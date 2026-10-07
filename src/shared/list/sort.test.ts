import { describe, expect, it } from 'vitest'
import { compareBy, compareStrings, createColumnSorter, nextSort } from './sort'
import type { ColumnSpec, ListSort, SortDirection } from './sort'

interface Row {
  id: string
  favourite: boolean
  score: number | null
}

type Column = 'id' | 'score'

const NATURAL: Record<Column, SortDirection> = { id: 'asc', score: 'desc' }

const SCORE: ColumnSpec<Row> = {
  isUnknown: (row) => row.score === null,
  compareKnownAscending: (a, b) => (a.score as number) - (b.score as number),
}

const COLUMNS: Record<Column, ColumnSpec<Row>> = {
  id: { isUnknown: () => false, compareKnownAscending: (a, b) => compareStrings(a.id, b.id) },
  score: SCORE,
}

const byId = (a: Row, b: Row): number => compareStrings(a.id, b.id)

function row(id: string, score: number | null, favourite = false): Row {
  return { id, favourite, score }
}

function ids(rows: readonly Row[]): string[] {
  return rows.map((r) => r.id)
}

describe('nextSort', () => {
  it('nextSort cycles natural, reversed, null', () => {
    const first = nextSort<Column>(null, 'score', NATURAL)
    expect(first).toEqual({ column: 'score', direction: 'desc' })
    const second = nextSort(first, 'score', NATURAL)
    expect(second).toEqual({ column: 'score', direction: 'asc' })
    expect(nextSort(second, 'score', NATURAL)).toBeNull()
  })

  it('a different column starts at its own natural direction', () => {
    const reversed: ListSort<Column> = { column: 'score', direction: 'asc' }
    expect(nextSort(reversed, 'id', NATURAL)).toEqual({ column: 'id', direction: 'asc' })
  })
})

describe('compareBy', () => {
  it('compareBy puts unknowns last in both directions', () => {
    const known = row('a', 5)
    const unknown = row('b', null)
    for (const direction of ['asc', 'desc'] as const) {
      expect(compareBy(unknown, known, SCORE, direction)).toBeGreaterThan(0)
      expect(compareBy(known, unknown, SCORE, direction)).toBeLessThan(0)
    }
  })

  it('two unknowns and two equal known values tie so the caller decides', () => {
    expect(compareBy(row('a', null), row('b', null), SCORE, 'asc')).toBe(0)
    expect(compareBy(row('a', 3), row('b', 3), SCORE, 'desc')).toBe(0)
  })

  it('known values follow the direction', () => {
    expect(compareBy(row('a', 1), row('b', 2), SCORE, 'asc')).toBeLessThan(0)
    expect(compareBy(row('a', 1), row('b', 2), SCORE, 'desc')).toBeGreaterThan(0)
  })
})

describe('createColumnSorter', () => {
  const rows = [row('a', 1), row('b', null, true), row('c', 9), row('d', 5, true), row('e', null)]
  const options = {
    columns: COLUMNS,
    natural: NATURAL,
    // Reverse id order, so the default order is distinguishable from the tie-break.
    defaultCompare: (a: Row, b: Row) => -byId(a, b),
    tieBreak: byId,
  }

  it('createColumnSorter pins favourites only when asked', () => {
    const sort: ListSort<Column> = { column: 'score', direction: 'desc' }
    const pinned = createColumnSorter({ ...options, pinFavourites: true })
    const unpinned = createColumnSorter({ ...options, pinFavourites: false })

    expect(ids(pinned.sortRows(rows, sort))).toEqual(['d', 'b', 'c', 'a', 'e'])
    expect(ids(unpinned.sortRows(rows, sort))).toEqual(['c', 'd', 'a', 'b', 'e'])
  })

  it('the default order is the default comparator alone', () => {
    const pinned = createColumnSorter({ ...options, pinFavourites: true })
    expect(ids(pinned.sortRows(rows, null))).toEqual(['e', 'd', 'c', 'b', 'a'])
  })

  it('ties under a column sort fall to the tie-break', () => {
    const sorter = createColumnSorter({ ...options, pinFavourites: false })
    const tied = [row('z', 2), row('x', null), row('y', 2), row('w', null)]
    expect(ids(sorter.sortRows(tied, { column: 'score', direction: 'asc' }))).toEqual([
      'y',
      'z',
      'w',
      'x',
    ])
  })

  it('sortRows never mutates its input', () => {
    const sorter = createColumnSorter({ ...options, pinFavourites: true })
    const input = Object.freeze([...rows])
    const before = ids(input)

    const sorted = sorter.sortRows(input, { column: 'score', direction: 'asc' })
    sorter.sortRows(input, null)

    expect(ids(input)).toEqual(before)
    expect(sorted).not.toBe(input)
  })

  it('nextSort uses the natural directions it was created with', () => {
    const sorter = createColumnSorter({ ...options, pinFavourites: false })
    expect(sorter.nextSort(null, 'score')).toEqual({ column: 'score', direction: 'desc' })
  })
})
