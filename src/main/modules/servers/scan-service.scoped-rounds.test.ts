import { describe, expect, it } from 'vitest'
import {
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  SERVERS_EVENTS,
  type ServersScanState,
  type ServersState,
} from '@shared/modules/servers'
import { IDLE_LAUNCH_STATE } from '@shared/types'
import type { FetchImpl } from '../downloads/fetcher'
import type { QueryServerFn } from './scan-runner'
import type { ServerQueryResult } from './server-query'
import { createScanService, SCAN_ALREADY_RUNNING_REASON_KEY } from './scan-service'
import {
  type RecordedEvent,
  fakeLaunch,
  RUNNING,
  recorder,
  baseState,
  manualEntry,
  infoOk,
  noReply,
  deferredQuery,
  tick,
  waitForIdle,
} from './scan-service.test-helpers'

describe('createScanService - game-running guard', () => {
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
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: launch.host,
      deps: { queryServer },
    })

    expect(service.start()).toEqual({ ok: false, reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY })
    // `starting` blocks just the same (D-D's exact predicate); a `selectedAddress` changes nothing.
    launch.set({ phase: 'starting', installationId: 'inst-1' })
    expect(service.start({ selectedAddress: '6.6.6.6:27910' })).toEqual({
      ok: false,
      reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
    })

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
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: launch.host,
      deps: { queryServer },
    })

    expect(service.start()).toEqual({ ok: true })
    launch.set(RUNNING)
    expect(service.start()).toEqual({ ok: false, reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY })
    service.dispose()
  })

  it('AC1/AC4: blockedReason mirrors the live launch state and clears the moment the session ends', () => {
    const { emit, events } = recorder()
    const launch = fakeLaunch()
    const service = createScanService({
      getServersState: () => baseState(),
      emit,
      launch: launch.host,
    })

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
    const service = createScanService({
      getServersState: () => baseState(),
      emit,
      launch: launch.host,
    })

    expect(service.read().state.blockedReason).toBe('game-running')
    expect(launch.listenerCount()).toBe(1)

    service.dispose()
    expect(launch.listenerCount()).toBe(0)
    launch.set(IDLE_LAUNCH_STATE)
    expect(events).toHaveLength(0)
  })
})

describe('createScanService - scoped rounds', () => {
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
          : {
              ok: true,
              kind: 'status',
              reply: { ok: true, serverinfo: { hostname: 'Status' }, players: [] },
              rttMs: 9,
            }
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
    expect(
      query.calls
        .filter((c) => c.kind === 'info')
        .map((c) => c.address)
        .sort(),
    ).toEqual([FAV_1, FAV_2, MANUAL, OTHER].sort())
    // 114's selected-server rule still applies to a full scan: status for the selected address.
    expect(query.calls.filter((c) => c.kind === 'status')).toEqual([
      { address: MANUAL, kind: 'status' },
    ])
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
    expect(service.start({ scope: { kind: 'favourites' }, selectedAddress: MANUAL })).toEqual({
      ok: true,
    })
    await waitForIdle(service)

    expect(fetchCalls).toHaveLength(0)
    expect(query.calls.map((c) => c.address).sort()).toEqual([FAV_1, FAV_2])
    expect(query.calls.every((c) => c.kind === 'info')).toBe(true)
    expect(service.read().state).toMatchObject({
      sourceFailures: [],
      scope: { kind: 'favourites' },
    })
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
    expect(service.read().state).toMatchObject({
      stage1Total: 0,
      stage2Total: 1,
      sourceFailures: [],
    })
    // The queried address gets its real row; every other favourite/manual address that has never
    // answered gets a pending placeholder (story S25 D2) - a single-server scope never touches them.
    const entries = service.read().entries
    expect(entries.find((e) => e.address === MANUAL)).toEqual(
      expect.objectContaining({ address: MANUAL, status: 'online', name: 'Status', players: [] }),
    )
    expect(
      entries
        .filter((e) => e.status === 'pending')
        .map((e) => e.address)
        .sort(),
    ).toEqual([FAV_1, FAV_2, OTHER].sort())
    expect(entries).toHaveLength(4)
  })

  it('an out-of-scope row keeps its data and stale flag after a favourites round; in-scope silence goes stale', async () => {
    const { emit } = recorder()
    const state = baseState({
      favourites: [favouriteEntry(FAV_1)],
      manualServers: [manualEntry(MANUAL), manualEntry(OTHER)],
    })
    const query = scriptedQuery()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer: query.fn },
    })
    const entryOf = (address: string) =>
      service.read().entries.find((entry) => entry.address === address)

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
    const state = baseState({
      favourites: [favouriteEntry(FAV_1)],
      manualServers: [manualEntry(MANUAL)],
    })
    const query = scriptedQuery()
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer: query.fn },
    })
    const entryOf = (address: string) =>
      service.read().entries.find((entry) => entry.address === address)

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
    const service = createScanService({
      getServersState: () => state,
      emit,
      launch: launch.host,
      deps: { queryServer },
    })

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

describe('createScanService - readDetail', () => {
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
