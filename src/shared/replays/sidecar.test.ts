import { describe, expect, it } from 'vitest'
import {
  isEmptySidecar,
  normalizeSidecarFields,
  serializeSidecar,
  sidecarFieldsSchema,
  sidecarFileName,
  sidecarFileSchema,
} from './sidecar'

const fullFields = {
  name: 'Grand final',
  description: 'A close one.',
  mod: 'ctf',
  gamemode: 'ctf',
  map: 'q2dm1',
  sides: [{ team: 'red', result: 'win', players: ['alice', 'bob'] }],
  tags: ['final', 'ctf'],
  favourite: true,
  rating: 8,
  date: '2026-01-02T03:04:05Z',
}

describe("the sidecar schema accepts exactly the story's fields", () => {
  it('parses a full valid object via sidecarFieldsSchema', () => {
    expect(sidecarFieldsSchema.safeParse(fullFields).success).toBe(true)
  })

  it('parses a full valid object via sidecarFileSchema with schemaVersion 1', () => {
    const withVersion = { schemaVersion: 1 as const, ...fullFields }
    expect(sidecarFileSchema.safeParse(withVersion).success).toBe(true)
  })

  it('rejects an object with an extra unknown key', () => {
    expect(sidecarFieldsSchema.safeParse({ ...fullFields, extra: 'nope' }).success).toBe(false)
  })

  it('rejects rating: 0', () => {
    expect(sidecarFieldsSchema.safeParse({ ...fullFields, rating: 0 }).success).toBe(false)
  })

  it('rejects rating: 11', () => {
    expect(sidecarFieldsSchema.safeParse({ ...fullFields, rating: 11 }).success).toBe(false)
  })

  it('rejects rating: 5.5', () => {
    expect(sidecarFieldsSchema.safeParse({ ...fullFields, rating: 5.5 }).success).toBe(false)
  })

  it('rejects favourite: "yes" (non-boolean)', () => {
    expect(sidecarFieldsSchema.safeParse({ ...fullFields, favourite: 'yes' }).success).toBe(false)
  })

  it('rejects date: "not-a-date" (non-ISO)', () => {
    expect(sidecarFieldsSchema.safeParse({ ...fullFields, date: 'not-a-date' }).success).toBe(false)
  })

  it('rejects a side object with team set but no players key at all', () => {
    const withBadSide = { ...fullFields, sides: [{ team: 'red' }] }
    expect(sidecarFieldsSchema.safeParse(withBadSide).success).toBe(false)
  })

  it('rejects schemaVersion: 2 via sidecarFileSchema', () => {
    const withVersion = { schemaVersion: 2, ...fullFields }
    expect(sidecarFileSchema.safeParse(withVersion).success).toBe(false)
  })
})

describe('normalisation keeps only what the user set', () => {
  it('trims strings and drops fields that become empty', () => {
    expect(normalizeSidecarFields({ name: '  Foo  ', description: '   ' })).toEqual({
      name: 'Foo',
    })
  })

  it('trims tags, drops empties, and de-duplicates case-insensitively keeping first spelling', () => {
    expect(normalizeSidecarFields({ tags: ['Foo', ' foo ', 'bar', '  '] })).toEqual({
      tags: ['Foo', 'bar'],
    })
  })

  it('trims player names and drops empties', () => {
    expect(
      normalizeSidecarFields({
        sides: [{ team: 'red', players: [' alice ', '', 'bob'] }],
      }),
    ).toEqual({
      sides: [{ team: 'red', players: ['alice', 'bob'] }],
    })
  })

  it('drops a side with no team, no result and empty players', () => {
    expect(
      normalizeSidecarFields({
        sides: [{ players: ['  ', ''] }, { team: 'red', players: [] }],
      }),
    ).toEqual({
      sides: [{ team: 'red', players: [] }],
    })
  })

  it('omits favourite: false', () => {
    expect(normalizeSidecarFields({ favourite: false, name: 'x' })).toEqual({ name: 'x' })
  })

  it('omits an empty sides/tags array input entirely', () => {
    expect(normalizeSidecarFields({ sides: [], tags: [] })).toEqual({})
  })

  it('reports empty when no keys remain', () => {
    expect(isEmptySidecar(normalizeSidecarFields({ favourite: false, tags: [] }))).toBe(true)
    expect(isEmptySidecar(normalizeSidecarFields({ name: 'x' }))).toBe(false)
  })
})

describe('serialisation is pretty-printed in a fixed key order', () => {
  it('produces byte-identical output regardless of source key order', () => {
    const shuffled = {
      date: '2026-01-02T03:04:05Z',
      rating: 8,
      favourite: true,
      tags: ['final', 'ctf'],
      sides: [{ players: ['alice', 'bob'], result: 'win', team: 'red' }],
      map: 'q2dm1',
      gamemode: 'ctf',
      mod: 'ctf',
      description: 'A close one.',
      name: 'Grand final',
    }

    const expected =
      '{\n' +
      '  "schemaVersion": 1,\n' +
      '  "name": "Grand final",\n' +
      '  "description": "A close one.",\n' +
      '  "mod": "ctf",\n' +
      '  "gamemode": "ctf",\n' +
      '  "map": "q2dm1",\n' +
      '  "sides": [\n' +
      '    {\n' +
      '      "team": "red",\n' +
      '      "result": "win",\n' +
      '      "players": [\n' +
      '        "alice",\n' +
      '        "bob"\n' +
      '      ]\n' +
      '    }\n' +
      '  ],\n' +
      '  "tags": [\n' +
      '    "final",\n' +
      '    "ctf"\n' +
      '  ],\n' +
      '  "favourite": true,\n' +
      '  "rating": 8,\n' +
      '  "date": "2026-01-02T03:04:05Z"\n' +
      '}\n'

    const actual = serializeSidecar(shuffled)
    expect(actual).toBe(expected)
    expect(actual.includes('\r')).toBe(false)
  })
})

describe('the sidecar name is the full demo file name plus .json', () => {
  it('appends .json verbatim, preserving case', () => {
    expect(sidecarFileName('final.dm2')).toBe('final.dm2.json')
    expect(sidecarFileName('x.mvd2.gz')).toBe('x.mvd2.gz.json')
    expect(sidecarFileName('FINAL.DM2')).toBe('FINAL.DM2.json')
  })
})

describe('sidecar comments', () => {
  it('comments are normalised: trimmed, empties dropped, sorted by time', () => {
    const out = normalizeSidecarFields({
      comments: [
        { atMs: 5000, text: '  second  ' },
        { atMs: 100, text: 'first' },
        { atMs: 300, text: '   ' },
      ],
    })
    expect(out.comments).toEqual([
      { atMs: 100, text: 'first' },
      { atMs: 5000, text: 'second' },
    ])
    expect(Object.keys(JSON.parse(serializeSidecar({ ...fullFields, ...out })))).toEqual([
      'schemaVersion',
      'name',
      'description',
      'mod',
      'gamemode',
      'map',
      'sides',
      'tags',
      'favourite',
      'rating',
      'date',
      'comments',
    ])
    expect(normalizeSidecarFields({ comments: [{ atMs: 1, text: ' ' }] })).toEqual({})
  })
})
