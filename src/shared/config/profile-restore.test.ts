import { describe, expect, it } from 'vitest'
import { banner, fitProseAndTag } from '@shared/config/cfg-layout'
import { buildImportedActions } from '@shared/config/alias-import'
import { META_FORMAT_VERSION, formatMetaTag } from '@shared/config/profile-metadata'
import { entryRefFor } from '@shared/config/render'
import {
  restoreProfileParts,
  type RestoreProfilePartsInput,
  type RestoreProfilePartsResult,
} from '@shared/config/profile-restore'

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

/** The trailing comment of a line the writer tagged: prose, then the tag, after one space. */
function tagged(prose: string, fields: Record<string, string | undefined>): string {
  const tag = formatMetaTag(fields)
  return prose.length > 0 ? ` ${prose} ${tag}` : ` ${tag}`
}

const REF_A = entryRefFor('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')
const REF_B = entryRefFor('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb')

describe('restoreProfileParts - what a launcher-written file gives back', () => {
  it('recovers name, kind, catalogue id, own alias name, both key slots and command order', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias(
      'ssg_sg',
      'use super shotgun; use shotgun',
      tagged('SSG + SG', { e: REF_A, k: 'bind', cid: 'weapon:ssg_sg' }),
    )
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG + SG', { e: REF_A, k: 'bind', slot: '1' }))
    file.bind('MOUSE2', 'ssg_sg', tagged('SSG + SG', { e: REF_A, k: 'bind', slot: '2' }))

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
      key: 'q',
      secondaryKey: 'MOUSE2',
      aliasName: 'ssg_sg',
    })
    expect(result.categories).toEqual([])
  })

  it('pairs the two slots of one entry by their shared `e`, never by adjacency', () => {
    const file = doc()
    file.version()
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('a', 'left_strafe', tagged('Strafe left', { e: REF_A, k: 'bind', slot: '1' }))
    file.bind('d', 'right_strafe', tagged('Strafe right', { e: REF_B, k: 'bind', slot: '1' }))
    file.bind('KP_LEFTARROW', 'left_strafe', tagged('Strafe left', { e: REF_A, k: 'bind', slot: '2' }))

    const result = file.restore()
    const left = result.actions.find((action) => action.name === 'Strafe left')!
    const right = result.actions.find((action) => action.name === 'Strafe right')!

    expect(left.key).toBe('a')
    expect(left.secondaryKey).toBe('KP_LEFTARROW')
    expect(right.key).toBe('d')
    expect(right.secondaryKey).toBeUndefined()
  })

  it('reads a slot modifier off that slot`s own `mod` field', () => {
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('r', 'rl', tagged('Rocket', { e: REF_A, k: 'bind', slot: '1', mod: 'ALT' }))
    file.bind('t', 'rl', tagged('Rocket', { e: REF_A, k: 'bind', slot: '2', mod: 'CTRL' }))

    const [action] = file.restore().actions

    expect(action!.keyModifier).toBe('ALT')
    expect(action!.secondaryKeyModifier).toBe('CTRL')
  })

  it('mints one local category per unknown `cat` id, named from the header title', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Fun stuff', formatMetaTag({ cat: 'e7c1-remote-id' }))
    file.alias('gg', 'say gg', tagged('GG', { e: REF_A, k: 'message' }))
    file.header('Binds: Fun stuff', formatMetaTag({ cat: 'e7c1-remote-id' }))
    file.bind('F1', 'gg', tagged('GG', { e: REF_A, k: 'message', slot: '1' }))

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
    file.alias('blaster_settings', '', tagged('Blaster setup', { e: REF_A, k: 'alias' }))

    const [action] = file.restore().actions

    expect(action!.kind).toBe('alias')
    expect(action!.keepEmptyAlias).toBe(true)
    expect(action!.commands).toEqual([])
  })

  it('recombines a chunk-split alias family into one entry, in body order', () => {
    const file = doc()
    file.version()
    file.header('Aliases: Drops', formatMetaTag({ cat: 'drops' }))
    const tag = tagged('Drop it all', { e: REF_A, k: 'alias' })
    file.alias('drop_all_p1', 'drop rl; drop rg', tag)
    file.alias('drop_all_p2', 'drop bfg', tag)
    file.alias('drop_all', 'drop_all_p1; drop_all_p2', tag)

    const [action] = file.restore().actions

    expect(action!.aliasName).toBe('drop_all')
    expect(action!.commands.map((command) => (command.kind === 'raw' ? command.text : ''))).toEqual([
      'drop rl',
      'drop rg',
      'drop bfg',
    ])
  })

  it('rebuilds an entry whose alias line the writer dropped from its bind line alone', () => {
    // A continuous catalogue row (`+forward`) is bound to its own command, so `render.ts` emits no
    // alias line for it at all - the bind line is the only record there is.
    const file = doc()
    file.version()
    file.header('Binds: Movement', formatMetaTag({ cat: 'movement' }))
    file.bind('w', '+forward', tagged('Move forward', { e: REF_A, k: 'bind', cid: '+forward', slot: '1' }))

    const [action] = file.restore().actions

    expect(action).toEqual({
      id: 'id1',
      categoryId: 'movement',
      name: 'Move forward',
      kind: 'bind',
      commands: [{ kind: 'raw', text: '+forward' }],
      catalogId: '+forward',
      key: 'w',
    })
    // No `aliasName`: `bindValueFor` already produces `+forward` for a continuous catalogue row, so
    // pinning one would resurrect an `alias +forward +forward` line the file never had.
    expect(action!.aliasName).toBeUndefined()
  })

  it('adopts the bind value as the own alias name of a self-mirroring entry', () => {
    const file = doc()
    file.version()
    file.header('Binds: Other', '')
    file.bind('MWHEELUP', 'weapnext', tagged('Next weapon', { e: REF_A, k: 'bind', slot: '1' }))

    const [action] = file.restore().actions

    expect(action!.aliasName).toBe('weapnext')
    expect(action!.commands).toEqual([{ kind: 'raw', text: 'weapnext' }])
  })

  it('reports the file`s profile id without ever adopting it', () => {
    const file = doc()
    file.sentinel('profile-42')
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('rl', 'use rocket launcher', tagged('RL', { e: REF_A, k: 'bind' }))

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
    // The layer's own alias and bind lines carry no `e`, so they never become entries.
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

  it('hands a modifier layer`s override back to its entry as a modified key slot', () => {
    // Story 016: `Alt+R` is not a bind line anywhere - it is an override in the ALT layer, keyed by
    // the entry's own mirrored value. There is no per-override tag to read it off, so this is the
    // only path back to `keyModifier`.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher; say_team quad up', tagged('Quad RL', { e: REF_A, k: 'bind' }))
    file.header('Layer: Alt (hold, on ALT)', formatMetaTag({ layer: 'remote-alt', mode: 'hold', trigger: 'ALT' }))
    file.alias('+alt', 'bind r quad_rl', ' Alt')
    file.alias('-alt', 'unbind r', ' Alt')
    file.bind('ALT', '+alt', ' Alt')

    const result = file.restore()
    const [action] = result.actions

    expect(action!.key).toBe('r')
    expect(action!.keyModifier).toBe('ALT')
    // The layer keeps the override: it is a derived mirror of exactly that slot, and the next save
    // would write it back identically.
    expect(result.layers[0]!.overrides).toEqual({ r: 'quad_rl' })
    expect(result.warnings).toEqual([])
  })
})

