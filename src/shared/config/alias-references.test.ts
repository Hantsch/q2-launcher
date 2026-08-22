import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '../modules/config'
import { aliasNameFor } from './alias-render'
import {
  actionsWithAliasLine,
  collectAliasReferences,
  findAliasReferrers,
  isSelfMirroringAlias,
  selfReferencingSegments,
} from './alias-references'

function action(overrides: Partial<ConfigAction> & Pick<ConfigAction, 'id' | 'kind' | 'name'>): ConfigAction {
  return { categoryId: 'c1', commands: [], ...overrides }
}

/** A continuous catalogue row (story 034): mirrors as its own bare command, not an alias. */
function catalogueRow(overrides: Partial<ConfigAction> & Pick<ConfigAction, 'id' | 'name'>): ConfigAction {
  return action({
    kind: 'bind',
    catalogId: 'movement:forward',
    commands: [{ kind: 'raw', text: '+forward' }],
    ...overrides,
  })
}

describe('collectAliasReferences', () => {
  it('collects a bare token from an action raw command', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({ id: 'b1', kind: 'bind', name: 'Test bind', commands: [{ kind: 'raw', text: '+test' }] }),
    ]

    expect(collectAliasReferences({ actions })).toContain('+test')
  })

  it('collects a bare token from a binds value', () => {
    const actions: ConfigAction[] = []

    expect(collectAliasReferences({ actions, binds: { r: '+test' } })).toContain('+test')
  })

  it('collects a bare token from every layer overrides value', () => {
    const actions: ConfigAction[] = []
    const layers = [{ id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { r: '+test' } }]

    expect(collectAliasReferences({ actions, layers })).toContain('+test')
  })

  it('widens by the target token of a bind <key> <token> segment', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: 'cali',
        commands: [{ kind: 'raw', text: 'bind KP_END drop_shotgun' }],
      }),
    ]

    expect(collectAliasReferences({ actions })).toContain('drop_shotgun')
  })

  it('lower-cases every collected token', () => {
    const actions = [action({ id: 'b1', kind: 'bind', name: 'Test bind', commands: [{ kind: 'raw', text: '+TEST' }] })]

    expect(collectAliasReferences({ actions })).toContain('+test')
  })

  it('does not treat a multi-word, non-bind segment as a reference', () => {
    const actions = [
      action({ id: 'b1', kind: 'bind', name: 'Drop weapon', commands: [{ kind: 'raw', text: '-drop rocket launcher' }] }),
    ]

    const tokens = collectAliasReferences({ actions })

    expect(tokens.has('rocket')).toBe(false)
    expect(tokens.has('launcher')).toBe(false)
    expect(tokens.has('-drop rocket launcher')).toBe(false)
  })

  it('collects a quote-wrapped binds value as its unquoted token (sanitized before scan, matching render)', () => {
    const actions: ConfigAction[] = []

    expect(collectAliasReferences({ actions, binds: { r: '"q2l_a_x_1234"' } })).toContain('q2l_a_x_1234')
  })

  it('collects a quote-wrapped layer overrides value as its unquoted token (sanitized before scan, matching render)', () => {
    const actions: ConfigAction[] = []
    const layers = [
      { id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { r: '"q2l_a_x_1234"' } },
    ]

    expect(collectAliasReferences({ actions, layers })).toContain('q2l_a_x_1234')
  })

  it('does not widen a bind segment whose target itself carries an argument', () => {
    const actions = [
      action({
        id: 'a1',
        kind: 'alias',
        name: 'weird',
        commands: [{ kind: 'raw', text: 'bind KP_END drop shotgun' }],
      }),
    ]

    expect(collectAliasReferences({ actions }).has('shotgun')).toBe(false)
  })
})

