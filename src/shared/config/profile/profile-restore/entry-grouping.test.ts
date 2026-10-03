import { describe, expect, it } from 'vitest'
import { collectAliasLines } from './entry-grouping'
import {
  allGroups,
  catalogueMirrorCandidate,
  createEntryGroupingState,
  groupFor,
  insideLayer,
  joinableUnboundGroup,
  matchAnchor,
  matchUnbound,
} from './entry-matching'
import type {
  EntryGroup,
  RestoreAliasLine,
  RestoreCommentLine,
  RestoreWarning,
  Section,
  TaggedLine,
  UnboundEntryLine,
} from './types'

const FILE = 'q2l-profile-test.cfg'

function category(line: number, cat: string): Section {
  return { file: FILE, line, kind: 'category', title: cat, fields: { cat } }
}

function layer(line: number): Section {
  return { file: FILE, line, kind: 'layer', title: 'Alt layer', fields: {} }
}

function alias(line: number, name: string, comment: string, body = 'echo'): RestoreAliasLine {
  return { file: FILE, line, name, body, comment }
}

function comment(line: number): RestoreCommentLine {
  return { file: FILE, line, text: '' }
}

function tagged<T>(item: T, fields: Record<string, string> = {}, prose = ''): TaggedLine<T> {
  return { item, fields, prose }
}

function unbound(line: number, fields: Record<string, string>, command: string): UnboundEntryLine {
  return { item: comment(line), fields, prose: '', command }
}

/** A state over a Weapons section (lines 1-19) and a Movement section (20 on). */
function twoCategoryState(warnings: RestoreWarning[] = []) {
  return createEntryGroupingState(
    [],
    [category(1, 'weapons'), category(20, 'movement')],
    warnings,
    [],
  )
}

/** An alias-line group in `scope`, as the alias phase would have built it. */
function aliasGroup(
  state: ReturnType<typeof twoCategoryState>,
  scope: string,
  line: TaggedLine<RestoreAliasLine>,
): EntryGroup {
  const group = groupFor(state, scope, line.item.name)
  group.aliases.push(line)
  return group
}

describe("groupEntryLines' rules as named functions", () => {
  it('gets or creates one group per category scope and key', () => {
    const state = twoCategoryState()
    const weaponsFire = groupFor(state, 'cat:weapons', 'fire')

    expect(groupFor(state, 'cat:weapons', 'fire')).toBe(weaponsFire)
    const movementFire = groupFor(state, 'cat:movement', 'fire')
    expect(movementFire).not.toBe(weaponsFire)
    expect(weaponsFire).toEqual({ key: 'fire', aliases: [], binds: [], anchors: [], unbounds: [] })
    const all = allGroups(state)
    expect(all).toHaveLength(2)
    expect(all[0]).toBe(weaponsFire)
    expect(all[1]).toBe(movementFire)
  })

  it('attaches an anchor to the claiming group of its own category scope', () => {
    const state = twoCategoryState()
    const weapons = aliasGroup(state, 'cat:weapons', tagged(alias(2, 'fire', ''), {}, 'Fire'))
    const movement = aliasGroup(state, 'cat:movement', tagged(alias(21, 'fire', ''), {}, 'Fire'))

    expect(matchAnchor(state, tagged(comment(5), {}, 'Fire'))).toBe(weapons)
    expect(matchAnchor(state, tagged(comment(25), {}, 'Fire'))).toBe(movement)
    // A second same-prose group in one scope makes that scope ambiguous: no match, no merge.
    aliasGroup(state, 'cat:weapons', tagged(alias(3, 'fire2', ''), {}, 'Fire'))
    expect(matchAnchor(state, tagged(comment(5), {}, 'Fire'))).toBeNull()
  })

  it('joins an unbound line to an existing group by cid only when that group is joinable', () => {
    const state = twoCategoryState()
    const grenade = aliasGroup(state, 'cat:weapons', tagged(alias(2, 'grenade', ''), { cid: 'g1' }))

    expect(matchUnbound(state, unbound(5, { an: 'grenade', cid: 'g1' }, 'grenade'))).toBe(grenade)
    expect(matchUnbound(state, unbound(5, { an: 'grenade' }, 'grenade'))).toBe(grenade)
    expect(matchUnbound(state, unbound(5, { an: 'grenade', cid: 'g2' }, 'grenade'))).toBeNull()
    expect(joinableUnboundGroup(state, grenade, 'g2')).toBe(false)

    // A group that already claims a key is a bound entry, never a keyless one's alias line.
    grenade.binds.push(tagged({ file: FILE, line: 3, key: 'g', command: 'grenade', comment: '' }))
    expect(joinableUnboundGroup(state, grenade, 'g1')).toBe(false)
    expect(matchUnbound(state, unbound(5, { an: 'grenade', cid: 'g1' }, 'grenade'))).toBeNull()
  })

  it('matches a catalogue-mirror unbound line to the alias whose body is its value', () => {
    const state = twoCategoryState()
    const relay = aliasGroup(
      state,
      'cat:weapons',
      tagged(alias(2, 'lone_relay', '', '+lonerelay'), { cid: 'relay' }),
    )
    const line = unbound(5, { cid: 'relay' }, '+lonerelay')

    expect(catalogueMirrorCandidate(state, state.groups.get('cat:weapons')!, line, 'relay')).toBe(
      relay,
    )
    expect(matchUnbound(state, line)).toBe(relay)
    // A line that states its join as a name has refused the mirror guess.
    expect(matchUnbound(state, unbound(5, { cid: 'relay', an: 'other' }, '+lonerelay'))).toBeNull()
  })

  it('recognises a position inside a layer section and nowhere else', () => {
    const alt = layer(10)
    const state = createEntryGroupingState(
      [alt],
      [category(1, 'weapons'), alt, category(20, 'movement')],
      [],
      [],
    )

    expect(insideLayer(state, { file: FILE, line: 15 })).toBe(true)
    expect(insideLayer(state, { file: FILE, line: 10 })).toBe(false)
    expect(insideLayer(state, { file: FILE, line: 25 })).toBe(false)
    expect(insideLayer(state, { file: 'other.cfg', line: 15 })).toBe(false)
  })

  it('degrades a missing tag to inference and reports a missing or invalid tag', () => {
    const warnings: RestoreWarning[] = []
    const state = twoCategoryState(warnings)
    const owned = alias(2, 'fire', 'Fire [q2l]')
    const handAdded = alias(3, 'my_macro', '')
    const broken = alias(4, 'broken', 'Broken [q2l')

    collectAliasLines(state, [owned, handAdded, broken])

    expect(state.aliasLines.map((line) => line.item)).toEqual([owned])
    expect(state.untaggedAliases).toEqual([handAdded])
    expect(warnings).toEqual([
      { reason: 'tag-missing', file: FILE, line: 3 },
      { reason: 'tag-malformed', file: FILE, line: 4 },
    ])
  })
})
