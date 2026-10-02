import { describe, expect, it, vi } from 'vitest'
import {
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  SCAN_FAVOURITES_NOT_IN_LAN_REASON_KEY,
  SERVERS_EVENTS,
  type ScanServerPush,
  type ServersScanState,
  type ServersState,
} from '@shared/modules/servers'
import type { FetchImpl } from '../../lib/net/fetcher'
import type { LanDiscoveryOptions, LanReply } from './lan-discovery'
import type { QueryServerFn } from './scan-runner'
import {
  createScanService,
  SCAN_ALREADY_RUNNING_REASON_KEY,
  type LanDiscoveryFn,
  type ScanService,
} from './scan-service'
import type { MasterUdpImpl } from './udp-master-source'
import {
  fakeLaunch,
  RUNNING,
  recorder,
  baseState,
  manualEntry,
  infoOk,
  deferredQuery,
  tick,
  waitForIdle,
} from './scan-service.test-helpers'

describe('createScanService - online and LAN lists', () => {
  const LAN_A = '192.168.1.10:27910'
  const LAN_B = '192.168.1.11:27910'
  const NET = '10.0.0.5:27910'
  const FAV = '10.0.0.6:27910'

  function lanReply(address: string): LanReply {
    return {
      address,
      reply: { ok: true, serverinfo: { hostname: `LAN ${address}` }, clients: 0 },
      rttMs: 2,
    }
  }

  /** A `lanDiscovery` fake answering `replies` in order; `hold()` parks the next round until
   * `release()`, so a test can act mid-discovery. */
  function fakeLan(
    initial: string[],
    failureKey: string | null = null,
  ): {
    fn: LanDiscoveryFn
    calls: LanDiscoveryOptions[]
    setReplies: (next: string[]) => void
    hold: () => void
    release: () => void
  } {
    const calls: LanDiscoveryOptions[] = []
    let replies = initial
    const gate = { held: false, release: (): void => {} }
    const fn: LanDiscoveryFn = async (options) => {
      calls.push(options)
      if (gate.held) await new Promise<void>((resolve) => (gate.release = resolve))
      for (const address of replies) options.onReply(lanReply(address))
      return { failureKey }
    }
    return {
      fn,
      calls,
      setReplies: (next) => {
        replies = next
      },
      hold: () => {
        gate.held = true
      },
      release: () => {
        gate.held = false
        gate.release()
      },
    }
  }

  /** Answers every query; an address in `busy` reports two clients, so it gets a stage-2 query. */
  function recordingQuery(busy: Set<string> = new Set()): {
    fn: QueryServerFn
    calls: { address: string; kind: string }[]
  } {
    const calls: { address: string; kind: string }[] = []
    const fn: QueryServerFn = async (target, options) => {
      const address = `${target.host}:${target.port}`
      calls.push({ address, kind: options.kind })
      if (options.kind === 'status') {
        return {
          ok: true,
          kind: 'status',
          reply: { ok: true, serverinfo: { hostname: 'Status' }, players: [] },
          rttMs: 9,
        }
      }
      const clients = busy.has(address) ? 2 : 0
      return {
        ok: true,
        kind: 'info',
        reply: { ok: true, serverinfo: { hostname: address }, clients },
        rttMs: 7,
      }
    }
    return { fn, calls }
  }

  function onlineState(): ServersState {
    return baseState({
      favourites: [{ address: FAV, addedAt: new Date().toISOString() }],
      manualServers: [manualEntry(NET)],
    })
  }

  function addresses(service: ScanService): string[] {
    return service
      .read()
      .entries.map((entry) => entry.address)
      .sort()
  }

  it('read with the online mode returns the online list while LAN is the active mode', async () => {
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: fakeLan([LAN_A]).fn },
    })
    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)
    service.setMode('lan')
    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)

    expect(addresses(service)).toEqual([LAN_A])
    expect(
      service
        .read('online')
        .entries.map((e) => e.address)
        .sort(),
    ).toEqual([FAV, NET].sort())
  })

  it('an online scan never runs LAN discovery', async () => {
    const lan = fakeLan([LAN_A])
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: lan.fn },
    })

    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)
    expect(service.start({ scope: { kind: 'favourites' } })).toEqual({ ok: true })
    await waitForIdle(service)

    expect(lan.calls).toHaveLength(0)
    expect(service.read().state.mode).toBe('online')
    expect(addresses(service)).toEqual([FAV, NET].sort())
  })

  it('a LAN scan contacts no master source', async () => {
    const fetchCalls: string[] = []
    const fetchImpl: FetchImpl = async (url) => {
      fetchCalls.push(url)
      throw new Error('offline')
    }
    let udpCalls = 0
    const udpImpl: MasterUdpImpl = async () => {
      udpCalls++
      throw new Error('offline')
    }
    const state = baseState({
      sources: [
        {
          id: 'http',
          type: 'http-list',
          address: 'http://example.invalid/servers.txt',
          enabled: true,
        },
        { id: 'udp', type: 'udp-master', address: 'master.example.invalid:27900', enabled: true },
      ],
      manualServers: [manualEntry(NET)],
    })
    const query = recordingQuery()
    const service = createScanService({
      getServersState: () => state,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: query.fn, fetchImpl, udpImpl, lanDiscovery: fakeLan([LAN_A]).fn },
    })

    service.setMode('lan')
    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)

    expect(fetchCalls).toEqual([])
    expect(udpCalls).toBe(0)
    expect(service.read().state.sourceFailures).toEqual([])
    // Only the broadcast answer is queried - never a source, favourite or manual address.
    expect(new Set(query.calls.map((call) => call.address))).toEqual(new Set([LAN_A]))
  })

  it('the LAN list holds only broadcast answers', async () => {
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: fakeLan([LAN_A, LAN_B]).fn },
    })
    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)

    service.setMode('lan')
    // Before any LAN round: no favourite/manual placeholders, no online rows.
    expect(service.read().entries).toEqual([])

    expect(service.start()).toEqual({ ok: true })
    await waitForIdle(service)

    const snapshot = service.read()
    expect(snapshot.mode).toBe('lan')
    expect(snapshot.state.mode).toBe('lan')
    expect(snapshot.entries.map((entry) => entry.address).sort()).toEqual([LAN_A, LAN_B])
    expect(snapshot.entries.every((entry) => entry.origins.join() === 'lan')).toBe(true)
    expect(snapshot.lan).toEqual({ lastFinishedAt: expect.any(String), failureKey: null })
  })

  it('a LAN row a favourite also names carries the favourite flag', async () => {
    const state = baseState({ favourites: [{ address: LAN_A, addedAt: new Date().toISOString() }] })
    const service = createScanService({
      getServersState: () => state,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: fakeLan([LAN_A, LAN_B]).fn },
    })
    service.setMode('lan')
    service.start()
    await waitForIdle(service)

    const flags = Object.fromEntries(
      service.read().entries.map((entry) => [entry.address, entry.favourite]),
    )
    expect(flags).toEqual({ [LAN_A]: true, [LAN_B]: false })
  })

  it('the online list never holds a LAN-only server', async () => {
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: fakeLan([LAN_A]).fn },
    })
    service.setMode('lan')
    service.start()
    await waitForIdle(service)

    service.setMode('online')
    expect(addresses(service)).toEqual([FAV, NET].sort())
    expect(service.readDetail(LAN_A)).toBeNull()
    service.start()
    await waitForIdle(service)
    expect(addresses(service)).toEqual([FAV, NET].sort())
    expect(service.overview().knownServerCount).toBe(2)
  })

  it("switching mode keeps the other mode's list", async () => {
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: fakeLan([LAN_A]).fn },
    })
    service.start()
    await waitForIdle(service)
    const onlineLastScanAt = service.overview().lastScanAt
    expect(onlineLastScanAt).not.toBeNull()

    service.setMode('lan')
    expect(service.overview()).toMatchObject({ knownServerCount: 0, lastScanAt: null })
    service.start()
    await waitForIdle(service)
    expect(addresses(service)).toEqual([LAN_A])

    service.setMode('online')
    expect(addresses(service)).toEqual([FAV, NET].sort())
    expect(service.read().entries.every((entry) => entry.status === 'online')).toBe(true)
    expect(service.overview().lastScanAt).toBe(onlineLastScanAt)

    service.setMode('lan')
    expect(addresses(service)).toEqual([LAN_A])
    expect(service.readDetail(LAN_A)?.row.origins).toEqual(['lan'])
  })

  it('a LAN scan is refused while the game runs', () => {
    const lan = fakeLan([LAN_A])
    const query = recordingQuery()
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch(RUNNING).host,
      deps: { queryServer: query.fn, lanDiscovery: lan.fn },
    })
    service.setMode('lan')

    for (const scope of [
      { kind: 'all' },
      { kind: 'favourites' },
      { kind: 'server', address: LAN_A },
    ] as const) {
      expect(service.start({ scope })).toEqual({
        ok: false,
        reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
      })
    }
    expect(lan.calls).toHaveLength(0)
    expect(query.calls).toHaveLength(0)
  })

  it('a favourites scan is refused in LAN mode', () => {
    const lan = fakeLan([LAN_A])
    const query = recordingQuery()
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: query.fn, lanDiscovery: lan.fn },
    })
    service.setMode('lan')

    expect(service.start({ scope: { kind: 'favourites' } })).toEqual({
      ok: false,
      reasonKey: SCAN_FAVOURITES_NOT_IN_LAN_REASON_KEY,
    })
    expect(service.read().state.running).toBe(false)
    expect(lan.calls).toHaveLength(0)
    expect(query.calls).toHaveLength(0)
  })

  it('a mid-scan mode switch keeps the round writing into the list it started with', async () => {
    const lan = fakeLan([LAN_A])
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: lan.fn },
    })

    // A LAN round, switched to online while discovery is still listening.
    service.setMode('lan')
    lan.hold()
    service.start()
    await tick()
    service.setMode('online')
    lan.release()
    await waitForIdle(service)
    expect(service.read().state.mode).toBe('lan')
    expect(addresses(service)).toEqual([FAV, NET].sort())
    expect(service.read().entries.every((entry) => entry.status === 'pending')).toBe(true)
    service.setMode('lan')
    expect(addresses(service)).toEqual([LAN_A])

    // An online round, switched to LAN while its queries are still out.
    const deferred = deferredQuery()
    const online = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: deferred.fn, lanDiscovery: lan.fn },
    })
    online.start()
    await tick()
    online.setMode('lan')
    // A second round is still single-flight, whatever the mode.
    expect(online.start()).toEqual({ ok: false, reasonKey: SCAN_ALREADY_RUNNING_REASON_KEY })
    for (const call of deferred.calls) call.resolve(infoOk())
    await waitForIdle(online)
    expect(online.read().entries).toEqual([])
    online.setMode('online')
    expect(
      online
        .read()
        .entries.map((entry) => `${entry.address} ${entry.status}`)
        .sort(),
    ).toEqual([`${FAV} online`, `${NET} online`].sort())
  })

  it('a LAN round replaces the LAN list', async () => {
    const lan = fakeLan([LAN_A, LAN_B])
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: lan.fn },
    })
    service.setMode('lan')
    service.start()
    await waitForIdle(service)
    expect(addresses(service)).toEqual([LAN_A, LAN_B])

    lan.setReplies([LAN_B])
    service.start()
    await waitForIdle(service)
    // LAN_A stopped answering: gone, not stale.
    expect(service.read().entries.map((entry) => `${entry.address} ${entry.status}`)).toEqual([
      `${LAN_B} online`,
    ])
    expect(service.readDetail(LAN_A)).toBeNull()
  })

  it('a LAN round reports discovery progress and its failure key', async () => {
    const { emit, events } = recorder()
    const service = createScanService({
      getServersState: onlineState,
      emit,
      launch: fakeLaunch().host,
      deps: {
        queryServer: recordingQuery().fn,
        lanDiscovery: fakeLan([], 'servers.lan.error.noInterface').fn,
      },
    })
    service.setMode('lan')
    service.start()
    await waitForIdle(service)
    expect(service.read().lan).toEqual({
      lastFinishedAt: expect.any(String),
      failureKey: 'servers.lan.error.noInterface',
    })
    expect(service.read().entries).toEqual([])

    const answering = createScanService({
      getServersState: onlineState,
      emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: fakeLan([LAN_A, LAN_B]).fn },
    })
    answering.setMode('lan')
    events.length = 0
    answering.start()
    await waitForIdle(answering)
    const stage1 = events
      .filter((event) => event.type === SERVERS_EVENTS.scanServer)
      .map((event) => event.payload as ScanServerPush)
      .filter((row) => row.stage === 'stage1')
    expect(
      stage1.slice(0, 2).map((row) => `${row.target.address} ${row.target.origins.join()}`),
    ).toEqual([`${LAN_A} lan`, `${LAN_B} lan`])
    const counts = events
      .filter((event) => event.type === SERVERS_EVENTS.scanChanged)
      .map((event) => (event.payload as ServersScanState).stage1Done)
    expect(counts).toContain(1)
    expect(counts).toContain(2)
    expect(answering.read().lan.failureKey).toBeNull()
  })

  it('LAN stage-2 rows never reach onStage2Row', async () => {
    const onStage2Row = vi.fn()
    const query = recordingQuery(new Set([LAN_A]))
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      onStage2Row,
      deps: { queryServer: query.fn, lanDiscovery: fakeLan([LAN_A, LAN_B]).fn },
    })
    service.setMode('lan')
    service.start()
    await waitForIdle(service)
    service.start({ scope: { kind: 'server', address: LAN_B } })
    await waitForIdle(service)

    expect(
      query.calls
        .filter((call) => call.kind === 'status')
        .map((call) => call.address)
        .sort(),
    ).toEqual([LAN_A, LAN_B].sort())
    expect(service.readDetail(LAN_A)?.serverinfo).toEqual({ hostname: 'Status' })
    expect(onStage2Row).not.toHaveBeenCalled()
  })

  it('a LAN single-server refresh never adds a row the broadcast did not find', async () => {
    const service = createScanService({
      getServersState: onlineState,
      emit: recorder().emit,
      launch: fakeLaunch().host,
      deps: { queryServer: recordingQuery().fn, lanDiscovery: fakeLan([LAN_A]).fn },
    })
    service.setMode('lan')
    service.start()
    await waitForIdle(service)

    expect(service.start({ scope: { kind: 'server', address: NET } })).toEqual({ ok: true })
    await waitForIdle(service)
    expect(addresses(service)).toEqual([LAN_A])
    service.setMode('online')
    expect(service.read().entries.find((entry) => entry.address === NET)?.status).toBe('pending')
  })
})
