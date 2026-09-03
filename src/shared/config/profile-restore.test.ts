import { describe, expect, it } from 'vitest'
import { banner, fitProseAndTag } from '@shared/config/cfg-layout'
import { actionKeySlots } from '@shared/config/action-slots'
import { buildImportedActions } from '@shared/config/alias-import'
import { META_FORMAT_VERSION, formatMetaTag } from '@shared/config/profile-metadata'
import {
  restoreProfileParts,
  type RestoreProfilePartsInput,
  type RestoreProfilePartsResult,
} from '@shared/config/profile-restore'
import type { ActionKeySlot, ConfigAction } from '@shared/modules/config'

/** Deterministic ids, so a case can pin which category or layer an entry points at. */
function idFactory(): () => string {
  let n = 0
  return () => `id${(n += 1)}`
}

/**
 * A document builder that produces exactly the shapes D3's parser hands over for a file D2 wrote:
 * comment-only lines with their line numbers, and cvar/bind/alias lines carrying the raw text after
 * their `//` marker (leading space included, as `config-parser.ts` slices it).
 *
 * Banner lines go through `cfg-layout.ts`'s own `banner`/`fitProseAndTag`, and every tag through
 * `formatMetaTag`, so a case is pinned against the writer's real decoration and the real grammar
 * rather than against a hand-typed imitation of them.
 */
interface DocBuilder {
  input: (extra?: Partial<RestoreProfilePartsInput>) => RestoreProfilePartsInput
  restore: () => RestoreProfilePartsResult
  comment: (text: string) => void
  version: (value?: number) => void
  sentinel: (profileId: string) => void
  header: (title: string, tag?: string) => void
  alias: (name: string, body: string, comment?: string) => void
  bind: (key: string, command: string, comment?: string) => void
  cvar: (name: string, value: string, comment?: string) => void
}

function doc(file = 'q2l-profile-src.cfg'): DocBuilder {
  let line = 0
  const comments: RestoreProfilePartsInput['comments'][number][] = []
  const aliases: RestoreProfilePartsInput['aliases'][number][] = []
  const binds: RestoreProfilePartsInput['binds'][number][] = []
  const cvars: RestoreProfilePartsInput['cvars'][number][] = []

  const at = (): { file: string; line: number } => ({ file, line: (line += 1) })

  const self: DocBuilder = {
    comment: (text: string): void => void comments.push({ ...at(), text }),
    version: (value = META_FORMAT_VERSION): void =>
      self.comment(`  My Profile ${formatMetaTag({ v: String(value) })}`),
    sentinel: (profileId: string): void =>
      self.comment(` q2-launcher profile ${profileId} - generated, do not edit`),
    /** A section banner exactly as `render.ts#titledSection` renders it, marker stripped. */
    header: (title: string, tag = ''): void =>
      self.comment(banner(fitProseAndTag(title, tag, 300))[0]!.slice(2)),
    alias: (name: string, body: string, comment = ''): void =>
      void aliases.push({ ...at(), name, body, comment }),
    bind: (key: string, command: string, comment = ''): void =>
      void binds.push({ ...at(), key, command, comment }),
    cvar: (name: string, value: string, comment = ''): void =>
      void cvars.push({ ...at(), name, value, comment }),
    input: (extra: Partial<RestoreProfilePartsInput> = {}): RestoreProfilePartsInput => ({
      aliases,
      binds,
      cvars,
      comments,
      newId: idFactory(),
      ...extra,
    }),
    restore: (): RestoreProfilePartsResult => restoreProfileParts(self.input()),
  }
  return self
}

/**
 * The trailing comment of a line the writer tagged: prose, then the tag, after one space.
 *
 * Story 050: an entry line always carries a tag even with no fields at all, because the tag's mere
 * presence is what marks the line as the launcher's own (`render.ts#entryTag`) - `tagged('X', {})`
 * renders exactly that bare `[q2l]` marker, and every case below that omits it is testing an
 * *untagged* line on purpose.
 */
function tagged(prose: string, fields: Record<string, string | undefined> = {}): string {
  const tag = formatMetaTag(fields)
  return prose.length > 0 ? ` ${prose} ${tag}` : ` ${tag}`
}

