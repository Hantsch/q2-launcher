import { describe, expect, it } from 'vitest'
import type { ScanScope, ScanServerPush, ScanStartResult, ServerListRow, WatchlistEntry, WatchlistSnapshot } from '@shared/modules/servers'
import type { RegexHost, RegexMatchOutcome } from './watchlist-regex-host'
import { createWatchlistService, type WatchlistScanHost } from './watchlist-service'

/**
 * Story 131 D4. Mirrors `scan-service.test.ts`'s style: fakes for every collaborator
 * (`getEntries`/`setEntries` over a plain in-memory list, a fake `regexHost`, a fake `scanService`
 * that just records `start()` calls), and assertions on the emitted `WatchlistSnapshot`s.
 */

function entry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return { id: overrides.id ?? 'e1', name: overrides.name ?? 'Alice', mode: overrides.mode ?? 'exact', tooSlow: overrides.tooSlow ?? false }
}

function statusRow(
  address: string,
  players: { score: number; ping: number; name: string }[],
  hostname = 'Host',
): ScanServerPush {
  return {
    stage: 'stage2',
    target: { address, origins: ['manual'] },
    result: { ok: true, kind: 'status', reply: { ok: true, serverinfo: { hostname }, players }, rttMs: 5 },
  }
}

function failedRow(address: string): ScanServerPush {
  return { stage: 'stage2', target: { address, origins: ['manual'] }, result: { ok: false, reason: 'no-reply' } }
}

/** A regex host fake whose outcome per (entryId, pattern) call is scripted, or defaults to a plain
 * case-insensitive-includes evaluation - close enough to `matchRegexNames` for these tests without
 * ever running a real worker thread. */
function fakeRegexHost(script: Map<string, RegexMatchOutcome> = new Map()): {
  host: RegexHost
  calls: { entryId: string; pattern: string; names: string[] }[]
} {
  const calls: { entryId: string; pattern: string; names: string[] }[] = []
  const host: RegexHost = {
    match: (entryId, pattern, names) => {
      calls.push({ entryId, pattern, names })
      const scripted = script.get(entryId)
      if (scripted !== undefined) return Promise.resolve(scripted)
      const re = new RegExp(pattern, 'i')
      return Promise.resolve({ ok: true, hits: names.map((n) => re.test(n)) })
    },
    dispose: () => undefined,
  }
  return { host, calls }
}

function fakeScanService(): { host: WatchlistScanHost; calls: ScanScope[] } {
  const calls: ScanScope[] = []
  const result: ScanStartResult = { ok: true }
  const host: WatchlistScanHost = {
    start: (options) => {
      calls.push(options.scope)
      return result
    },
  }
  return { host, calls }
}

