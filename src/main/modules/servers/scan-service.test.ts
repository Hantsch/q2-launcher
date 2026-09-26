import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SERVERS_STATE,
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  SERVERS_EVENTS,
  type ServersScanState,
  type ServersState,
} from '@shared/modules/servers'
import { IDLE_LAUNCH_STATE, type LaunchState } from '@shared/types'
import type { LaunchHost } from '../../services/write-guard'
import type { FetchImpl } from '../downloads/fetcher'
import type { ScanServerResult, QueryServerFn } from './scan-runner'
import type { ServerQueryResult } from './server-query'
import { createScanService, SCAN_ALREADY_RUNNING_REASON_KEY, type ScanService } from './scan-service'

/**
 * Story 114 D6. The service is the one thing in this story that is genuinely stateful, so these
 * tests drive it through its public surface only (`start`/`read`/`overview`/`dispose`) with a fake
 * `queryServer` - never a real socket, never a real `fetch` - and assert on the emitted event
 * sequence and on `read()`/`overview()` snapshots, the same way `scan-runner.test.ts` asserts on
 * `runScan`'s own callbacks.
 *
 * Every state fixture below disables/empties `sources` so `resolveSources` never has an enabled
 * source to resolve (no `fetchImpl`/`udpImpl` fake needed at all) - the address set comes entirely
 * from `favourites`/`manualServers`, which is all `buildScanAddressSet` needs to produce targets.
 */

type RecordedEvent = { type: string; payload: unknown }

/** Story 116 D3: a controllable `LaunchHost`, mirroring `write-guard.test.ts`'s `fakeLaunch` -
 * `set()` updates `getState()` first and then notifies, the same order `LaunchService.setState` uses. */
function fakeLaunch(initial: LaunchState = IDLE_LAUNCH_STATE): {
  host: LaunchHost
  set: (next: LaunchState) => void
  listenerCount: () => number
} {
  let current = initial
  const listeners = new Set<(next: LaunchState) => void>()
  const host: LaunchHost = {
    getState: () => current,
    onStateChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    host,
    set: (next) => {
      current = next
      for (const listener of [...listeners]) listener(next)
    },
    listenerCount: () => listeners.size,
  }
}

const RUNNING: LaunchState = { phase: 'running', installationId: 'inst-1' }

function recorder(): { emit: (type: string, payload: unknown) => void; events: RecordedEvent[] } {
  const events: RecordedEvent[] = []
  return { emit: (type, payload) => events.push({ type, payload }), events }
}

function baseState(overrides: Partial<ServersState> = {}): ServersState {
  return {
    ...DEFAULT_SERVERS_STATE,
    sources: [],
    favourites: [],
    manualServers: [],
    history: [],
    ...overrides,
  }
}

function manualEntry(address: string): ServersState['manualServers'][number] {
  return { address, origin: 'manual', addedAt: new Date().toISOString() }
}

/** A well-formed `info` reply reporting zero clients, so `runScan` never queues a stage 2 query for
 * it (a *known* empty reply, per `scan-runner.ts`'s `isWorthStage2`) - keeps every test below to a
 * single stage1-only row per target. */
function infoOk(hostname = 'Host'): ServerQueryResult {
  return { ok: true, kind: 'info', reply: { ok: true, serverinfo: { hostname }, clients: 0 }, rttMs: 7 }
}

const noReply: ServerQueryResult = { ok: false, reason: 'no-reply' }

/** A `queryServer` fake whose replies are deferred promises resolved by hand - lets a test pause a
 * scan mid-flight (D-D) or leave it running forever (D-L) without any real timers. */
function deferredQuery(): {
  fn: QueryServerFn
  calls: { address: string; resolve: (result: ServerQueryResult) => void }[]
} {
  const calls: { address: string; resolve: (result: ServerQueryResult) => void }[] = []
  const fn: QueryServerFn = (target) =>
    new Promise((resolve) => {
      calls.push({ address: `${target.host}:${target.port}`, resolve })
    })
  return { fn, calls }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Polls `service.read().state.running` a few ticks at a time - the fixtures here never touch a
 * real timer, so a handful of microtask/macrotask flushes is always enough once every deferred
 * query has been resolved. */
async function waitForIdle(service: ScanService, maxTicks = 20): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (!service.read().state.running) return
    await tick()
  }
  throw new Error('scan did not settle in time')
}

