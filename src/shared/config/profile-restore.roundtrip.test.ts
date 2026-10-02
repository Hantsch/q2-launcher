import { describe, expect, it } from 'vitest'
import { META_FORMAT_VERSION, formatMetaTag } from '@shared/config/profile-metadata'
import { doc, tagged, slotsOf, keysOf } from './profile-restore.test-helpers'

describe('restoreProfileParts - what a launcher-written file gives back', () => {
  it('recovers name, kind, catalogue id, own alias name, both key slots and command order', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias(
      'ssg_sg',
      'use super shotgun; use shotgun',
      tagged('SSG + SG', { cid: 'weapon:ssg_sg' }),
    )
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))
    file.bind('MOUSE2', 'ssg_sg', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))

    const result = file.restore()

    expect(result.metadataVersion).toBe(META_FORMAT_VERSION)
    expect(result.warnings).toEqual([])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({
      id: 'id1',
      // A template `cat` id keeps its id (so `cat=` tags, the seed and the migration all mean the
      // same drawer) - but story 052 D4 mints a real category record for it all the same.
      categoryId: 'weapons',
      name: 'SSG + SG',
      kind: 'bind',
      commands: [
        { kind: 'raw', text: 'use super shotgun' },
        { kind: 'raw', text: 'use shotgun' },
      ],
      catalogId: 'weapon:ssg_sg',
      keys: [{ key: 'q' }, { key: 'MOUSE2' }],
      aliasName: 'ssg_sg',
    })
    // Story 052 D4: minted as an ordinary category, named from the header's own title, with the
    // template's `nameKey` re-attached because that title is still the template's English default.
    // Before D4 this was `[]` - the id was adopted invisibly, which now would leave the entry
    // pointing at a category the profile does not have.
    expect(result.categories).toEqual([
      { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
    ])
  })

  it('mints a renamed template category under its own name, with no nameKey', () => {
    // AC 8's rename half, on the read side: the user renamed "Weapons" to "Guns" in the rail, the
    // writer put that in the header, and it has to come back as the profile's name for `weapons` -
    // not be overwritten by the template default the id used to imply.
    const file = doc()
    file.version()
    file.header('Aliases: Guns', formatMetaTag({ cat: 'weapons' }))
    file.alias('ssg_sg', 'use super shotgun; use shotgun', tagged('SSG + SG'))

    const result = file.restore()

    expect(result.categories).toEqual([{ id: 'weapons', name: 'Guns' }])
    expect(result.actions[0]!.categoryId).toBe('weapons')
  })

  it('creates only the categories the file has (AC 7)', () => {
    // A foreign-shaped file with one section: no Movement/Weapons/Weapon dropping alongside it.
    const file = doc()
    file.version()
    file.header('Aliases: Imported', formatMetaTag({ cat: 'their-cat-id' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    expect(result.categories).toHaveLength(1)
    expect(result.categories[0]!.name).toBe('Imported')
    // Story 079 D1 (AC4): the file's own `cat=` id is adopted - it is looked up within this profile
    // only, and adopting it is what keeps the next render's tag identical - and the entry follows it.
    expect(result.categories[0]!.id).toBe('their-cat-id')
    expect(result.actions[0]!.categoryId).toBe('their-cat-id')
  })

  it('pairs two bind lines running one command into one entry with two keys, in file order', () => {
    // AC4, and the D7 acceptance clause: no ref field is involved at all. The two lines are
    // deliberately not adjacent, and the entry in between shares neither value nor display name.
    const file = doc()
    file.version()
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('a', 'left_strafe', tagged('Strafe left'))
    file.bind('d', 'right_strafe', tagged('Strafe right'))
    file.bind('KP_LEFTARROW', 'left_strafe', tagged('Strafe left'))

    const result = file.restore()
    const left = result.actions.find((action) => action.name === 'Strafe left')!
    const right = result.actions.find((action) => action.name === 'Strafe right')!

    expect(result.actions).toHaveLength(2)
    expect(keysOf(left)).toEqual(['a', 'KP_LEFTARROW'])
    expect(keysOf(right)).toEqual(['d'])
    expect(result.warnings).toEqual([])
  })

  it('makes a hand-added third bind line on the same value that entry`s third slot', () => {
    // AC3 / D7: file order is the whole slot rule since story 050 dropped `slot`, and claims append
    // with no cap - so the third line is neither rejected nor reported as a conflict.
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { cid: 'weapon:ssg_sg' }))
    file.bind('MOUSE2', 'ssg_sg', tagged('SSG', { cid: 'weapon:ssg_sg' }))
    // What a player editing the synced file in Notepad writes: the same value, a marker tag copied
    // off the line above, a third key.
    file.bind('f', 'ssg_sg', tagged('SSG', { cid: 'weapon:ssg_sg' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(keysOf(result.actions[0])).toEqual(['q', 'MOUSE2', 'f'])
    expect(result.warnings).toEqual([])
  })

  it('joins a bind line onto the alias line whose name it runs', () => {
    // The join rule: one shared key space, so `bind q "ssg_sg"` meets `alias ssg_sg …` without
    // either line carrying a field that says so.
    const file = doc()
    file.version()
    file.header('Aliases: Other', '')
    file.alias('ssg_sg', 'use super shotgun', tagged('SSG'))
    file.header('Binds: Other', '')
    file.bind('q', 'ssg_sg', tagged('SSG'))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.aliasName).toBe('ssg_sg')
    expect(keysOf(result.actions[0])).toEqual(['q'])
  })

  it('claims a bind line`s slot before an anchor line`s, whatever the file order', () => {
    // The documented consequence of "bind lines before anchor lines": an entry whose modified slot
    // came first in the UI comes back with its two slots swapped. Both keys and both modifiers
    // survive, which is what keeps the re-render byte-identical.
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Rocket', { cid: 'weapon:rl', key: 'r', mod: 'ALT' }))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('t', 'rl', tagged('Rocket', { cid: 'weapon:rl' }))
    file.header(
      'Layer: Alt (hold, on ALT)',
      formatMetaTag({ layer: 'l-alt', mode: 'hold', trigger: 'ALT' }),
    )
    file.alias('+alt', 'bind r rl', ' Alt')
    file.alias('-alt', 'unbind r', ' Alt')
    file.bind('ALT', '+alt', ' Alt')

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(slotsOf(result.actions[0])).toEqual([{ key: 't' }, { key: 'r', modifier: 'ALT' }])
    expect(result.warnings).toEqual([])
  })

  it('reads a slot modifier off that slot`s own `mod` field', () => {
    // Only an anchor line ever carries `mod` (a modified slot has no bind line), so a two-modifier
    // entry is two anchors under its own `Entries:` section, in slot order.
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Rocket', { cid: 'weapon:rl', an: 'rl', key: 'r', mod: 'ALT' }))
    file.comment(tagged('Rocket', { cid: 'weapon:rl', an: 'rl', key: 't', mod: 'CTRL' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(slotsOf(result.actions[0])).toEqual([
      { key: 'r', modifier: 'ALT' },
      { key: 't', modifier: 'CTRL' },
    ])
  })

  it('reports a `mod` that is not a modifier and keeps the slot`s key', () => {
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Rocket', { cid: 'weapon:rl', an: 'rl', key: 'r', mod: 'HYPER' }))

    const result = file.restore()

    expect(slotsOf(result.actions[0])).toEqual([{ key: 'r' }])
    expect(result.warnings).toEqual([
      { reason: 'tag-modifier-unknown', file: 'q2l-profile-src.cfg', line: 3, subject: 'HYPER' },
    ])
  })

  it('adopts one category per unknown `cat` id, named from the header title', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Fun stuff', formatMetaTag({ cat: 'e7c1-remote-id' }))
    file.alias('gg', 'say gg', tagged('GG'))
    file.header('Binds: Fun stuff', formatMetaTag({ cat: 'e7c1-remote-id' }))
    file.bind('F1', 'gg', tagged('GG'))

    const result = file.restore()

    // One category, not two: the alias section and the bind section carry the same id - and it is
    // the file's own id (story 079 D1, AC4), not a freshly minted one.
    expect(result.categories).toEqual([{ id: 'e7c1-remote-id', name: 'Fun stuff' }])
    expect(result.actions[0]!.categoryId).toBe('e7c1-remote-id')
    expect(result.actions[0]!.kind).toBe('message')
    expect(result.actions[0]!.commands).toEqual([{ kind: 'message', channel: 'say', text: 'gg' }])
  })

  it('keeps an empty-bodied alias entry as one', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Other', '')
    file.alias('blaster_settings', '', tagged('Blaster setup'))

    const [action] = file.restore().actions

    // Nothing claims a key for it and it has an alias line, which is exactly story 019's definition
    // of a `kind: 'alias'` entry - inferred now that `k` is gone, never read off a tag.
    expect(action!.kind).toBe('alias')
    expect(action!.keepEmptyAlias).toBe(true)
    expect(action!.commands).toEqual([])
  })

  it('recombines a chunk-split alias family into one entry, in body order', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Drops', formatMetaTag({ cat: 'drops' }))
    const tag = tagged('Drop it all')
    file.alias('drop_all_p1', 'drop rl; drop rg', tag)
    file.alias('drop_all_p2', 'drop bfg', tag)
    file.alias('drop_all', 'drop_all_p1; drop_all_p2', tag)

    const result = file.restore()
    const [action] = result.actions

    // One entry, not three: the `_p<n>` family folds onto the base line that calls it.
    expect(result.actions).toHaveLength(1)
    expect(action!.aliasName).toBe('drop_all')
    expect(action!.commands.map((command) => (command.kind === 'raw' ? command.text : ''))).toEqual(
      ['drop rl', 'drop rg', 'drop bfg'],
    )
  })

  it('joins a bind line onto a chunk-split family through its base name', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Drops', formatMetaTag({ cat: 'drops' }))
    const tag = tagged('Drop it all')
    file.alias('drop_all_p1', 'drop rl', tag)
    file.alias('drop_all', 'drop_all_p1', tag)
    file.header('Binds: Drops', formatMetaTag({ cat: 'drops' }))
    file.bind('x', 'drop_all', tag)

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(keysOf(result.actions[0])).toEqual(['x'])
    expect(result.actions[0]!.aliasName).toBe('drop_all')
  })

  it('rebuilds an entry whose alias line the writer dropped from its bind line alone', () => {
    // A continuous catalogue row (`+forward`) is bound to its own command, so `render.ts` emits no
    // alias line for it at all - the bind line is the only record there is.
    const file = doc()
    file.version()
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('w', '+forward', tagged('Move forward', { cid: '+forward' }))

    const [action] = file.restore().actions

    expect(action).toEqual({
      id: 'id1',
      categoryId: 'movement',
      name: 'Move forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: '+forward',
      keys: [{ key: 'w' }],
    })
    // No `aliasName`: `bindValueFor` already produces `+forward` for a continuous catalogue row, so
    // pinning one would resurrect an `alias +forward +forward` line the file never had.
    expect(action!.aliasName).toBeUndefined()
  })

  it('adopts the bind value as the own alias name of a self-mirroring entry', () => {
    const file = doc()
    file.version()
    file.header('Binds: Other', '')
    file.bind('MWHEELUP', 'weapnext', tagged('Next weapon'))

    const [action] = file.restore().actions

    expect(action!.aliasName).toBe('weapnext')
    expect(action!.commands).toEqual([{ kind: 'raw', text: 'weapnext' }])
  })

  it('leaves a raw bind the user typed and commented out of the entries entirely', () => {
    // With `e` gone, tag *presence* is the only launcher-owned signal a code line has left. A bind
    // line with a plain comment and no `[q2l` marker therefore stays a raw bind (it survives in
    // `profile.binds`, which `import.ts` reads off the parsed lines directly) and gets no warning:
    // warning on every raw bind would fire on every healthy file.
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG'))
    file.bind('z', 'give all', ' my cheat key')

    const result = file.restore()

    expect(result.actions.map((action) => action.name)).toEqual(['SSG'])
    expect(result.warnings).toEqual([])
  })

  it('orders entries by the file`s own line order, not aliases-before-binds (review finding 3)', () => {
    // The file below is what `render.ts` writes for a category whose action order is
    // [Forward (aliasless, mirrors as its bare `+forward`), SSG (alias-backed)]: the alias section
    // holds only SSG's line, and the bind section holds Forward's line *first*, because
    // `compareOwnedBinds` sorts a category's binds by the owning action's index.
    //
    // Grouping in map-insertion order created the alias-backed group first regardless, so Forward
    // came back as action 2 - and the very next render then swapped the two bind lines. Byte
    // identity on an untouched file, gone. The restored order has to follow the bind section.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('ssg_sg', 'use super shotgun', tagged('SSG', { cid: 'weapon:ssg_sg' }))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('w', '+forward', tagged('Forward', { cid: 'movement:forward' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { cid: 'weapon:ssg_sg' }))

    const result = file.restore()

    expect(result.actions.map((action) => action.name)).toEqual(['Forward', 'SSG'])
  })

  it('keeps two same-named entries in different categories apart (review finding 4)', () => {
    // Both entries are called `Fire`, so `derivedAliasName` slugs both to `fire` and the writer
    // emits two `alias fire` lines - one per category section. Keyed on the bare alias name, the
    // two collapsed into a single entry here: one body, one `cid` and one set of keys survived and
    // the other entry was gone without a warning. The category scope keeps them apart.
    //
    // This pins the *grouping key's scope* on a hand-fed input, and that is all it can pin: a real
    // reader folds `alias` lines last-definition-wins by name before calling here, so the two
    // `alias fire` lines below never arrive together (the same reason `entry-alias-duplicate` is
    // raised by that fold and not by this module - see its doc comment). What the scope still buys
    // on real input is the *bind-value* key space, where nothing folds anything away: two entries
    // sharing one bind value in two categories stay two entries. The end-to-end behaviour of the
    // alias collision itself is covered where it actually happens -
    // `main/modules/config/file-source-pipeline.test.ts`.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('fire', '+attack', tagged('Fire', { cid: 'weapon:fire' }))
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('fire', '+forward', tagged('Fire', { cid: 'movement:fire' }))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('MOUSE1', 'fire', tagged('Fire', { cid: 'weapon:fire' }))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('w', 'fire', tagged('Fire', { cid: 'movement:fire' }))

    const result = file.restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toHaveLength(2)
    expect(result.actions.map((action) => action.categoryId)).toEqual(['weapons', 'movement'])
    expect(result.actions.map((action) => action.catalogId)).toEqual([
      'weapon:fire',
      'movement:fire',
    ])
    expect(result.actions.map((action) => action.commands)).toEqual([
      [{ kind: 'raw', text: '+attack' }],
      [{ kind: 'raw', text: '+forward' }],
    ])
    // Each entry kept its own key, on its own line, in its own category's bind section.
    expect(keysOf(result.actions[0])).toEqual(['MOUSE1'])
    expect(keysOf(result.actions[1])).toEqual(['w'])
  })

  // The `entry-alias-duplicate` report that used to be tested here is deliberately gone from this
  // module (story-050 review, finding 4, second round). It was reported from `buildEntry` on an
  // input no reader can produce - both readers fold `alias` lines last-definition-wins by name
  // before calling `restoreProfileParts` - so the branch was unreachable and the entry a user
  // actually loses still vanished without a word. The warning now comes from the fold itself
  // (`main/modules/config/file-source.ts`), and is tested against the real
  // render -> read -> restore pipeline in `main/modules/config/file-source-pipeline.test.ts` plus
  // `main/modules/config/file-source.test.ts`. Nothing is asserted here in its place: this module
  // cannot see the collision at all, and a test that pretended otherwise is what let the first fix
  // through.

  it('reports the file`s profile id without ever adopting it', () => {
    const file = doc()
    file.sentinel('profile-42')
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    expect(result.sourceProfileId).toBe('profile-42')
    expect(result.actions.map((action) => action.id)).not.toContain('profile-42')
  })
})

