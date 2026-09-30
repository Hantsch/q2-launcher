import { describe, expect, it } from 'vitest'
import { DEMO_SORT_COLUMNS, NATURAL_DIRECTION, nextSort, sortDemoRows } from './list-sort'
import type { DemoSortColumn, DemoSortFields } from './list-sort'

let counter = 0

function mkRow(partial: Partial<DemoSortFields> = {}): DemoSortFields {
  counter += 1
  return {
    id: `id-${counter}`,
    favourite: false,
    rating: null,
    map: null,
    mod: null,
    players: null,
    date: null,
    durationMs: null,
    ...partial,
  }
}

const identity = (row: DemoSortFields): DemoSortFields => row

function idsOf(rows: DemoSortFields[]): string[] {
  return rows.map((r) => r.id)
}

describe('sortDemoRows — default order', () => {
  it('favourites first, each group newest first, unknown date last, id tie-break makes it total', () => {
    const a = mkRow({ id: 'a', favourite: true, date: 1000 })
    const b = mkRow({ id: 'b', favourite: true, date: 1000 })
    const favUnknown = mkRow({ id: 'fav-unknown', favourite: true, date: null })
    const nonfav = mkRow({ id: 'nonfav', favourite: false, date: 2000 })
    const nonfavUnknown = mkRow({ id: 'nonfav-unknown', favourite: false, date: null })

    const shuffled = [nonfavUnknown, b, nonfav, favUnknown, a]
    const result = sortDemoRows(shuffled, null, identity)

    // Favourites first regardless of date (nonfav's 2000 beats both favourites' 1000, but still
    // sorts after them); within the favourite group, date ties break by id; unknown date is last
    // in its group.
    expect(idsOf(result)).toEqual(['a', 'b', 'fav-unknown', 'nonfav', 'nonfav-unknown'])
  })
})

describe('sortDemoRows — column sort, every column, both directions', () => {
  const cases: Array<{ column: DemoSortColumn; build: () => DemoSortFields[] }> = [
    {
      column: 'map',
      build: () => [
        mkRow({ id: 'low', map: 'alpha' }),
        mkRow({ id: 'mid', map: 'bravo' }),
        mkRow({ id: 'high', map: 'charlie' }),
      ],
    },
    {
      column: 'mod',
      build: () => [
        mkRow({ id: 'low', mod: 'alpha' }),
        mkRow({ id: 'mid', mod: 'bravo' }),
        mkRow({ id: 'high', mod: 'charlie' }),
      ],
    },
    {
      column: 'players',
      build: () => [
        mkRow({ id: 'low', players: 'alpha' }),
        mkRow({ id: 'mid', players: 'bravo' }),
        mkRow({ id: 'high', players: 'charlie' }),
      ],
    },
    {
      column: 'date',
      build: () => [
        mkRow({ id: 'low', date: 1000 }),
        mkRow({ id: 'mid', date: 2000 }),
        mkRow({ id: 'high', date: 3000 }),
      ],
    },
    {
      column: 'duration',
      build: () => [
        mkRow({ id: 'low', durationMs: 1000 }),
        mkRow({ id: 'mid', durationMs: 2000 }),
        mkRow({ id: 'high', durationMs: 3000 }),
      ],
    },
    {
      column: 'rating',
      build: () => [
        mkRow({ id: 'low', favourite: false, rating: 1 }),
        mkRow({ id: 'mid', favourite: false, rating: 2 }),
        mkRow({ id: 'high', favourite: false, rating: 3 }),
      ],
    },
  ]

  it.each(cases)('$column sorts ascending and descending', ({ column, build }) => {
    const [low, mid, high] = build()
    const shuffled = [high, low, mid]

    const asc = sortDemoRows(shuffled, { column, direction: 'asc' }, identity)
    expect(idsOf(asc)).toEqual(['low', 'mid', 'high'])

    const desc = sortDemoRows(shuffled, { column, direction: 'desc' }, identity)
    expect(idsOf(desc)).toEqual(['high', 'mid', 'low'])
  })

  it('every column is present exactly once in DEMO_SORT_COLUMNS', () => {
    expect(DEMO_SORT_COLUMNS).toHaveLength(cases.length)
    expect(new Set(DEMO_SORT_COLUMNS)).toEqual(new Set(cases.map((c) => c.column)))
  })
})