describe('createScanService', () => {
  it('AC5: start() emits scan.changed, then one scan.server per row in arrival order', async () => {
    const { emit, events } = recorder()
    const state = baseState({
      manualServers: [manualEntry('1.1.1.1:27910'), manualEntry('2.2.2.2:27910')],
    })
    let call = 0
    const queryServer: QueryServerFn = async () => (call++ === 0 ? infoOk('First') : infoOk('Second'))
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

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

  it("D-K: a server that misses a later scan keeps its previous row flagged stale, never zeroed", async () => {
    const { emit } = recorder()
    const address = '3.3.3.3:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    let reply: ServerQueryResult = infoOk('Arena')
    const queryServer: QueryServerFn = async () => reply
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

    // needpass=1 (bit 0 set) -> true
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ needpass: true })

    // needpass=3 (bit 0 set, plus another flag) -> true
    needpass = '3'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ needpass: true })

    // needpass=0 -> false
    needpass = '0'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ needpass: false })

    // needpass=2 (bit 0 clear) -> false
    needpass = '2'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ needpass: false })
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
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

    // needpass=2 (bit 1 set) -> true
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ spectatorPass: true })

    // needpass=3 (bit 1 set, plus bit 0) -> true
    needpass = '3'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ spectatorPass: true })

    // needpass=0 -> false
    needpass = '0'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ spectatorPass: false })

    // needpass=1 (bit 1 clear) -> false
    needpass = '1'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ spectatorPass: false })
  })

  it('garbage or absent needpass keeps the previous spectatorPass value', async () => {
    const { emit } = recorder()
    const address = '20.0.0.6:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    let needpass: string | undefined = 'not-a-number'
    const queryServer: QueryServerFn = async () => {
      const serverinfo: Record<string, string> = { hostname: 'Host' }
      if (needpass !== undefined) serverinfo.needpass = needpass
      return { ok: true, kind: 'info', reply: { ok: true, serverinfo, clients: undefined }, rttMs: 5 }
    }
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

    // garbage needpass -> no previous value, stays undefined
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)?.spectatorPass).toBeUndefined()

    // a valid reply establishes spectatorPass: true
    needpass = '2'
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ spectatorPass: true })

    // an absent needpass afterwards keeps the previously established value
    needpass = undefined
    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ spectatorPass: true })
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
          reply: { ok: true, serverinfo: { hostname: 'Host', ctf: '1' }, players: [] },
          rttMs: 5,
        }
      }
      // Second scan: an info-only reply that says nothing about gamemode flags at all - the
      // previously derived gamemode must survive rather than being cleared.
      return infoOk('Host')
    }
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

    service.start({ selectedAddress: address })
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ gamemode: 'ctf' })

    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ gamemode: 'ctf' })
  })

  it('read marks favourite from the live favourites list', async () => {
    const { emit } = recorder()
    const address = '20.0.0.3:27910'
    const state = baseState({ favourites: [{ address, addedAt: new Date().toISOString() }] })
    const queryServer: QueryServerFn = async () => infoOk('Fav')
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

    service.start()
    await waitForIdle(service)
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ favourite: true })

    // The favourites list changes between two read() calls - the very next read() must reflect it,
    // with no new scan needed.
    state.favourites = []
    expect(service.read().entries.find((e) => e.address === address)).toMatchObject({ favourite: false })
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
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer } })

    const snapshot = service.read()
    const favRow = snapshot.entries.find((e) => e.address === favAddress)
    const manualRow = snapshot.entries.find((e) => e.address === manualAddress)

    expect(favRow).toMatchObject({ status: 'pending', lastSeenAt: null, favourite: true, origins: ['favourite'] })
    expect(manualRow).toMatchObject({ status: 'pending', lastSeenAt: null, favourite: false, origins: ['manual'] })
    expect(snapshot.entries.some((e) => e.address === masterOnlyAddress)).toBe(false)
    expect(snapshot.entries).toHaveLength(2)
  })

  it('story 131 D4: onStage2Row fires synchronously for stage2 rows only, after the scan\'s own emit, and never delays or alters the scan', async () => {
    const address = '30.0.0.1:27910'
    const state = baseState({ manualServers: [manualEntry(address)] })
    // A status reply with clients>0 so stage1 queues a stage2 status query for the same address.
    const queryServer: QueryServerFn = async (_target, opts) =>
      opts.kind === 'info'
        ? { ok: true, kind: 'info', reply: { ok: true, serverinfo: { hostname: 'Arena' }, clients: 1 }, rttMs: 5 }
        : { ok: true, kind: 'status', reply: { ok: true, serverinfo: { hostname: 'Arena' }, players: [] }, rttMs: 5 }

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

describe('createScanService - story 116 D3 game-running guard', () => {
  function changedStates(events: RecordedEvent[]): ServersScanState[] {
    return events
      .filter((event) => event.type === SERVERS_EVENTS.scanChanged)
      .map((event) => event.payload as ServersScanState)
  }

  it('AC2: a manual scan while the game runs is refused, not queued, and no sweep runs', async () => {
    const { emit, events } = recorder()
    const state = baseState({ manualServers: [manualEntry('6.6.6.6:27910')] })
    const { fn: queryServer, calls } = deferredQuery()
    const launch = fakeLaunch(RUNNING)
    const service = createScanService({ getServersState: () => state, emit, launch: launch.host, deps: { queryServer } })

    expect(service.start()).toEqual({ ok: false, reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY })
    // `starting` blocks just the same (D-D's exact predicate); a `selectedAddress` changes nothing.
    launch.set({ phase: 'starting', installationId: 'inst-1' })
    expect(service.start({ selectedAddress: '6.6.6.6:27910' })).toEqual({ ok: false, reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY })

    await tick()
    await tick()
    expect(calls).toHaveLength(0)
    expect(service.read().state).toMatchObject({ running: false, phase: 'idle', startedAt: null })
    expect(service.read().state.blockedReason).toBe('game-running')
    expect(service.overview()).toEqual({ scanning: false, knownServerCount: 0, lastScanAt: null })
    expect(changedStates(events).some((s) => s.running)).toBe(false)

    // Not queued: ending the session starts nothing by itself - the service has no memory of the
    // refused call (a resumed *automatic* scan is scan-cadence.ts's job, D-G).
    launch.set({ phase: 'exited', installationId: 'inst-1' })
    await tick()
    await tick()
    expect(calls).toHaveLength(0)
    expect(service.read().state.running).toBe(false)

    // ...and the very next manual call goes through normally.
    expect(service.start()).toEqual({ ok: true })
    for (let i = 0; i < 10 && calls.length === 0; i++) await tick()
    expect(calls).toHaveLength(1)
    service.dispose()
    await waitForIdle(service)
  })

  it('the game-running refusal wins over the single-flight refusal', () => {
    const { emit } = recorder()
    const state = baseState({ manualServers: [manualEntry('6.6.6.7:27910')] })
    const { fn: queryServer } = deferredQuery()
    const launch = fakeLaunch()
    const service = createScanService({ getServersState: () => state, emit, launch: launch.host, deps: { queryServer } })

    expect(service.start()).toEqual({ ok: true })
    launch.set(RUNNING)
    expect(service.start()).toEqual({ ok: false, reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY })
    service.dispose()
  })

  it('AC1/AC4: blockedReason mirrors the live launch state and clears the moment the session ends', () => {
    const { emit, events } = recorder()
    const launch = fakeLaunch()
    const service = createScanService({ getServersState: () => baseState(), emit, launch: launch.host })

    expect(service.read().state.blockedReason).toBeNull()

    // Published as soon as a session is live - before any scan attempt, so a skipped automatic
    // round (which never reaches `start()`) is visible too.
    launch.set({ phase: 'starting', installationId: 'inst-1' })
    expect(service.read().state.blockedReason).toBe('game-running')
    expect(changedStates(events).at(-1)?.blockedReason).toBe('game-running')

    // starting -> running changes nothing visible: no duplicate push.
    const pushesWhileBlocked = changedStates(events).length
    launch.set(RUNNING)
    expect(changedStates(events)).toHaveLength(pushesWhileBlocked)

    // Out of the active phase: cleared and pushed, with no scan attempt needed.
    launch.set({ phase: 'exited', installationId: 'inst-1' })
    expect(service.read().state.blockedReason).toBeNull()
    expect(changedStates(events).at(-1)?.blockedReason).toBeNull()
    expect(changedStates(events)).toHaveLength(pushesWhileBlocked + 1)

    // handed-off never blocks (D-D).
    launch.set({ phase: 'handed-off', installationId: 'inst-1' })
    expect(service.read().state.blockedReason).toBeNull()
    expect(changedStates(events)).toHaveLength(pushesWhileBlocked + 1)
  })

  it('a service constructed mid-session starts blocked, and dispose() drops the launch subscription', () => {
    const { emit, events } = recorder()
    const launch = fakeLaunch(RUNNING)
    const service = createScanService({ getServersState: () => baseState(), emit, launch: launch.host })

    expect(service.read().state.blockedReason).toBe('game-running')
    expect(launch.listenerCount()).toBe(1)

    service.dispose()
    expect(launch.listenerCount()).toBe(0)
    launch.set(IDLE_LAUNCH_STATE)
    expect(events).toHaveLength(0)
  })
})

describe('createScanService - story 117 D3 scoped rounds', () => {
  type QueryCall = { address: string; kind: 'info' | 'status' }

  /** Records every `(address, kind)` query and answers from a mutable per-address script -
   * `noReply` for any address the script does not name. */
  function scriptedQuery(): {
    fn: QueryServerFn
    calls: QueryCall[]
    replies: Map<string, ServerQueryResult>
  } {
    const calls: QueryCall[] = []
    const replies = new Map<string, ServerQueryResult>()
    const fn: QueryServerFn = async (target, options) => {
      const address = `${target.host}:${target.port}`
      calls.push({ address, kind: options.kind })
      if (options.kind === 'status') {
        const scripted = replies.get(address)
        return scripted === undefined || !scripted.ok
          ? noReply
          : { ok: true, kind: 'status', reply: { ok: true, serverinfo: { hostname: 'Status' }, players: [] }, rttMs: 9 }
      }
      return replies.get(address) ?? noReply
    }
    return { fn, calls, replies }
  }

  /** An enabled http-list source whose fetch is recorded and always fails - proves whether a round
   * resolved sources at all without any real network. */
  function recordingFetch(): { fetchImpl: FetchImpl; fetchCalls: string[] } {
    const fetchCalls: string[] = []
    const fetchImpl: FetchImpl = async (url) => {
      fetchCalls.push(url)
      throw new Error('offline')
    }
    return { fetchImpl, fetchCalls }
  }

  const SOURCE: ServersState['sources'][number] = {
    id: 'src-1',
    type: 'http-list',
    address: 'http://example.invalid/servers.txt',
    enabled: true,
  }

  function favouriteEntry(address: string): ServersState['favourites'][number] {
    return { address, addedAt: new Date().toISOString() }
  }

  const FAV_1 = '10.0.0.1:27910'
  const FAV_2 = '10.0.0.2:27910'
  const MANUAL = '10.0.0.3:27910'
  const OTHER = '10.0.0.4:27910'

  function disjointState(): ServersState {
    return baseState({
      sources: [SOURCE],
      favourites: [favouriteEntry(FAV_1), favouriteEntry(FAV_2)],
      manualServers: [manualEntry(MANUAL), manualEntry(OTHER)],
    })
  }

  it("'all' (the default) is unchanged: resolves sources, queries the full set, honours selectedAddress", async () => {
    const { emit } = recorder()
    const state = disjointState()
    const query = scriptedQuery()
    const { fetchImpl, fetchCalls } = recordingFetch()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer: query.fn, fetchImpl },
    })

    expect(service.start({ selectedAddress: MANUAL })).toEqual({ ok: true })
    expect(service.read().state.scope).toEqual({ kind: 'all' })
    await waitForIdle(service)

    expect(fetchCalls).toHaveLength(1)
    expect(service.read().state.sourceFailures).toHaveLength(1)
    expect(query.calls.filter((c) => c.kind === 'info').map((c) => c.address).sort()).toEqual(
      [FAV_1, FAV_2, MANUAL, OTHER].sort(),
    )
    // 114's selected-server rule still applies to a full scan: status for the selected address.
    expect(query.calls.filter((c) => c.kind === 'status')).toEqual([{ address: MANUAL, kind: 'status' }])
    // Persisted after the round, so the final scan.changed still names the scope.
    expect(service.read().state.scope).toEqual({ kind: 'all' })
  })

  it('AC2: a favourites scope queries only favourite addresses, not sources or manual servers', async () => {
    const { emit } = recorder()
    const state = disjointState()
    const query = scriptedQuery()
    const { fetchImpl, fetchCalls } = recordingFetch()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer: query.fn, fetchImpl },
    })

    // A selectedAddress outside the scope is ignored - it must not smuggle in a status query.
    expect(service.start({ scope: { kind: 'favourites' }, selectedAddress: MANUAL })).toEqual({ ok: true })
    await waitForIdle(service)

    expect(fetchCalls).toHaveLength(0)
    expect(query.calls.map((c) => c.address).sort()).toEqual([FAV_1, FAV_2])
    expect(query.calls.every((c) => c.kind === 'info')).toBe(true)
    expect(service.read().state).toMatchObject({ sourceFailures: [], scope: { kind: 'favourites' } })
  })

  it('AC3: a single-server scope sends one status query and no info query', async () => {
    const { emit } = recorder()
    const state = disjointState()
    const query = scriptedQuery()
    query.replies.set(MANUAL, infoOk())
    const { fetchImpl, fetchCalls } = recordingFetch()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer: query.fn, fetchImpl },
    })

    expect(service.start({ scope: { kind: 'server', address: MANUAL } })).toEqual({ ok: true })
    await waitForIdle(service)

    expect(fetchCalls).toHaveLength(0)
    expect(query.calls).toEqual([{ address: MANUAL, kind: 'status' }])
    expect(service.read().state).toMatchObject({ stage1Total: 0, stage2Total: 1, sourceFailures: [] })
    // The queried address gets its real row; every other favourite/manual address that has never
    // answered gets a pending placeholder (story S25 D2) - a single-server scope never touches them.
    const entries = service.read().entries
    expect(entries.find((e) => e.address === MANUAL)).toEqual(
      expect.objectContaining({ address: MANUAL, status: 'online', name: 'Status', players: [] }),
    )
    expect(entries.filter((e) => e.status === 'pending').map((e) => e.address).sort()).toEqual(
      [FAV_1, FAV_2, OTHER].sort(),
    )
    expect(entries).toHaveLength(4)
  })

  it('an out-of-scope row keeps its data and stale flag after a favourites round; in-scope silence goes stale', async () => {
    const { emit } = recorder()
    const state = baseState({
      favourites: [favouriteEntry(FAV_1)],
      manualServers: [manualEntry(MANUAL), manualEntry(OTHER)],
    })
    const query = scriptedQuery()
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer: query.fn } })
    const entryOf = (address: string) => service.read().entries.find((entry) => entry.address === address)

    // Round 1 (all): everyone answers.
    query.replies.set(FAV_1, infoOk('Fav'))
    query.replies.set(MANUAL, infoOk('Manual'))
    query.replies.set(OTHER, infoOk('Other'))
    service.start()
    await waitForIdle(service)

    // Round 2 (all): OTHER is silent, so it is stale going into the scoped round.
    query.replies.delete(OTHER)
    service.start()
    await waitForIdle(service)
    expect(entryOf(OTHER)).toMatchObject({ status: 'stale', name: 'Other' })

    const manualBefore = structuredClone(entryOf(MANUAL))
    const otherBefore = structuredClone(entryOf(OTHER))

    // Round 3 (favourites): the favourite is silent; neither manual server is asked. MANUAL now
    // would not answer either - if the round named it, it would wrongly go stale.
    query.replies.delete(FAV_1)
    query.replies.delete(MANUAL)
    query.calls.length = 0
    expect(service.start({ scope: { kind: 'favourites' } })).toEqual({ ok: true })
    await waitForIdle(service)

    expect(query.calls).toEqual([{ address: FAV_1, kind: 'info' }])
    expect(entryOf(FAV_1)).toMatchObject({ status: 'stale', name: 'Fav' })
    expect(entryOf(MANUAL)).toEqual(manualBefore)
    expect(entryOf(OTHER)).toEqual(otherBefore)
    expect(service.read().entries).toHaveLength(3)
  })

  it('a timed-out single-server refresh flips only that row stale and leaves every other row untouched', async () => {
    const { emit } = recorder()
    const state = baseState({ favourites: [favouriteEntry(FAV_1)], manualServers: [manualEntry(MANUAL)] })
    const query = scriptedQuery()
    const service = createScanService({ getServersState: () => state, emit, launch: fakeLaunch().host, deps: { queryServer: query.fn } })
    const entryOf = (address: string) => service.read().entries.find((entry) => entry.address === address)

    query.replies.set(FAV_1, infoOk('Fav'))
    query.replies.set(MANUAL, infoOk('Manual'))
    service.start()
    await waitForIdle(service)

    const manualBefore = structuredClone(entryOf(MANUAL))
    const favBefore = structuredClone(entryOf(FAV_1))

    // Neither server would answer now; only FAV_1 is asked.
    query.replies.clear()
    query.calls.length = 0
    expect(service.start({ scope: { kind: 'server', address: FAV_1 } })).toEqual({ ok: true })
    await waitForIdle(service)

    expect(query.calls).toEqual([{ address: FAV_1, kind: 'status' }])
    expect(entryOf(FAV_1)).toEqual({
      ...favBefore,
      status: 'stale',
      rttHistory: [...(favBefore?.rttHistory ?? []), { at: expect.any(String), rttMs: null }],
    })
    expect(entryOf(MANUAL)).toEqual(manualBefore)
  })

  it('single-flight and the game guard refuse a scoped start exactly like a full one', () => {
    const { emit } = recorder()
    const { fn: queryServer, calls } = deferredQuery()
    const launch = fakeLaunch()
    const state = baseState({ manualServers: [manualEntry(MANUAL)] })
    const service = createScanService({ getServersState: () => state, emit, launch: launch.host, deps: { queryServer } })

    expect(service.start()).toEqual({ ok: true })
    expect(service.start({ scope: { kind: 'server', address: OTHER } })).toEqual({
      ok: false,
      reasonKey: SCAN_ALREADY_RUNNING_REASON_KEY,
    })
    expect(service.read().state.scope).toEqual({ kind: 'all' })

    launch.set(RUNNING)
    expect(service.start({ scope: { kind: 'favourites' } })).toEqual({
      ok: false,
      reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
    })
    expect(calls.every((call) => call.address === MANUAL)).toBe(true)
    service.dispose()
  })
})

