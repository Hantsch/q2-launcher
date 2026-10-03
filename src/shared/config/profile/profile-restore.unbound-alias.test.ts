import { describe, expect, it } from 'vitest'
import { formatMetaTag } from '@shared/config/profile/profile-metadata'
import { doc, tagged, slotsOf, keysOf, type DocBuilder } from './profile-restore.test-helpers'

describe('restoreProfileParts - an unbound line beside an alias line (story 063 D2)', () => {
  /** One unbound line as `render.ts#unboundLine` writes it - same helper as the 052 block above. */
  function unbound(command: string, prose: string, fields: Record<string, string> = {}): string {
    return `bind "${command}"  //${tagged(prose, fields)}`
  }

  /**
   * The grenade shape D1 introduced: a bodied entry in `Aliases: Weapons` whose key slot is empty,
   * so `Entries: Weapons` carries its commented-out bind naming the very same alias.
   */
  function keylessBodiedFile(): DocBuilder {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('hand_grenades', 'use grenades', tagged('Hand grenades', { cid: 'weapon:grenades' }))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(
      unbound('hand_grenades', 'Hand grenades', {
        cid: 'weapon:grenades',
        an: 'hand_grenades',
      }),
    )
    return file
  }

  it('joins the two lines into one `kind: bind` entry, body and alias name intact', () => {
    const result = keylessBodiedFile().restore()

    expect(result.warnings).toEqual([])
    // One entry, not two: the alias line and the unbound line are one row's two halves.
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'weapons',
        name: 'Hand grenades',
        // The whole deliverable: the unbound line says "keyed kind, empty slot", so this is not the
        // `kind: 'alias'` the alias line alone used to be read as.
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'use grenades' }],
        catalogId: 'weapon:grenades',
        aliasName: 'hand_grenades',
      },
    ])
    // An empty slot, not an invented one - the unbound line carries no `key` to claim.
    expect(keysOf(result.actions[0])).toEqual([])
    // And the entry is not marked as an empty-bodied alias definition either.
    expect(result.actions[0]!.keepEmptyAlias).toBeUndefined()
  })

  it('joins them off the commented-out bind`s own value when the tag carries no `an`', () => {
    // An entry with no explicit `aliasName` renders its alias line under `aliasNameFor`'s derived
    // name, and `unboundLine` writes `an` only for an explicit one - so for that entry the
    // commented-out bind's value (`bindValueFor`, the same derived name) is the file's only
    // statement of the join. Without reading it, exactly the entries the UI creates by default
    // would still split in two.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('grenade_launcher', 'use grenade launcher', tagged('Grenade Launcher'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('grenade_launcher', 'Grenade Launcher'))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.kind).toBe('bind')
    expect(result.actions[0]!.aliasName).toBe('grenade_launcher')
    expect(result.actions[0]!.commands).toEqual([{ kind: 'raw', text: 'use grenade launcher' }])
  })

  it('reads a keyless entry with a `say` body back as the message entry it is', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Other', formatMetaTag({ cat: 'chat' }))
    file.alias('gg_e', 'say gg', tagged('GG'))
    file.header('Entries: Other', formatMetaTag({ cat: 'chat' }))
    file.comment(unbound('gg_e', 'GG', { an: 'gg_e' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.kind).toBe('message')
    expect(result.actions[0]!.commands).toEqual([{ kind: 'message', channel: 'say', text: 'gg' }])
  })

  it('leaves a genuine `kind: alias` entry - an alias line with no unbound line - an alias entry', () => {
    // The other half of the signal, and the one that must not become collateral damage: nothing
    // claims a key for this line *and* the writer wrote no unbound line beside it, which is exactly
    // story 019's never-bound entry.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('my_macro', 'use blaster; +attack', tagged('My macro'))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.kind).toBe('alias')
    expect(result.actions[0]!.aliasName).toBe('my_macro')
    expect(keysOf(result.actions[0])).toEqual([])
  })

  it('leaves a never-bound `say` alias entry an alias entry rather than promoting it', () => {
    // Story 063 D2's one deliberate behaviour change beyond the join: `entryKindFor` no longer
    // outranks the alias-entry test. Before D1 the promotion to `kind: 'message'` was invisible
    // (a keyless message entry rendered the same bytes an alias entry did); now the two shapes
    // differ in the file, so promoting this one grew an unbound line the original never had and
    // story 042's fixed point was gone (`orphanedCategoryProfiles`).
    const file = doc()
    file.version()
    file.header('Aliases: Other', formatMetaTag({ cat: 'chat' }))
    file.alias('orphaned_entry', 'say orphaned', tagged('Orphaned entry'))

    expect(file.restore().actions[0]!.kind).toBe('alias')
  })

  it('keeps `keepEmptyAlias` on an empty-bodied alias entry, and does not invent one next to an unbound line', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Other', '')
    file.alias('blaster_settings', '', tagged('Blaster setup'))
    // A commandless keyless row of its own, in its own section - the `//bind ""` shape story 052 D1
    // seeds. It names no alias, so it can never be folded onto the line above it.
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('', 'Crouch', { cid: 'movement:crouch' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    const [aliasEntry, seeded] = result.actions
    expect(aliasEntry!.kind).toBe('alias')
    expect(aliasEntry!.keepEmptyAlias).toBe(true)
    expect(seeded!.kind).toBe('bind')
    expect(seeded!.name).toBe('Crouch')
    expect(seeded!.keepEmptyAlias).toBeUndefined()
  })

  it('does not fold an unbound line onto a bound entry`s alias group', () => {
    // A hand-edited file can state both, and the writer never does: an entry with a key has no
    // unbound line. Folding would give this row a phantom second body and lose the standalone row
    // the line really describes, so the two stay two.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('r', 'rl', tagged('RL'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('rl', 'RL', { an: 'rl' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    expect(keysOf(result.actions[0])).toEqual(['r'])
    expect(result.actions[1]!.kind).toBe('bind')
    expect(keysOf(result.actions[1])).toEqual([])
  })

  it('does not fold an unbound line onto a recognised toggle', () => {
    // `render.ts#isUnboundEntry` excludes `toggle`/`press-release` outright, so this is a hand edit -
    // and `buildTwoPartEntry` reads no unbound line at all, so folding it in would drop the line's
    // own row silently. The trio has no bind line here on purpose: a keyless toggle is exactly the
    // shape whose dispatch group an unbound line could plausibly be mistaken for.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('zoom_s1', 'fov 30; alias zoom zoom_s2', tagged('Zoom', { lbl: 'In' }))
    file.alias('zoom_s2', 'fov 90; alias zoom zoom_s1', tagged('Zoom', { lbl: 'Out' }))
    file.alias('zoom', 'zoom_s1', tagged('Zoom'))
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('zoom', 'Zoom', { an: 'zoom' }))

    const result = file.restore()

    const toggle = result.actions.find((action) => action.kind === 'toggle')
    expect(toggle).toBeDefined()
    expect(toggle!.parts).toHaveLength(2)
    // The unbound line still becomes its own row rather than vanishing into the toggle.
    expect(result.actions).toHaveLength(2)
  })

  it('does not fold an unbound line onto a press/release half', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('+slow', 'cl_forwardspeed 110', tagged('Slow'))
    file.alias('-slow', 'cl_forwardspeed 200', tagged('Slow'))
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+slow', 'Slow', { an: '+slow' }))

    const result = file.restore()

    const pair = result.actions.find((action) => action.kind === 'press-release')
    expect(pair).toBeDefined()
    expect(pair!.aliasName).toBe('slow')
    expect(pair!.parts).toHaveLength(2)
    expect(result.actions).toHaveLength(2)
  })

  it('does not fold an unbound line onto an alias line whose `cid` disagrees', () => {
    // Two catalogue rows, one name: the tag never gives way under budget pressure, so two different
    // `cid`s are two different entries whatever the file names them.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('grenades', 'use grenades', tagged('Grenades', { cid: 'weapon:grenades' }))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('grenades', 'Grenades', { cid: 'weapon:gl', an: 'grenades' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    expect(result.actions.map((action) => action.catalogId)).toEqual([
      'weapon:grenades',
      'weapon:gl',
    ])
  })

  it('does not fold an unbound line onto an alias line in another category', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('grenades', 'use grenades', tagged('Grenades'))
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('grenades', 'Grenades', { an: 'grenades' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    expect(result.actions.map((action) => action.categoryId)).toEqual(['weapons', 'movement'])
  })

  it('joins a chunk-split body`s family through its base name', () => {
    // The `_p<n>` fold already keys the family under its parent name, and that is the name the
    // unbound line points at - so a body too long for one line joins exactly like a short one.
    const file = doc()
    file.version()
    file.header('Aliases: Drops', formatMetaTag({ cat: 'drops' }))
    const tag = tagged('Drop it all')
    file.alias('drop_all_p1', 'drop rl; drop rg', tag)
    file.alias('drop_all', 'drop_all_p1', tag)
    file.header('Entries: Drops', formatMetaTag({ cat: 'drops' }))
    file.comment(unbound('drop_all', 'Drop it all', { an: 'drop_all' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.kind).toBe('bind')
    expect(result.actions[0]!.aliasName).toBe('drop_all')
    expect(result.actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'drop rl' },
      { kind: 'raw', text: 'drop rg' },
    ])
  })

  it('joins a referenced-only continuous entry whose `//bind` value is not its alias name', () => {
    // Story 063 D3 (review fix): the one shape where the writer's two statements of the join are two
    // *different* strings. `Lone relay` is keyless, catalogue-backed and has a single continuous
    // command, so `bindValueFor` mirrors it onto that command text (`+lonerelay`) rather than through
    // its alias - and its alias line exists all the same, because `Relay caller`'s body calls
    // `lone_relay` by name (`alias-references.ts#actionsWithAliasLine`'s third guard). So the unbound
    // line names `+lonerelay` while the alias line is defined under `lone_relay`, and it carries no
    // `an` either (`render.ts#unboundLine` omits it when an alias line spells the name as code).
    // Before the fix the pair split into two entries sharing one `catalogId`: an inert
    // `kind: 'alias'` row plus a keyless `kind: 'bind'` one.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('lone_relay', '+lonerelay', tagged('Lone relay', { cid: 'weapons:lone-relay' }))
    file.alias('relay_caller', 'lone_relay', tagged('Relay caller'))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('c', 'relay_caller', tagged('Relay caller'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('+lonerelay', 'Lone relay', { cid: 'weapons:lone-relay' }))

    const result = file.restore()

    expect(result.warnings).toEqual([])
    // Two entries - the relay and its caller - not three.
    expect(result.actions).toHaveLength(2)
    const relay = result.actions.find((action) => action.name === 'Lone relay')!
    expect(relay.kind).toBe('bind')
    expect(relay.commands).toEqual([{ kind: 'raw', text: '+lonerelay' }])
    expect(relay.aliasName).toBe('lone_relay')
    expect(relay.catalogId).toBe('weapons:lone-relay')
    expect(keysOf(relay)).toEqual([])
    // One `catalogId`, on one entry: the split's own signature was two entries carrying it.
    expect(
      result.actions.filter((action) => action.catalogId === 'weapons:lone-relay'),
    ).toHaveLength(1)
    // The caller is untouched, and still calls the relay by the exact name it is defined under.
    const caller = result.actions.find((action) => action.name === 'Relay caller')!
    expect(caller.kind).toBe('bind')
    expect(caller.commands).toEqual([{ kind: 'raw', text: 'lone_relay' }])
    expect(keysOf(caller)).toEqual(['c'])
  })

  it('does not join a continuous unbound line onto an alias line whose body differs', () => {
    // The mirror-value join is exact: the alias line's own rendered body *is* the mirror value for
    // the shape it exists for, so a body that says something else is a different entry - the same
    // "refuse and keep two rows" direction every other gate takes.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('lone_relay', '+otherrelay', tagged('Lone relay', { cid: 'weapons:lone-relay' }))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('+lonerelay', 'Lone relay', { cid: 'weapons:lone-relay' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
  })

  it('still keeps an anchor of another entry off a joined group', () => {
    // The joined group now carries an unbound line, and `matchAnchor` used to exclude *any* group
    // that did - which would newly deny a real anchor its entry. It excludes only the groups an
    // unbound line created on its own, so this anchored entry still gets its modified slot while
    // the keyless one keeps none.
    const file = keylessBodiedFile()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('moveleft', '+moveleft', tagged('Strafe left'))
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(tagged('Strafe left', { an: 'moveleft', key: 'a', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    const grenades = result.actions.find((action) => action.aliasName === 'hand_grenades')!
    const strafe = result.actions.find((action) => action.aliasName === 'moveleft')!
    expect(grenades.kind).toBe('bind')
    expect(keysOf(grenades)).toEqual([])
    expect(slotsOf(strafe)).toEqual([{ key: 'a', modifier: 'ALT' }])
  })
})

/**
 * Story 051 D5 - the header block is a four-line banner now (`=` rule / name / `=` rule / the
 * `[q2l v=… id=…]` tag alone), so ownership rides on that tag instead of a separate sentinel line
 * and the block's decoration sits *before* the tag rather than after it. Both directions are pinned
 * here: what the new shape gives back, and that the legacy shape still gives back exactly what it
 * did.
 */