describe('sortDemoRows — unknown values sort after known values, both directions', () => {
  const cases: Array<{ column: DemoSortColumn; build: () => [DemoSortFields, DemoSortFields] }> = [
    {
      column: 'map',
      build: () => [mkRow({ id: 'known', map: 'q2dm1' }), mkRow({ id: 'unknown', map: '   ' })],
    },
    {
      column: 'mod',
      build: () => [mkRow({ id: 'known', mod: 'ctf' }), mkRow({ id: 'unknown', mod: null })],
    },
    {
      column: 'players',
      build: () => [
        mkRow({ id: 'known', players: '3/8' }),
        mkRow({ id: 'unknown', players: null }),
      ],
    },
    {
      column: 'date',
      build: () => [mkRow({ id: 'known', date: 1000 }), mkRow({ id: 'unknown', date: null })],
    },
    {
      column: 'duration',
      build: () => [
        mkRow({ id: 'known', durationMs: 1000 }),
        mkRow({ id: 'unknown', durationMs: Number.NaN }),
      ],
    },
    {
      column: 'rating',
      build: () => [
        mkRow({ id: 'known', favourite: false, rating: 5 }),
        mkRow({ id: 'unknown', favourite: false, rating: null }),
      ],
    },
  ]

  it.each(cases)('$column: unknown is last in both directions', ({ column, build }) => {
    const [known, unknown] = build()

    const asc = sortDemoRows([unknown, known], { column, direction: 'asc' }, identity)
    expect(idsOf(asc)).toEqual(['known', 'unknown'])

    const desc = sortDemoRows([unknown, known], { column, direction: 'desc' }, identity)
    expect(idsOf(desc)).toEqual(['known', 'unknown'])
  })
})

describe('sortDemoRows — a column sort does not pin favourites', () => {
  it('a favourite with an older date does not get pulled above a newer non-favourite', () => {
    const fav = mkRow({ id: 'fav', favourite: true, date: 1000 })
    const nonfav = mkRow({ id: 'nonfav', favourite: false, date: 5000 })

    const desc = sortDemoRows([fav, nonfav], { column: 'date', direction: 'desc' }, identity)
    expect(idsOf(desc)).toEqual(['nonfav', 'fav'])
  })

  it('a favourite with a "worse" map name does not get pulled above a non-favourite', () => {
    const fav = mkRow({ id: 'fav', favourite: true, map: 'zzz' })
    const nonfav = mkRow({ id: 'nonfav', favourite: false, map: 'aaa' })

    const asc = sortDemoRows([fav, nonfav], { column: 'map', direction: 'asc' }, identity)
    expect(idsOf(asc)).toEqual(['nonfav', 'fav'])
  })
})

describe('sortDemoRows — tie-break chain', () => {
  it('ties on the sorted column fall back to date descending (unknown last), then id ascending', () => {
    const b = mkRow({ id: 'b', map: 'q2dm1', date: 2000 })
    const a = mkRow({ id: 'a', map: 'q2dm1', date: 2000 })
    const c = mkRow({ id: 'c', map: 'q2dm1', date: null })

    const result = sortDemoRows([c, b, a], { column: 'map', direction: 'asc' }, identity)

    expect(idsOf(result)).toEqual(['a', 'b', 'c'])
  })
})

describe('sortDemoRows — purity', () => {
  it('does not mutate the input array', () => {
    const rows = [mkRow({ date: 3000 }), mkRow({ date: 1000 }), mkRow({ date: 2000 })]
    const original = [...rows]

    sortDemoRows(rows, null, identity)
    sortDemoRows(rows, { column: 'date', direction: 'asc' }, identity)

    expect(rows).toEqual(original)
  })
})

describe('nextSort', () => {
  it('cycles natural -> reversed -> default, and jumps to natural on a different column', () => {
    const natural = nextSort(null, 'date')
    expect(natural).toEqual({ column: 'date', direction: NATURAL_DIRECTION.date })

    const reversed = nextSort(natural, 'date')
    expect(reversed).toEqual({ column: 'date', direction: 'asc' })

    const backToDefault = nextSort(reversed, 'date')
    expect(backToDefault).toBeNull()

    const otherColumn = nextSort(reversed, 'map')
    expect(otherColumn).toEqual({ column: 'map', direction: NATURAL_DIRECTION.map })
  })
})
