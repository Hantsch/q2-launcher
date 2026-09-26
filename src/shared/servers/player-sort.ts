/**
 * Sorts a `status` reply's player roster for display. A malformed field — a score/ping that is
 * not a finite number, or a name that is not a non-empty string — always sorts last, in either
 * direction, rather than colliding with `0`/`''` or blowing up the comparison.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import type { ServerPlayer } from './status-reply'

export type PlayerSortKey = 'name' | 'score' | 'ping'
export type SortDir = 'asc' | 'desc'

export const DEFAULT_PLAYER_SORT = { key: 'score', dir: 'desc' } as const

/** The direction a column naturally reads in: score highest-first, name and ping lowest/A-first. */
export function naturalDir(key: PlayerSortKey): SortDir {
  return key === 'score' ? 'desc' : 'asc'
}

function isValidValue(key: PlayerSortKey, player: ServerPlayer): boolean {
  if (key === 'name') return typeof player.name === 'string' && player.name.length > 0
  const value = player[key]
  return typeof value === 'number' && Number.isFinite(value)
}

function compareValid(key: PlayerSortKey, a: ServerPlayer, b: ServerPlayer): number {
  if (key === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  return a[key] - b[key]
}

/**
 * Returns a new, sorted array — never mutates `players`. Ties (including two malformed entries)
 * keep their original roster order (a stable sort). Malformed entries always land after every
 * well-formed one, in both `asc` and `desc`.
 */
export function sortPlayers(
  players: readonly ServerPlayer[],
  key: PlayerSortKey,
  dir: SortDir
): ServerPlayer[] {
  const indexed = players.map((player, index) => ({ player, index }))

  indexed.sort((a, b) => {
    const aValid = isValidValue(key, a.player)
    const bValid = isValidValue(key, b.player)

    if (aValid && !bValid) return -1
    if (!aValid && bValid) return 1
    if (!aValid && !bValid) return a.index - b.index

    const cmp = compareValid(key, a.player, b.player)
    if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
    return a.index - b.index
  })

  return indexed.map((entry) => entry.player)
}
