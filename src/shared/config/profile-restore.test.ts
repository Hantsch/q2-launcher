import { describe, expect, it } from 'vitest'
import { BANNER_WIDTH, banner, fitProseAndTag } from '@shared/config/cfg-layout'
import { actionKeySlots } from '@shared/config/action-slots'
import { buildImportedActions } from '@shared/config/alias-import'
import { META_FORMAT_VERSION, formatMetaTag } from '@shared/config/profile-metadata'
import { COMMENT_LINE_BUDGET, COMMENT_PREFIX, HAND_EDIT_SENTENCE } from '@shared/config/render'
import {
  foreignBannerCommentText,
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
  bannerHeader: (profileId: string, name?: string) => void
  headerRule: () => void
  headerTag: (fields: Record<string, string>) => void
  header: (title: string, tag?: string) => void
  alias: (name: string, body: string, comment?: string, codeWidth?: number) => void
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
    /** One `=`-rule line of the header block, from `banner`'s own `fill: '='` output. */
    headerRule: (): void => self.comment(banner([''], { fill: '=' })[0]!.slice(2)),
    /** The header block's tag-only last line (story 051 D2, `render.ts#headerTagLine`): the tag
     * alone, right-aligned so its closing `]` lands on `BANNER_WIDTH`. */
    headerTag: (fields: Record<string, string>): void => {
      const tag = formatMetaTag(fields)
      self.comment(`${' '.repeat(BANNER_WIDTH - 2 - tag.length)}${tag}`)
    },
    /** The whole story-051 header block, exactly the four lines `render.ts#buildHeaderBlock`
     * writes: `=` rule, profile name, `=` rule, `[q2l v=… id=…]` tag alone on the last line. */
    bannerHeader: (profileId: string, name = 'My Profile'): void => {
      const [topRule, nameLine, bottomRule] = banner([name], { fill: '=' })
      self.comment(topRule!.slice(2))
      self.comment(nameLine!.slice(2))
      self.comment(bottomRule!.slice(2))
      self.headerTag({ v: String(META_FORMAT_VERSION), id: profileId })
    },
    /** A section banner exactly as `render.ts#titledSection` renders it, marker stripped. */
    header: (title: string, tag = ''): void =>
      self.comment(banner(fitProseAndTag(title, tag, 300))[0]!.slice(2)),
    /** `codeWidth` is what the parser measures off the raw line - omitted by every case that does
     * not care, exactly as a caller with no raw line to measure omits it. */
    alias: (name: string, body: string, comment = '', codeWidth?: number): void =>
      void aliases.push({ ...at(), name, body, comment, ...(codeWidth === undefined ? {} : { codeWidth }) }),
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
    // Their id means nothing locally, so a local one is minted - the entry follows it.
    expect(result.categories[0]!.id).not.toBe('their-cat-id')
    expect(result.actions[0]!.categoryId).toBe(result.categories[0]!.id)
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

describe('restoreProfileParts - unbound lines (story 052 D3)', () => {
  /**
   * One unbound line exactly as `render.ts#unboundLine` writes it, marker stripped the way
   * `config-parser.ts` hands a comment-only line over: the whole `bind` command commented out, then
   * the same `  // <prose> [q2l …]` trailing comment every other entry line carries.
   */
  function unbound(command: string, prose: string, fields: Record<string, string> = {}): string {
    return `bind "${command}"  //${tagged(prose, fields)}`
  }

  it('rebuilds an entry that has no line at all but its unbound one, command included', () => {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+moveleft', 'Strafe left', { cid: 'movement:moveleft' }))

    const result = file.restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        // From the section the line sits in, exactly as an anchor's category is.
        categoryId: 'movement',
        name: 'Strafe left',
        kind: 'bind',
        // The point of the whole shape: the body carries what the entry runs, so this is not the
        // `commands: []` the reverted 042 "entry anchor" came back with.
        commands: [{ kind: 'raw', text: '+moveleft' }],
        catalogId: 'movement:moveleft',
      },
    ])
    expect(keysOf(result.actions[0])).toEqual([])
  })

  it('claims the line, so it never reaches the import preview`s preserved list', () => {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+moveleft', 'Strafe left', { cid: 'movement:moveleft' }))

    // `import.ts#preservedLinesFor` subtracts exactly this list from what the dialog calls
    // "preserved" - a launcher-owned line the reader fully understood is the opposite of "we did
    // not understand this, so we kept it verbatim".
    expect(file.restore().consumedCommentLines).toContainEqual({
      file: 'q2l-profile-src.cfg',
      line: 3,
    })
  })

  it('reads `//bind ""` as an entry that genuinely has no commands', () => {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    // The shape most of `STANDARD_TEMPLATE`'s seeded rows have (story 052 D1): a real row, with a
    // name and a catalogue id, that the user has not given a command yet.
    file.comment(unbound('', 'Crouch', { cid: 'movement:crouch' }))

    const result = file.restore()

    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'movement',
        name: 'Crouch',
        kind: 'bind',
        commands: [],
        catalogId: 'movement:crouch',
      },
    ])
  })

  it('keeps two commandless rows in one category apart instead of folding them into one', () => {
    // The collapse this shape invites: keyed on what the line says - an empty bind value - every
    // seeded row of a template profile is the same key. Each unbound line gets a group of its own
    // for exactly that reason.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('', 'Crouch', { cid: 'movement:crouch' }))
    file.comment(unbound('', 'Jump', { cid: 'movement:jump' }))

    const result = file.restore()

    expect(result.actions.map((entry) => entry.name)).toEqual(['Crouch', 'Jump'])
    expect(result.actions.map((entry) => entry.catalogId)).toEqual([
      'movement:crouch',
      'movement:jump',
    ])
  })

  it('takes the entry`s own alias name off the line`s `an` field', () => {
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('weapnext', 'Next weapon', { an: 'weapnext' }))

    const result = file.restore()

    expect(result.actions[0]!.aliasName).toBe('weapnext')
    expect(result.actions[0]!.commands).toEqual([{ kind: 'raw', text: 'weapnext' }])
  })

  it('leaves a bound entry and its lines exactly as they were', () => {
    // The no-regression half: the same file carries an ordinary alias+bind entry next to the
    // unbound one, and neither reads the other's lines.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('ssg_sg', 'use super shotgun; use shotgun', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG + SG', { cid: 'weapon:ssg_sg' }))
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.comment(unbound('+attack', 'Attack', { cid: 'weapon:attack' }))

    const result = file.restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'weapons',
        name: 'SSG + SG',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'use super shotgun' },
          { kind: 'raw', text: 'use shotgun' },
        ],
        catalogId: 'weapon:ssg_sg',
        keys: [{ key: 'q' }],
        aliasName: 'ssg_sg',
      },
      {
        id: 'id2',
        categoryId: 'weapons',
        name: 'Attack',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+attack' }],
        catalogId: 'weapon:attack',
      },
    ])
  })

  it('does not let an anchor line of another entry land on an unbound one', () => {
    // An unbound entry has no key slot at all - that is why it got this line rather than an anchor -
    // so an anchor, which is nothing but a key claim, must never be matched onto it, not even when
    // the two share a `cid`. The anchor keeps its own entry instead.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+moveleft', 'Strafe left', { cid: 'movement:moveleft' }))
    file.comment(tagged('Strafe left', { cid: 'movement:moveleft', key: 'a', mod: 'ALT' }))

    const result = file.restore()

    expect(result.actions).toHaveLength(2)
    const [unboundEntry, anchored] = result.actions
    expect(unboundEntry!.commands).toEqual([{ kind: 'raw', text: '+moveleft' }])
    expect(keysOf(unboundEntry)).toEqual([])
    expect(slotsOf(anchored)).toEqual([{ key: 'a', modifier: 'ALT' }])
  })

  it('is not read as a section banner when its display name carries a banner rule', () => {
    // The claiming-order defect this predicate exists to prevent, in its `---` form: the prose of an
    // unbound line is a user-typed display name, so `scanComments`' decoration test would have taken
    // this line for an untagged banner, minted a category named after it and re-filed the line below
    // it under that category.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(unbound('+moveleft', 'Strafe --- left', { cid: 'movement:moveleft' }))
    file.comment(unbound('+moveright', 'Strafe right', { cid: 'movement:moveright' }))

    const result = file.restore()

    // Exactly one category - the `Entries: Movement` header's - and none named after the display
    // name: a second category here would be the very defect this predicate prevents.
    expect(result.categories).toEqual([
      { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
    ])
    expect(result.actions.map((entry) => entry.categoryId)).toEqual(['movement', 'movement'])
    expect(result.actions.map((entry) => entry.name)).toEqual(['Strafe --- left', 'Strafe right'])
  })

  it('leaves a hand-typed comment that merely mentions a bind alone', () => {
    // Tag presence is the whole launcher-owned signal (story 050): without a `[q2l …]` this is a
    // player's own note, and reading an entry out of it would invent a row nobody created - and
    // consume a line the import preview is supposed to show.
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(' bind "+moveleft" - maybe later')

    const result = file.restore()

    expect(result.actions).toEqual([])
    expect(result.consumedCommentLines).not.toContainEqual({
      file: 'q2l-profile-src.cfg',
      line: 3,
    })
  })

  it('keeps a `//` inside a quoted command out of the display prose', () => {
    // Read with the config tokenizer's own rules, so a `//` inside the quoted body is part of the
    // command rather than the start of the trailing comment.
    const file = doc()
    file.version()
    file.header('Entries: Other', formatMetaTag({ cat: 'chat' }))
    file.comment(unbound('say see http://q2.example', 'Site'))

    const result = file.restore()

    expect(result.actions[0]!.name).toBe('Site')
    expect(result.actions[0]!.commands).toEqual([
      { kind: 'message', channel: 'say', text: 'see http://q2.example' },
    ])
  })
})

