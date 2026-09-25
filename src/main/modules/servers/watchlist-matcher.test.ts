import { describe, expect, it } from 'vitest'
import type { ServerPlayer } from '@shared/servers/status-reply'
import type { WatchlistEntry, WatchlistMatch } from '@shared/modules/servers'
import { buildWatchlistSnapshot, matchPlainEntry, matchRegexNames } from './watchlist-matcher'

/** Story 131 D2: the pure matcher/snapshot functions. No IPC, no worker - those are later Ds. */

const context = { address: '1.2.3.4:27910', serverName: 'Test Server', seenAt: '2024-01-01T00:00:00.000Z' }

function player(name: string, score = 0, ping = 10): ServerPlayer {
  return { name, score, ping }
}

describe('matchPlainEntry', () => {
  it('exact, substring modes match case-insensitively and return every matching player', () => {
    const exactEntry: WatchlistEntry = { id: '1', name: 'alice', mode: 'exact', tooSlow: false }
    const players = [player('Alice'), player('alice2'), player('ALICE')]

    const exactMatches = matchPlainEntry(exactEntry, players, context)
    expect(exactMatches.map((m) => m.playerName)).toEqual(['Alice', 'ALICE'])

    const substringEntry: WatchlistEntry = {
      id: '2',
      name: 'lic',
      mode: 'substring',
      tooSlow: false,
    }
    const substringMatches = matchPlainEntry(substringEntry, players, context)
    expect(substringMatches.map((m) => m.playerName)).toEqual(['Alice', 'alice2', 'ALICE'])
  })

  it('builds WatchlistMatch rows from the supplied roster context', () => {
    const entry: WatchlistEntry = { id: '1', name: 'alice', mode: 'exact', tooSlow: false }
    const players = [player('Alice', 12, 45)]

    const matches = matchPlainEntry(entry, players, context)

    expect(matches).toEqual<WatchlistMatch[]>([
      {
        address: context.address,
        serverName: context.serverName,
        playerName: 'Alice',
        score: 12,
        ping: 45,
        seenAt: context.seenAt,
      },
    ])
  })

  it('returns no matches when no player matches - entry stays offline (checked via buildWatchlistSnapshot below)', () => {
    const entry: WatchlistEntry = { id: '1', name: 'nobody', mode: 'exact', tooSlow: false }
    const players = [player('Someone Else')]

    expect(matchPlainEntry(entry, players, context)).toEqual([])
  })

  it('returns no matches for a regex-mode entry (handled elsewhere, not on main thread)', () => {
    const entry: WatchlistEntry = { id: '1', name: '^a.*', mode: 'regex', tooSlow: false }
    const players = [player('Alice')]

    expect(matchPlainEntry(entry, players, context)).toEqual([])
  })
})

describe('matchRegexNames', () => {
  it('matches case-insensitively, one boolean per name in order', () => {
    const result = matchRegexNames('^a.*e$', ['Alice', 'Bob', 'aXe'])

    expect(result).toEqual([true, false, true])
  })

  it('is fully self-contained: toString()+eval reproduces the same behaviour with no outer references', () => {
    // eslint-disable-next-line no-eval -- proving D3's exact serialize-then-eval mechanism works.
    const rebuilt = eval(`(${matchRegexNames.toString()})`) as typeof matchRegexNames

    expect(rebuilt('^a.*e$', ['Alice', 'Bob', 'aXe'])).toEqual([true, false, true])
  })
})

describe('buildWatchlistSnapshot', () => {
  const entryOffline: WatchlistEntry = { id: 'a', name: 'Nobody', mode: 'exact', tooSlow: false }
  const entryTooSlow: WatchlistEntry = { id: 'b', name: 'Slow', mode: 'regex', tooSlow: true }
  const entryFound: WatchlistEntry = { id: 'c', name: 'Alice', mode: 'exact', tooSlow: false }
  const entryLeft: WatchlistEntry = { id: 'd', name: 'Gone', mode: 'exact', tooSlow: false }

  it('an entry with no data anywhere is offline', () => {
    const snapshot = buildWatchlistSnapshot(
      [entryOffline],
      new Map(),
      new Map(),
      new Map(),
      '2024-01-01T00:00:00.000Z',
    )

    expect(snapshot).toEqual({
      asOf: '2024-01-01T00:00:00.000Z',
      entries: [{ entry: entryOffline, state: 'offline', recheck: null }],
    })
  })

  it('tooSlow wins over any other data', () => {
    const matchesByEntry = new Map([
      ['b', [{ address: 'x', playerName: 'Slow', score: 0, ping: 0, seenAt: '2024-01-01' }]],
    ])

    const snapshot = buildWatchlistSnapshot(
      [entryTooSlow],
      matchesByEntry,
      new Map(),
      new Map(),
      null,
    )

    expect(snapshot.entries).toEqual([{ entry: entryTooSlow, state: 'too-slow', recheck: null }])
  })

  it('found keeps every match, sorted seenAt descending', () => {
    const matches: WatchlistMatch[] = [
      { address: 'a1', playerName: 'Alice', score: 1, ping: 1, seenAt: '2024-01-01T00:00:00.000Z' },
      { address: 'a2', playerName: 'Alice', score: 2, ping: 2, seenAt: '2024-01-03T00:00:00.000Z' },
      { address: 'a3', playerName: 'Alice', score: 3, ping: 3, seenAt: '2024-01-02T00:00:00.000Z' },
    ]
    const matchesByEntry = new Map([['c', matches]])

    const snapshot = buildWatchlistSnapshot(
      [entryFound],
      matchesByEntry,
      new Map(),
      new Map(),
      null,
    )

    expect(snapshot.entries).toEqual([
      {
        entry: entryFound,
        state: 'found',
        matches: [matches[1], matches[2], matches[0]],
        recheck: null,
      },
    ])
  })

  it('left is reported when the entry has no current match but a prior left record exists', () => {
    const leftByEntry = new Map([['d', { address: '5.6.7.8:27910', checkedAt: '2024-01-02T00:00:00.000Z' }]])

    const snapshot = buildWatchlistSnapshot(
      [entryLeft],
      new Map(),
      leftByEntry,
      new Map(),
      null,
    )

    expect(snapshot.entries).toEqual([
      {
        entry: entryLeft,
        state: 'left',
        address: '5.6.7.8:27910',
        checkedAt: '2024-01-02T00:00:00.000Z',
        reasonKey: 'servers.watchlist.left.needsFullScan',
        recheck: null,
      },
    ])
  })

  it('carries the recheck field through from recheckByEntry', () => {
    const recheckByEntry = new Map<string, 'pending' | 'no-reply'>([['a', 'pending']])

    const snapshot = buildWatchlistSnapshot(
      [entryOffline],
      new Map(),
      new Map(),
      recheckByEntry,
      null,
    )

    expect(snapshot.entries[0].recheck).toBe('pending')
  })
})
