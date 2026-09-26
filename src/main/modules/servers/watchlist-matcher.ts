import type { ServerPlayer } from '@shared/servers/status-reply'
import type { WatchlistEntry, WatchlistMatch, WatchlistSnapshot } from '@shared/modules/servers'

/**
 * Story 131 D2: the watchlist's pure matching/snapshot functions. Nothing here does IPC or
 * `node:dgram` I/O - the roster data (a server's `status` reply players) and the pre-computed
 * match/left/recheck maps are supplied by the caller (a later deliverable's service).
 */

/** Context about the server a roster call came from - a single `status` reply covers one address,
 * so the caller supplies it rather than this function inferring it from the roster itself. */
export interface WatchlistRosterContext {
  address: string
  serverName?: string
  seenAt: string
}

/**
 * Matches a `'exact'`/`'substring'` entry's name against `players`, case-insensitively. Returns
 * every matching player (not just the first) as `WatchlistMatch`es. `'regex'` entries are not
 * handled here - they run through `matchRegexNames` (in a worker, a later deliverable), never on
 * main's thread.
 */
export function matchPlainEntry(
  entry: WatchlistEntry,
  players: readonly ServerPlayer[],
  context: WatchlistRosterContext,
): WatchlistMatch[] {
  if (entry.mode === 'regex') {
    return []
  }

  const needle = entry.name.toLowerCase()
  const matches: WatchlistMatch[] = []
  for (const player of players) {
    const haystack = player.name.toLowerCase()
    const isMatch = entry.mode === 'exact' ? haystack === needle : haystack.includes(needle)
    if (isMatch) {
      matches.push({
        address: context.address,
        serverName: context.serverName,
        playerName: player.name,
        score: player.score,
        ping: player.ping,
        seenAt: context.seenAt,
      })
    }
  }
  return matches
}

/**
 * Matches a regex `pattern` against every one of `names`, case-insensitively, returning one
 * boolean per name in the same order. Story 131's ReDoS-avoidance mechanism (D3) works by
 * serializing this function's *source* via `.toString()` and running it inside a Worker via
 * `eval` - so this function must stay fully self-contained: no imports, no closures over anything
 * outside its own body, nothing but its own parameters and locals. Do not "clean this up" by
 * factoring out a helper or referencing anything declared elsewhere in this module.
 */
export function matchRegexNames(pattern: string, names: string[]): boolean[] {
  const re = new RegExp(pattern, 'i')
  return names.map((n) => re.test(n))
}

/**
 * Builds the watchlist's overall `WatchlistSnapshot` from each entry plus the per-entry
 * computation maps a later deliverable's service produces. Precedence per entry, matching the
 * `WatchlistEntryStatus` union: `tooSlow` wins over everything else (the matcher has given up on
 * this entry, whatever `matchesByEntry` might otherwise say); then a non-empty match list wins
 * (`'found'`, all matches kept, sorted `seenAt` descending); then a `leftByEntry` record
 * (`'left'`); otherwise `'offline'`.
 */
export function buildWatchlistSnapshot(
  entries: readonly WatchlistEntry[],
  matchesByEntry: ReadonlyMap<string, WatchlistMatch[]>,
  leftByEntry: ReadonlyMap<string, { address: string; checkedAt: string }>,
  recheckByEntry: ReadonlyMap<string, 'pending' | 'no-reply'>,
  asOf: string | null,
): WatchlistSnapshot {
  const statuses = entries.map((entry) => {
    const recheck = recheckByEntry.get(entry.id) ?? null

    if (entry.tooSlow) {
      return { entry, state: 'too-slow' as const, recheck }
    }

    const matches = matchesByEntry.get(entry.id)
    if (matches !== undefined && matches.length > 0) {
      const sorted = [...matches].sort((a, b) => b.seenAt.localeCompare(a.seenAt))
      return { entry, state: 'found' as const, matches: sorted, recheck }
    }

    const left = leftByEntry.get(entry.id)
    if (left !== undefined) {
      return {
        entry,
        state: 'left' as const,
        address: left.address,
        checkedAt: left.checkedAt,
        reasonKey: 'servers.watchlist.left.needsFullScan' as const,
        recheck,
      }
    }

    return { entry, state: 'offline' as const, recheck }
  })

  return { asOf, entries: statuses }
}