describe('restoreProfileParts - anchor lines (story 042 review fix)', () => {
  /** The file `render.ts` writes for an entry bound only through a modifier: an anchor line under
   * its own category section, and the ALT layer that actually carries the binding. */
  function anchoredFile(): ReturnType<typeof doc> {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(
      tagged('Forward', { e: REF_A, k: 'bind', cid: 'forward', slot: '1', mod: 'ALT', key: 'w' }),
    )
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
        key: 'w',
        keyModifier: 'ALT',
      },
    ])
    // The override stays on the layer: it is a derived mirror of that same slot.
    expect(result.layers[0]!.overrides).toEqual({ w: '+forward' })
  })

  it('does not hand the same override to the entry`s second slot as well', () => {
    const [action] = anchoredFile().restore().actions

    expect(action!.secondaryKey).toBeUndefined()
    expect(action!.secondaryKeyModifier).toBeUndefined()
  })

  it('takes the own alias name off an anchor`s `an` field when no alias line carries it (round 2, NEW-3)', () => {
    const file = doc()
    file.version()
    file.header('Entries: Weapons', formatMetaTag({ cat: 'weapons' }))
    // The self-mirroring shape story 039 drops the alias line for: nothing in the file spells
    // `weapnext` as code, so the tag is the only place the entry's own alias name can live.
    file.comment(
      tagged('Next weapon', { e: REF_A, k: 'bind', an: 'weapnext', slot: '1', mod: 'ALT', key: 'MWHEELUP' }),
    )
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
        key: 'MWHEELUP',
        keyModifier: 'ALT',
        aliasName: 'weapnext',
      },
    ])
  })

  // Reader tolerance only, not a writer contract: `render.ts#buildAnchorLines` stopped emitting a
  // slot-less *entry* anchor in the story's third review round (an entry restored from one comes
  // back with `commands: []`, which `catalog-binds.ts#applySlot` then reuses as the base for the next
  // bind of the same catalogue row - a key pointing at an alias nothing defines). Such a line can
  // still reach this module from a hand-edited or older file, and reading it is strictly better than
  // choking on it, so the behaviour stays pinned here.
  it('still reads a slot-less anchor out of a hand-edited file, though the writer emits none', () => {
    const file = doc()
    file.version()
    file.header('Entries: Movement', formatMetaTag({ cat: 'movement' }))
    file.comment(tagged('Strafe left', { e: REF_A, k: 'bind', cid: 'moveleft' }))

    const result = file.restore()

    expect(result.warnings).toEqual([])
    expect(result.actions).toEqual([
      {
        id: 'id1',
        categoryId: 'movement',
        name: 'Strafe left',
        kind: 'bind',
        // No key, no alias line and no layer override: the identity comes back, the command has
        // nowhere in the file to come back from (`catalogId` is what still names the row).
        commands: [],
        catalogId: 'moveleft',
      },
    ])
  })

  it('ignores an `e` on a section header or on the version marker', () => {
    const file = doc()
    file.version()
    // A hand-edited `e` on a *section* header is not an entry anchor.
    file.header('Binds: Weapons', formatMetaTag({ e: REF_B, cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { e: REF_A, k: 'bind', slot: '1' }))

    const result = file.restore()

    expect(result.actions.map((entry) => entry.name)).toEqual(['SSG'])
  })
})