function setup(overrides: {
  entries?: WatchlistEntry[]
  knownServers?: ServerListRow[]
  regexHost?: RegexHost
} = {}) {
  let entries = overrides.entries ?? []
  const knownServers = overrides.knownServers ?? []
  const { host: regexHost, calls: regexCalls } = overrides.regexHost
    ? { host: overrides.regexHost, calls: [] as { entryId: string; pattern: string; names: string[] }[] }
    : fakeRegexHost()
  const scan = fakeScanService()
  const snapshots: WatchlistSnapshot[] = []
  const service = createWatchlistService({
    getEntries: () => entries,
    setEntries: (next) => {
      entries = next
    },
    getKnownServers: () => knownServers,
    scanService: scan.host,
    regexHost,
    emit: (snapshot) => snapshots.push(snapshot),
    now: () => '2026-01-01T00:00:00.000Z',
  })
  return { service, snapshots, scanCalls: scan.calls, regexCalls, getEntries: () => entries }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('createWatchlistService', () => {
  it('AC3: a matched entry carries server, player score and ping from the status row', async () => {
    const { service, snapshots } = setup({ entries: [entry({ name: 'Alice' })] })

    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 5, ping: 40, name: 'Alice' }], 'Arena'))
    await tick()

    const snapshot = service.read()
    expect(snapshot.entries).toEqual([
      {
        entry: entry({ name: 'Alice' }),
        state: 'found',
        recheck: null,
        matches: [
          {
            address: '1.1.1.1:27910',
            serverName: 'Arena',
            playerName: 'Alice',
            score: 5,
            ping: 40,
            seenAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    ])
    expect(snapshots.length).toBeGreaterThan(0)
  })

  it('AC4: a name on two servers shows both matches', async () => {
    const { service } = setup({ entries: [entry({ name: 'Alice' })] })

    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 1, ping: 10, name: 'Alice' }]))
    service.onStage2Row(statusRow('2.2.2.2:27910', [{ score: 2, ping: 20, name: 'Alice' }]))
    await tick()

    const status = service.read().entries[0]
    expect(status?.state).toBe('found')
    if (status?.state === 'found') {
      expect(status.matches.map((m) => m.address).sort()).toEqual(['1.1.1.1:27910', '2.2.2.2:27910'])
    }
  })

  it('AC5: onStage2Row issues zero queries of its own - the identical addresses/order come only from the scan itself', async () => {
    // The watchlist service never calls scanService.start() from onStage2Row - only recheck() does.
    const { service, scanCalls } = setup({ entries: [entry({ name: 'Alice' })] })
    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 1, ping: 10, name: 'Alice' }]))
    await tick()
    expect(scanCalls).toHaveLength(0)
  })

  it('AC5: add/edit re-match against known rosters issues zero scan queries', async () => {
    const knownServers: ServerListRow[] = [
      {
        address: '3.3.3.3:27910',
        origins: ['manual'],
        status: 'online',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        players: [{ score: 0, ping: 5, name: 'Bob' }],
        favourite: false,
      },
    ]
    const { service, scanCalls } = setup({ knownServers })

    const added = await service.add({ name: 'Bob', mode: 'exact' })
    expect(added.ok).toBe(true)
    expect(scanCalls).toHaveLength(0)
    if (added.ok) {
      const status = added.snapshot.entries[0]
      expect(status?.state).toBe('found')
    }
  })

  it('AC6: re-checking one entry issues exactly one status query to its last-seen server', async () => {
    const { service, scanCalls } = setup({ entries: [entry({ id: 'e1', name: 'Alice' })] })
    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 1, ping: 10, name: 'Alice' }]))
    await tick()

    const result = service.recheck({ id: 'e1' })
    expect(result).toEqual({ ok: true })
    expect(scanCalls).toEqual([{ kind: 'server', address: '1.1.1.1:27910' }])
  })

  it('recheck refuses when the entry has no current match', () => {
    const { service } = setup({ entries: [entry({ id: 'e1', name: 'Alice' })] })
    expect(service.recheck({ id: 'e1' })).toEqual({ ok: false, reasonKey: 'servers.watchlist.error.notFound' })
  })

  it('AC8: a too-slow regex entry is marked and skipped while a plain entry in the same row matches normally', async () => {
    const script = new Map<string, RegexMatchOutcome>([['regex-1', { ok: false, reason: 'too-slow' }]])
    const { host: regexHost, calls } = fakeRegexHost(script)
    const { service, getEntries } = setup({
      entries: [entry({ id: 'regex-1', name: '(a+)+$', mode: 'regex' }), entry({ id: 'plain-1', name: 'Alice' })],
      regexHost,
    })

    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 1, ping: 10, name: 'Alice' }]))
    await tick()
    await tick()

    expect(getEntries().find((e) => e.id === 'regex-1')?.tooSlow).toBe(true)
    const plainStatus = service.read().entries.find((s) => s.entry.id === 'plain-1')
    expect(plainStatus?.state).toBe('found')
    const regexStatus = service.read().entries.find((s) => s.entry.id === 'regex-1')
    expect(regexStatus?.state).toBe('too-slow')

    // A second row must never call the host again for the now-too-slow entry.
    service.onStage2Row(statusRow('2.2.2.2:27910', [{ score: 1, ping: 10, name: 'Alice' }]))
    await tick()
    expect(calls.filter((c) => c.entryId === 'regex-1')).toHaveLength(1)
  })

  it('AC9: a re-check that no longer finds the name marks the entry left and starts nothing further', async () => {
    const { service, scanCalls } = setup({ entries: [entry({ id: 'e1', name: 'Alice' })] })
    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 1, ping: 10, name: 'Alice' }]))
    await tick()

    const result = service.recheck({ id: 'e1' })
    expect(result).toEqual({ ok: true })
    expect(scanCalls).toEqual([{ kind: 'server', address: '1.1.1.1:27910' }])

    // The re-check's own stage-2 row comes back with a roster that no longer has Alice.
    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 0, ping: 5, name: 'Someone Else' }]))
    await tick()

    const status = service.read().entries.find((s) => s.entry.id === 'e1')
    expect(status).toMatchObject({
      state: 'left',
      address: '1.1.1.1:27910',
      reasonKey: 'servers.watchlist.left.needsFullScan',
    })
    // Nothing further queried by the watchlist service itself beyond the one recheck call above.
    expect(scanCalls).toHaveLength(1)
  })

  it('a re-check whose server gives no reply keeps the previous found state but flags recheck no-reply', async () => {
    const { service } = setup({ entries: [entry({ id: 'e1', name: 'Alice' })] })
    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 1, ping: 10, name: 'Alice' }]))
    await tick()

    service.recheck({ id: 'e1' })
    service.onStage2Row(failedRow('1.1.1.1:27910'))

    const status = service.read().entries.find((s) => s.entry.id === 'e1')
    expect(status?.state).toBe('found')
    expect(status?.recheck).toBe('no-reply')
  })

  it('a stale regex job resolving too-slow after the entry was edited does not resurrect tooSlow on the new pattern', async () => {
    // Reproduces the reviewer's race: a job queued for the old pattern must never be applied once
    // update() has moved the entry on to a new generation, even though the promise itself still
    // resolves normally afterwards.
    let releaseJob: ((outcome: RegexMatchOutcome) => void) | null = null
    const calls: { entryId: string; pattern: string }[] = []
    const regexHost: RegexHost = {
      match: (entryId, pattern, _names) => {
        calls.push({ entryId, pattern })
        return new Promise<RegexMatchOutcome>((resolve) => {
          releaseJob = resolve
        })
      },
      dispose: () => undefined,
    }
    const { service, getEntries } = setup({
      entries: [entry({ id: 'regex-1', name: '(a+)+$', mode: 'regex' })],
      regexHost,
    })

    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 1, ping: 10, name: 'Someone' }]))
    await tick()
    expect(calls).toEqual([{ entryId: 'regex-1', pattern: '(a+)+$' }])
    expect(releaseJob).not.toBeNull()

    // Edit the entry to a new pattern before the old job ever resolves.
    const updated = await service.update({ id: 'regex-1', name: '^bob$', mode: 'regex' })
    expect(updated.ok).toBe(true)
    expect(getEntries().find((e) => e.id === 'regex-1')?.tooSlow).toBe(false)

    // The stale job now resolves too-slow, for the pattern that no longer applies.
    releaseJob!({ ok: false, reason: 'too-slow' })
    await tick()
    await tick()

    expect(getEntries().find((e) => e.id === 'regex-1')?.tooSlow).toBe(false)
    const status = service.read().entries.find((s) => s.entry.id === 'regex-1')
    expect(status?.state).not.toBe('too-slow')
  })

  it('remove() clears matches and left/recheck state for that entry', async () => {
    const { service } = setup({ entries: [entry({ id: 'e1', name: 'Alice' })] })
    service.onStage2Row(statusRow('1.1.1.1:27910', [{ score: 1, ping: 10, name: 'Alice' }]))
    await tick()

    const result = service.remove({ id: 'e1' })
    expect(result.ok).toBe(true)
    expect(service.read().entries).toEqual([])
  })
})