describe('actionsWithAliasLine', () => {
  it('drops a catalogue row whose mirror bypasses the alias and whose alias name is referenced by nothing', () => {
    const actions = [catalogueRow({ id: 'b1', name: '+forward' })]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toEqual([])
  })

  it('keeps a catalogue row whose alias name is referenced elsewhere in the profile', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const caller = action({
      id: 'c1',
      kind: 'bind',
      name: 'Caller',
      commands: [{ kind: 'raw', text: aliasName }],
    })
    const actions = [row, caller]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced via a base bind value', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const actions = [row]

    const kept = actionsWithAliasLine(actions, { actions, binds: { z: aliasName } })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced via a layer override', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const actions = [row]
    const layers = [{ id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { z: aliasName } }]

    const kept = actionsWithAliasLine(actions, { actions, layers })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced via a quote-wrapped base bind value (schema allows it; render would strip the quotes)', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const actions = [row]

    const kept = actionsWithAliasLine(actions, { actions, binds: { z: `"${aliasName}"` } })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced via a quote-wrapped layer override value (schema allows it; render would strip the quotes)', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const actions = [row]
    const layers = [
      { id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { z: `"${aliasName}"` } },
    ]

    const kept = actionsWithAliasLine(actions, { actions, layers })

    expect(kept).toContainEqual(row)
  })

  it('keeps a catalogue row referenced only via a bind <key> <alias> segment', () => {
    const row = catalogueRow({ id: 'b1', name: '+forward' })
    const aliasName = aliasNameFor(row)
    const caller = action({
      id: 'c1',
      kind: 'bind',
      name: 'Caller',
      commands: [{ kind: 'raw', text: `bind KP_END ${aliasName}` }],
    })
    const actions = [row, caller]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toContainEqual(row)
  })

  it('keeps a kind: alias entry even when nothing references it', () => {
    const aliasEntry = action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })
    const actions = [aliasEntry]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toEqual([aliasEntry])
  })

  it('keeps a keyless, unreferenced free-form bind action (User decision: user-authored content)', () => {
    const freeform = action({
      id: 'f1',
      kind: 'bind',
      name: 'My combo',
      commands: [{ kind: 'raw', text: 'wait; +attack' }],
    })
    const actions = [freeform]

    const kept = actionsWithAliasLine(actions, { actions })

    expect(kept).toEqual([freeform])
  })
})

/**
 * Story 039 review fix - the writer must never emit `alias <name> <name>`.
 * Reachable only since the derived alias name became a readable slug of the
 * display name: a discrete (sign-free) single-token entry named after its own
 * command derives an alias name textually identical to that command.
 */
