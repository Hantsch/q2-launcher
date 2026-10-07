import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SERVERS_EVENTS } from '@shared/modules/servers'
import type { ScanServerResult, QueryServerFn } from './scan-runner'
import type { ServerQueryResult } from './server-query'
import { createScanService, SCAN_ALREADY_RUNNING_REASON_KEY } from './scan-service'
import {
  fakeLaunch,
  recorder,
  baseState,
  manualEntry,
  infoOk,
  noReply,
  deferredQuery,
  tick,
  waitForIdle,
} from './scan-service.test-helpers'

describe('createScanService', () => {
  it('AC5: start() emits scan.changed, then one scan.server per row in arrival order', async () => {
    const { emit, events } = recorder()
    const state = baseState({
      manualServers: [manualEntry('1.1.1.1:27910'), manualEntry('2.2.2.2:27910')],
    })
    let call = 0
    const queryServer: QueryServerFn = async () =>
      call++ === 0 ? infoOk('First') : infoOk('Second')
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    expect(service.start()).toEqual({ ok: true })
    expect(events[0]).toEqual({ type: SERVERS_EVENTS.scanChanged, payload: expect.any(Object) })

    await waitForIdle(service)

    const serverEvents = events.filter((event) => event.type === SERVERS_EVENTS.scanServer)
    expect(serverEvents).toHaveLength(2)
    expect((serverEvents[0]!.payload as ScanServerResult).target.address).toBe('1.1.1.1:27910')
    expect((serverEvents[1]!.payload as ScanServerResult).target.address).toBe('2.2.2.2:27910')

    const snapshot = service.read()
    expect(snapshot.state.running).toBe(false)
    expect(snapshot.entries.map((entry) => entry.address).sort()).toEqual([
      '1.1.1.1:27910',
      '2.2.2.2:27910',
    ])
  })

  it('D-L: a second start() while one is running is refused and never starts a second sweep', async () => {
    const { emit } = recorder()
    const state = baseState({ manualServers: [manualEntry('9.9.9.9:27910')] })
    const { fn: queryServer, calls } = deferredQuery()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    expect(service.start()).toEqual({ ok: true })
    expect(service.start({ selectedAddress: 'irrelevant' })).toEqual({
      ok: false,
      reasonKey: SCAN_ALREADY_RUNNING_REASON_KEY,
    })

    await tick()
    await tick()

    // Only the first `start()` ever reached the runner - the refusal issued no query of its own.
    expect(calls).toHaveLength(1)
    expect(service.read().state.running).toBe(true)
  })

  it('D-K: a server that misses a later scan keeps its previous row flagged stale, never zeroed', async () => {
    const { emit } = recorder()
    const address = '3.3.3.3:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    let reply: ServerQueryResult = infoOk('Arena')
    const queryServer: QueryServerFn = async () => reply
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // First scan: the server answers.
    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)

    const afterFirst = service.read().entries.find((entry) => entry.address === address)
    expect(afterFirst).toMatchObject({ status: 'online', name: 'Arena' })

    // Second scan: the same server does not answer this time.
    reply = noReply
    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)

    const afterSecond = service.read().entries.find((entry) => entry.address === address)
    expect(afterSecond).toMatchObject({ status: 'stale', name: 'Arena' })
    // Never reported as freshly empty - the previous row's fields (and its lastSeenAt) survive.
    expect(afterSecond?.lastSeenAt).toBe(afterFirst?.lastSeenAt)
  })

  it('review fix: an aborted sweep never stale-flips an entry it did not get to answer', async () => {
    const { emit } = recorder()
    const address = '3.3.3.4:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    const { fn: queryServer, calls } = deferredQuery()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // First scan: the server answers and gets a normal 'online' row.
    expect(service.start()).toEqual({ ok: true })
    for (let i = 0; i < 10 && calls.length === 0; i++) await tick()
    calls[0]!.resolve(infoOk('Arena'))
    await waitForIdle(service)
    const afterFirst = service.read().entries.find((entry) => entry.address === address)
    expect(afterFirst).toMatchObject({ status: 'online', name: 'Arena' })

    // Second scan: aborted (dispose()) before its query ever resolves - `runScan` settles with
    // `aborted: true` and never got an answer for this address at all, which is not the same as
    // "the server was silent". The previous row must stay exactly as it was: still 'online', not
    // downgraded to 'stale'.
    expect(service.start()).toEqual({ ok: true })
    for (let i = 0; i < 10 && calls.length === 1; i++) await tick()
    expect(calls).toHaveLength(2)
    service.dispose()
    await waitForIdle(service)

    const afterAbort = service.read().entries.find((entry) => entry.address === address)
    expect(afterAbort).toMatchObject({ status: 'online', name: 'Arena' })
    expect(afterAbort?.lastSeenAt).toBe(afterFirst?.lastSeenAt)
  })

  it('D-D: read() gives a coherent mid-scan snapshot for a renderer that mounts mid-scan', async () => {
    const { emit } = recorder()
    const address = '4.4.4.4:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    const { fn: queryServer, calls } = deferredQuery()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    expect(service.start()).toEqual({ ok: true })
    // Let resolveSources/buildScanAddressSet/runScan reach the pool and issue the query.
    for (let i = 0; i < 10 && calls.length === 0; i++) await tick()
    expect(calls).toHaveLength(1)

    const mid = service.read()
    expect(mid.state.running).toBe(true)
    expect(mid.state.phase).toBe('stage1')
    // No successful reply has landed yet, so the only row is the manual address's own pending
    // placeholder (story S25 D2) - not the "not even a placeholder" empty list this used to assert
    // before placeholders existed.
    expect(mid.entries).toEqual([
      { address, origins: ['manual'], status: 'pending', lastSeenAt: null, favourite: false },
    ])

    calls[0]!.resolve(infoOk('Mounted'))
    await waitForIdle(service)

    const done = service.read()
    expect(done.state.running).toBe(false)
    expect(done.entries).toHaveLength(1)
    expect(done.entries[0]).toMatchObject({ address, status: 'online', name: 'Mounted' })
  })

  it('overview() reports the real entry count and scanning flag, and keeps lastScanAt across the next scan', async () => {
    const { emit } = recorder()
    const state = baseState({ manualServers: [manualEntry('5.5.5.5:27910')] })
    const queryServer: QueryServerFn = async () => infoOk()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    expect(service.overview()).toEqual({ scanning: false, knownServerCount: 0, lastScanAt: null })

    service.start()
    expect(service.overview().scanning).toBe(true)

    await waitForIdle(service)
    const afterFirst = service.overview()
    expect(afterFirst).toEqual({
      scanning: false,
      knownServerCount: 1,
      lastScanAt: expect.any(String),
    })

    // A second scan starting does not blank `lastScanAt` back to `null` while it runs - only the
    // live `ServersScanState.finishedAt` does that (see the file doc comment).
    service.start()
    expect(service.overview().lastScanAt).toBe(afterFirst.lastScanAt)
    await waitForIdle(service)
  })

  it('needpass bit 0 decides the password flag', async () => {
    const { emit } = recorder()
    const address = '20.0.0.1:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    let needpass = '1'
    const queryServer: QueryServerFn = async () => ({
      ok: true,
      kind: 'info',
      reply: { ok: true, serverinfo: { hostname: 'Host', needpass }, clients: undefined },
      rttMs: 5,
    })
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // needpass=1 (bit 0 set) -> true
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      needpass: true,
    })

    // needpass=3 (bit 0 set, plus another flag) -> true
    needpass = '3'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      needpass: true,
    })

    // needpass=0 -> false
    needpass = '0'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      needpass: false,
    })

    // needpass=2 (bit 0 clear) -> false
    needpass = '2'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      needpass: false,
    })
  })

  it('needpass bit 1 sets spectatorPass', async () => {
    const { emit } = recorder()
    const address = '20.0.0.5:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    let needpass = '2'
    const queryServer: QueryServerFn = async () => ({
      ok: true,
      kind: 'info',
      reply: { ok: true, serverinfo: { hostname: 'Host', needpass }, clients: undefined },
      rttMs: 5,
    })
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // needpass=2 (bit 1 set) -> true
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      spectatorPass: true,
    })

    // needpass=3 (bit 1 set, plus bit 0) -> true
    needpass = '3'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      spectatorPass: true,
    })

    // needpass=0 -> false
    needpass = '0'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      spectatorPass: false,
    })

    // needpass=1 (bit 1 clear) -> false
    needpass = '1'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      spectatorPass: false,
    })
  })

  it('garbage or absent needpass keeps the previous spectatorPass value', async () => {
    const { emit } = recorder()
    const address = '20.0.0.6:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    let needpass: string | undefined = 'not-a-number'
    const queryServer: QueryServerFn = async () => {
      const serverinfo: Record<string, string> = { hostname: 'Host' }
      if (needpass !== undefined) serverinfo.needpass = needpass
      return {
        ok: true,
        kind: 'info',
        reply: { ok: true, serverinfo, clients: undefined },
        rttMs: 5,
      }
    }
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // garbage needpass -> no previous value, stays undefined
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)?.spectatorPass).toBeUndefined()

    // a valid reply establishes spectatorPass: true
    needpass = '2'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      spectatorPass: true,
    })

    // an absent needpass afterwards keeps the previously established value
    needpass = undefined
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      spectatorPass: true,
    })
  })

  it("a status reply's mode flags become the entry's gamemode and survive an info-only reply", async () => {
    const { emit } = recorder()
    const address = '20.0.0.2:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    let call = 0
    const queryServer: QueryServerFn = async () => {
      call++
      if (call === 1) {
        // First scan: a status reply with ctf=1, so the gamemode should derive to 'ctf'.
        return {
          ok: true,
          kind: 'status',
          reply: {
            ok: true,
            serverinfo: { hostname: 'Host', gamename: 'baseq2', ctf: '1' },
            players: [],
          },
          rttMs: 5,
        }
      }
      // Second scan: an info-only reply that says nothing about gamemode flags at all - the
      // previously derived gamemode must survive rather than being cleared.
      return infoOk('Host')
    }
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    service.start({ selectedAddress: address })
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      gamemode: 'ctf',
    })

    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      gamemode: 'ctf',
    })
  })

  it('read marks favourite from the live favourites list', async () => {
    const { emit } = recorder()
    const address = '20.0.0.3:27910'
    const state = baseState({ favourites: [{ address, addedAt: new Date().toISOString() }] })
    const queryServer: QueryServerFn = async () => infoOk('Fav')
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      favourite: true,
    })

    // The favourites list changes between two read() calls - the very next read() must reflect it,
    // with no new scan needed.
    state.favourites = []
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({
      favourite: false,
    })
  })

  it('story 124 D1: every successful reply appends one RTT sample across rounds, and a timeout appends a no-answer sample', async () => {
    const { emit } = recorder()
    const address = '20.0.0.9:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    const infoOkWithRtt = (rttMs: number): ServerQueryResult => ({
      ok: true,
      kind: 'info',
      reply: { ok: true, serverinfo: { hostname: 'Arena' }, clients: 0 },
      rttMs,
    })
    let reply: ServerQueryResult = infoOkWithRtt(11)
    const queryServer: QueryServerFn = async () => reply
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // Round 1: a successful reply with rttMs 11.
    service.start()
    await waitForIdle(service)
    let row = service.read().entries.find((entry) => entry.address === address)
    expect(row?.rttHistory).toEqual([{ at: expect.any(String), rttMs: 11 }])

    // Round 2: a successful reply with a different rttMs (22) - the history grows, oldest first.
    reply = infoOkWithRtt(22)
    service.start()
    await waitForIdle(service)
    row = service.read().entries.find((entry) => entry.address === address)
    expect(row?.rttHistory).toEqual([
      { at: expect.any(String), rttMs: 11 },
      { at: expect.any(String), rttMs: 22 },
    ])

    // Round 3: a timeout - the last sample is a no-answer one and the row goes stale.
    reply = noReply
    service.start()
    await waitForIdle(service)
    row = service.read().entries.find((entry) => entry.address === address)
    expect(row?.status).toBe('stale')
    expect(row?.rttHistory).toHaveLength(3)
    expect(row?.rttHistory?.at(-1)).toEqual({ at: expect.any(String), rttMs: null })
  })

  it('read lists a never-answered favourite or manual server as a pending placeholder, and no master-only address', async () => {
    const { emit } = recorder()
    const favAddress = '20.0.0.4:27910'
    const manualAddress = '20.0.0.5:27910'
    const masterOnlyAddress = '20.0.0.6:27910'
    const state = baseState({
      favourites: [{ address: favAddress, addedAt: new Date().toISOString() }],
      manualServers: [manualEntry(manualAddress)],
    })
    // Nothing ever answers - `mergeStaleRound` never creates rows for these since they have no
    // pre-existing entry and this test never runs a scan at all, so `read()` alone must produce the
    // placeholders.
    const queryServer: QueryServerFn = async () => noReply
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    const snapshot = service.read()
    const favRow = snapshot.entries.find((e) => e.address === favAddress)
    const manualRow = snapshot.entries.find((e) => e.address === manualAddress)

    expect(favRow).toMatchObject({
      status: 'pending',
      lastSeenAt: null,
      favourite: true,
      origins: ['favourite'],
    })
    expect(manualRow).toMatchObject({
      status: 'pending',
      lastSeenAt: null,
      favourite: false,
      origins: ['manual'],
    })
    expect(snapshot.entries.some((e) => e.address === masterOnlyAddress)).toBe(false)
    expect(snapshot.entries).toHaveLength(2)
  })

  it("story 131 D4: onStage2Row fires synchronously for stage2 rows only, after the scan's own emit, and never delays or alters the scan", async () => {
    // Both scans below are compared field-for-field, timestamps included - freeze the clock
    // (Date only; setImmediate stays real for waitForIdle) so a millisecond boundary crossed
    // between the two runs cannot make them differ.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T00:00:00.000Z') })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const address = '30.0.0.1:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    // A status reply with clients>0 so stage1 queues a stage2 status query for the same address.
    const queryServer: QueryServerFn = async (_target, opts) =>
      opts.kind === 'info'
        ? {
            ok: true,
            kind: 'info',
            reply: { ok: true, serverinfo: { hostname: 'Arena' }, clients: 1 },
            rttMs: 5,
          }
        : {
            ok: true,
            kind: 'status',
            reply: { ok: true, serverinfo: { hostname: 'Arena' }, players: [] },
            rttMs: 5,
          }

    // Baseline run with no hook at all, to compare event sequence/timing against.
    const { emit: emitBaseline, events: baselineEvents } = recorder()
    const baselineService = createScanService({
      getServersState: () => state,
      emit: emitBaseline,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })
    expect(baselineService.start()).toEqual({ ok: true })
    await waitForIdle(baselineService)
    const baselineServerEvents = baselineEvents.filter((e) => e.type === SERVERS_EVENTS.scanServer)

    // A hook that throws synchronously and records every call it received.
    const hookCalls: string[] = []
    const { emit, events } = recorder()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
      onStage2Row: (row) => {
        hookCalls.push(row.stage)
        throw new Error('watchlist observer blew up')
      },
    })

    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)

    const serverEvents = events.filter((e) => e.type === SERVERS_EVENTS.scanServer)
    // Identical scan.server sequence whether or not the (throwing) hook is set.
    expect(serverEvents).toEqual(baselineServerEvents)
    expect(service.read().entries).toEqual(baselineService.read().entries)

    // Only called for the stage2 row, exactly once, and it did not stop the scan from finishing.
    expect(hookCalls).toEqual(['stage2'])
    expect(service.read().state.running).toBe(false)
  })
})
