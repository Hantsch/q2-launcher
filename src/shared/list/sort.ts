/**
 * Generic column-sort primitives for the launcher's lists — one engine every list's sort is
 * expressed in: a column is a spec (which values are unknown, how two known values compare
 * ascending), the list supplies its default order and its tie-break, and says whether favourites
 * stay pinned to the top under a column sort.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * electron import.
 */

export type SortDirection = 'asc' | 'desc'

export interface ListSort<C extends string> {
  column: C
  direction: SortDirection
}

/** Case- and accent-insensitive, digit runs compared as numbers (`map2` before `map10`). */
export function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })
}

/** Favourites before non-favourites; two rows with the same flag tie (0). */
export function compareFavouriteFirst(
  a: { readonly favourite: boolean },
  b: { readonly favourite: boolean },
): number {
  if (a.favourite === b.favourite) return 0
  return a.favourite ? -1 : 1
}

/**
 * Cycles a column header's sort state: a different column (or no sort at all) picks that column at
 * its natural direction; the same column at its natural direction reverses it; the same column
 * already reversed returns to the default order (`null`).
 */
export function nextSort<C extends string>(
  current: ListSort<C> | null,
  column: C,
  natural: Record<C, SortDirection>,
): ListSort<C> | null {
  if (current === null || current.column !== column) {
    return { column, direction: natural[column] }
  }
  if (current.direction === natural[column]) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return null
}

export interface ColumnSpec<T> {
  isUnknown(row: T): boolean
  /** Ascending comparison between two rows whose values are both known. */
  compareKnownAscending(a: T, b: T): number
}

/**
 * Compares two rows by one column in `direction`. An unknown value sorts after every known value
 * in both directions; two unknowns, and two equal known values, return 0 so the caller's
 * tie-break decides.
 */
export function compareBy<T>(a: T, b: T, spec: ColumnSpec<T>, direction: SortDirection): number {
  const aUnknown = spec.isUnknown(a)
  const bUnknown = spec.isUnknown(b)
  if (aUnknown && bUnknown) return 0
  if (aUnknown) return 1
  if (bUnknown) return -1
  const ascending = spec.compareKnownAscending(a, b)
  if (ascending === 0) return 0
  return direction === 'asc' ? ascending : -ascending
}

export interface ColumnSorterOptions<T, C extends string> {
  columns: Record<C, ColumnSpec<T>>
  natural: Record<C, SortDirection>
  /** The order with no column sort active — used alone, nothing is applied before it. */
  defaultCompare(a: T, b: T): number
  /** Decides rows the column compare leaves tied (two unknowns, or equal known values). */
  tieBreak(a: T, b: T): number
  /** Whether favourites stay pinned above everything else under a column sort. Only rows that
   * carry a `favourite` flag can be pinned. */
  pinFavourites: T extends { readonly favourite: boolean } ? boolean : false
}

export interface ColumnSorter<T, C extends string> {
  /** A sorted copy of `rows` — the input is never mutated. `null` means the default order. */
  sortRows(rows: readonly T[], sort: ListSort<C> | null): T[]
  nextSort(current: ListSort<C> | null, column: C): ListSort<C> | null
}

export function createColumnSorter<T, C extends string>(
  options: ColumnSorterOptions<T, C>,
): ColumnSorter<T, C> {
  const { columns, natural, defaultCompare, tieBreak, pinFavourites } = options

  function compareColumn(a: T, b: T, column: C, direction: SortDirection): number {
    if (pinFavourites) {
      // `pinFavourites` can only be true when T carries a `favourite` flag (see its type).
      const favourite = compareFavouriteFirst(
        a as { readonly favourite: boolean },
        b as { readonly favourite: boolean },
      )
      if (favourite !== 0) return favourite
    }
    const byColumn = compareBy(a, b, columns[column], direction)
    if (byColumn !== 0) return byColumn
    return tieBreak(a, b)
  }

  return {
    sortRows(rows, sort) {
      const copy = [...rows]
      if (sort === null) return copy.sort(defaultCompare)
      const { column, direction } = sort
      return copy.sort((a, b) => compareColumn(a, b, column, direction))
    },
    nextSort(current, column) {
      return nextSort(current, column, natural)
    },
  }
}
