import { describe, expect, it } from 'vitest'
import {
  EMPTY_DEMO_LIST_FILTER,
  demoFilterOptions,
  demoListFilterSchema,
  filterDemos,
  isDemoFilterActive,
  matchesDemoFilter,
  matchesDemoSearch,
  type DemoFilterSubject,
  type DemoListFilter,
} from './list-filter'

function subject(overrides: Partial<DemoFilterSubject> = {}): DemoFilterSubject {
  return {
    fileName: 'demo.dm2',
    name: 'Some Demo',
    map: 'q2dm1',
    mod: 'baseq2',
    gamemode: { value: 'duel', source: 'sidecar' },
    sidecar: null,
    headerPlayers: [],
    namePlayers: [],
    rosterTerms: [],
    date: null,
    ...overrides,
  }
}

function filter(overrides: Partial<DemoListFilter> = {}): DemoListFilter {
  return { ...EMPTY_DEMO_LIST_FILTER, ...overrides }
}

describe('matchesDemoSearch', () => {
  it('search finds a demo by its team name', () => {
    const s = subject({ rosterTerms: ['Home', 'Away', 'Zed', 'Watcher'] })
    expect(matchesDemoSearch(s, 'Away')).toBe(true)
    expect(matchesDemoSearch(s, 'watcher')).toBe(true)
    expect(matchesDemoSearch(subject(), 'Away')).toBe(false)
  })

  it('matches every field case-insensitively', () => {
    const s = subject({
      name: 'Grudge Match',
      fileName: 'grudge_final.dm2',
      map: 'Q2DM8',
      sidecar: { description: 'Epic CTF finale', tags: ['Highlight'] },
    })
    expect(matchesDemoSearch(s, 'GRUDGE')).toBe(true) // name
    expect(matchesDemoSearch(s, 'FINAL.DM2')).toBe(true) // file name
    expect(matchesDemoSearch(s, 'q2dm8')).toBe(true) // map
    expect(matchesDemoSearch(s, 'ctf finale')).toBe(true) // description
    expect(matchesDemoSearch(s, 'highlight')).toBe(true) // tag
  })

  it('finds a player from every source', () => {
    const s = subject({
      sidecar: { sides: [{ players: ['Tom'] }] },
      headerPlayers: ['Rex'],
      namePlayers: ['Zed'],
    })
    expect(matchesDemoSearch(s, 'tom')).toBe(true)
    expect(matchesDemoSearch(s, 'rex')).toBe(true)
    expect(matchesDemoSearch(s, 'zed')).toBe(true)
    expect(matchesDemoSearch(s, 'nobody')).toBe(false)
  })

  it('never throws on missing parts and matches everything on an empty term', () => {
    const s = subject({ name: null, map: null, sidecar: null })
    expect(() => matchesDemoSearch(s, '')).not.toThrow()
    expect(matchesDemoSearch(s, '')).toBe(true)
    expect(matchesDemoSearch(s, '   ')).toBe(true)
    expect(matchesDemoSearch(s, 'anything')).toBe(false)
  })

  it('a quoted search matches a whole field exactly', () => {
    const s = subject({
      name: 'Grudge Match',
      fileName: 'grudge_final.dm2',
      map: 'q2ctf5',
      sidecar: { description: 'Epic finale', tags: ['lan'], sides: [{ players: ['Tom'] }] },
      headerPlayers: ['Rex'],
      namePlayers: ['Zed'],
    })
    for (const whole of [
      'GRUDGE MATCH',
      'grudge_final.dm2',
      'q2ctf5',
      'epic finale',
      'LAN',
      'tom',
      'rex',
      'zed',
    ]) {
      expect(matchesDemoSearch(s, `"${whole}"`)).toBe(true)
    }
  })

  it('a quoted partial value matches nothing', () => {
    const s = subject({ map: 'q2ctf5', sidecar: { tags: ['final'] }, headerPlayers: ['WallFly'] })
    expect(matchesDemoSearch(s, 'q2ctf')).toBe(true)
    expect(matchesDemoSearch(s, '"q2ctf"')).toBe(false)
    expect(matchesDemoSearch(s, '"fina"')).toBe(false)
    expect(matchesDemoSearch(s, '"wall"')).toBe(false)
  })
})

