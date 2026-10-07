/**
 * Sorts a `status` reply's player roster for display. A malformed field — a score/ping that is
 * not a finite number, or a name that is not a non-empty string — always sorts last, in either
 * direction, rather than colliding with `0`/`''` or blowing up the comparison.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { compareBy, compareStrings } from '../list/sort'
import type { ColumnSpec, SortDirection } from '../list/sort'
import type { ServerPlayer } from './status-reply'

export type PlayerSortKey = 'name' | 'score' | 'ping'

export const DEFAULT_PLAYER_SORT = { key: 'score', dir: 'desc' } as const

/** The direction each column naturally reads in: score highest-first, name and ping lowest/A-first. */
export const PLAYER_NATURAL_DIRECTION: Record<PlayerSortKey, SortDirection> = {
  name: 'asc',
  score: 'desc',
  ping: 'asc',
}

function numberSpec(key: 'score' | 'ping'): ColumnSpec<ServerPlayer> {
  return {
    isUnknown: (p) => typeof p[key] !== 'number' || !Number.isFinite(p[key]),
    compareKnownAscending: (a, b) => a[key] - b[key],
  }
}

const SPECS: Record<PlayerSortKey, ColumnSpec<ServerPlayer>> = {
  name: {
    isUnknown: (p) => typeof p.name !== 'string' || p.name.length === 0,
    compareKnownAscending: (a, b) => compareStrings(a.name, b.name),
  },
  score: numberSpec('score'),
  ping: numberSpec('ping'),
}

/**
 * Returns a new, sorted array — never mutates `players`. Ties (including two malformed entries)
 * keep their original roster order (a stable sort). Malformed entries always land after every
 * well-formed one, in both `asc` and `desc`.
 */
export function sortPlayers(
  players: readonly ServerPlayer[],
  key: PlayerSortKey,
  dir: SortDirection,
): ServerPlayer[] {
  const spec = SPECS[key]
  const indexed = players.map((player, index) => ({ player, index }))
  indexed.sort((a, b) => compareBy(a.player, b.player, spec, dir) || a.index - b.index)
  return indexed.map((entry) => entry.player)
}