describe('restoreProfileParts - layers', () => {
  /** A hold layer exactly as `generateLayerAliases` renders one, inside its own section. */
  function holdLayerFile(): ReturnType<typeof doc> {
    const file = doc()
    file.version()
    file.header(
      'Layer: Drop menu (hold, on ALT)',
      formatMetaTag({ layer: 'remote-layer-1', mode: 'hold', trigger: 'ALT' }),
    )
    file.alias('+drop_menu', 'bind 1 drop rl; bind 2 drop_menu_c1', ' Drop menu')
    file.alias('drop_menu_c1', 'drop rg; drop bfg', ' Drop menu')
    file.alias('-drop_menu', 'bind 1 weapnext; unbind 2', ' Drop menu')
    file.bind('ALT', '+drop_menu', ' Drop menu')
    return file
  }

  it('recovers identity, name, mode, trigger and the overrides that belong to it', () => {
    const result = holdLayerFile().restore()

    expect(result.layers).toHaveLength(1)
    expect(result.layers[0]).toEqual({
      // The tag's own id, adopted (story 079 D1, AC4) - a layer is only ever looked up within its
      // own profile, and re-minting it would rewrite the tag on the next render.
      id: 'remote-layer-1',
      name: 'Drop menu',
      mode: 'hold',
      triggerKey: 'ALT',
      // The apply half's binds only - never the restore half's `bind 1 weapnext`/`unbind 2` - and a
      // `_c<n>` helper resolved back into the command it was hoisted out of.
      overrides: { '1': 'drop rl', '2': 'drop rg; drop bfg' },
    })
    // The layer's own alias and bind lines carry no tag, so they never become entries.
    expect(result.actions).toEqual([])
  })

  it('lets the alias names the file really carries outrank a contradicting `mode` tag', () => {
    const file = doc()
    file.version()
    file.header(
      'Layer: Zoom (toggle, on v)',
      formatMetaTag({ layer: 'remote-layer-2', mode: 'toggle', trigger: 'v' }),
    )
    file.alias('+zoom', 'bind 1 x', ' Zoom')
    file.alias('-zoom', 'bind 1 y', ' Zoom')
    file.bind('v', '+zoom', ' Zoom')

    const result = file.restore()

    expect(result.layers[0]!.mode).toBe('hold')
    expect(result.warnings).toEqual([
      expect.objectContaining({ reason: 'layer-mode-contradicted', subject: 'toggle' }),
    ])
  })

  it('reads a toggle layer through its dispatch alias', () => {
    const file = doc()
    file.version()
    file.header(
      'Layer: Zoom (toggle, on v)',
      formatMetaTag({ layer: 'remote-layer-3', mode: 'toggle', trigger: 'v' }),
    )
    file.alias('zoom_on', 'bind 1 x; alias zoom zoom_off', ' Zoom')
    file.alias('zoom_off', 'bind 1 y; alias zoom zoom_on', ' Zoom')
    file.alias('zoom', 'zoom_on', ' Zoom')
    file.bind('v', 'zoom', ' Zoom')

    const [layer] = file.restore().layers

    expect(layer!.mode).toBe('toggle')
    expect(layer!.triggerKey).toBe('v')
    expect(layer!.overrides).toEqual({ '1': 'x' })
  })

  it('hands a modifier layer`s override back to the entry whose anchor line records it', () => {
    // Story 016: `Alt+R` is not a bind line anywhere - it is an override in the ALT layer, keyed by
    // the entry's own mirrored value. This is exactly the file `render.ts` writes for it: the alias
    // line that defines the entry, the anchor line that records the slot, and the layer that
    // carries the binding.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher; say_team quad up', tagged('Quad RL'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Quad RL', { key: 'r', mod: 'ALT' }))
    file.header(
      'Layer: Alt (hold, on ALT)',
      formatMetaTag({ layer: 'remote-alt', mode: 'hold', trigger: 'ALT' }),
    )
    file.alias('+alt', 'bind r quad_rl', ' Alt')
    file.alias('-alt', 'unbind r', ' Alt')
    file.bind('ALT', '+alt', ' Alt')

    const result = file.restore()
    const [action] = result.actions

    expect(result.actions).toHaveLength(1)
    expect(slotsOf(action)).toEqual([{ key: 'r', modifier: 'ALT' }])
    // A slot claim makes it a bound entry, so the inferred kind is `bind`, not `alias`.
    expect(action!.kind).toBe('bind')
    // Claimed once, not twice: `restoreModifierSlots` sees the anchor already holds this exact
    // `(key, modifier)` pair and does not append it a second time.
    expect(result.layers[0]!.overrides).toEqual({ r: 'quad_rl' })
    expect(result.warnings).toEqual([])
  })

  // Documented consequence of story 050 dropping `k`, not a behaviour worth a warning: an entry
  // whose *only* key lived on a modified slot is a `kind: 'bind'` entry with an alias line, an
  // anchor line and a layer override. Hand-delete the anchor and the file no longer says anywhere
  // that the entry is bound at all - an alias line nothing claims a key for is exactly story 019's
  // `kind: 'alias'` entry, and `restoreModifierSlots` leaves such an entry alone (an alias entry is
  // never bound, so an override matching one is not evidence of a slot). Before 050 the `k=bind`
  // tag settled it. Nothing is lost from the file: the alias line and the layer override both come
  // back and re-render byte-identically; only the modifier slot the deleted line recorded is gone
  // with it. The writer never emits this shape - every modified slot gets an anchor
  // (`render.ts#buildAnchorLines`) - so it needs a hand-edit to reach.
  it('leaves an alias entry alone when only a layer override, and no anchor, names it', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher; say_team quad up', tagged('Quad RL'))
    file.header(
      'Layer: Alt (hold, on ALT)',
      formatMetaTag({ layer: 'remote-alt', mode: 'hold', trigger: 'ALT' }),
    )
    file.alias('+alt', 'bind r quad_rl', ' Alt')
    file.alias('-alt', 'unbind r', ' Alt')
    file.bind('ALT', '+alt', ' Alt')

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.kind).toBe('alias')
    expect(slotsOf(result.actions[0])).toEqual([])
    // Every line still comes back: the alias line as the entry, the override on its layer.
    expect(result.actions[0]!.aliasName).toBe('quad_rl')
    expect(result.layers[0]!.overrides).toEqual({ r: 'quad_rl' })
    expect(result.warnings).toEqual([])
  })

  it('appends a modifier override as a further slot instead of reporting it as unplaceable', () => {
    // Pre-050 this was `modifier-slot-unavailable`: both of the entry's two slots were taken, so
    // the ALT layer's own override for it had nowhere to go. `keys` is uncapped now, so the claim
    // simply appends and the warning is gone with the cap.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher', tagged('Quad RL'))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'quad_rl', tagged('Quad RL'))
    file.bind('e', 'quad_rl', tagged('Quad RL'))
    file.header(
      'Layer: Alt (hold, on ALT)',
      formatMetaTag({ layer: 'l-alt', mode: 'hold', trigger: 'ALT' }),
    )
    file.alias('+alt', 'bind r quad_rl', ' Alt')
    file.alias('-alt', 'unbind r', ' Alt')
    file.bind('ALT', '+alt', ' Alt')

    const result = file.restore()

    expect(slotsOf(result.actions[0])).toEqual([
      { key: 'q' },
      { key: 'e' },
      { key: 'r', modifier: 'ALT' },
    ])
    expect(result.warnings).toEqual([])
  })

  it('reports a trigger tag the layer section does not actually bind, and follows the file', () => {
    const file = doc()
    file.version()
    file.header(
      'Layer: Drops (hold, on ALT)',
      formatMetaTag({ layer: 'l1', mode: 'hold', trigger: 'ALT' }),
    )
    file.alias('+drops', 'bind 1 drop rl', ' Drops')
    file.alias('-drops', 'unbind 1', ' Drops')
    file.bind('CTRL', '+drops', ' Drops')

    const result = file.restore()

    expect(result.layers[0]!.triggerKey).toBe('CTRL')
    expect(result.warnings).toEqual([
      expect.objectContaining({ reason: 'layer-trigger-contradicted', subject: 'ALT' }),
    ])
  })
})