describe('actionsWithAliasLine self-reference guard (story 039)', () => {
  /** A *discrete* catalogue row exactly as `bind-adoption.ts` materialises `bind MWHEELUP "weapnext"`. */
  function discreteRow(overrides: Partial<ConfigAction> = {}): ConfigAction {
    return action({
      id: 'd1',
      kind: 'bind',
      name: 'weapnext',
      catalogId: 'weaponExtra:weapnext',
      key: 'MWHEELUP',
      commands: [{ kind: 'raw', text: 'weapnext' }],
      ...overrides,
    })
  }

  it('drops a discrete catalogue row whose alias name equals its own command', () => {
    const row = discreteRow()
    // The precondition that makes this reachable at all: name, alias name and
    // command are one and the same string.
    expect(aliasNameFor(row)).toBe('weapnext')

    const actions = [row]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([])
  })

  it('drops it even when its own bind carries that very token (the direct mirror, not a reference)', () => {
    const row = discreteRow()
    const actions = [row]

    const kept = actionsWithAliasLine(actions, { actions, binds: { MWHEELUP: 'weapnext' } })

    expect(kept).toEqual([])
  })

  it('drops it even when something else in the profile names it (equality beats reference)', () => {
    const row = discreteRow()
    const actions = [row]
    const layers = [
      { id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { z: 'weapnext' } },
    ]

    const kept = actionsWithAliasLine(actions, { actions, binds: { y: 'weapnext' }, layers })

    expect(kept).toEqual([])
  })

  it('drops a kind: alias entry whose body is nothing but its own name', () => {
    const selfLoop = action({ id: 's1', kind: 'alias', name: '+slow', commands: [{ kind: 'raw', text: '+slow' }] })
    const actions = [selfLoop]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([])
  })

  it('drops an entry whose pinned aliasName equals its own command', () => {
    const pinned = action({
      id: 'p1',
      kind: 'bind',
      name: 'Next Weapon',
      aliasName: 'weapnext',
      commands: [{ kind: 'raw', text: 'weapnext' }],
    })
    const actions = [pinned]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([])
  })

  it('keeps a sign-differing near-namesake - alias forward +forward is legal, not a self-reference', () => {
    const row = catalogueRow({ id: 'b1', name: 'Forward' })
    expect(aliasNameFor(row)).toBe('forward')
    const actions = [row]

    const kept = actionsWithAliasLine(actions, { actions, binds: { z: 'forward' } })

    expect(kept).toEqual([row])
  })

  /**
   * Fourth pass, the User's decision (story 039, Decisions (Sprint)): the third
   * pass dropped these three shapes on the argument that an unreachable alias
   * lost nothing. That is overruled - dropping the line deletes `centerview`,
   * the user's own content, from the file, and which way out to take is the
   * user's call. So the line is kept as authored and
   * `validate-actions.ts`'s `aliasSelfReference` reports it instead; the
   * error-level `aliasCycle` that follows for the kept line is expected, not a
   * bug. `selfReferencingSegments` is asserted alongside `actionsWithAliasLine`
   * here, since that is what feeds the finding.
   */
  it('keeps a multi-command entry whose first body segment calls its own name, and reports the segment', () => {
    const combo = action({
      id: 'm1',
      kind: 'bind',
      name: 'weapnext',
      key: 'MWHEELUP',
      commands: [{ kind: 'raw', text: 'weapnext' }, { kind: 'raw', text: 'centerview' }],
    })
    const actions = [combo]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([combo])
    expect(selfReferencingSegments(combo)).toEqual(['weapnext'])
    expect(isSelfMirroringAlias(combo)).toBe(false)
  })

  it('keeps an entry whose *later* body segment calls its own name, and reports that segment', () => {
    const combo = action({
      id: 'm2',
      kind: 'bind',
      name: 'centerview',
      key: 'MOUSE3',
      commands: [{ kind: 'raw', text: '+attack' }, { kind: 'raw', text: 'centerview' }],
    })
    const actions = [combo]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([combo])
    expect(selfReferencingSegments(combo)).toEqual(['centerview'])
  })

  it('keeps an entry whose self-call sits behind an inline `;` inside one command', () => {
    const combo = action({
      id: 'm3',
      kind: 'bind',
      name: 'weapnext',
      commands: [{ kind: 'raw', text: 'weapnext; centerview' }],
    })
    const actions = [combo]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([combo])
    expect(selfReferencingSegments(combo)).toEqual(['weapnext'])
  })

  /**
   * The boundary of the one shape that is still dropped: only a body that is
   * *nothing but* the alias name is lossless to drop. `weapnext arg` would lose
   * its argument, so it is kept and reported like any other self-reference.
   */
  it('keeps an entry whose single body segment carries an argument after its own name', () => {
    const combo = action({
      id: 'm7',
      kind: 'bind',
      name: 'weapnext',
      key: 'MWHEELUP',
      commands: [{ kind: 'raw', text: 'weapnext 2' }],
    })
    const actions = [combo]

    expect(isSelfMirroringAlias(combo)).toBe(false)
    expect(actionsWithAliasLine(actions, { actions })).toEqual([combo])
    expect(selfReferencingSegments(combo)).toEqual(['weapnext 2'])
  })

  it('keeps a signed engine command as one segment of a longer body (alias forward "+forward; centerview")', () => {
    const combo = action({
      id: 'm4',
      kind: 'bind',
      name: 'Forward',
      key: 'w',
      commands: [{ kind: 'raw', text: '+forward' }, { kind: 'raw', text: 'centerview' }],
    })
    expect(aliasNameFor(combo)).toBe('forward')
    const actions = [combo]

    // `+forward` is a real engine command, so this alias is what a caller
    // reaches and its body really does dispatch that command - the legal case
    // `validate-structure.ts#referencedAlias`'s carve-out already protects.
    expect(actionsWithAliasLine(actions, { actions, binds: { w: 'forward' } })).toEqual([combo])
  })

  it('keeps an entry whose own name only appears as an argument, not as a segment head', () => {
    const combo = action({
      id: 'm5',
      kind: 'alias',
      name: 'cali',
      commands: [{ kind: 'raw', text: 'bind KP_END cali' }],
    })
    const actions = [combo]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([combo])
  })

  /**
   * The documented boundary of this guard: `validate-structure.ts`'s
   * `referencedAlias` also builds a self-edge from a *sign-stripped* token
   * (`-zoom` -> `zoom`) when the signed form is no engine command, and reports
   * that as an `aliasCycle`. This guard deliberately does not mirror that
   * branch - see `isSelfMirroringAlias`'s doc comment.
   */
  it('keeps an entry whose body calls a sign-differing member of its own name family', () => {
    const zoom = action({
      id: 'm6',
      kind: 'bind',
      name: 'zoom',
      key: 'MOUSE2',
      commands: [{ kind: 'raw', text: 'set fov 30' }, { kind: 'raw', text: '-zoom' }],
    })
    const actions = [zoom]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([zoom])
  })
})

