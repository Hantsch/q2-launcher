/**
 * Sort engine for the servers list — pure, colocated with `row-markers.ts` in the same module.
 * Every mode (default and column) starts with favourites pinned to the top; everything else is a
 * pure comparator over `ServerListRow` with no knowledge of how the rows got there.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */
import { knownPlayerCount } from './row-markers'
import type { ServerGamemode } from './row-markers'
import type { ServerListRow } from '../modules/servers'

export type ServerSortColumn = 'name' | 'mod' | 'players' | 'map' | 'ping'
export type ServerSortDirection = 'asc' | 'desc'

export interface ServerListSort {
  column: ServerSortColumn
  direction: ServerSortDirection
}

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

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })
}

function displayName(row: ServerListRow): string {
  return row.name ?? row.address
}

/** Favourites first; ties keep their relative order (callers apply this before anything else). */
function compareFavourite(a: ServerListRow, b: ServerListRow): number {
  if (a.favourite === b.favourite) return 0
  return a.favourite ? -1 : 1
}

/**
 * The default order (no explicit sort): favourites first, then occupancy descending (an unknown
 * count sorts below every known count, 0 included), then gamemode rank, then display name, then
 * address — a total order, so any remaining tie is impossible given two distinct rows.
 */
function compareDefault(a: ServerListRow, b: ServerListRow): number {
  const favourite = compareFavourite(a, b)
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

type ColumnValue = string | number | undefined

function columnValue(row: ServerListRow, column: ServerSortColumn): ColumnValue {
  switch (column) {
    case 'name':
      return displayName(row)
    case 'mod':
      return row.mod
    case 'players':
      return knownPlayerCount(row)
    case 'map':
      return row.map
    case 'ping':
      return row.rttMs
  }
}

function compareColumnValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return compareStrings(String(a), String(b))
}

/**
 * Favourites first, then the column value in `direction` (an undefined value always sorts last,
 * regardless of direction), then the default comparator as the tie-break.
 */
function compareColumn(
  a: ServerListRow,
  b: ServerListRow,
  column: ServerSortColumn,
  direction: ServerSortDirection,
): number {
  const favourite = compareFavourite(a, b)
  if (favourite !== 0) return favourite

  const valueA = columnValue(a, column)
  const valueB = columnValue(b, column)

  if (valueA === undefined && valueB === undefined) return compareDefault(a, b)
  if (valueA === undefined) return 1
  if (valueB === undefined) return -1

  const cmp = compareColumnValues(valueA, valueB)
  const directed = direction === 'asc' ? cmp : -cmp
  if (directed !== 0) return directed

  return compareDefault(a, b)
}

/**
 * Sorts a copy of `rows` — never mutates the input. `sort` undefined means the default order;
 * otherwise sorts by that column/direction, favourites still pinned first.
 */
export function sortServerRows(
  rows: readonly ServerListRow[],
  sort: ServerListSort | undefined,
): ServerListRow[] {
  const copy = [...rows]
  if (sort === undefined) {
    return copy.sort(compareDefault)
  }
  const { column, direction } = sort
  return copy.sort((a, b) => compareColumn(a, b, column, direction))
}

/**
 * Cycles a column header's sort state: clicking a different column (or from no sort at all) picks
 * that column at its natural direction; clicking the same column again reverses it; clicking it a
 * third time returns to the default order (`undefined`).
 */
export function nextSort(
  current: ServerListSort | undefined,
  column: ServerSortColumn,
): ServerListSort | undefined {
  if (current === undefined || current.column !== column) {
    return { column, direction: NATURAL_DIRECTION[column] }
  }
  if (current.direction === NATURAL_DIRECTION[column]) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return undefined
}