/** An entry's key slots as `(key, modifier)` pairs, which is what almost every case here asserts on
 * - read through the accessor rather than off `action.keys`, same discipline as production code. */
function slotsOf(action: ConfigAction | undefined): ActionKeySlot[] {
  return [...actionKeySlots(action!)]
}

/** Just the keys of an entry's slots, in slot order. */
function keysOf(action: ConfigAction | undefined): string[] {
  return slotsOf(action).map((slot) => slot.key)
}

describe('restoreProfileParts - what a launcher-written file gives back', () => {
  it('recovers name, kind, catalogue id, own alias name, both key slots and command order', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('ssg_sg', 'use super shotgun; use shotgun', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))
    file.bind('MOUSE2', 'ssg_sg', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))

    const result = file.restore()

    expect(result.metadataVersion).toBe(META_FORMAT_VERSION)
    expect(result.warnings).toEqual([])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({
      id: 'id1',
      // A built-in `cat` id is adopted verbatim, so no category is created for it.
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
    expect(result.categories).toEqual([])
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
    file.header('Layer: Alt (hold, on ALT)', formatMetaTag({ layer: 'l-alt', mode: 'hold', trigger: 'ALT' }))
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

  it('mints one local category per unknown `cat` id, named from the header title', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Fun stuff', formatMetaTag({ cat: 'e7c1-remote-id' }))
    file.alias('gg', 'say gg', tagged('GG'))
    file.header('Binds: Fun stuff', formatMetaTag({ cat: 'e7c1-remote-id' }))
    file.bind('F1', 'gg', tagged('GG'))

    const result = file.restore()

    // One category, not two: the alias section and the bind section carry the same id.
    expect(result.categories).toEqual([{ id: 'id2', name: 'Fun stuff' }])
    expect(result.actions[0]!.categoryId).toBe('id2')
    // A fresh local id, never the file's own.
    expect(result.categories[0]!.id).not.toBe('e7c1-remote-id')
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
    expect(action!.commands.map((command) => (command.kind === 'raw' ? command.text : ''))).toEqual([
      'drop rl',
      'drop rg',
      'drop bfg',
    ])
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
      id: 'id1',
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
    file.header('Layer: Alt (hold, on ALT)', formatMetaTag({ layer: 'remote-alt', mode: 'hold', trigger: 'ALT' }))
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
    file.header('Layer: Alt (hold, on ALT)', formatMetaTag({ layer: 'remote-alt', mode: 'hold', trigger: 'ALT' }))
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
    file.header('Layer: Alt (hold, on ALT)', formatMetaTag({ layer: 'l-alt', mode: 'hold', trigger: 'ALT' }))
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
    file.header('Layer: Drops (hold, on ALT)', formatMetaTag({ layer: 'l1', mode: 'hold', trigger: 'ALT' }))
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

describe('restoreProfileParts - anchor lines and how they find their entry', () => {
  /** The file `render.ts` writes for an entry bound only through a modifier: an anchor line under
   * its own category section, and the ALT layer that actually carries the binding. */
  function anchoredFile(): ReturnType<typeof doc> {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(tagged('Forward', { cid: 'forward', key: 'w', mod: 'ALT' }))
    file.header('Layer: Alt (hold, on ALT)', formatMetaTag({ layer: 'remote-alt', mode: 'hold', trigger: 'ALT' }))
    file.alias('+alt', 'bind w +forward', ' Alt')
    file.alias('-alt', 'unbind w', ' Alt')
    file.bind('ALT', '+alt', ' Alt')
    return file
  }

  it('rebuilds an entry that has no alias line and no bind line anywhere in the file', () => {
    const result = anchoredFile().restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'movement',
        name: 'Forward',
        kind: 'bind',
        // Taken from the layer override the anchor names - the only place the file records what this
        // entry does, since it has no alias line to hold a body.
        commands: [{ kind: 'raw', text: '+forward' }],
        catalogId: 'forward',
        keys: [{ key: 'w', modifier: 'ALT' }],
      },
    ])
    // The override stays on the layer: it is a derived mirror of that same slot.
    expect(result.layers[0]!.overrides).toEqual({ w: '+forward' })
  })

  it('does not hand the same override to a second slot as well', () => {
    const [action] = anchoredFile().restore().actions

    expect(slotsOf(action)).toHaveLength(1)
  })

  it('pairs an anchor with its entry by `cid`, even when the two proses differ', () => {
    // D7's first anchor clause: `cid` is checked before prose, so a catalogue-backed entry survives
    // a display name that drifted between its bind line and its anchor.
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('r', 'rl', tagged('Rocket launcher', { cid: 'weapon:rl' }))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('RL (renamed)', { cid: 'weapon:rl', key: 'g', mod: 'CTRL' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(slotsOf(result.actions[0])).toEqual([{ key: 'r' }, { key: 'g', modifier: 'CTRL' }])
    // The bind line's own prose still names the entry - the alias/bind line comes first.
    expect(result.actions[0]!.name).toBe('Rocket launcher')
  })

  it('pairs a `cid`-less anchor with its entry by display prose', () => {
    // D7's second anchor clause: a user-made entry has no catalogue link, so its anchor's only tie
    // to it is the display name both lines carry.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher; say_team quad', tagged('Quad RL'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Quad RL', { key: 'g', mod: 'SHIFT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.aliasName).toBe('quad_rl')
    expect(slotsOf(result.actions[0])).toEqual([{ key: 'g', modifier: 'SHIFT' }])
  })

  it('never merges two entries because one name is a prefix of the other (review finding 1)', () => {
    // The prose match is *exact* and nothing wider. A prefix relation (the removed third step)
    // matched `Reload` against its sibling `Reload weapon` here and folded the two into one entry:
    // one of them lost its name, its commands and its bind in one go, with no warning at all. Both
    // entries survive, each with its own line, and the anchor lands on the one it names exactly.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('reload', 'use shotgun; +attack', tagged('Reload'))
    file.alias('reload_weapon', 'weapnext; +attack', tagged('Reload weapon'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Reload weapon', { key: 'b', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions.map((action) => action.name)).toEqual(['Reload', 'Reload weapon'])
    expect(result.actions.map((action) => action.aliasName)).toEqual(['reload', 'reload_weapon'])
    expect(slotsOf(result.actions[0])).toEqual([])
    expect(slotsOf(result.actions[1])).toEqual([{ key: 'b', modifier: 'ALT' }])
    // Both bodies are still there - the merge used to keep only the first line's.
    expect(result.actions[1]!.commands).toEqual([
      { kind: 'raw', text: 'weapnext' },
      { kind: 'raw', text: '+attack' },
    ])
  })

  it('splits an anchor whose prose is only a prefix of its entry`s off as its own entry', () => {
    // The other side of the same coin: with the prefix step gone, an anchor whose prose is a
    // *truncation* of the entry's own no longer pairs with it - it becomes its own row, the same
    // accepted drift an inconsistent hand-rename produces (see the test below). Nothing is lost:
    // both the alias line's entry and the anchor's entry survive with their own keys.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('combo', 'use bfg10k; say_team big one incoming', tagged('Quad damage BFG combo'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Quad damage BFG', { key: 'b', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions.map((action) => action.name)).toEqual([
      'Quad damage BFG combo',
      'Quad damage BFG',
    ])
    expect(slotsOf(result.actions[1])).toEqual([{ key: 'b', modifier: 'ALT' }])
  })

  it('splits an inconsistently renamed anchor off as its own entry, losing no line', () => {
    // D7's fourth acceptance clause, and the drift the User accepted: the anchor's prose was
    // hand-edited to something that is neither the entry's name nor a prefix of it, and the entry
    // has no `cid` to fall back on. Two rows, no crash, and every config line still accounted for.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher', tagged('Quad RL'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Something else entirely', { an: 'quad_rl', key: 'g', mod: 'SHIFT' }))
    file.header('Layer: Alt (hold, on SHIFT)', formatMetaTag({ layer: 'l-s', mode: 'hold', trigger: 'SHIFT' }))
    file.alias('+shifted', 'bind g quad_rl', ' Shifted')
    file.alias('-shifted', 'unbind g', ' Shifted')
    file.bind('SHIFT', '+shifted', ' Shifted')

    const result = file.restore()

    expect(result.actions.map((action) => action.name)).toEqual(['Quad RL', 'Something else entirely'])
    // The alias line's entry keeps its own line and its own name; the anchor's entry keeps the key
    // and modifier the anchor recorded. Nothing was dropped and nothing was merged.
    expect(slotsOf(result.actions[0])).toEqual([])
    expect(slotsOf(result.actions[1])).toEqual([{ key: 'g', modifier: 'SHIFT' }])
    expect(result.actions[1]!.aliasName).toBe('quad_rl')
    // The anchor line is still reported as understood, so it does not also show up as an
    // unrecognised leftover in the import preview.
    expect(result.consumedCommentLines).toEqual(
      expect.arrayContaining([{ file: 'q2l-profile-src.cfg', line: 5 }]),
    )
  })

  it('gives an anchor whose prose matches two entries its own entry rather than guessing', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl_a', 'use rocket launcher', tagged('Rocket'))
    file.alias('rl_b', 'use rocket launcher; wave 1', tagged('Rocket'))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Rocket', { key: 'g', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(3)
    expect(slotsOf(result.actions[2])).toEqual([{ key: 'g', modifier: 'ALT' }])
  })

  it('keeps an anchor out of an entry that sits in another category', () => {
    // The match is scoped to the anchor's own section, so a same-named entry in a different category
    // is not a candidate at all.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher', tagged('Quad RL'))
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(tagged('Quad RL', { key: 'g', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    expect(result.actions[0]!.categoryId).toBe('weapons')
    expect(result.actions[1]!.categoryId).toBe('movement')
  })

  it('joins a second anchor of one anchor-only entry onto the first one`s entry', () => {
    // An entry whose every slot is modified has no alias and no bind line at all, only its anchors.
    // The second one has to find the group the first one created, or the entry comes back split.
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(tagged('Next weapon', { an: 'weapnext', key: 'MWHEELUP', mod: 'ALT' }))
    file.comment(tagged('Next weapon', { an: 'weapnext', key: 'MWHEELDOWN', mod: 'CTRL' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(1)
    expect(slotsOf(result.actions[0])).toEqual([
      { key: 'MWHEELUP', modifier: 'ALT' },
      { key: 'MWHEELDOWN', modifier: 'CTRL' },
    ])
  })

  it('takes the own alias name off an anchor`s `an` field when no alias line carries it', () => {
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    // The self-mirroring shape story 039 drops the alias line for: nothing in the file spells
    // `weapnext` as code, so the tag is the only place the entry's own alias name can live.
    file.comment(tagged('Next weapon', { an: 'weapnext', key: 'MWHEELUP', mod: 'ALT' }))
    file.header('Layer: Alt (hold, on ALT)', formatMetaTag({ layer: 'l-alt', mode: 'hold', trigger: 'ALT' }))
    file.alias('+alt', 'bind MWHEELUP weapnext', ' Alt')
    file.alias('-alt', 'unbind MWHEELUP', ' Alt')
    file.bind('ALT', '+alt', ' Alt')

    const result = file.restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'weapons',
        name: 'Next weapon',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'weapnext' }],
        keys: [{ key: 'MWHEELUP', modifier: 'ALT' }],
        aliasName: 'weapnext',
      },
    ])
  })

  it('reads no entry out of a comment that carries no `key`, and keeps the line preserved', () => {
    // Story 050: `key` is the anchor discriminator, and only anchors ever carry one. A comment-only
    // line with a `cid` but no `key` is therefore not an anchor - the writer emits no such line
    // (`render.ts#buildAnchorLines`), and reading one as a keyless, commandless entry would hand
    // `catalog-binds.ts#applySlot` an empty base to spread on the next bind of that catalogue row.
    // The line is not consumed either, so it stays visible in the import preview's `preserved` list
    // instead of being lost.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(tagged('Strafe left', { cid: 'moveleft' }))

    const result = file.restore()

    expect(result.actions).toEqual([])
    expect(result.consumedCommentLines).not.toEqual(
      expect.arrayContaining([{ file: 'q2l-profile-src.cfg', line: 3 }]),
    )
  })

  it('ignores a `key` on a section header or on the version marker', () => {
    const file = doc()
    file.version()
    // A hand-edited `key` on a *section* header is not an entry anchor.
    file.header('Binds: Weapons', formatMetaTag({ key: 'g', cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG'))

    const result = file.restore()

    expect(result.actions.map((entry) => entry.name)).toEqual(['SSG'])
    expect(result.actions[0]!.categoryId).toBe('weapons')
  })
})

describe('restoreProfileParts - hand-edited and unknown metadata', () => {
  it('reports a mangled tag, loses only that line`s entry, and keeps the rest', () => {
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    // Truncated mid-tag, exactly as a hand-edit leaves it: no closing bracket.
    file.bind('q', 'ssg_sg', ' SSG + SG [q2l cid=')
    file.bind('MOUSE2', 'ssg_sg', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))

    const result = file.restore()

    expect(result.warnings).toEqual([
      { reason: 'tag-malformed', file: 'q2l-profile-src.cfg', line: 3 },
    ])
    // The surviving line still rebuilds its entry with its own key; the mangled line's bind is not
    // turned into a second, invented entry and is not merged into this one either - a tag nothing
    // could be read out of no longer says whose line it is. It stays a plain bind
    // (`profile.binds` is imported from the parsed lines directly, so nothing about it is lost).
    expect(result.actions).toHaveLength(1)
    expect(keysOf(result.actions[0])).toEqual(['MOUSE2'])
  })

  it('claims a line whose tag has one garbled token among good ones', () => {
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', ' SSG [q2l cid=weapon:ssg_sg =garbled]')

    const result = file.restore()

    expect(result.warnings.map((warning) => warning.reason)).toEqual(['tag-malformed'])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.catalogId).toBe('weapon:ssg_sg')
  })

  it('reports a hand-deleted version marker but still reads the tags that are left', () => {
    const file = doc()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG'))

    const result = file.restore()

    expect(result.metadataVersion).toBeNull()
    expect(result.warnings).toEqual([
      expect.objectContaining({ reason: 'metadata-version-missing' }),
    ])
    expect(result.actions).toHaveLength(1)
  })

  it('parses what it recognises from a newer format version, and says so', () => {
    const file = doc()
    file.version(META_FORMAT_VERSION + 1)
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { wobble: 'yes' }))

    const result = file.restore()

    expect(result.metadataVersion).toBe(META_FORMAT_VERSION + 1)
    expect(result.warnings.map((warning) => warning.reason)).toEqual([
      'metadata-version-newer',
      'tag-unknown-keys',
    ])
    expect(result.warnings[1]!.subject).toBe('wobble')
    // Everything the registry does know still came back.
    expect(result.actions[0]).toMatchObject({ name: 'SSG', kind: 'bind', keys: [{ key: 'q' }] })
  })

  it('reports a leftover `e`/`slot` from a hand-edit as an unknown key and reads the line anyway', () => {
    // Story 050 dropped all three keys from the registry, so a field copied out of a pre-050 file
    // is now simply unknown: reported, round-tripped, and ignored for reconstruction.
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { e: 'b8df77ed', k: 'bind', slot: '2' }))

    const result = file.restore()

    expect(result.warnings).toEqual([
      { reason: 'tag-unknown-keys', file: 'q2l-profile-src.cfg', line: 3, subject: 'e,k,slot' },
    ])
    // `slot=2` says nothing any more - file order does, and this is the entry's first claim.
    expect(keysOf(result.actions[0])).toEqual(['q'])
  })

  it('reports a `v` that is not a version at all', () => {
    const file = doc()
    file.comment(`  My Profile ${formatMetaTag({ v: 'banana' })}`)
    file.bind('q', 'ssg_sg', tagged('SSG'))

    const result = file.restore()

    expect(result.metadataVersion).toBeNull()
    expect(result.warnings.map((warning) => warning.reason)).toContain('metadata-version-invalid')
    expect(result.actions).toHaveLength(1)
  })

  it('reports a hand-added alias line with no tag and imports it from its plain definition', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))
    file.alias('my_macro', 'say hi; wave 1')

    const result = file.restore()

    expect(result.warnings).toEqual([
      { reason: 'tag-missing', file: 'q2l-profile-src.cfg', line: 4 },
    ])
    expect(result.actions.map((action) => action.aliasName)).toEqual(['rl', 'my_macro'])
  })

  it('maps two adjacent untagged banners to one `Main / Sub` category', () => {
    const file = doc()
    file.version()
    file.header('Main Key`s')
    file.header('1st row')
    file.bind('1', 'weapon_1', tagged('Blaster'))

    const result = file.restore()

    expect(result.categories).toEqual([{ id: 'id2', name: 'Main Key`s / 1st row' }])
    expect(result.actions[0]!.categoryId).toBe('id2')
  })

  it('mints nothing for a section no entry is filed under', () => {
    const file = doc()
    file.version()
    file.header('Mouse')
    file.cvar('sensitivity', '4.5')
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    expect(file.restore().categories).toEqual([])
  })

  it('files a tagged line that sits under no header at all in one fallback drawer, and says so', () => {
    const file = doc()
    file.version()
    file.bind('q', 'ssg_sg', tagged('SSG'))
    file.bind('e', 'rl', tagged('RL'))

    const result = file.restore()

    // One shared fallback drawer, minted after the first entry's own id.
    expect(result.categories).toEqual([{ id: 'id2', name: 'Imported' }])
    expect(result.actions.map((action) => action.categoryId)).toEqual(['id2', 'id2'])
    // The warning names the entry by what the text identified it as - the bind value, since these
    // lines have no alias line of their own.
    expect(result.warnings).toEqual([
      { reason: 'entry-section-unknown', file: 'q2l-profile-src.cfg', line: 2, subject: 'ssg_sg' },
      { reason: 'entry-section-unknown', file: 'q2l-profile-src.cfg', line: 3, subject: 'rl' },
    ])
  })
})

