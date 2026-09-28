import { describe, expect, it } from 'vitest'

import type { SidecarFields } from '../replays/sidecar'
import type { NameFacts } from '../replays/name-template'
import type { Dm2Header } from './dm2-header'
import {
  effectiveFileTime,
  hasValue,
  firstValue,
  resolveEffectiveValues,
  type ResolveEffectiveValuesInputs,
} from './effective-values'

function header(overrides: Partial<Dm2Header> = {}): Dm2Header {
  return {
    ok: true,
    protocol: 34,
    layout: 'original',
    gameDir: 'baseq2',
    levelName: 'The Edge',
    map: 'q2dm1',
    pov: 'Ranger',
    players: ['Ranger', 'Slayer'],
    largestBlockBytes: 100,
    bytesConsumed: 100,
    ...overrides,
  }
}

const FIXED_FILE_TIME = { birthtimeMs: 1_000, mtimeMs: 2_000 } // -> epoch ms 1000 via effectiveFileTime

function baseInputs(overrides: Partial<ResolveEffectiveValuesInputs> = {}): ResolveEffectiveValuesInputs {
  return {
    fileName: 'final.dm2',
    sidecar: null,
    header: null,
    nameFacts: null,
    fileTime: FIXED_FILE_TIME,
    ...overrides,
  }
}

const NAME_FACTS: NameFacts = {
  date: { year: 2024, month: 3, day: 15, hour: 10, minute: 30, second: 5 },
  map: 'q2dm3',
  pov: 'Slayer',
  players: ['Alice', 'Bob'],
  host: 'q2dm3-host',
}

const NAME_FACTS_DATE_MS = new Date(2024, 2, 15, 10, 30, 5).getTime()