/**
 * Story 051 D5 - the header block is a four-line banner now (`=` rule / name / `=` rule / the
 * `[q2l v=… id=…]` tag alone), so ownership rides on that tag instead of a separate sentinel line
 * and the block's decoration sits *before* the tag rather than after it. Both directions are pinned
 * here: what the new shape gives back, and that the legacy shape still gives back exactly what it
 * did.
 */
describe('restoreProfileParts - the story-051 banner header', () => {
  const file0 = 'q2l-profile-src.cfg'

  it('reads ownership off the header tag and consumes all four header lines', () => {
    const file = doc()
    file.bannerHeader('profile-9')
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    // The tag's `id` is what `import.ts` turns into `ownWrittenFile` - without it a new-shape file
    // would import as a foreign config, since no sentinel line is written any more.
    expect(result.sourceProfileId).toBe('profile-9')
    expect(result.metadataVersion).toBe(META_FORMAT_VERSION)
    expect(result.warnings).toEqual([])
    // Still reported, never adopted (AC4).
    expect(result.actions.map((action) => action.id)).not.toContain('profile-9')
    // All four header lines are understood, so `preservedLinesFor` (import.ts) subtracts every one
    // of them from the preview's `preserved` list - AC5's "none of the four appears there".
    for (const line of [1, 2, 3, 4]) {
      expect(result.consumedCommentLines).toContainEqual({ file: file0, line })
    }
    // And the name line between the two rules invented no section of its own: the file's one real
    // category is the only one minted.
    expect(result.categories.map((category) => category.name)).toEqual(['Weapons'])
  })

  it('lets the profile file`s own header outvote the loader`s sentinel', () => {
    // The real read order: `autoexec.cfg` is the entry file and carries a sentinel naming whichever
    // profile is the installation's default; the profile file it `exec`s carries the banner header.
    const loader = doc('autoexec.cfg')
    loader.sentinel('installation-default')

    const profileFile = doc('q2l-profile-p9.cfg')
    profileFile.bannerHeader('p9')
    profileFile.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    profileFile.alias('rl', 'use rocket launcher', tagged('RL'))

    const first = loader.input()
    const second = profileFile.input()
    const result = restoreProfileParts({
      aliases: [...first.aliases, ...second.aliases],
      binds: [...first.binds, ...second.binds],
      cvars: [...first.cvars, ...second.cvars],
      comments: [...first.comments, ...second.comments],
      newId: idFactory(),
    })

    expect(result.sourceProfileId).toBe('p9')
    // The loader's own sentinel is still understood, just outvoted - it must not resurface as an
    // unrecognised leftover either.
    expect(result.consumedCommentLines).toContainEqual({ file: 'autoexec.cfg', line: 1 })
  })

  it('keeps the leftovers of a header whose closing rule was hand-deleted in `preserved`', () => {
    // `=` rule / name / tag - the rule under the name is gone, so the backward walk finds prose
    // where it expects decoration and stops there rather than guessing.
    const file = doc()
    file.headerRule()
    file.comment('  My Profile')
    file.headerTag({ v: String(META_FORMAT_VERSION), id: 'profile-9' })
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    // Ownership rides on the tag line and is unaffected by the mangled decoration around it.
    expect(result.sourceProfileId).toBe('profile-9')
    expect(result.consumedCommentLines).toContainEqual({ file: file0, line: 3 })
    // The two lines the writer's shape no longer accounts for stay visible instead.
    expect(result.consumedCommentLines).not.toContainEqual({ file: file0, line: 1 })
    expect(result.consumedCommentLines).not.toContainEqual({ file: file0, line: 2 })
    // And neither of them was read as a section header: only the file's real category is minted,
    // and the entry is still filed under it.
    expect(result.categories.map((category) => category.name)).toEqual(['Weapons'])
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.categoryId).toBe('weapons')
  })

  it('keeps the name line of a header whose opening rule was hand-deleted in `preserved`', () => {
    // name / `=` rule / tag - the adjacent rule still matches and is consumed, the name line above
    // it is not: without both rules around it, nothing identifies that arbitrary prose as ours.
    const file = doc()
    file.comment('  My Profile')
    file.headerRule()
    file.headerTag({ v: String(META_FORMAT_VERSION), id: 'profile-9' })
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    expect(result.sourceProfileId).toBe('profile-9')
    expect(result.consumedCommentLines).toContainEqual({ file: file0, line: 3 })
    expect(result.consumedCommentLines).toContainEqual({ file: file0, line: 2 })
    expect(result.consumedCommentLines).not.toContainEqual({ file: file0, line: 1 })
    expect(result.categories.map((category) => category.name)).toEqual(['Weapons'])
  })

  it('still consumes the legacy header block forward from its name+tag line', () => {
    // Pre-051: `=` rule / name+tag / hand-edit sentence / `=` rule. The tag sits in the middle and
    // carries no `id`, so ownership comes from the sentinel line above the block, exactly as before.
    const file = doc()
    file.sentinel('profile-42')
    file.headerRule()
    file.version()
    file.comment(` ${HAND_EDIT_SENTENCE}`)
    file.headerRule()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    expect(result.sourceProfileId).toBe('profile-42')
    expect(result.metadataVersion).toBe(META_FORMAT_VERSION)
    for (const line of [1, 2, 3, 4, 5]) {
      expect(result.consumedCommentLines).toContainEqual({ file: file0, line })
    }
    expect(result.categories.map((category) => category.name)).toEqual(['Weapons'])
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

  // Story 053 D4: two adjacent untagged banners used to be read as two independent plain sections
  // (D3's own stopgap, since the `Main / Sub` string-fusion that read them before it went with the
  // rest of the read-only second level). Now that the model has a real second level
  // (`ConfigActionCategory.subcategories`), an untagged pair like this - a foreign author's own
  // category header, followed by two untagged banners in a decoration this writer never uses itself
  // (`-`/`=` are `BANNER_RULE`'s own, deliberately excluded - see `decorationWrap`'s doc comment) that
  // recurs at least twice - is promoted into a real category + sub-categories instead, via the
  // repeated-decoration heuristic.
  it('promotes an adjacent untagged pair into a category with real sub-categories', () => {
    const file = doc()
    file.version()
    file.header('Main Key`s')
    file.comment(' ##### 1st row #####')
    file.bind('1', 'weapon_1', tagged('Blaster'))
    file.comment(' ##### 2nd row #####')

    const result = file.restore()

    expect(result.categories).toEqual([
      {
        id: 'id1',
        name: 'Main Key`s',
        subcategories: [
          { id: 'id2', name: '1st row' },
          { id: 'id3', name: '2nd row' },
        ],
      },
    ])
    expect(result.actions[0]!.categoryId).toBe('id1')
    expect(result.actions[0]!.subcategoryId).toBe('id2')
    // No string-fused name anywhere - the two levels are structural, not concatenated prose.
    expect(result.categories.map((category) => category.name)).not.toContain('Main Key`s / 1st row')
  })

  it('does not promote a single stray decorated comment - its decoration is not repeated', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))
    file.comment(' ##### stray row #####')

    const result = file.restore()

    // The category the tag states still mints, exactly as ever; the stray decorated comment mints
    // nothing at all - it is not even a plain section, since its decoration (`#`) occurs on no other
    // line in this file.
    expect(result.categories).toEqual([
      { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
    ])
    expect(result.categories.some((category) => category.subcategories)).toBe(false)
  })

  it('leaves an existing category name containing " / " alone - no retroactive splitting', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Old Name / Sub', formatMetaTag({ cat: 'their-cat-id' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    const result = file.restore()

    // A category a colleague's earlier import already fused into one name (story 042-era behaviour,
    // or a hand-typed name) is just a category whose name happens to contain " / " - read back
    // verbatim, never guessed apart into a category + sub-category.
    expect(result.categories).toEqual([{ id: 'id2', name: 'Old Name / Sub' }])
  })

  // Story 053 D4: the motivating shape - a `dm.cfg`-style file with no `[q2l …]` tag anywhere at all
  // (a genuinely foreign config), a top-level header recognised the ordinary way (`brackets` style,
  // same as AC8's own pinned fixture), and two repeated `#####`-decorated row headers beneath it.
  // AC8's own fixture (a single `1st row` banner, decoration seen once) is deliberately left
  // untouched by this - see the "produces exactly what `buildImportedActions` produces today" test
  // above, still green - this is the case where the decoration genuinely repeats.
  it('imports a wholly foreign dm.cfg-shaped file as one category with real sub-categories', () => {
    const file = doc('dm.cfg')
    file.comment(' ----- [ Main Key`s ] -----')
    file.comment(' ##### 1st row #####')
    file.alias('drop_shotgun', 'drop shotgun; say_team dropped sg; wave 1')
    file.bind('KP_END', 'drop_shotgun')
    file.comment(' ##### 2nd row #####')
    file.alias('gg', 'say gg')
    file.bind('KP_DOWNARROW', 'gg')

    const result = file.restore()

    expect(result.categories).toHaveLength(1)
    const [category] = result.categories
    expect(category!.name).toBe('Main Key`s')
    expect(category!.name).not.toContain('/')
    expect(category!.subcategories?.map((sub) => sub.name)).toEqual(['1st row', '2nd row'])

    const dropShotgun = result.actions.find((action) => action.aliasName === 'drop_shotgun')
    const gg = result.actions.find((action) => action.aliasName === 'gg')
    expect(dropShotgun!.categoryId).toBe(category!.id)
    expect(gg!.categoryId).toBe(category!.id)
    expect(dropShotgun!.subcategoryId).toBe(category!.subcategories![0]!.id)
    expect(gg!.subcategoryId).toBe(category!.subcategories![1]!.id)
    expect(result.metadataVersion).toBeNull()
  })

  // Story 053 D4, review finding 1: the same file as the case above, but with the top-level header
  // in the decoration the story, AC6 and `dm.cfg` itself actually use - `.: Main Key`s :.`, a
  // mirrored punctuation wrap - instead of a dash-decorated banner this writer would have drawn
  // itself. That header matches neither `BANNER_RULE` nor `CATEGORY_TITLE_PREFIX`, so it opened no
  // section at all and left the `#####` markers below it with no category-shaped parent to attach to:
  // the whole file fell back to `buildImportedActions`' content guess (one `Weapons` category, no
  // sub-categories). `mirroredWrapTitle` is what recognises it now.
  it('imports a foreign file whose top-level header is a mirrored punctuation wrap', () => {
    const file = doc('dm.cfg')
    file.comment(' .: Main Key`s :.')
    file.comment(' ##### 1st row #####')
    file.alias('row1a', 'use blaster')
    file.bind('1', 'row1a')
    file.comment(' ##### 2nd row #####')
    file.alias('row2a', 'use rocket launcher')
    file.bind('q', 'row2a')

    const result = file.restore()

    expect(result.categories).toHaveLength(1)
    const [category] = result.categories
    // The decoration is stripped the way every other header's is - the name is what the file says,
    // never the drawing around it.
    expect(category!.name).toBe('Main Key`s')
    expect(category!.subcategories?.map((sub) => sub.name)).toEqual(['1st row', '2nd row'])

    const row1 = result.actions.find((action) => action.aliasName === 'row1a')
    const row2 = result.actions.find((action) => action.aliasName === 'row2a')
    expect(row1!.categoryId).toBe(category!.id)
    expect(row2!.categoryId).toBe(category!.id)
    expect(row1!.subcategoryId).toBe(category!.subcategories![0]!.id)
    expect(row2!.subcategoryId).toBe(category!.subcategories![1]!.id)
    // AC6's own words: a real second level, not a name with a slash in it.
    expect(category!.name).not.toContain('/')
  })

  // The mirrored wrap is a *recognition* rule and nothing more: it opens the same untagged `plain`
  // section a `--- Upper Row ---` banner opens, one level, no promotion, no name fusion - and, like
  // that one, mints a category only because an entry is filed under it.
  it('reads a mirrored-wrap header on its own as one plain category, no sub-categories', () => {
    const file = doc()
    file.version()
    file.comment(' <<: Upper Row :>>')
    file.bind('KP_END', 'gg', tagged('GG'))

    const result = file.restore()

    expect(result.categories.map((category) => category.name)).toEqual(['Upper Row'])
    expect(result.categories.some((category) => category.subcategories)).toBe(false)
    expect(result.actions[0]!.subcategoryId).toBeUndefined()
  })

  it('mints nothing for a section no entry is filed under', () => {
    const file = doc()
    file.version()
    file.header('Mouse')
    file.cvar('sensitivity', '4.5')
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL'))

    // The `Mouse` cvar-group banner mints nothing (no entry is filed under it); the one section that
    // does hold an entry mints exactly one category - story 052 D4, where a template id is minted
    // like any other rather than adopted invisibly.
    expect(file.restore().categories).toEqual([
      { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
    ])
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

/**
 * Story 045, D7 - the two-part entry kinds and the `wait` command kind, read back out of a
 * launcher-written file with no `k` tag to say what kind an entry is (story 050 removed it). Every
 * case here is written the way `render.ts`/`alias-render.ts` really write the family: the state
 * lines carry the entry's one display prose plus their own `lbl`, the dispatch line carries the
 * plain tag, and a bind line points at what `bindValueFor` mirrors (the dispatch for a toggle, the
 * `+` half verbatim for a pair).
 */
describe('restoreProfileParts - toggle and press/release entries (story 045)', () => {
  /** A healthy toggle family exactly as the writer emits it, dispatch bound to `v`. */
  function toggleFile(): DocBuilder {
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('zoom_s1', 'fov 30; sensitivity 1.5; alias zoom zoom_s2', tagged('Zoom', { lbl: 'In' }))
    file.alias('zoom_s2', 'fov 90; alias zoom zoom_s1', tagged('Zoom', { lbl: 'Out' }))
    file.alias('zoom', 'zoom_s1', tagged('Zoom'))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('v', 'zoom', tagged('Zoom'))
    return file
  }

  it('folds the trio into one toggle entry with both states, both labels and the dispatch key', () => {
    const result = toggleFile().restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toHaveLength(1)
    const entry = result.actions[0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.name).toBe('Zoom')
    expect(entry.aliasName).toBe('zoom')
    expect(entry.categoryId).toBe('movement')
    // `commands` stays empty for a two-part kind - `ConfigAction.parts`' own contract.
    expect(entry.commands).toEqual([])
    expect(entry.parts).toEqual([
      {
        commands: [
          { kind: 'raw', text: 'fov 30' },
          { kind: 'raw', text: 'sensitivity 1.5' },
        ],
        label: 'In',
        aliasName: 'zoom_s1',
      },
      {
        commands: [{ kind: 'raw', text: 'fov 90' }],
        label: 'Out',
        aliasName: 'zoom_s2',
      },
    ])
    expect(keysOf(entry)).toEqual(['v'])
  })

  it('keeps the state names verbatim, so an imported trio re-renders under its own names', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('zoomin', 'zoom_fov; zoom_sens; alias zoom zoomout', tagged('Zoom'))
    file.alias('zoomout', 'norm_fov; norm_sens; alias zoom zoomin', tagged('Zoom'))
    file.alias('zoom', 'zoomin', tagged('Zoom'))

    const entry = file.restore().actions[0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.parts?.map((part) => part.aliasName)).toEqual(['zoomin', 'zoomout'])
    // No `lbl` on either line, so neither part invents a label.
    expect(entry.parts?.every((part) => part.label === undefined)).toBe(true)
  })

  it('folds a chunk-split state, whose dispatch rewrite hides inside the last `_p<n>` line', () => {
    // The shape `alias-render.ts#chunkHalf` writes once a state outgrows one line: the state's own
    // body is nothing but the chunk names, and the `alias zoom zoom_s2` rewrite that identifies it
    // as a state at all sits in `zoom_s1_p2`. `entry-idioms.ts` cannot see through that on its own
    // (its own doc comment says so) - this is the case that fails if D7 hands it unfolded bodies.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('zoom_s1_p1', 'fov 30; sensitivity 1.5', tagged('Zoom'))
    file.alias('zoom_s1_p2', 'cl_gun 0; alias zoom zoom_s2', tagged('Zoom'))
    file.alias('zoom_s1', 'zoom_s1_p1; zoom_s1_p2', tagged('Zoom', { lbl: 'In' }))
    file.alias('zoom_s2', 'fov 90; cl_gun 2; alias zoom zoom_s1', tagged('Zoom', { lbl: 'Out' }))
    file.alias('zoom', 'zoom_s1', tagged('Zoom'))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('v', 'zoom', tagged('Zoom'))

    const result = file.restore()
    expect(result.actions).toHaveLength(1)
    const entry = result.actions[0]!
    expect(entry.kind).toBe('toggle')
    expect(entry.parts?.[0]).toEqual({
      commands: [
        { kind: 'raw', text: 'fov 30' },
        { kind: 'raw', text: 'sensitivity 1.5' },
        { kind: 'raw', text: 'cl_gun 0' },
      ],
      label: 'In',
      aliasName: 'zoom_s1',
    })
    expect(keysOf(entry)).toEqual(['v'])
  })

  it('falls back to plain alias entries for a cross-wired trio, with no warning of its own', () => {
    // Both states reassign the dispatch to `zoom_s1` - the hand edit the story's test plan asks for.
    // D5 rejects the whole shape (its three names are not pairwise distinct), so all three lines
    // restore as the plain entries they read as, which is what D8's `toggleCrossWired` reports on.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('zoom_s1', 'fov 30; alias zoom zoom_s1', tagged('Zoom', { lbl: 'In' }))
    file.alias('zoom_s2', 'fov 90; alias zoom zoom_s1', tagged('Zoom', { lbl: 'Out' }))
    file.alias('zoom', 'zoom_s1', tagged('Zoom'))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('v', 'zoom', tagged('Zoom'))

    const result = file.restore()
    expect(result.actions).toHaveLength(3)
    expect(result.actions.map((action) => action.aliasName)).toEqual(['zoom_s1', 'zoom_s2', 'zoom'])
    // Never half a toggle: no entry carries `parts` at all.
    expect(result.actions.some((action) => action.parts !== undefined)).toBe(false)
    // The bodies survive whole, rewrite segment included - the fallback loses nothing.
    expect(result.actions[0]!.commands).toEqual([
      { kind: 'raw', text: 'fov 30' },
      { kind: 'raw', text: 'alias zoom zoom_s1' },
    ])
    // No new restore-time warning: a body wired unusually contradicts no tag, and reporting the
    // broken shape is D8's Care job, on these very fallback entries.
    expect(result.warnings).toEqual([])
  })

  it('does not merge a trio whose lines disagree about their display prose', () => {
    // Story 050 made the comment's prose the entry's identity, and the writer puts the entry's one
    // display name on every line of its alias family. Three lines wired like a toggle but named
    // three different things are three entries, and merging them would drop two names from the file.
    const file = toggleFile()
    file.alias('other_s1', 'fov 30; alias other other_s2', tagged('State one', { lbl: 'In' }))
    file.alias('other_s2', 'fov 90; alias other other_s1', tagged('State two', { lbl: 'Out' }))
    file.alias('other', 'other_s1', tagged('Dispatch'))

    const result = file.restore()
    // The healthy trio still merges; the disagreeing one stays three plain entries.
    expect(result.actions.filter((action) => action.kind === 'toggle')).toHaveLength(1)
    expect(result.actions.filter((action) => action.aliasName?.startsWith('other'))).toHaveLength(3)
  })

  it('folds a `+x`/`-x` pair into one press/release entry keyed off the `+` half', () => {
    // `bindValueFor` mirrors a press/release entry as `+slow` verbatim, so the bind line's value
    // groups with the PRESS half's own alias name - there is no group named after the bare base.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('+slow', 'cl_forwardspeed 110; cl_sidespeed 110', tagged('Slow'))
    file.alias('-slow', 'cl_forwardspeed 200; cl_sidespeed 200', tagged('Slow'))
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('SHIFT', '+slow', tagged('Slow'))

    const result = file.restore()
    expect(result.actions).toHaveLength(1)
    const entry = result.actions[0]!
    expect(entry.kind).toBe('press-release')
    expect(entry.name).toBe('Slow')
    // The sign-free base, so `+`/`-` stay a render-time affix and the halves cannot drift (AC3).
    expect(entry.aliasName).toBe('slow')
    expect(entry.commands).toEqual([])
    expect(entry.parts).toEqual([
      {
        commands: [
          { kind: 'raw', text: 'cl_forwardspeed 110' },
          { kind: 'raw', text: 'cl_sidespeed 110' },
        ],
      },
      {
        commands: [
          { kind: 'raw', text: 'cl_forwardspeed 200' },
          { kind: 'raw', text: 'cl_sidespeed 200' },
        ],
      },
    ])
    expect(keysOf(entry)).toEqual(['SHIFT'])
    expect(result.warnings).toEqual([])
  })

  it('leaves a `+x` with no `-x` as the plain alias entry it is', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('+slow', 'cl_forwardspeed 110', tagged('Slow'))

    const entry = file.restore().actions[0]!
    expect(entry.kind).toBe('alias')
    expect(entry.aliasName).toBe('+slow')
    expect(entry.parts).toBeUndefined()
  })

  it('merges a half whose prose the line budget cut - and only at the exact cut point', () => {
    // Story-045 review round 2, finding 2. The `+` half's line records how wide its code was, so
    // this reader can reproduce what `fitProseAndTag` would have written there for the whole name
    // and compare. `Slow mo` is that cut at 7 characters of room; `Slow` and `Slow motion` are not,
    // and a rule that took any prefix would have merged all three away.
    const roomFor = (prose: string): number =>
      COMMENT_LINE_BUDGET - COMMENT_PREFIX.length + 2 - formatMetaTag({}).length - 1 - prose.length
    const pair = (prose: string, codeWidth?: number): RestoreProfilePartsResult => {
      const file = doc()
      file.version()
      file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
      file.alias('+slow', 'cl_forwardspeed 110', tagged(prose), codeWidth)
      file.alias('-slow', 'cl_forwardspeed 200', tagged('Slow motion walk'))
      return file.restore()
    }

    const merged = pair('Slow mo', roomFor('Slow mo'))
    expect(merged.actions).toHaveLength(1)
    expect(merged.actions[0]!.kind).toBe('press-release')
    // The whole name, not the cut spelling - the next render writes it back onto both lines.
    expect(merged.actions[0]!.name).toBe('Slow motion walk')

    // A prefix that is *not* what that room would have produced: two names, two entries.
    expect(pair('Slow', roomFor('Slow mo')).actions).toHaveLength(2)
    // Enough room for the whole name means nothing was cut - so `Slow mo` is a name of its own.
    expect(pair('Slow mo', roomFor('Slow motion walk')).actions).toHaveLength(2)
    // No recorded code width at all: nothing can prove a cut, and the safe answer is two entries.
    expect(pair('Slow mo').actions).toHaveLength(2)
  })

  it('does not merge two `+x`/`-x` alias entries the file names differently', () => {
    // The shape `fixtures/profiles.ts#pressReleaseAndEmptyAliasProfile` has carried since story 042:
    // two independent `kind: 'alias'` entries that happen to be named `+slow`/`-slow`. Merging them
    // would put one display name on both lines and lose the other on the next render.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('+slow', 'cl_forwardspeed 110', tagged('Slow walk'))
    file.alias('-slow', 'cl_forwardspeed 200', tagged('Slow walk (release)'))

    const result = file.restore()
    expect(result.actions).toHaveLength(2)
    expect(result.actions.map((action) => action.kind)).toEqual(['alias', 'alias'])
  })

  it('does not merge a state that claims a key of its own', () => {
    // A `bind` on a state is a shape the writer never emits (it binds the dispatch and nothing
    // else). Merging would move that key onto the dispatch value and rewrite a line the user typed.
    const file = toggleFile()
    file.bind('n', 'zoom_s1', tagged('Zoom'))

    const result = file.restore()
    expect(result.actions.some((action) => action.kind === 'toggle')).toBe(false)
    expect(result.actions).toHaveLength(3)
  })

  it('collapses a launcher-written run of literal `wait` segments back into one command', () => {
    // AC6 for the plain-alias case, nothing to do with the two new kinds: `commandLineFor` writes a
    // `{ kind: 'wait', frames: 5 }` command as five literal `wait` segments, so reading five back as
    // five raw commands would cost the entry its wait-row identity on every reload.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('hop_wait', 'wait; wait; wait; wait; wait', tagged('Hop wait'))
    file.alias('rocket_jump', '+moveup; wait; wait; +attack; wait; -attack', tagged('Rocket jump'))

    const [hop, jump] = file.restore().actions
    expect(hop!.commands).toEqual([{ kind: 'wait', frames: 5 }])
    expect(jump!.commands).toEqual([
      { kind: 'raw', text: '+moveup' },
      { kind: 'wait', frames: 2 },
      { kind: 'raw', text: '+attack' },
      { kind: 'wait', frames: 1 },
      { kind: 'raw', text: '-attack' },
    ])
  })

  it('does not resolve a `waitN` family away - the reference has to keep working', () => {
    // `entry-idioms.ts` can resolve `wait20` to a frame count, which is right for a foreign config
    // (D6) and wrong here: rewriting `wait5; wait5; wait5; wait5` as twenty literal waits would
    // silently drop four references the user's other bodies may still call, and the file would come
    // back different from the one that was read.
    const file = doc()
    file.version()
    file.header('Aliases: Movement', formatMetaTag({ cat: 'movement' }))
    file.alias('wait5', 'wait; wait; wait; wait; wait', tagged('Wait 5'))
    file.alias('wait20', 'wait5; wait5; wait5; wait5', tagged('Wait 20'))

    const [five, twenty] = file.restore().actions
    expect(five!.commands).toEqual([{ kind: 'wait', frames: 5 }])
    expect(twenty!.commands).toEqual([
      { kind: 'raw', text: 'wait5' },
      { kind: 'raw', text: 'wait5' },
      { kind: 'raw', text: 'wait5' },
      { kind: 'raw', text: 'wait5' },
    ])
  })
})

describe('foreignBannerCommentText (story 059 D5)', () => {
  it("peels dm.cfg's own double-wrapped banner and hands back a mirroredWrapTitle-shaped inner title", () => {
    const raw =
      '<<--------------------------- .: General Settings :. ----------------------------->>'
    expect(foreignBannerCommentText(raw)).toBe('.: General Settings :.')
  })

  it('recognises a marker-less repeated-decoration sub-header unchanged, same as decorationWrap', () => {
    expect(foreignBannerCommentText('      ########## 1st row ##########')).toBe(
      '########## 1st row ##########',
    )
  })

  it('recognises a plain mirrored wrap with no outer bracket layer at all', () => {
    expect(foreignBannerCommentText(' .: Main Key`s :.')).toBe('.: Main Key`s :.')
  })

  it('does not mistake an ordinary command line for a banner', () => {
    expect(foreignBannerCommentText('vid_restart')).toBeNull()
    expect(foreignBannerCommentText('echo "real DArKStar config"')).toBeNull()
    expect(foreignBannerCommentText('   ')).toBeNull()
  })

  it('rejects an asymmetric outer wrap - open and close delimiters must be real mirrors', () => {
    // `<<` mirrors to `>>`, never to itself - a line closing with the wrong bracket is not this
    // writer's own decoration, so peeling must not silently accept it.
    expect(foreignBannerCommentText('<<--- .: Title :. ---<<')).toBeNull()
  })
})

/**
 * Story 059 D5: the same wiring `import.ts#mergeForeignBannerComments` does - a marker-less banner
 * line recognised by `foreignBannerCommentText` and merged into `comments` - reproduced directly at
 * this layer, so the cvar-section attribution this deliverable is actually about is pinned against
 * `restoreProfileParts` itself, not only against the end-to-end importer.
 */
describe('restoreProfileParts - cvar sections from a marker-less foreign banner (story 059 D5)', () => {
  it('files cvars under a banner drawn with no `//` marker at all, once its text is recognised', () => {
    const file = doc('dm.cfg')
    const banner = foreignBannerCommentText(
      '<<--------------------------- .: General Settings :. ----------------------------->>',
    )!
    file.comment(banner)
    file.cvar('hostname', '"DArKStar\'s Server"')
    file.cvar('cl_blend', '"0"')
    file.comment(
      foreignBannerCommentText(
        '<<--------------------------- .: Grafik Settings :. ----------------------------->>',
      )!,
    )
    file.cvar('gl_picmip', '"10"')

    const result = file.restore()

    expect(result.cvarSections.map((section) => section.name)).toEqual([
      'General Settings',
      'Grafik Settings',
    ])
    const general = result.cvarSections.find((section) => section.name === 'General Settings')!
    expect([...general.cvars].sort()).toEqual(['cl_blend', 'hostname'])
    const grafik = result.cvarSections.find((section) => section.name === 'Grafik Settings')!
    expect(grafik.cvars).toEqual(['gl_picmip'])
  })

  it('leaves every cvar unplaced when the file has no recognisable banner at all', () => {
    const file = doc('gfx.cfg')
    file.comment('\t[GRAFIK SETTINGS]') // gfx.cfg's own real, unrecognised comment
    file.cvar('gl_jpg_quality', '"85"')
    file.cvar('cl_maxfps', '"120"')

    const result = file.restore()

    expect(result.cvarSections).toEqual([])
  })

  /**
   * Story 059 review Fix 4: 053 D4's repeated-decoration sub-header heuristic
   * (`heuristicSubcategoryParent`) already promotes a `#####`-style marker-less sub-banner into a
   * real `Section.kind: 'subcategory'` for the BIND side (`applyForeignSubcategoryHeuristic`'s own
   * test above, "promotes an adjacent untagged pair into a category with real sub-categories"), but
   * `cvarSectionKeyFor` had no branch for that kind at all, so a `set` line under the very same
   * sub-banner fell through to `null` and read back unplaced. A top-level `set`-bearing banner
   * followed by a `#####`-style sub-banner that ALSO has `set` lines under it is exactly the case
   * that was silently dropping cvars.
   */
  it('files cvars under a repeated-decoration sub-banner exactly as the bind side already does', () => {
    const file = doc('dm.cfg')
    file.comment(
      foreignBannerCommentText(
        '<<--------------------------- .: General Settings :. ----------------------------->>',
      )!,
    )
    file.cvar('hostname', '"DArKStar\'s Server"')
    file.comment(' ##### 1st row #####')
    file.cvar('cl_blend', '"0"')
    file.comment(' ##### 2nd row #####')
    file.cvar('cl_vwep', '"1"')

    const result = file.restore()

    expect(result.cvarSections.map((section) => section.name)).toEqual(['General Settings'])
    const general = result.cvarSections[0]!
    // The ungrouped run under the top-level banner keeps only what sits directly under it.
    expect(general.cvars).toEqual(['hostname'])
    expect(general.subsections?.map((sub) => sub.name)).toEqual(['1st row', '2nd row'])
    expect(general.subsections![0]!.cvars).toEqual(['cl_blend'])
    expect(general.subsections![1]!.cvars).toEqual(['cl_vwep'])
  })
})