describe('restoreProfileParts - the config line wins', () => {
  it('refuses a `k=alias` tag on an entry a bind line points a key at, and names the line', () => {
    // The hand-edit the story spells out: the tag still claims an alias entry, the alias line it
    // described is gone. An alias entry is never bound, so the bind line is the truth.
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG + SG', { e: REF_A, k: 'alias', slot: '1' }))

    const result = file.restore()

    expect(result.actions[0]!.kind).toBe('bind')
    expect(result.actions[0]!.commands).toEqual([{ kind: 'raw', text: 'ssg_sg' }])
    expect(result.warnings).toEqual([
      { reason: 'tag-kind-contradicted', file: 'q2l-profile-src.cfg', line: 3, subject: 'alias' },
    ])
  })

  it('reports every later line claiming a slot the first one already holds, and keeps the first', () => {
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { e: REF_A, k: 'bind', slot: '1' }))
    file.bind('e', 'ssg_sg', tagged('SSG', { e: REF_A, k: 'bind', slot: '1' }))
    file.bind('r', 'ssg_sg', tagged('SSG', { e: REF_A, k: 'bind', slot: '1' }))

    const result = file.restore()

    expect(result.actions[0]!.key).toBe('q')
    // Story-042-review finding 2 (fix-cycle-5 continuation): a line that names an already-taken slot
    // is a genuine conflict and must be dropped, never silently re-homed into the *other* (secondary)
    // slot - that would quietly turn a conflicting claim into a real key assignment nothing in the
    // file actually asked for. Both `e` and `r` claimed slot 1 after `q` already held it, so both are
    // reported and dropped; `secondaryKey` stays unset.
    expect(result.actions[0]!.secondaryKey).toBeUndefined()
    expect(result.warnings).toEqual([
      { reason: 'tag-slot-conflict', file: 'q2l-profile-src.cfg', line: 4, subject: 'e' },
      { reason: 'tag-slot-conflict', file: 'q2l-profile-src.cfg', line: 5, subject: 'r' },
    ])
  })

  it('names the layer section when a modifier override finds both of an entry`s slots taken', () => {
    // Both slots are already claimed by real bind lines, so the ALT layer's own override for the
    // same entry has nowhere to go. The warning has to carry a real locator (the layer section it
    // came from) - `ImportProfileDialog` renders `file:line` per warning, and a `('':0)` reads as
    // "(:0)" there.
    const file = doc()
    file.version()
    file.header('Aliases: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.alias('quad_rl', 'use rocket launcher', tagged('Quad RL', { e: REF_A, k: 'bind' }))
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'quad_rl', tagged('Quad RL', { e: REF_A, k: 'bind', slot: '1' }))
    file.bind('e', 'quad_rl', tagged('Quad RL', { e: REF_A, k: 'bind', slot: '2' }))
    file.header('Layer: Alt (hold, on ALT)', formatMetaTag({ layer: 'l-alt', mode: 'hold', trigger: 'ALT' }))
    file.alias('+alt', 'bind r quad_rl', ' Alt')
    file.alias('-alt', 'unbind r', ' Alt')
    file.bind('ALT', '+alt', ' Alt')

    const result = file.restore()

    expect(result.warnings).toEqual([
      {
        reason: 'modifier-slot-unavailable',
        file: 'q2l-profile-src.cfg',
        line: 7,
        subject: 'r',
      },
    ])
    // The two real bind lines keep their slots - the override is reported, never forced in.
    expect(result.actions[0]!.key).toBe('q')
    expect(result.actions[0]!.secondaryKey).toBe('e')
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

describe('restoreProfileParts - hand-edited and unknown metadata', () => {
  it('reports a mangled tag, loses only that line`s entry, and keeps the rest', () => {
    const file = doc()
    file.version()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    // Truncated mid-tag, exactly as a hand-edit leaves it: no closing bracket.
    file.bind('q', 'ssg_sg', ' SSG + SG [q2l e=')
    file.bind('MOUSE2', 'ssg_sg', tagged('SSG + SG', { e: REF_A, k: 'bind', slot: '2' }))

    const result = file.restore()

    expect(result.warnings).toEqual([
      { reason: 'tag-malformed', file: 'q2l-profile-src.cfg', line: 3 },
    ])
    // The surviving line still rebuilds its entry, in the slot its own tag names (slot 2 stays slot
    // 2 - the file says so, and the line whose tag is gone is in no position to contradict it); the
    // mangled line's bind is not turned into a second, invented entry, it stays a plain bind
    // (`profile.binds` is imported from the parsed lines directly, so nothing about it is lost).
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]!.secondaryKey).toBe('MOUSE2')
    expect(result.actions[0]!.key).toBeUndefined()
  })

  it('reports a hand-deleted version marker but still reads the tags that are left', () => {
    const file = doc()
    file.header('Binds: Weapons', formatMetaTag({ cat: 'weapons' }))
    file.bind('q', 'ssg_sg', tagged('SSG', { e: REF_A, k: 'bind', slot: '1' }))

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
    file.bind('q', 'ssg_sg', tagged('SSG', { e: REF_A, k: 'bind', slot: '1', wobble: 'yes' }))

    const result = file.restore()

    expect(result.metadataVersion).toBe(META_FORMAT_VERSION + 1)
    expect(result.warnings.map((warning) => warning.reason)).toEqual([
      'metadata-version-newer',
      'tag-unknown-keys',
    ])
    expect(result.warnings[1]!.subject).toBe('wobble')
    // Everything the registry does know still came back.
    expect(result.actions[0]).toMatchObject({ name: 'SSG', kind: 'bind', key: 'q' })
  })

  it('reports a `v` that is not a version at all', () => {
    const file = doc()
    file.comment(`  My Profile ${formatMetaTag({ v: 'banana' })}`)
    file.bind('q', 'ssg_sg', tagged('SSG', { e: REF_A, k: 'bind', slot: '1' }))

    const result = file.restore()

    expect(result.metadataVersion).toBeNull()
    expect(result.warnings.map((warning) => warning.reason)).toContain('metadata-version-invalid')
    expect(result.actions).toHaveLength(1)
  })

  it('maps two adjacent untagged banners to one `Main / Sub` category', () => {
    const file = doc()
    file.version()
    file.header('Main Key`s')
    file.header('1st row')
    file.bind('1', 'weapon_1', tagged('Blaster', { e: REF_A, k: 'bind', slot: '1' }))

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
    file.alias('rl', 'use rocket launcher', tagged('RL', { e: REF_A, k: 'bind' }))

    expect(file.restore().categories).toEqual([])
  })

  it('files a tagged line that sits under no header at all in one fallback drawer, and says so', () => {
    const file = doc()
    file.version()
    file.bind('q', 'ssg_sg', tagged('SSG', { e: REF_A, k: 'bind', slot: '1' }))
    file.bind('e', 'rl', tagged('RL', { e: REF_B, k: 'bind', slot: '1' }))

    const result = file.restore()

    // One shared fallback drawer, minted after the first entry's own id.
    expect(result.categories).toEqual([{ id: 'id2', name: 'Imported' }])
    expect(result.actions.map((action) => action.categoryId)).toEqual(['id2', 'id2'])
    expect(result.warnings.map((warning) => warning.reason)).toEqual([
      'entry-section-unknown',
      'entry-section-unknown',
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