describe('matchesDemoFilter — one criterion at a time', () => {
  const rows: DemoFilterSubject[] = [
    subject({
      fileName: 'a',
      mod: 'ctf',
      gamemode: { value: 'ctf', source: 'sidecar' },
      map: 'q2dm1',
    }),
    subject({
      fileName: 'b',
      mod: 'baseq2',
      gamemode: { value: 'duel', source: 'guessed' },
      map: 'q2dm2',
      sidecar: { favourite: true, rating: 8 },
    }),
    subject({
      fileName: 'c',
      mod: 'baseq2',
      gamemode: { value: null, source: 'none' },
      map: 'q2dm1',
      sidecar: { rating: 3 },
    }),
  ]

  it('mod', () => {
    expect(
      rows.filter((r) => matchesDemoFilter(r, filter({ mod: 'baseq2' }))).map((r) => r.fileName),
    ).toEqual(['b', 'c'])
  })

  it('gamemode, including a guessed value', () => {
    expect(
      rows.filter((r) => matchesDemoFilter(r, filter({ gamemode: 'duel' }))).map((r) => r.fileName),
    ).toEqual(['b'])
  })

  it('map', () => {
    expect(
      rows.filter((r) => matchesDemoFilter(r, filter({ map: 'q2dm1' }))).map((r) => r.fileName),
    ).toEqual(['a', 'c'])
  })

  it('favouritesOnly', () => {
    expect(
      rows
        .filter((r) => matchesDemoFilter(r, filter({ favouritesOnly: true })))
        .map((r) => r.fileName),
    ).toEqual(['b'])
  })

  it('minRating', () => {
    expect(
      rows.filter((r) => matchesDemoFilter(r, filter({ minRating: 5 }))).map((r) => r.fileName),
    ).toEqual(['b'])
  })

  it('a rating filter excludes unrated demos', () => {
    const unrated = subject({ fileName: 'unrated', sidecar: {} })
    expect(matchesDemoFilter(unrated, filter({ minRating: 1 }))).toBe(false)
  })

  it('several tags match with OR', () => {
    const a = subject({ fileName: 'a', sidecar: { tags: ['funny'] } })
    const b = subject({ fileName: 'b', sidecar: { tags: ['sad'] } })
    const c = subject({ fileName: 'c', sidecar: { tags: ['boring'] } })
    const f = filter({ tags: ['Funny', 'SAD'] })
    expect([a, b, c].filter((r) => matchesDemoFilter(r, f)).map((r) => r.fileName)).toEqual([
      'a',
      'b',
    ])
  })
})

describe('matchesDemoFilter — combinations', () => {
  it('active filters intersect, including to an empty result', () => {
    const rows: DemoFilterSubject[] = [
      subject({ fileName: 'a', mod: 'ctf', map: 'q2dm1', sidecar: { favourite: true } }),
      subject({ fileName: 'b', mod: 'ctf', map: 'q2dm2', sidecar: { favourite: true } }),
      subject({ fileName: 'c', mod: 'baseq2', map: 'q2dm1', sidecar: { favourite: true } }),
    ]
    const f = filter({ mod: 'ctf', map: 'q2dm1', favouritesOnly: true })
    expect(rows.filter((r) => matchesDemoFilter(r, f)).map((r) => r.fileName)).toEqual(['a'])

    const impossible = filter({ mod: 'ctf', map: 'q2dm2', favouritesOnly: true, minRating: 9 })
    expect(rows.filter((r) => matchesDemoFilter(r, impossible))).toEqual([])
  })

  it('no active filter lists every row, including a whitespace-only search', () => {
    const rows: DemoFilterSubject[] = [subject({ fileName: 'a' }), subject({ fileName: 'b' })]
    expect(rows.filter((r) => matchesDemoFilter(r, EMPTY_DEMO_LIST_FILTER))).toHaveLength(2)
    expect(rows.filter((r) => matchesDemoFilter(r, filter({ search: '   ' })))).toHaveLength(2)
    expect(isDemoFilterActive(filter({ search: '   ' }))).toBe(false)
    expect(isDemoFilterActive(EMPTY_DEMO_LIST_FILTER)).toBe(false)
  })
})