describe('restoreProfileParts - a file with no metadata at all', () => {
  it('produces exactly what `buildImportedActions` produces today', () => {
    // AC8 is a no-regression criterion, so the untagged path must not go through new code. Compared
    // against the 041 function directly, with an identical id factory, so a divergence cannot hide.
    const file = doc('dmalias.cfg')
    file.comment(' ----- [ Main Key`s ] -----')
    file.comment(' --- 1st row ---')
    file.alias('drop_shotgun', 'drop shotgun; say_team dropped sg; wave 1')
    file.alias('gg', 'say gg')
    file.alias('blaster_settings', '')
    file.alias('cali', 'bind KP_END drop_shotgun; bind KP_DOWNARROW gg')
    file.bind('KP_END', 'drop_shotgun')
    file.bind('c', 'cali')
    file.cvar('sensitivity', '4.5')

    const input = file.input({ newId: idFactory(), layerAliases: ['cali'] })
    const restored = restoreProfileParts(input)
    const expected = buildImportedActions({
      aliases: input.aliases.map(({ name, body, file: from, line }) => ({ name, body, file: from, line })),
      binds: Object.fromEntries(input.binds.map((bind) => [bind.key, bind.command])),
      layerAliases: ['cali'],
      newId: idFactory(),
    })

    expect(restored.actions).toEqual(expected.actions)
    expect(restored.categories).toEqual(expected.categories)
    expect(restored.layers).toEqual(expected.layers)
    expect(restored.ambiguous).toEqual(expected.ambiguous)
    expect(restored.warnings).toEqual([])
    expect(restored.metadataVersion).toBeNull()
  })

  it('still reports an ownership sentinel it found on the way past', () => {
    const file = doc('autoexec.cfg')
    file.sentinel('profile-7')
    file.alias('gg', 'say gg')

    expect(file.restore().sourceProfileId).toBe('profile-7')
  })
})
