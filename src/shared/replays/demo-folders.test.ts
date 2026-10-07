import { describe, expect, it } from 'vitest'
import {
  buildFolderView,
  nearestExisting,
  rowsBelow,
  validateFolderName,
  type DiscoveredFolder,
  type FolderRow,
} from './demo-folders'

const row = (
  sourceKey: string,
  folder: string[],
  id = folder.join('/'),
): FolderRow & { id: string } => ({
  sourceKey,
  source: sourceKey.toUpperCase(),
  folder,
  id,
})
const dir = (sourceKey: string, path: string[], archive = false): DiscoveredFolder => ({
  sourceKey,
  source: sourceKey.toUpperCase(),
  path,
  archive,
})

describe('buildFolderView', () => {
  it('lists one root per source and no demos at the top level', () => {
    const view = buildFolderView({
      rows: [row('b', []), row('a', ['x'])],
      folders: [dir('a', []), dir('b', [], true)],
      current: null,
    })
    expect(view.demos).toEqual([])
    expect(view.folders.map((f) => [f.label, f.ref.path, f.demoCount, f.archive])).toEqual([
      ['A', [], 1, false],
      ['B', [], 1, true],
    ])
    expect(view.crumbs).toEqual([{ label: null, ref: null }])
  })

  it('folders come first with their recursive demo count', () => {
    const rows = [
      row('a', ['Duel', '2024', 'r1']),
      row('a', ['Duel']),
      row('a', ['ctf']),
      row('a', []),
    ]
    const view = buildFolderView({
      rows,
      folders: [dir('a', ['Empty'])],
      current: { sourceKey: 'a', path: [] },
    })
    expect(view.folders.map((f) => [f.name, f.demoCount])).toEqual([
      ['ctf', 1],
      ['Duel', 2],
      ['Empty', 0],
    ])
    expect(view.demos).toHaveLength(1)
  })

  it('sorts folders naturally and case-insensitively', () => {
    const view = buildFolderView({
      rows: [],
      folders: [dir('a', ['m10']), dir('a', ['M2']), dir('a', ['b'])],
      current: { sourceKey: 'a', path: [] },
    })
    expect(view.folders.map((f) => f.name)).toEqual(['b', 'M2', 'm10'])
  })

  it('shows nested folders from ancestors of rows and builds crumbs', () => {
    const view = buildFolderView({
      rows: [row('a', ['x', 'y', 'z'])],
      folders: [],
      current: { sourceKey: 'a', path: ['x'] },
    })
    expect(view.folders.map((f) => [f.name, f.ref.path, f.demoCount])).toEqual([
      ['y', ['x', 'y'], 1],
    ])
    expect(view.crumbs).toEqual([
      { label: null, ref: null },
      { label: 'A', ref: { sourceKey: 'a', path: [] } },
      { label: 'x', ref: { sourceKey: 'a', path: ['x'] } },
    ])
  })

  it('keeps an empty discovered folder and flags archive folders', () => {
    const view = buildFolderView({
      rows: [],
      folders: [dir('a', ['pak.zip'], true)],
      current: { sourceKey: 'a', path: [] },
    })
    expect(view.folders).toMatchObject([{ name: 'pak.zip', archive: true, demoCount: 0 }])
  })
})

describe('rowsBelow', () => {
  const rows = [row('a', ['a']), row('a', ['ab']), row('a', ['a', 'b']), row('A', ['a'])]
  it('matches segment-wise and compares source keys exactly', () => {
    expect(rowsBelow(rows, { sourceKey: 'a', path: ['a'] })).toEqual([rows[0], rows[2]])
  })
  it('returns every row at the top level', () => {
    expect(rowsBelow(rows, null)).toBe(rows)
  })
})

describe('nearestExisting', () => {
  const folders = [dir('a', []), dir('a', ['x']), dir('b', [])]
  it('returns the folder itself when it exists', () => {
    expect(nearestExisting({ sourceKey: 'a', path: ['x'] }, folders)).toEqual({
      sourceKey: 'a',
      path: ['x'],
    })
  })
  it('falls back to the deepest existing ancestor', () => {
    expect(nearestExisting({ sourceKey: 'a', path: ['x', 'y', 'z'] }, folders)).toEqual({
      sourceKey: 'a',
      path: ['x'],
    })
  })
  it('falls back to null when the whole source is gone or current is null', () => {
    expect(nearestExisting({ sourceKey: 'gone', path: ['x'] }, folders)).toBeNull()
    expect(nearestExisting(null, folders)).toBeNull()
  })
})

describe('validateFolderName', () => {
  it('trims and accepts a plain name', () => {
    expect(validateFolderName('  Duels 2024 ')).toEqual({ ok: true, name: 'Duels 2024' })
  })
  it.each([
    ['   ', 'empty'],
    ['a/b', 'separator'],
    [String.fromCharCode(97, 92, 98), 'separator'],
    ['.', 'dotDot'],
    ['..', 'dotDot'],
    ['a:b', 'invalidChar'],
    ['name.', 'trailingDotOrSpace'],
    ['con', 'reserved'],
    ['x'.repeat(101), 'tooLong'],
  ])('refuses %j as %s', (input, key) => {
    expect(validateFolderName(input)).toMatchObject({
      ok: false,
      reasonKey: `replays.folder.error.${key}`,
    })
  })
  it('accepts a name of exactly 100 characters', () => {
    expect(validateFolderName('x'.repeat(100))).toMatchObject({ ok: true })
  })
})
