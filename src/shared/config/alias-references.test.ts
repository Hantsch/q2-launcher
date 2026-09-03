import { describe, expect, it } from 'vitest'
import type { ActionKeySlot, ConfigAction } from '../modules/config'
import { aliasNameFor } from './alias-render'
import {
  actionsWithAliasLine,
  buildAliasIndex,
  collectAliasReferences,
  findAliasReferrers,
  findAliasReferrersByName,
  isSelfMirroringAlias,
  selfReferencingSegments,
} from './alias-references'
import { generateLayerAliases, type AltLayer } from './alt-layers'

function action(overrides: Partial<ConfigAction> & Pick<ConfigAction, 'id' | 'kind' | 'name'>): ConfigAction {
  return { categoryId: 'c1', commands: [], ...overrides }
}

/** Builds a `keys` array from a sparse list of slots - `undefined` entries are skipped. */
function keySlots(...slots: (ActionKeySlot | undefined)[]): ActionKeySlot[] {
  return slots.filter((slot): slot is ActionKeySlot => slot !== undefined)
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
      keys: keySlots({ key: 'MWHEELUP' }),
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
      keys: keySlots({ key: 'MWHEELUP' }),
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
      keys: keySlots({ key: 'MOUSE3' }),
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
      keys: keySlots({ key: 'MWHEELUP' }),
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
      keys: keySlots({ key: 'w' }),
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
      keys: keySlots({ key: 'MOUSE2' }),
      commands: [{ kind: 'raw', text: 'set fov 30' }, { kind: 'raw', text: '-zoom' }],
    })
    const actions = [zoom]

    expect(actionsWithAliasLine(actions, { actions })).toEqual([zoom])
  })
})

describe('collectAliasReferences ignoreOwnMirrorOf option (story 039, D9)', () => {
  it('ignores the own base bind slot the action holds', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [] })
    const aliasName = aliasNameFor(owner)

    const tokens = collectAliasReferences(
      { actions: [owner], binds: { q: aliasName } },
      { ignoreOwnMirrorOf: owner },
    )

    expect(tokens.has(aliasName.toLowerCase())).toBe(false)
  })

  it('still reports the same alias name on a key the action does not hold as a reference', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [] })
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
      keys: keySlots({ key: 'q', modifier: 'ALT' }),
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
      keys: keySlots({ key: 'q', modifier: 'ALT' }),
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
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [] })
    const aliasName = aliasNameFor(owner)

    const tokens = collectAliasReferences({ actions: [owner], binds: { q: aliasName } })

    expect(tokens.has(aliasName.toLowerCase())).toBe(true)
  })
})

