import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  dedupeByKey,
  parseForgivingEnvelope,
  parseForgivingRows,
  parseKeyedRows,
} from './forgiving'

const rowSchema = z.object({ id: z.string(), gamedir: z.string() })
type Row = z.infer<typeof rowSchema>

describe('parseForgivingRows', () => {
  it('drops an invalid row and keeps its siblings', () => {
    const rows = parseForgivingRows(rowSchema, [
      { id: 'a', gamedir: 'x' },
      { id: 1 },
      { id: 'b', gamedir: 'y' },
    ])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('returns [] for a non-array', () => {
    expect(parseForgivingRows(rowSchema, { id: 'a' })).toEqual([])
    expect(parseForgivingRows(rowSchema, undefined)).toEqual([])
  })
})

describe('parseKeyedRows', () => {
  it('dedupe keeps the first occurrence', () => {
    const rows = parseKeyedRows(
      rowSchema,
      [
        { id: 'a', gamedir: 'one' },
        { id: 'a', gamedir: 'two' },
      ],
      { keyOf: (r: Row) => r.id },
    )
    expect(rows).toEqual([{ id: 'a', gamedir: 'one' }])
  })

  it('a key is reserved only by a kept row', () => {
    const rows = parseKeyedRows(
      rowSchema,
      [
        { id: 'a', gamedir: 'Base' },
        { id: 'b', gamedir: 'base' }, // dropped on gamedir; must not reserve id 'b'
        { id: 'b', gamedir: 'other' },
      ],
      { keyOf: { id: (r: Row) => r.id, gamedir: (r: Row) => r.gamedir.toLowerCase() } },
    )
    expect(rows.map((r) => r.gamedir)).toEqual(['Base', 'other'])
  })

  it('drops a row the refine step refuses', () => {
    const rows = parseKeyedRows(
      rowSchema,
      [
        { id: 'a', gamedir: 'x' },
        { id: 'b', gamedir: '' },
      ],
      {
        keyOf: (r: Row) => r.id,
        refine: (r) => (r.gamedir ? r : null),
      },
    )
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  it('returns [] for a non-array', () => {
    expect(parseKeyedRows(rowSchema, 'nope', { keyOf: (r: Row) => r.id })).toEqual([])
  })

  it('onDrop reports every drop with its reason', () => {
    const onDrop = vi.fn()
    parseKeyedRows(
      rowSchema,
      [
        { id: 'a', gamedir: 'x' },
        42,
        { id: 'b', gamedir: '' },
        { id: 'c', gamedir: 'X' },
        { id: 'a', gamedir: 'z' },
      ],
      {
        keyOf: { id: (r: Row) => r.id, gamedir: (r: Row) => r.gamedir.toLowerCase() },
        refine: (r) => (r.gamedir ? r : null),
        onDrop,
      },
    )
    expect(onDrop).toHaveBeenCalledTimes(4)
    const drops = onDrop.mock.calls.map(([d]) => d)
    expect(drops.map((d) => [d.reason, d.index, d.key])).toEqual([
      ['invalid', 1, undefined],
      ['refused', 2, undefined],
      ['duplicate', 3, 'gamedir'],
      ['duplicate', 4, 'id'],
    ])
    expect(drops[0].error).toBeInstanceOf(z.ZodError)
  })

  it('onDrop reports a single key function as "key"', () => {
    const onDrop = vi.fn()
    parseKeyedRows(
      rowSchema,
      [
        { id: 'a', gamedir: '' },
        { id: 'a', gamedir: '' },
      ],
      {
        keyOf: (r: Row) => r.id,
        onDrop,
      },
    )
    expect(onDrop.mock.calls[0][0]).toMatchObject({ reason: 'duplicate', index: 1, key: 'key' })
  })
})

describe('parseForgivingEnvelope', () => {
  const envelope = z.object({ items: z.array(z.string()).default([]) })

  it('a missing envelope parses as {} and garbage returns the fallback', () => {
    const fallback = (): { items: string[] } => ({ items: ['fallback'] })
    expect(parseForgivingEnvelope(envelope, undefined, fallback)).toEqual({ items: [] })
    const a = parseForgivingEnvelope(envelope, 'garbage', fallback)
    const b = parseForgivingEnvelope(envelope, 'garbage', fallback)
    expect(a).toEqual({ items: ['fallback'] })
    expect(a).not.toBe(b)
  })
})

describe('dedupeByKey', () => {
  it('keeps the first occurrence', () => {
    expect(
      dedupeByKey(
        [
          { k: 'a', n: 1 },
          { k: 'a', n: 2 },
          { k: 'b', n: 3 },
        ],
        (r) => r.k,
      ),
    ).toEqual([
      { k: 'a', n: 1 },
      { k: 'b', n: 3 },
    ])
  })
})

describe('module row loops', () => {
  it('the module row loops go through the helper', () => {
    const files = [
      'src/main/modules/mods/install-records.ts',
      'src/main/modules/mods/catalog-parse.ts',
      'src/main/services/content/manifest-parse.ts',
    ]
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(source, file).toMatch(/from '(\.\.\/)+lib\/forgiving'/)
      expect(source, file).not.toMatch(/for \(const [^)]*\) \{[^}]*\.safeParse\(row\)/)
    }
  })
})
