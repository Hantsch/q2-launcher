/**
 * Sort engine for the servers list — pure, colocated with `row-markers.ts` in the same module.
 * Every mode (default and column) starts with favourites pinned to the top; everything else is a
 * pure comparator over `ServerListRow` with no knowledge of how the rows got there.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */
import { knownPlayerCount } from './row-markers'
import type { ServerGamemode } from './row-markers'
import { compareFavouriteFirst, compareStrings, createColumnSorter } from '../list/sort'
import type { ListSort, SortDirection } from '../list/sort'
import type { ServerListRow } from '../modules/servers'

export type ServerSortColumn = 'name' | 'mod' | 'players' | 'map' | 'ping'
export type ServerSortDirection = SortDirection
export type ServerListSort = ListSort<ServerSortColumn>

/** The columns the servers list can be sorted by, in the order they appear in the header. */
export const SERVER_SORT_COLUMNS: readonly ServerSortColumn[] = [
  'name',
  'mod',
  'players',
  'map',
  'ping',
]

/** Each column's "natural" direction — the one `nextSort` picks the first time a column is
 * clicked, and reverses from on the second click. */
export const NATURAL_DIRECTION: Record<ServerSortColumn, ServerSortDirection> = {
  name: 'asc',
  mod: 'asc',
  players: 'desc',
  map: 'asc',
  ping: 'asc',
}

const GAMEMODE_RANK: Record<ServerGamemode, number> = {
  deathmatch: 0,
  team: 1,
  ctf: 2,
  coop: 3,
  single: 4,
}

function gamemodeRank(gamemode: ServerGamemode | undefined): number {
  return gamemode === undefined ? 5 : GAMEMODE_RANK[gamemode]
}

function displayName(row: ServerListRow): string {
  return row.name ?? row.address
}

/**
 * The default order (no explicit sort): favourites first, then occupancy descending (an unknown
 * count sorts below every known count, 0 included), then gamemode rank, then display name, then
 * address — a total order, so any remaining tie is impossible given two distinct rows.
 */
function compareDefault(a: ServerListRow, b: ServerListRow): number {
  const favourite = compareFavouriteFirst(a, b)
  if (favourite !== 0) return favourite

  const countA = knownPlayerCount(a)
  const countB = knownPlayerCount(b)
  if (countA !== countB) {
    if (countA === undefined) return 1
    if (countB === undefined) return -1
    return countB - countA
  }

  const rankA = gamemodeRank(a.gamemode)
  const rankB = gamemodeRank(b.gamemode)
  if (rankA !== rankB) return rankA - rankB

  const name = compareStrings(displayName(a), displayName(b))
  if (name !== 0) return name

  return compareStrings(a.address, b.address)
}

const SORTER = createColumnSorter<ServerListRow, ServerSortColumn>({
  columns: {
    name: {
      isUnknown: () => false,
      compareKnownAscending: (a, b) => compareStrings(displayName(a), displayName(b)),
    },
    mod: {
      isUnknown: (row) => row.mod === undefined,
      compareKnownAscending: (a, b) => compareStrings(a.mod ?? '', b.mod ?? ''),
    },
    players: {
      isUnknown: (row) => knownPlayerCount(row) === undefined,
      compareKnownAscending: (a, b) => (knownPlayerCount(a) ?? 0) - (knownPlayerCount(b) ?? 0),
    },
    map: {
      isUnknown: (row) => row.map === undefined,
      compareKnownAscending: (a, b) => compareStrings(a.map ?? '', b.map ?? ''),
    },
    ping: {
      isUnknown: (row) => row.rttMs === undefined,
      compareKnownAscending: (a, b) => (a.rttMs ?? 0) - (b.rttMs ?? 0),
    },
  },
  natural: NATURAL_DIRECTION,
  defaultCompare: compareDefault,
  tieBreak: compareDefault,
  pinFavourites: true,
})

/** A sorted copy of `rows`; `null` means the default order, favourites pinned first either way. */
export const sortServerRows = SORTER.sortRows

/** Cycles a header's sort state; the third click returns to the default order (`null`). */
export const nextSort = SORTER.nextSort