describe('createScanService - readDetail (story 122 D2)', () => {
  const ADDR = '9.9.9.9:27910'

  function statusReply(serverinfo: Record<string, string>): ServerQueryResult {
    return { ok: true, kind: 'status', reply: { ok: true, serverinfo, players: [] }, rttMs: 5 }
  }

  it('readDetail returns the row and the last status serverinfo, kept while stale', async () => {
    const { emit } = recorder()
    const state = baseState({ manualServers: [manualEntry(ADDR)] })
    let current: QueryServerFn = async () => statusReply({ hostname: 'A', mapname: 'q2dm1' })
    const queryServer: QueryServerFn = (target, opts) => current(target, opts)
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // Round 1: status reply A.
    expect(service.start({ scope: { kind: 'server', address: ADDR } })).toEqual({ ok: true })
    await waitForIdle(service)
    expect(service.readDetail(ADDR)?.serverinfo).toEqual({ hostname: 'A', mapname: 'q2dm1' })

    // Round 2: status reply B, which lacks 'mapname' - the whole record is replaced, not merged.
    current = async () => statusReply({ hostname: 'B' })
    expect(service.start({ scope: { kind: 'server', address: ADDR } })).toEqual({ ok: true })
    await waitForIdle(service)
    expect(service.readDetail(ADDR)?.serverinfo).toEqual({ hostname: 'B' })

    // Round 3 (an 'info'-only round, scope 'all'): an info reply never touches statusInfo.
    current = async () => infoOk('C')
    expect(service.start({ scope: { kind: 'all' } })).toEqual({ ok: true })
    await waitForIdle(service)
    expect(service.readDetail(ADDR)?.serverinfo).toEqual({ hostname: 'B' })

    // Round 4: a timed-out single-server round leaves serverinfo unchanged and flips the row stale.
    current = async () => noReply
    expect(service.start({ scope: { kind: 'server', address: ADDR } })).toEqual({ ok: true })
    await waitForIdle(service)
    const detail = service.readDetail(ADDR)
    expect(detail?.serverinfo).toEqual({ hostname: 'B' })
    expect(detail?.row.status).toBe('stale')
  })

  it('readDetail is null for an unknown address and has null serverinfo for an info-only or pending row', async () => {
    const { emit } = recorder()
    const PENDING = '8.8.8.8:27910'
    const INFO_ONLY = '7.7.7.7:27910'
    const state = baseState({
      favourites: [{ address: PENDING, addedAt: new Date().toISOString() }],
      manualServers: [manualEntry(INFO_ONLY)],
    })
    const queryServer: QueryServerFn = async (target) =>
      `${target.host}:${target.port}` === INFO_ONLY ? infoOk('Info') : noReply
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // A single-server round touches only INFO_ONLY - PENDING is never queried by any round, so it
    // stays a placeholder row (never entered `entries` at all) rather than going stale.
    expect(service.start({ scope: { kind: 'server', address: INFO_ONLY } })).toEqual({ ok: true })
    await waitForIdle(service)

    expect(service.readDetail('1.2.3.4:27910')).toBeNull()

    const pendingDetail = service.readDetail(PENDING)
    expect(pendingDetail?.row.status).toBe('pending')
    expect(pendingDetail?.serverinfo).toBeNull()

    const infoDetail = service.readDetail(INFO_ONLY)
    expect(infoDetail?.row.status).toBe('online')
    expect(infoDetail?.serverinfo).toBeNull()
  })

  it("a status reply's full serverinfo is kept on the entry", async () => {
    const { emit } = recorder()
    const state = baseState({ manualServers: [manualEntry(ADDR)] })
    const queryServer: QueryServerFn = async () =>
      statusReply({ hostname: 'Modded', matchmode: '1' })
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    expect(service.start({ scope: { kind: 'server', address: ADDR } })).toEqual({ ok: true })
    await waitForIdle(service)

    expect(service.readDetail(ADDR)?.serverinfo).toEqual({ hostname: 'Modded', matchmode: '1' })
  })

  it('an info-only reply keeps the previous status serverinfo', async () => {
    const { emit } = recorder()
    const state = baseState({ manualServers: [manualEntry(ADDR)] })
    let current: QueryServerFn = async () => statusReply({ hostname: 'A' })
    const queryServer: QueryServerFn = (target, opts) => current(target, opts)
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // Round 1: a status reply establishes serverinfo.
    expect(service.start({ scope: { kind: 'server', address: ADDR } })).toEqual({ ok: true })
    await waitForIdle(service)
    expect(service.readDetail(ADDR)?.serverinfo).toEqual({ hostname: 'A' })

    // Round 2: an info-only reply, whose raw data carries a 'clients' key - it must never touch
    // (let alone leak into) statusInfo.
    current = async (): Promise<ServerQueryResult> => ({
      ok: true,
      kind: 'info',
      reply: { ok: true, serverinfo: { hostname: 'A-info' }, clients: 3 },
      rttMs: 7,
    })
    expect(service.start({ scope: { kind: 'server', address: ADDR } })).toEqual({ ok: true })
    await waitForIdle(service)

    const detail = service.readDetail(ADDR)
    expect(detail?.serverinfo).toEqual({ hostname: 'A' })
    expect(detail?.serverinfo).not.toHaveProperty('clients')
  })

  it('a stale round keeps the last serverinfo', async () => {
    const { emit } = recorder()
    const state = baseState({ manualServers: [manualEntry(ADDR)] })
    let current: QueryServerFn = async () => statusReply({ hostname: 'A' })
    const queryServer: QueryServerFn = (target, opts) => current(target, opts)
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer },
    })

    // Round 1: a status reply establishes serverinfo.
    expect(service.start({ scope: { kind: 'server', address: ADDR } })).toEqual({ ok: true })
    await waitForIdle(service)
    const before = service.readDetail(ADDR)?.serverinfo
    expect(before).toEqual({ hostname: 'A' })

    // Round 2: the address times out / gets no reply, going stale.
    current = async () => noReply
    expect(service.start({ scope: { kind: 'server', address: ADDR } })).toEqual({ ok: true })
    await waitForIdle(service)

    const detail = service.readDetail(ADDR)
    expect(detail?.serverinfo).toEqual(before)
    expect(detail?.row.status).toBe('stale')
  })
})