describe('findAliasReferrers (story 039, D9)', () => {
  it('finds nothing for an unreferenced entry', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [] })

    expect(findAliasReferrers(owner, { actions: [owner], binds: { q: aliasNameFor(owner) } })).toEqual([])
  })

  it('does not report the entry\'s own two mirror slots (base bind + layer override)', () => {
    const owner = action({
      id: 'a1',
      kind: 'bind',
      name: 'SSG SG',
      keys: keySlots({ key: 'q' }, { key: 'r', modifier: 'ALT' }),
      commands: [],
    })
    const aliasName = aliasNameFor(owner)
    const layers = [{ id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { r: aliasName } }]

    const referrers = findAliasReferrers(owner, { actions: [owner], binds: { q: aliasName }, layers })

    expect(referrers).toEqual([])
  })

  it('reports a hand-typed bind on an unrelated key by that key', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [] })
    const aliasName = aliasNameFor(owner)

    const referrers = findAliasReferrers(owner, { actions: [owner], binds: { q: aliasName, x: aliasName } })

    expect(referrers).toEqual([{ kind: 'bind', key: 'x' }])
  })

  it('ignores a third slot (index 2) exactly like the first two - unmodified into binds, modified into its layer', () => {
    // Story 050, D3's acceptance criterion, restated for `findAliasReferrers`: slot identity comes
    // from array order, not from a fixed "primary"/"secondary" pair, so the own-mirror exclusion
    // must reach every slot the accessor returns, not just the first two.
    const owner = action({
      id: 'a1',
      kind: 'bind',
      name: 'SSG SG',
      keys: keySlots({ key: 'q' }, { key: 'r', modifier: 'ALT' }, { key: 't', modifier: 'CTRL' }),
      commands: [],
    })
    const aliasName = aliasNameFor(owner)
    const layers: AltLayer[] = [
      { id: 'l1', name: 'Alt', mode: 'hold' as const, triggerKey: 'ALT', overrides: { r: aliasName } },
      { id: 'l2', name: 'Ctrl', mode: 'hold' as const, triggerKey: 'CTRL', overrides: { t: aliasName } },
    ]

    const referrers = findAliasReferrers(owner, { actions: [owner], binds: { q: aliasName }, layers })

    expect(referrers).toEqual([])
  })

  it('reports a hand-typed layer override on an unrelated modifier by its key and layer name', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [] })
    const aliasName = aliasNameFor(owner)
    const layers = [{ id: 'l1', name: 'Ctrl', mode: 'hold' as const, triggerKey: 'CTRL', overrides: { z: aliasName } }]

    const referrers = findAliasReferrers(owner, { actions: [owner], binds: { q: aliasName }, layers })

    expect(referrers).toEqual([{ kind: 'override', key: 'z', layerName: 'Ctrl' }])
  })

  it('reports another action whose command text calls the alias by name', () => {
    const owner = action({ id: 'a1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [] })
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

/**
 * Story 044, D1 - the shared name-space index Care and the Aliases tab both read.
 *
 * The risk these cases guard is one-directional: a name that *is* referenced reading as
 * unreferenced lets Care offer to delete a live alias, so every reference source the AC names
 * (base binds, layer overrides, other aliases' bodies, other entries' commands) gets its own case,
 * as does the self-reference the graph deliberately counts.
 */
describe('buildAliasIndex (story 044, D1)', () => {
  function holdLayer(overrides: Partial<AltLayer> = {}): AltLayer {
    return { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' }, ...overrides }
  }

  it('emits one row per entry, in actions order, before any layer row (the contract validate-actions.ts pairs on)', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] }),
      action({ id: 'b1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [{ kind: 'raw', text: 'use ssg' }] }),
    ]

    const index = buildAliasIndex({ actions, layers: [holdLayer()] })

    expect(index.slice(0, actions.length).map((row) => row.ownerActionId)).toEqual(['a1', 'b1'])
    expect(index.slice(actions.length).every((row) => row.origin === 'layer')).toBe(true)
  })

  it('labels a kind: alias entry as an editable user alias owned by that entry', () => {
    const aliasEntry = action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })

    const [row] = buildAliasIndex({ actions: [aliasEntry] })

    expect(row).toMatchObject({
      name: aliasNameFor(aliasEntry),
      key: aliasNameFor(aliasEntry).toLowerCase(),
      origin: 'user',
      owner: '+test',
      ownerActionId: 'a1',
      editable: true,
    })
  })

  it('labels a keyed entry\'s alias as generated and read-only', () => {
    const keyed = action({ id: 'b1', kind: 'bind', name: 'SSG SG', keys: keySlots({ key: 'q' }), commands: [{ kind: 'raw', text: 'use ssg' }] })

    const [row] = buildAliasIndex({ actions: [keyed] })

    expect(row).toMatchObject({ origin: 'generated', owner: 'SSG SG', ownerActionId: 'b1', editable: false })
  })

  it('lists every alias the launcher generates for a layer, owned by that layer and read-only', () => {
    const layer = holdLayer()
    const emitted = generateLayerAliases(layer, {}).aliases.map((alias) => alias.name)
    expect(emitted.length).toBeGreaterThan(0)

    const index = buildAliasIndex({ actions: [], layers: [layer] })

    expect(index.map((row) => row.name)).toEqual(emitted)
    expect(index.every((row) => row.origin === 'layer' && row.ownerLayerName === 'Drops')).toBe(true)
    expect(index.every((row) => row.owner === 'Drops' && !row.editable && row.ownerActionId === undefined)).toBe(true)
  })

  it('reports a name called only from inside another alias\'s body as referenced by that entry', () => {
    const target = action({ id: 'a1', kind: 'alias', name: 'drop_shotgun', commands: [{ kind: 'raw', text: 'drop shotgun' }] })
    const caller = action({ id: 'a2', kind: 'alias', name: 'dall', commands: [{ kind: 'raw', text: 'drop_shotgun' }] })

    const index = buildAliasIndex({ actions: [target, caller] })

    expect(index[0]!.referrers).toEqual([{ kind: 'action', name: 'dall' }])
  })

  it('reports a name called only from a layer override as referenced by that override', () => {
    const target = action({ id: 'a1', kind: 'alias', name: 'drop_shotgun', commands: [] })
    const layers = [holdLayer({ overrides: { z: aliasNameFor(target) } })]

    const index = buildAliasIndex({ actions: [target], layers })

    expect(index[0]!.referrers).toEqual([{ kind: 'override', key: 'z', layerName: 'Drops' }])
  })

  it('reports a name called only from a base bind as referenced by that key', () => {
    const target = action({ id: 'a1', kind: 'alias', name: 'drop_shotgun', commands: [] })

    const index = buildAliasIndex({ actions: [target], binds: { KP_END: aliasNameFor(target) } })

    expect(index[0]!.referrers).toEqual([{ kind: 'bind', key: 'KP_END' }])
  })

  it('counts an entry\'s own recursive body and its own bind mirror as referrers (no self-exclusion)', () => {
    const recursive = action({
      id: 'a1',
      kind: 'bind',
      name: 'weapnext',
      keys: keySlots({ key: 'MWHEELUP' }),
      commands: [{ kind: 'raw', text: 'weapnext' }, { kind: 'raw', text: 'centerview' }],
    })

    const index = buildAliasIndex({ actions: [recursive], binds: { MWHEELUP: 'weapnext' } })

    expect(index[0]!.referrers).toEqual([
      { kind: 'action', name: 'weapnext' },
      { kind: 'bind', key: 'MWHEELUP' },
    ])
  })

  it('reports an alias nothing calls with an empty referrer array, never undefined', () => {
    const lonely = action({ id: 'a1', kind: 'alias', name: '+test', commands: [{ kind: 'raw', text: 'wait' }] })

    const [row] = buildAliasIndex({ actions: [lonely], binds: { z: 'centerview' } })

    expect(row!.referrers).toEqual([])
    expect(row!.duplicateOf).toEqual([])
  })

  it('names each other on both rows when two entries resolve to the same name', () => {
    const first = action({ id: 'a1', kind: 'alias', name: 'Test', commands: [] })
    const second = action({ id: 'a2', kind: 'alias', name: 'test', commands: [] })

    const index = buildAliasIndex({ actions: [first, second] })

    expect(index[0]!.duplicateOf).toEqual(['test'])
    expect(index[1]!.duplicateOf).toEqual(['Test'])
  })

  it('surfaces a user alias colliding with a generated layer alias on both rows', () => {
    const layer = holdLayer()
    const layerAliasName = generateLayerAliases(layer, {}).aliases[0]!.name
    const collide = action({ id: 'a1', kind: 'alias', name: 'My alias', aliasName: layerAliasName, commands: [] })

    const index = buildAliasIndex({ actions: [collide], layers: [layer] })
    const layerRow = index.find((row) => row.origin === 'layer' && row.key === layerAliasName.toLowerCase())

    expect(index[0]!.duplicateOf).toEqual(['Drops'])
    expect(layerRow?.duplicateOf).toEqual(['My alias'])
  })
})

describe('findAliasReferrersByName (story 044, D1)', () => {
  it('answers for a name with no owning action at all', () => {
    const referrers = findAliasReferrersByName('+drops', { actions: [], binds: { ALT: '+drops' } })

    expect(referrers).toEqual([{ kind: 'bind', key: 'ALT' }])
  })

  it('matches case-insensitively, like the engine\'s own alias lookup', () => {
    const referrers = findAliasReferrersByName('+Drops', { actions: [], binds: { ALT: '+DROPS' } })

    expect(referrers).toEqual([{ kind: 'bind', key: 'ALT' }])
  })

  it('reports an entry once however many of its commands call the name', () => {
    const caller = action({
      id: 'c1',
      kind: 'alias',
      name: 'dall',
      commands: [{ kind: 'raw', text: 'drop_shotgun' }, { kind: 'raw', text: 'drop_shotgun' }],
    })

    expect(findAliasReferrersByName('drop_shotgun', { actions: [caller] })).toEqual([
      { kind: 'action', name: 'dall' },
    ])
  })

  it('returns an empty array for a name nothing calls', () => {
    expect(findAliasReferrersByName('nobody_calls_me', { actions: [] })).toEqual([])
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
