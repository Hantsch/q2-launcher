import { describe, expect, it } from 'vitest'
import { DEFAULT_SERVERS_STATE, SERVERS_EVENTS, type ServersState } from '@shared/modules/servers'
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

/** A well-formed `info` reply with no player count, so `runScan` never queues a stage 2 query for
 * it - keeps every test below to a single stage1-only row per target. */
function infoOk(hostname = 'Host'): ServerQueryResult {
  return { ok: true, kind: 'info', reply: { ok: true, serverinfo: { hostname }, clients: undefined }, rttMs: 7 }
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
    const service = createScanService({ getServersState: () => state, emit, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, deps: { queryServer } })

    expect(service.start()).toEqual({ ok: true })
    expect(service.start('irrelevant')).toEqual({
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
    const service = createScanService({ getServersState: () => state, emit, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, deps: { queryServer } })

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
    const service = createScanService({ getServersState: () => state, emit, deps: { queryServer } })

    expect(service.start()).toEqual({ ok: true })
    // Let resolveSources/buildScanAddressSet/runScan reach the pool and issue the query.
    for (let i = 0; i < 10 && calls.length === 0; i++) await tick()
    expect(calls).toHaveLength(1)

    const mid = service.read()
    expect(mid.state.running).toBe(true)
    expect(mid.state.phase).toBe('stage1')
    expect(mid.entries).toEqual([])

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
    const service = createScanService({ getServersState: () => state, emit, deps: { queryServer } })

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
})