describe('collectAliasReferences ignoreOwnMirrorOf option (story 039, D9)', () => {
  it('ignores the own base bind slot the action holds', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', key: 'q', commands: [] })
    const aliasName = aliasNameFor(owner)

    const tokens = collectAliasReferences(
      { actions: [owner], binds: { q: aliasName } },
      { ignoreOwnMirrorOf: owner },
    )

    expect(tokens.has(aliasName.toLowerCase())).toBe(false)
  })

  it('still reports the same alias name on a key the action does not hold as a reference', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', key: 'q', commands: [] })
    const aliasName = aliasNameFor(owner)

    const tokens = collectAliasReferences(
      { actions: [owner], binds: { q: aliasName, x: aliasName } },
      { ignoreOwnMirrorOf: owner },
    )

    expect(tokens.has(aliasName.toLowerCase())).toBe(true)
  })

  it('ignores the own layer override slot for the modifier the action carries', () => {
    const owner = action({
      id: 'a1',
      kind: 'bind',
      name: 'SSG SG',
      key: 'q',
      keyModifier: 'ALT',
      commands: [],
    })
    const aliasName = aliasNameFor(owner)
    const layers = [{ id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { q: aliasName } }]

    const tokens = collectAliasReferences({ actions: [owner], layers }, { ignoreOwnMirrorOf: owner })

    expect(tokens.has(aliasName.toLowerCase())).toBe(false)
  })

  it('does not ignore a layer override on the same key in a layer for a different modifier', () => {
    const owner = action({
      id: 'a1',
      kind: 'bind',
      name: 'SSG SG',
      key: 'q',
      keyModifier: 'ALT',
      commands: [],
    })
    const aliasName = aliasNameFor(owner)
    const layers = [
      { id: 'l1', name: 'Ctrl', mode: 'hold' as const, triggerKey: 'CTRL', overrides: { q: aliasName } },
    ]

    const tokens = collectAliasReferences({ actions: [owner], layers }, { ignoreOwnMirrorOf: owner })

    expect(tokens.has(aliasName.toLowerCase())).toBe(true)
  })

  it('default (no options) behaves exactly as before - own mirror slot still counts as a reference', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', key: 'q', commands: [] })
    const aliasName = aliasNameFor(owner)

    const tokens = collectAliasReferences({ actions: [owner], binds: { q: aliasName } })

    expect(tokens.has(aliasName.toLowerCase())).toBe(true)
  })
})

describe('findAliasReferrers (story 039, D9)', () => {
  it('finds nothing for an unreferenced entry', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', key: 'q', commands: [] })

    expect(findAliasReferrers(owner, { actions: [owner], binds: { q: aliasNameFor(owner) } })).toEqual([])
  })

  it('does not report the entry\'s own two mirror slots (base bind + layer override)', () => {
    const owner = action({
      id: 'a1',
      kind: 'bind',
      name: 'SSG SG',
      key: 'q',
      secondaryKey: 'r',
      secondaryKeyModifier: 'ALT',
      commands: [],
    })
    const aliasName = aliasNameFor(owner)
    const layers = [{ id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { r: aliasName } }]

    const referrers = findAliasReferrers(owner, { actions: [owner], binds: { q: aliasName }, layers })

    expect(referrers).toEqual([])
  })

  it('reports a hand-typed bind on an unrelated key by that key', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', key: 'q', commands: [] })
    const aliasName = aliasNameFor(owner)

    const referrers = findAliasReferrers(owner, { actions: [owner], binds: { q: aliasName, x: aliasName } })

    expect(referrers).toEqual([{ kind: 'bind', key: 'x' }])
  })

  it('reports a hand-typed layer override on an unrelated modifier by its key and layer name', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', key: 'q', commands: [] })
    const aliasName = aliasNameFor(owner)
    const layers = [{ id: 'l1', name: 'Ctrl', mode: 'hold' as const, triggerKey: 'CTRL', overrides: { z: aliasName } }]

    const referrers = findAliasReferrers(owner, { actions: [owner], binds: { q: aliasName }, layers })

    expect(referrers).toEqual([{ kind: 'override', key: 'z', layerName: 'Ctrl' }])
  })

  it('reports another action whose command text calls the alias by name', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', key: 'q', commands: [] })
    const aliasName = aliasNameFor(owner)
    const caller = action({
      id: 'c1',
      kind: 'bind',
      name: 'Caller',
      commands: [{ kind: 'raw', text: aliasName }],
    })

    const referrers = findAliasReferrers(owner, { actions: [owner, caller], binds: { q: aliasName } })

    expect(referrers).toEqual([{ kind: 'action', name: 'Caller' }])
  })
})

describe('self-reference (no self-exclusion)', () => {
  it('counts a recursive body - an action whose own command text is its own alias name - as a reference', () => {
    const recursive = action({
      id: 'a1',
      kind: 'alias',
      name: '+test',
      commands: [{ kind: 'raw', text: '+test' }],
    })

    const tokens = collectAliasReferences({ actions: [recursive] })

    expect(tokens.has(aliasNameFor(recursive).toLowerCase())).toBe(true)
  })
})
