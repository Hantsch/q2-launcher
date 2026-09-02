import { describe, expect, it } from 'vitest'
import type { AliasIndexRow } from '@shared/config/alias-references'
import {
  filterAliasRows,
  isDuplicateAliasRow,
  sortAliasRows,
  type HasAliasIndexRow,
} from './alias-rows'

/** Minimal `AliasIndexRow` fixture - only the fields the functions under test actually read
 * (`name`, `referrers`, `duplicateOf`) vary per call; everything else is a fixed, valid filler. */
function row(overrides: Partial<AliasIndexRow>): AliasIndexRow {
  return {
    name: 'weapnext',
    key: 'weapnext',
    origin: 'user',
    owner: 'weapnext',
    ownerActionId: 'a1',
    editable: true,
    referrers: [],
    duplicateOf: [],
    ...overrides,
  }
}

function wrap(r: AliasIndexRow): HasAliasIndexRow {
  return { row: r }
}

describe('sortAliasRows', () => {
  it('sorts ascending by name by default', () => {
    const rows = [wrap(row({ name: 'zoom' })), wrap(row({ name: 'attack' })), wrap(row({ name: 'move' }))]
    expect(sortAliasRows(rows).map((r) => r.row.name)).toEqual(['attack', 'move', 'zoom'])
  })

  it('sorts case-insensitively, mixed case interleaves by letter not by case', () => {
    const rows = [wrap(row({ name: 'Zoom' })), wrap(row({ name: 'attack' })), wrap(row({ name: 'Move' }))]
    expect(sortAliasRows(rows).map((r) => r.row.name)).toEqual(['attack', 'Move', 'Zoom'])
  })

  it('reverses order when direction is desc', () => {
    const rows = [wrap(row({ name: 'attack' })), wrap(row({ name: 'zoom' })), wrap(row({ name: 'move' }))]
    expect(sortAliasRows(rows, 'desc').map((r) => r.row.name)).toEqual(['zoom', 'move', 'attack'])
  })

  it('does not mutate the input array', () => {
    const rows = [wrap(row({ name: 'zoom' })), wrap(row({ name: 'attack' }))]
    const original = [...rows]
    sortAliasRows(rows)
    expect(rows).toEqual(original)
  })

  it('is stable: rows sharing a name keep their original relative order', () => {
    const dupA = wrap(row({ name: 'dup', owner: 'first' }))
    const dupB = wrap(row({ name: 'dup', owner: 'second' }))
    const rows = [dupA, dupB]
    expect(sortAliasRows(rows).map((r) => r.row.owner)).toEqual(['first', 'second'])
  })
})

describe('filterAliasRows', () => {
  const rows = [
    wrap(row({ name: 'weapnext', referrers: [{ kind: 'bind', key: 'MWHEELUP' }] })),
    wrap(row({ name: 'weapprev', referrers: [] })),
    wrap(row({ name: 'jump', referrers: [{ kind: 'bind', key: 'SPACE' }] })),
    wrap(row({ name: 'crouch', referrers: [] })),
  ]

  it('with no filter fields set, returns everything unchanged', () => {
    expect(filterAliasRows(rows, {})).toEqual(rows)
  })

  it('filters by a case-insensitive name-text fragment matching a subset', () => {
    const result = filterAliasRows(rows, { nameText: 'WEAP' })
    expect(result.map((r) => r.row.name)).toEqual(['weapnext', 'weapprev'])
  })

  it('ignores a whitespace-only name filter', () => {
    expect(filterAliasRows(rows, { nameText: '   ' })).toEqual(rows)
  })

  it('filters to unreferenced-only rows', () => {
    const result = filterAliasRows(rows, { unreferencedOnly: true })
    expect(result.map((r) => r.row.name)).toEqual(['weapprev', 'crouch'])
  })

  it('combines a name fragment with unreferenced-only, narrowing to rows matching both', () => {
    const result = filterAliasRows(rows, { nameText: 'weap', unreferencedOnly: true })
    expect(result.map((r) => r.row.name)).toEqual(['weapprev'])
  })

  it('combination can narrow to nothing when no row satisfies both', () => {
    const result = filterAliasRows(rows, { nameText: 'jump', unreferencedOnly: true })
    expect(result).toEqual([])
  })
})

describe('isDuplicateAliasRow', () => {
  it('is false when duplicateOf is empty', () => {
    expect(isDuplicateAliasRow(row({ duplicateOf: [] }))).toBe(false)
  })

  it('is true when duplicateOf names at least one colliding owner', () => {
    expect(isDuplicateAliasRow(row({ duplicateOf: ['other entry'] }))).toBe(true)
  })
})
