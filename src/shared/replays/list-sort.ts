/**
 * Sort engine for the demo (replay) list — pure, mirrors the shape of
 * `src/shared/servers/list-sort.ts` but deliberately does NOT pin favourites under a column sort:
 * favourite-first grouping only applies to the default order (no explicit column sort active).
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * electron import.
 */

import { compareFavouriteFirst, compareStrings, createColumnSorter } from '../list/sort'
import type { ColumnSpec, ListSort, SortDirection } from '../list/sort'

export const DEMO_SORT_COLUMNS = ['map', 'mod', 'players', 'date', 'duration', 'rating'] as const

export type DemoSortColumn = (typeof DEMO_SORT_COLUMNS)[number]
export type DemoSortDirection = SortDirection
export type DemoListSort = ListSort<DemoSortColumn>

/** Each column's "natural" direction — the one `nextSort` picks the first time a column is
 * clicked, and reverses from on the second click. */
export const NATURAL_DIRECTION: Record<DemoSortColumn, DemoSortDirection> = {
  map: 'asc',
  mod: 'asc',
  players: 'asc',
  date: 'desc',
  duration: 'desc',
  rating: 'desc',
}

/**
 * The fields a demo row needs to expose for sorting. `date` is the effective date the row
 * displays, in epoch ms; `players` is the players/sides text the row shows.
 */
export interface DemoSortFields {
  id: string
  favourite: boolean
  rating: number | null
  map: string | null
  mod: string | null
  players: string | null
  date: number | null
  durationMs: number | null
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

function isUnknownNumber(value: number | null | undefined): boolean {
  return value === null || value === undefined || !Number.isFinite(value)
}

function compareId(a: DemoSortFields, b: DemoSortFields): number {
  return compareStrings(a.id, b.id)
}

/** Date descending, unknown date last — the shared tie-break under every sort mode. */
function compareDateDesc(a: DemoSortFields, b: DemoSortFields): number {
  const aUnknown = isUnknownNumber(a.date)
  const bUnknown = isUnknownNumber(b.date)
  if (aUnknown && bUnknown) return 0
  if (aUnknown) return 1
  if (bUnknown) return -1
  return (b.date as number) - (a.date as number)
}

/** Date descending (unknown last), then id ascending — the tie-break chain for every mode. */
function tieBreak(a: DemoSortFields, b: DemoSortFields): number {
  const date = compareDateDesc(a, b)
  if (date !== 0) return date
  return compareId(a, b)
}

/**
 * The default order (no explicit column sort): favourites before non-favourites, then within each
 * group date descending (unknown date last), then id ascending — a total order.
 */
function compareDefault(a: DemoSortFields, b: DemoSortFields): number {
  const favourite = compareFavouriteFirst(a, b)
  if (favourite !== 0) return favourite
  return tieBreak(a, b)
}

/** Rating's known-value order is a (favourite, rating) pair: favourite ranks above non-favourite;
 * within the same favourite flag, an unrated demo (rating null/non-finite) ranks below a rated
 * one. Only `favourite: false` with an unrated rating is "unknown" (sorts last, both directions).
 * This returns the comparison in DESCENDING/natural polarity (favourite+high-rating first). */
function ratingKnownDescending(a: DemoSortFields, b: DemoSortFields): number {
  if (a.favourite !== b.favourite) return a.favourite ? -1 : 1
  const ratingValue = (fields: DemoSortFields): number =>
    isUnknownNumber(fields.rating) ? -Infinity : (fields.rating as number)
  return ratingValue(b) - ratingValue(a)
}

function isRatingUnknown(fields: DemoSortFields): boolean {
  return !fields.favourite && isUnknownNumber(fields.rating)
}

const COLUMN_SPECS: Record<DemoSortColumn, ColumnSpec<DemoSortFields>> = {
  map: {
    isUnknown: (f) => isBlank(f.map),
    compareKnownAscending: (a, b) => compareStrings(a.map as string, b.map as string),
  },
  mod: {
    isUnknown: (f) => isBlank(f.mod),
    compareKnownAscending: (a, b) => compareStrings(a.mod as string, b.mod as string),
  },
  players: {
    isUnknown: (f) => isBlank(f.players),
    compareKnownAscending: (a, b) => compareStrings(a.players as string, b.players as string),
  },
  date: {
    isUnknown: (f) => isUnknownNumber(f.date),
    compareKnownAscending: (a, b) => (a.date as number) - (b.date as number),
  },
  duration: {
    isUnknown: (f) => isUnknownNumber(f.durationMs),
    compareKnownAscending: (a, b) => (a.durationMs as number) - (b.durationMs as number),
  },
  rating: {
    isUnknown: isRatingUnknown,
    // Ascending is the exact reverse of the descending known-value order.
    compareKnownAscending: (a, b) => -ratingKnownDescending(a, b),
  },
}

interface Entry {
  row: unknown
  fields: DemoSortFields
}

const SORTER = createColumnSorter<Entry, DemoSortColumn>({
  columns: {
    map: lift(COLUMN_SPECS.map),
    mod: lift(COLUMN_SPECS.mod),
    players: lift(COLUMN_SPECS.players),
    date: lift(COLUMN_SPECS.date),
    duration: lift(COLUMN_SPECS.duration),
    rating: lift(COLUMN_SPECS.rating),
  },
  natural: NATURAL_DIRECTION,
  defaultCompare: (a, b) => compareDefault(a.fields, b.fields),
  tieBreak: (a, b) => tieBreak(a.fields, b.fields),
  pinFavourites: false,
})

function lift(spec: ColumnSpec<DemoSortFields>): ColumnSpec<Entry> {
  return {
    isUnknown: (e) => spec.isUnknown(e.fields),
    compareKnownAscending: (a, b) => spec.compareKnownAscending(a.fields, b.fields),
  }
}

/**
 * Sorts a copy of `rows` — never mutates the input. `sort === null` means the default order
 * (favourites first, then date descending, then id); a column sort never pins favourites.
 */
export function sortDemoRows<T>(
  rows: readonly T[],
  sort: DemoListSort | null,
  fields: (row: T) => DemoSortFields,
): T[] {
  const entries = rows.map((row) => ({ row, fields: fields(row) }))
  return SORTER.sortRows(entries, sort).map((entry) => entry.row as T)
}

/** Cycles a header's sort state; the third click returns to the default order (`null`). */
export const nextSort = SORTER.nextSort