describe('matchesDemoFilter — date range', () => {
  const nowMs = new Date(2026, 0, 15).getTime()
  const inRangeMs = new Date(2026, 0, 10).getTime()
  const outOfRangeMs = new Date(2025, 11, 1).getTime()
  const dateFilter = filter({ date: { kind: 'custom', from: '2026-01-05', to: '2026-01-12' } })

  it('the date filter matches on the effective date whatever its source', () => {
    const a = subject({ fileName: 'a', mod: 'baseq2', date: inRangeMs })
    const b = subject({ fileName: 'b', mod: 'ctf', date: inRangeMs })
    const c = subject({ fileName: 'c', date: outOfRangeMs })

    expect(matchesDemoFilter(a, dateFilter, nowMs)).toBe(true)
    expect(matchesDemoFilter(b, dateFilter, nowMs)).toBe(true)
    expect(matchesDemoFilter(c, dateFilter, nowMs)).toBe(false)
  })

  it('the date filter ANDs with the other filters', () => {
    const f = filter({ ...dateFilter, mod: 'ctf' })
    const failsMod = subject({ fileName: 'a', mod: 'baseq2', date: inRangeMs })
    const failsDate = subject({ fileName: 'b', mod: 'ctf', date: outOfRangeMs })
    const passesBoth = subject({ fileName: 'c', mod: 'ctf', date: inRangeMs })

    expect(matchesDemoFilter(failsMod, f, nowMs)).toBe(false)
    expect(matchesDemoFilter(failsDate, f, nowMs)).toBe(false)
    expect(matchesDemoFilter(passesBoth, f, nowMs)).toBe(true)
  })

  it('the empty filter has no date filter and counts as inactive', () => {
    expect(EMPTY_DEMO_LIST_FILTER.date).toBeNull()
    expect(isDemoFilterActive(EMPTY_DEMO_LIST_FILTER)).toBe(false)
  })
})

describe('filterDemos', () => {
  it('preserves the input order and never mutates the input', () => {
    const rows = [
      { id: 'z', mod: 'baseq2' },
      { id: 'a', mod: 'baseq2' },
      { id: 'm', mod: 'ctf' },
    ]
    const original = [...rows]
    const result = filterDemos(rows, filter({ mod: 'baseq2' }), (r) =>
      subject({ fileName: r.id, mod: r.mod }),
    )
    expect(result.map((r) => r.id)).toEqual(['z', 'a'])
    expect(rows).toEqual(original)
  })
})

describe('demoFilterOptions', () => {
  it('is distinct, case-insensitive and sorted', () => {
    const subjects: DemoFilterSubject[] = [
      subject({
        mod: 'baseq2',
        map: 'Q2DM1',
        gamemode: { value: 'duel', source: 'sidecar' },
        sidecar: { tags: ['Fun'] },
      }),
      subject({
        mod: 'BaseQ2',
        map: 'q2dm3',
        gamemode: { value: 'ctf', source: 'guessed' },
        sidecar: { tags: ['fun', 'epic'] },
      }),
      subject({
        mod: 'ctf',
        map: 'q2dm1',
        gamemode: { value: null, source: 'none' },
        sidecar: null,
      }),
    ]
    const options = demoFilterOptions(subjects)
    expect(options.mods).toEqual(['baseq2', 'ctf'])
    expect(options.maps).toEqual(['Q2DM1', 'q2dm3'])
    expect(options.tags).toEqual(['epic', 'Fun'])
    expect(options.gamemodes.map((g) => g.value).sort()).toEqual(['ctf', 'duel'])
    expect(options.gamemodes.every((g) => g.labelKey !== undefined)).toBe(true)
  })
})

describe('demoListFilterSchema', () => {
  it('accepts the empty filter and rejects out-of-range values', () => {
    expect(demoListFilterSchema.safeParse(EMPTY_DEMO_LIST_FILTER).success).toBe(true)
    expect(demoListFilterSchema.safeParse(filter({ minRating: 0 })).success).toBe(false)
    expect(demoListFilterSchema.safeParse(filter({ minRating: 11 })).success).toBe(false)
    expect(demoListFilterSchema.safeParse(filter({ search: 'x'.repeat(201) })).success).toBe(false)
    expect(demoListFilterSchema.safeParse(filter({ tags: ['x'.repeat(41)] })).success).toBe(false)
    expect(demoListFilterSchema.safeParse({ ...EMPTY_DEMO_LIST_FILTER, extra: 1 }).success).toBe(
      false,
    )
  })
})