describe('resolveEffectiveValues', () => {
  it.each([
    // field, sidecar, header, nameFacts, expectedValue, expectedSource
    ['name', { name: 'My Match' }, null, null, 'My Match', 'sidecar'],
    ['name', {}, null, null, 'final.dm2', 'name'],
    ['map', { map: 'q2dm2' }, header(), NAME_FACTS, 'q2dm2', 'sidecar'],
    ['map', {}, header(), NAME_FACTS, 'q2dm1', 'demo'],
    ['map', {}, null, NAME_FACTS, 'q2dm3', 'name'],
    ['mod', { mod: 'rogue' }, header(), null, 'rogue', 'sidecar'],
    ['mod', {}, header(), null, 'baseq2', 'demo'],
    ['gamemode', { gamemode: 'ctf' }, null, null, 'ctf', 'sidecar'],
    [
      'sides',
      { sides: [{ players: ['A', 'B'] }] },
      header(),
      NAME_FACTS,
      [{ players: ['A', 'B'] }],
      'sidecar',
    ],
    ['sides', {}, header(), NAME_FACTS, [{ players: ['Ranger', 'Slayer'] }], 'demo'],
    ['sides', {}, null, NAME_FACTS, [{ players: ['Alice', 'Bob'] }], 'name'],
    ['pov', {}, header(), NAME_FACTS, 'Ranger', 'demo'],
    ['pov', {}, null, NAME_FACTS, 'Slayer', 'name'],
    ['host', {}, null, NAME_FACTS, 'q2dm3-host', 'name'],
  ] as const)(
    'each field takes the first rung that has a value and reports its source: %s',
    (field, sidecar, headerValue, nameFacts, expectedValue, expectedSource) => {
      const result = resolveEffectiveValues(
        baseInputs({ sidecar: sidecar as Partial<SidecarFields>, header: headerValue, nameFacts }),
      )
      const effective = result[field as keyof typeof result]
      expect(effective.value).toEqual(expectedValue)
      expect(effective.source).toBe(expectedSource)
    },
  )

  it('each field takes the first rung that has a value and reports its source', () => {
    // date has its own dedicated rungs (parsed, not passed through raw), covered separately below
    // so it is exercised here too for completeness of "every field".
    const sidecarDate = resolveEffectiveValues(
      baseInputs({ sidecar: { date: '2024-01-01T00:00:00.000Z' } }),
    )
    expect(sidecarDate.date.source).toBe('sidecar')

    const nameDate = resolveEffectiveValues(baseInputs({ nameFacts: NAME_FACTS }))
    expect(nameDate.date.source).toBe('name')
    expect(nameDate.date.value).toBe(NAME_FACTS_DATE_MS)

    const fileDate = resolveEffectiveValues(baseInputs())
    expect(fileDate.date.source).toBe('file')
    expect(fileDate.date.value).toBe(effectiveFileTime(FIXED_FILE_TIME))
  })

  it('the effective name is the sidecar name, else the file name', () => {
    const withSidecar = resolveEffectiveValues(baseInputs({ sidecar: { name: 'Grudge Match' } }))
    expect(withSidecar.name).toEqual({ value: 'Grudge Match', source: 'sidecar' })

    const withoutSidecar = resolveEffectiveValues(baseInputs({ sidecar: null }))
    expect(withoutSidecar.name).toEqual({ value: 'final.dm2', source: 'name' })
  })

  it("the effective sides are the sidecar's, else the demo's players, else the name's players", () => {
    const sidecarSides = resolveEffectiveValues(
      baseInputs({ sidecar: { sides: [{ team: 'red', players: ['A'] }] }, header: header(), nameFacts: NAME_FACTS }),
    )
    expect(sidecarSides.sides).toEqual({ value: [{ team: 'red', players: ['A'] }], source: 'sidecar' })

    const demoSides = resolveEffectiveValues(baseInputs({ header: header(), nameFacts: NAME_FACTS }))
    expect(demoSides.sides).toEqual({ value: [{ players: ['Ranger', 'Slayer'] }], source: 'demo' })

    const nameSides = resolveEffectiveValues(baseInputs({ nameFacts: NAME_FACTS }))
    expect(nameSides.sides).toEqual({ value: [{ players: ['Alice', 'Bob'] }], source: 'name' })

    // Demo header present but with an empty player list: falls through to name facts.
    const emptyDemoPlayers = resolveEffectiveValues(
      baseInputs({ header: header({ players: [] }), nameFacts: NAME_FACTS }),
    )
    expect(emptyDemoPlayers.sides).toEqual({ value: [{ players: ['Alice', 'Bob'] }], source: 'name' })

    // Both demo and name player lists empty: falls all the way through to no value.
    const noPlayers = resolveEffectiveValues(
      baseInputs({ header: header({ players: [] }), nameFacts: { ...NAME_FACTS, players: [] } }),
    )
    expect(noPlayers.sides).toEqual({ value: null, source: null })
  })

  it('the effective date is the sidecar override, else the name date, else the file time', () => {
    const sidecarDate = resolveEffectiveValues(
      baseInputs({ sidecar: { date: '2024-06-01T12:00:00.000Z' }, nameFacts: NAME_FACTS }),
    )
    expect(sidecarDate.date).toEqual({ value: Date.parse('2024-06-01T12:00:00.000Z'), source: 'sidecar' })

    const nameDate = resolveEffectiveValues(baseInputs({ nameFacts: NAME_FACTS }))
    expect(nameDate.date).toEqual({ value: NAME_FACTS_DATE_MS, source: 'name' })

    const fileDate = resolveEffectiveValues(baseInputs())
    expect(fileDate.date).toEqual({ value: effectiveFileTime(FIXED_FILE_TIME), source: 'file' })

    // Unparsable sidecar date string falls through to the name date.
    const unparsable = resolveEffectiveValues(
      baseInputs({ sidecar: { date: 'not-a-date' as SidecarFields['date'] }, nameFacts: NAME_FACTS }),
    )
    expect(unparsable.date).toEqual({ value: NAME_FACTS_DATE_MS, source: 'name' })
  })

  it('file time prefers creation and falls back to modification when creation is missing or later', () => {
    expect(effectiveFileTime({ birthtimeMs: 1_000, mtimeMs: 2_000 })).toBe(1_000)
    expect(effectiveFileTime({ birthtimeMs: 0, mtimeMs: 2_000 })).toBe(2_000)
    expect(effectiveFileTime({ birthtimeMs: 3_000, mtimeMs: 2_000 })).toBe(2_000)
  })

  it('clearing a sidecar field makes the next lower source effective again', () => {
    const withMap = resolveEffectiveValues(
      baseInputs({ sidecar: { map: 'q2dm2' }, header: header(), nameFacts: NAME_FACTS }),
    )
    expect(withMap.map).toEqual({ value: 'q2dm2', source: 'sidecar' })

    const removed = resolveEffectiveValues(baseInputs({ sidecar: {}, header: header(), nameFacts: NAME_FACTS }))
    expect(removed.map).toEqual({ value: 'q2dm1', source: 'demo' })

    const blank = resolveEffectiveValues(
      baseInputs({ sidecar: { map: '' }, header: header(), nameFacts: NAME_FACTS }),
    )
    expect(blank.map).toEqual({ value: 'q2dm1', source: 'demo' })

    const noSidecar = resolveEffectiveValues(baseInputs({ sidecar: null, header: header(), nameFacts: NAME_FACTS }))
    expect(noSidecar.map).toEqual({ value: 'q2dm1', source: 'demo' })

    // Also exercise an array field (sides) through the same present/removed/empty/null progression.
    const sidesWith = resolveEffectiveValues(
      baseInputs({ sidecar: { sides: [{ players: ['A'] }] }, header: header(), nameFacts: NAME_FACTS }),
    )
    expect(sidesWith.sides.source).toBe('sidecar')

    const sidesRemoved = resolveEffectiveValues(baseInputs({ sidecar: {}, header: header(), nameFacts: NAME_FACTS }))
    expect(sidesRemoved.sides.source).toBe('demo')

    const sidesEmpty = resolveEffectiveValues(
      baseInputs({ sidecar: { sides: [] }, header: header(), nameFacts: NAME_FACTS }),
    )
    expect(sidesEmpty.sides.source).toBe('demo')

    const sidesNoSidecar = resolveEffectiveValues(
      baseInputs({ sidecar: null, header: header(), nameFacts: NAME_FACTS }),
    )
    expect(sidesNoSidecar.sides.source).toBe('demo')
  })
})

describe('hasValue', () => {
  it('rejects null, undefined, blank strings and empty arrays; accepts everything else', () => {
    expect(hasValue(null)).toBe(false)
    expect(hasValue(undefined)).toBe(false)
    expect(hasValue('')).toBe(false)
    expect(hasValue('   ')).toBe(false)
    expect(hasValue([])).toBe(false)
    expect(hasValue(0)).toBe(true)
    expect(hasValue(false)).toBe(true)
    expect(hasValue('a')).toBe(true)
    expect(hasValue(['a'])).toBe(true)
    expect(hasValue({})).toBe(true)
  })
})

describe('firstValue', () => {
  it('returns the first rung with a value, or a null/null fallback when none do', () => {
    expect(
      firstValue([
        { source: 'sidecar', value: undefined },
        { source: 'demo', value: 'x' },
      ]),
    ).toEqual({ value: 'x', source: 'demo' })

    expect(firstValue([{ source: 'sidecar', value: undefined }])).toEqual({ value: null, source: null })
  })
})
