import { describe, expect, it } from 'vitest'
import type {
  ActionKeySlot,
  ConfigAction,
  ConfigActionCategory,
  ConfigProfile,
} from '@shared/modules/config'
import { STANDARD_TEMPLATE, TEMPLATE_ACTION_CATEGORIES } from '@shared/modules/config'
import type { AltLayer } from '@shared/config/alt-layers'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { keySlotAt } from '@shared/config/action-slots'
import { ROUND_TRIP_FIXTURES } from '@shared/config/fixtures/profiles'
import { aliasNameFor, renderActionAliasLines } from '@shared/config/alias-render'
import { ALL_CVARS } from '@shared/config/cvar-catalog'
import { parseMetaTag } from '@shared/config/profile-metadata'
import { effectiveSize } from '@shared/config/engine-limits'
import type { SwitchBindChainInput } from './switch-bind'
import { renderSwitchBindChain } from './switch-bind'
import {
  OWNERSHIP_MARKER,
  STRICTEST_LINE_BUDGET,
  profileFileName,
  renderLoaderFile,
  renderProfileFile,
  sentinelLine,
} from './render'

/**
 * The three template categories as `STANDARD_TEMPLATE` seeds them (`{ id, name, nameKey }`).
 *
 * Story 052 D4: the file's category sections are `profile.categories`, in that array's order, and
 * nothing else - the three former built-ins are no longer prepended by the writer. So a test profile
 * whose actions sit in `movement`/`weapons`/`drops` has to *carry* those categories, exactly as a
 * template-seeded profile does; without them its entries are uncategorised and land in the trailing
 * "Other" bucket (which is what several tests below now deliberately check).
 */
const TEMPLATE_CATEGORIES: ConfigActionCategory[] = TEMPLATE_ACTION_CATEGORIES.map((category) => ({
  id: category.id,
  name: category.label,
  nameKey: category.labelKey,
}))

/**
 * Story 059 D2: the writer's cvar sections now come from `profile.cvarSections`, not from
 * `CvarDef.group`/`CVAR_GROUP_ORDER` directly - a test profile that carries no sections of its own
 * would put every catalogue cvar into the reserved `Defaults` bucket instead of the four
 * Player/Network/Graphics/Sound sections this file's literals below pin. Seeding the default
 * `profile()` with `STANDARD_TEMPLATE.cvarSections` (which places every `ALL_CVARS` name across
 * those same four sections) keeps every pre-059 assertion in this file byte-identical, exactly the
 * same rebaselining `TEMPLATE_CATEGORIES` above did for story 052's category change.
 */
function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'test-id',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    categories: TEMPLATE_CATEGORIES,
    cvarSections: STANDARD_TEMPLATE.cvarSections.map((section) => ({ ...section })),
    ...overrides,
  }
}

/** Story 008: mirrors `alias-render.test.ts`'s own `action()` helper. */
function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
  return {
    id: 'ab12cd34-0000-0000-0000-000000000000',
    categoryId: 'weapons',
    name: 'Drop RL',
    kind: 'bind',
    commands: [{ kind: 'raw', text: 'drop rl' }],
    ...overrides,
  }
}

/**
 * The four-line header block story 051 D2 now emits unconditionally, for the default `profile()`
 * name ("Test") - every exact-match test in this file that predates D2 has to grow this block,
 * since it appears even for a profile with no cvars/binds at all, and it is now the *whole* header
 * (`renderProfileFile` no longer prepends `sentinelLine()` in front of it). Built once here as a
 * function of `id` (rather than hand-counted inline) so the fill width and the right-aligned tag's
 * padding can't silently drift between the tests that need them; still a literal computation, not a
 * call into `render.ts`'s own `banner()`/`headerTagLine()` - the point is to pin the real output,
 * not to test the implementation against itself.
 *
 * Story 051 moved ownership (the profile id) into this block's own tag, alongside the metadata
 * format's `v` marker - both now live on the same right-aligned fourth line, and nowhere else in a
 * rendered file (see the `sentinelLine` block at the bottom of this file for the *loader*'s own,
 * unchanged sentinel).
 */
function testProfileHeader(id: string): string[] {
  const tag = `[q2l v=1 id=${id}]`
  const rule = '// ============================================================================='
  return [rule, '//  Test', rule, `//${' '.repeat(rule.length - 2 - tag.length)}${tag}`]
}

/** Builds an action's `keys` array from a sparse list of slots - `undefined` entries are skipped,
 * so a caller can express "no primary slot, only a secondary one" as `keySlots(undefined, slot)`.
 * Same helper `action-mirror.test.ts` uses since story 050 D3. */
function keySlots(...slots: (ActionKeySlot | undefined)[]): ActionKeySlot[] {
  return slots.filter((slot): slot is ActionKeySlot => slot !== undefined)
}

/**
 * The `[q2l ...]` tag story 042 D2 attaches to one entry's generated line, as story 050 D6 cut it
 * down: `cid` when the entry is catalogue-backed, an anchor line's own `key`/`mod`/`an` where it
 * has them, and *nothing at all* otherwise - a fieldless entry line still carries the bare `[q2l]`
 * marker, which is what tells a generated line from a hand-typed one on read-back.
 *
 * Spelled out here as plain string building (never by calling into `profile-metadata.ts`) so a
 * change to the emitted field order or to the marker's spelling fails these assertions instead of
 * agreeing with the renderer by construction. Field order mirrors `KNOWN_META_KEYS`.
 */
function entryTag(
  fields: { cid?: string; an?: string; key?: string; mod?: string; lbl?: string } = {},
): string {
  const parts: string[] = []
  if (fields.cid !== undefined) parts.push(`cid=${fields.cid}`)
  if (fields.an !== undefined) parts.push(`an=${fields.an}`)
  if (fields.key !== undefined) parts.push(`key=${fields.key}`)
  if (fields.mod !== undefined) parts.push(`mod=${fields.mod}`)
  if (fields.lbl !== undefined) parts.push(`lbl=${fields.lbl}`)
  return parts.length > 0 ? `[q2l ${parts.join(' ')}]` : '[q2l]'
}

/**
 * Story 040 D4: `writeUnbindall` defaults to on, so `default `profile()`'s missing value renders
 * this line unconditionally too - same rebaselining reason `TEST_PROFILE_HEADER` documents for D2,
 * one line down from it since it is its own block (blank-line separated by `joinBlocks`).
 */
const TEST_PROFILE_UNBINDALL = ['', 'unbindall']

/**
 * Story 048 D2: a rendered file now carries a `set` line for *every* cvar in `ALL_CVARS`, not only
 * the ones the profile stored a value for - so this block appears in every rendered file, exactly
 * like `TEST_PROFILE_HEADER` and `TEST_PROFILE_UNBINDALL` do, and every exact-match test in this
 * file that predates D2 has to grow it.
 *
 * Spelled out as a literal rather than derived from `ALL_CVARS`: this is the byte-exact anchor for
 * the whole cvar block - the group order, the group banners, the catalog ordering inside a group,
 * the per-section name-column alignment (which now has to hold with *every* cvar present, not just
 * a sparse subset) and each cvar's catalogue default. Deriving it from the catalogue would make it
 * agree with the renderer by construction. Completeness is pinned separately, against `ALL_CVARS`
 * itself, by the "writes a line for every catalogue cvar" test further down - so a cvar added to the
 * catalogue fails there even though this literal knows nothing about it.
 */
const TEST_PROFILE_CVAR_DEFAULTS = [
  '',
  '// --- Player [q2l cvs=player] -------------------------------------------------',
  'set name        "player"',
  'set skin        "male/grunt"',
  'set fov         "100"',
  'set sensitivity "4"',
  'set m_pitch     "0.022"',
  'set freelook    "1"',
  'set cl_run      "1"',
  'set hand        "2"',
  'set crosshair   "1"',
  'set ch_scale    "1"',
  'set msg         "0"',
  '',
  '// --- Network [q2l cvs=network] -----------------------------------------------',
  'set rate      "25000"',
  'set cl_maxfps "125"',
  'set cl_async  "1"',
  '',
  '// --- Graphics [q2l cvs=graphics] ---------------------------------------------',
  'set vid_fullscreen  "1"',
  'set vid_gamma       "0.8"',
  'set gl_modulate     "2"',
  'set gl_picmip       "0"',
  'set gl_texturemode  "GL_LINEAR_MIPMAP_LINEAR"',
  'set cl_gun          "0"',
  'set cl_blend        "0"',
  'set gl_polyblend    "0"',
  'set gl_shadows      "0"',
  'set gl_dynamic      "0"',
  'set gl_swapinterval "0"',
  'set cl_noskins      "0"',
  'set r_maxfps        "125"',
  'set con_alpha       "1"',
  '',
  '// --- Sound [q2l cvs=sound] ---------------------------------------------------',
  'set s_volume "0.7"',
  'set s_khz    "44"',
]

/** The four cvar group banners `TEST_PROFILE_CVAR_DEFAULTS` carries, as `banners()` reports them -
 * every rendered file has all four now, since no group can be empty once every catalogue cvar is
 * written. Story 059 D2: each now carries its own `cvs=<id>` tag, since `profile()`'s default
 * `cvarSections` (`STANDARD_TEMPLATE.cvarSections`) makes these four real, profile-owned sections
 * rather than the old untagged catalogue groups. */
const CVAR_GROUP_BANNERS = [
  'Player [q2l cvs=player]',
  'Network [q2l cvs=network]',
  'Graphics [q2l cvs=graphics]',
  'Sound [q2l cvs=sound]',
]

/**
 * `TEST_PROFILE_CVAR_DEFAULTS` with the given cvars carrying a stored value instead of their
 * catalogue default.
 *
 * A key is matched against the block case-insensitively (the renderer resolves stored keys through
 * `findCvar`, which does the same) and the line is rewritten under the *stored* spelling, keeping
 * the section's existing name-column padding - which stays correct because only the casing can
 * differ, never the length. Throws rather than silently doing nothing for a name the block has no
 * line for, so a typo in a test cannot quietly assert against the defaults.
 */
function cvarBlock(overrides: Record<string, string> = {}): string[] {
  const lines = [...TEST_PROFILE_CVAR_DEFAULTS]
  for (const [name, value] of Object.entries(overrides)) {
    const index = lines.findIndex((line) =>
      line.toLowerCase().startsWith(`set ${name.toLowerCase()} `),
    )
    if (index === -1) throw new Error(`no catalogue cvar line for "${name}"`)
    const padding = /^ +/.exec(lines[index]!.slice(`set ${name}`.length))![0]
    lines[index] = `set ${name}${padding}"${value}"`
  }
  return lines
}

/**
 * One rendered bind/alias line stripped back to the bare command it was before story 040 D3
 * aligned it and hung a `// <label>` off it: the trailing comment removed, and the multi-space
 * column padding collapsed back to the single space the old flat dump used.
 *
 * Exists so the assertions that are about *content* (this alias line, in this order, with this
 * body - the thing that actually executes) can keep being written against `generateLayerAliases`'
 * and `renderActionAlias`' own output instead of against a hand-copied literal that happens to
 * carry today's column widths. The assertions that are about the *layout* pin the padded lines
 * verbatim instead; both kinds appear below, deliberately.
 *
 * Safe as a whitespace collapse for exactly these lines: every generated body has been through
 * `sanitizeCommand`, which collapses runs of whitespace, so no two-space run inside a body can be
 * destroyed by this.
 */
function unformat(line: string): string {
  return line.replace(/\s{2,}\/\/ .*$/, '').replace(/\s{2,}/g, ' ')
}

/** Every `set <name> <value>` line of a rendered file, in file order. */
function setLines(rendered: string): string[] {
  return rendered.split('\n').filter((line) => line.startsWith('set '))
}

/** The cvar name a `set` line writes - the token between `set ` and the aligned value column. */
function setName(line: string): string {
  return line.slice('set '.length).trimEnd().split(' ')[0]!
}

describe('renderProfileFile', () => {
  it('renders the header block, then cvars grouped by catalog order, then the unowned binds', () => {
    const p = profile({
      id: 'abc123',
      cvars: { sensitivity: '3', cl_run: '0', crosshair: '0' },
      binds: { UPARROW: '+forward', c: '+movedown', SHIFT: '+speed' },
    })

    expect(renderProfileFile(p)).toBe(
      [
        ...testProfileHeader('abc123'),
        ...TEST_PROFILE_UNBINDALL,
        // Catalog order (ALL_CVARS index), not alphabetical: sensitivity, then cl_run, then
        // crosshair - alphabetical would be cl_run/crosshair/sensitivity, a different order,
        // so this also pins that the sort key really is the catalog, not the key string. Since
        // story 048 D2 the three stored values sit among every *other* catalogue cvar too, each
        // at its default - the file states the whole configuration, not just the deviations.
        ...cvarBlock({ sensitivity: '3', cl_run: '0', crosshair: '0' }),
        '',
        // Story 040 D3: this profile has no actions at all, so no bind here has an owning entry
        // and every one of them lands in the "other binds" section - written, not dropped, and
        // sorted by normalized key (uppercase key names before the single-character `c`). No
        // trailing comment: the file has no display name for a bind nothing in the profile owns.
        '// --- Other binds -------------------------------------------------------------',
        'bind SHIFT   "+speed"',
        'bind UPARROW "+forward"',
        'bind c       "+movedown"',
        '',
      ].join('\n'),
    )
  })

  /**
   * Story 048 D2's headline acceptance: an empty `cvars` map still renders the complete catalogue,
   * every cvar at its own `def.default`, in the existing grouped and name-aligned layout. This is
   * what makes `exec`ing the file idempotent - whatever `config.cfg`, `autoexec.cfg`, another
   * profile or a mod set before it is written back to the intended value.
   */
  it('writes every catalogue cvar at its default for a profile with an empty cvars map', () => {
    const p = profile({ id: 'empty-id', cvars: {}, binds: {} })

    expect(renderProfileFile(p)).toBe(
      [
        ...testProfileHeader('empty-id'),
        ...TEST_PROFILE_UNBINDALL,
        ...cvarBlock(),
        '',
      ].join('\n'),
    )
  })

  /**
   * Story 040 D4's own acceptance: a profile with no stored `writeUnbindall` behaves exactly as
   * `true`. Same output as an explicit `writeUnbindall: true` and different from `false` - the
   * three cases the setting has to distinguish.
   */
  it('writes unbindall by default when writeUnbindall is unset', () => {
    const p = profile({ id: 'unbindall-default', cvars: {}, binds: {} })
    expect(p.writeUnbindall).toBeUndefined()

    expect(renderProfileFile(p)).toBe(
      renderProfileFile({ ...p, writeUnbindall: true }),
    )
  })

  it('writes a single unbindall line directly after the header when writeUnbindall is true', () => {
    const p = profile({ id: 'unbindall-on', cvars: {}, binds: {}, writeUnbindall: true })

    expect(renderProfileFile(p)).toBe(
      [
        ...testProfileHeader('unbindall-on'),
        ...TEST_PROFILE_UNBINDALL,
        ...cvarBlock(),
        '',
      ].join('\n'),
    )
  })

  it('writes no unbindall line at all when writeUnbindall is false', () => {
    const p = profile({ id: 'unbindall-off', cvars: {}, binds: {}, writeUnbindall: false })

    expect(renderProfileFile(p)).toBe(
      [
        ...testProfileHeader('unbindall-off'),
        ...cvarBlock(),
        '',
      ].join('\n'),
    )
  })

  it('round-trips high-ASCII values through latin1 byte-for-byte', () => {
    const p = profile({
      id: 'hi-ascii',
      cvars: { name: 'Bjørn' },
      binds: {},
    })

    const rendered = renderProfileFile(p)
    const roundTripped = Buffer.from(rendered, 'latin1').toString('latin1')

    expect(roundTripped).toBe(rendered)
  })
})

describe('renderProfileFile with layers', () => {
  const holdLayer: AltLayer = {
    id: 'layer-drops',
    name: 'Drops',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: { '1': 'drop rl', '2': 'drop rg' },
  }

  const toggleLayer: AltLayer = {
    id: 'layer-zoom',
    name: 'Zoom',
    mode: 'toggle',
    triggerKey: 'v',
    overrides: { MOUSE2: 'zoom_toggle_cmd' },
  }

  const emptyLayer: AltLayer = {
    id: 'layer-empty',
    name: 'Empty',
    mode: 'hold',
    triggerKey: 'g',
    overrides: {},
  }

  /** Story 011: a layer with real overrides but no trigger key assigned. */
  const noTriggerLayer: AltLayer = {
    id: 'layer-no-trigger',
    name: 'NoTrigger',
    mode: 'hold',
    triggerKey: null,
    overrides: { '1': 'drop rl' },
  }

  it('emits every layer alias, verbatim, in its own layer section, in array + generation order', () => {
    const binds = { UPARROW: '+forward' }
    const p = profile({
      id: 'layers-id',
      cvars: { sensitivity: '3' },
      binds,
      layers: [holdLayer, toggleLayer],
    })

    const holdResult = generateLayerAliases(holdLayer, binds)
    const toggleResult = generateLayerAliases(toggleLayer, binds)

    const rendered = renderProfileFile(p)
    const lines = rendered.split('\n')

    // Content: every generated alias, unchanged and in generation order, layer by layer in
    // `profile.layers` order - asserted against the generator's own output, not a literal.
    const expectedAliasLines = [
      ...holdResult.aliases.map((a) => a.line),
      ...toggleResult.aliases.map((a) => a.line),
    ]
    expect(lines.filter((line) => line.startsWith('alias ')).map(unformat)).toEqual(
      expectedAliasLines,
    )

    // Layout (story 040 D3): one section per layer, banner naming the layer, its mode and its
    // trigger key; the layer's aliases and its trigger bind inside it; the whole block *after*
    // the bind sections, so a trigger always wins its key. Pinned verbatim, padding and comments
    // included.
    const firstLayerBannerIndex = lines.findIndex((line) => line.startsWith('// --- Layer: Drops '))
    const otherBindsIndex = lines.findIndex((line) => line.startsWith('// --- Other binds '))

    expect(otherBindsIndex).toBeGreaterThanOrEqual(0)
    expect(firstLayerBannerIndex).toBeGreaterThan(otherBindsIndex)
    // Story 042 D2: the banner carries the layer's own ref, mode and trigger key - the fields
    // that let a reader put these lines back into the right layer. `trigger` is present here
    // because both layers have one; the trigger-less layer's own case below pins its absence. The
    // banner's `-` fill is gone on both: the title plus its tag already fills the 80-char width,
    // and no line this writer emits ends in whitespace with nothing after it.
    expect(lines.slice(firstLayerBannerIndex)).toEqual([
      '// --- Layer: Drops (hold, on ALT) [q2l layer=layer-drops mode=hold trigger=ALT]',
      'alias +drops "bind 1 drop rl; bind 2 drop rg"  // Drops',
      'alias -drops "unbind 1; unbind 2"              // Drops',
      'bind ALT     +drops                            // Drops',
      '',
      '// --- Layer: Zoom (toggle, on v) [q2l layer=layer-zoom mode=toggle trigger=v] -',
      'alias zoom_on  "bind MOUSE2 zoom_toggle_cmd; alias zoom zoom_off"  // Zoom',
      'alias zoom_off "unbind MOUSE2; alias zoom zoom_on"                 // Zoom',
      'alias zoom     zoom_on                                             // Zoom',
      'bind v         zoom                                                // Zoom',
      '',
    ])
  })

  it('puts each layer trigger bind inside its own layer section, in profile layer order', () => {
    const binds = { UPARROW: '+forward' }
    const p = profile({
      id: 'layers-id',
      cvars: {},
      binds,
      layers: [holdLayer, toggleLayer],
    })

    const holdResult = generateLayerAliases(holdLayer, binds)
    const toggleResult = generateLayerAliases(toggleLayer, binds)

    const rendered = renderProfileFile(p)
    const lines = rendered.split('\n')
    const triggerLine = (result: typeof holdResult): string =>
      `bind ${result.triggerBind!.key} ${result.triggerBind!.command}`

    // Both trigger binds are written, in layer array order, each one the last line of its own
    // layer's section - and the layer sections themselves come after every bind section, so a
    // trigger bind is always the last write to its key (`buildLayerSections`' doc comment).
    expect(lines.filter((line) => line.startsWith('bind ')).map(unformat)).toEqual([
      // The base bind, in the "other binds" section, before both layer sections.
      'bind UPARROW "+forward"',
      triggerLine(holdResult),
      triggerLine(toggleResult),
    ])

    const holdBannerIndex = lines.findIndex((line) => line.startsWith('// --- Layer: Drops '))
    const zoomBannerIndex = lines.findIndex((line) => line.startsWith('// --- Layer: Zoom '))
    const holdTriggerIndex = lines.findIndex((line) => unformat(line) === triggerLine(holdResult))

    expect(holdBannerIndex).toBeLessThan(holdTriggerIndex)
    expect(holdTriggerIndex).toBeLessThan(zoomBannerIndex)
  })

  it('does not emit a trigger bind for an empty layer, but still emits one for a non-empty layer alongside it', () => {
    const binds = {}
    const p = profile({
      id: 'layers-id',
      cvars: {},
      binds,
      layers: [emptyLayer, holdLayer],
    })

    const emptyResult = generateLayerAliases(emptyLayer, binds)
    const holdResult = generateLayerAliases(holdLayer, binds)

    expect(emptyResult.aliases).toEqual([])

    const rendered = renderProfileFile(p)
    const codeLines = rendered.split('\n').map(unformat)

    expect(codeLines).not.toContain(
      `bind ${emptyResult.triggerBind!.key} ${emptyResult.triggerBind!.command}`,
    )
    expect(codeLines).toContain(
      `bind ${holdResult.triggerBind!.key} ${holdResult.triggerBind!.command}`,
    )
    // An empty layer contributes no lines at all, so it must not leave a banner over nothing
    // either (story 040: "an empty section is omitted").
    expect(rendered).not.toContain('// --- Layer: Empty ')
  })

  it('renders a layer with overrides but no trigger key: aliases are emitted, no bind line is', () => {
    const binds = {}
    const p = profile({
      id: 'layers-id',
      cvars: {},
      binds,
      layers: [noTriggerLayer, holdLayer],
    })

    const noTriggerResult = generateLayerAliases(noTriggerLayer, binds)
    const holdResult = generateLayerAliases(holdLayer, binds)

    expect(noTriggerResult.aliases.length).toBeGreaterThan(0)
    expect(noTriggerResult.triggerBind).toBeNull()

    const rendered = renderProfileFile(p)
    const codeLines = rendered.split('\n').map(unformat)

    for (const alias of noTriggerResult.aliases) {
      expect(codeLines).toContain(alias.line)
    }
    // The banner says so out loud rather than showing an empty pair of parentheses - and its tag
    // (story 042 D2) omits `trigger` entirely rather than emitting it empty, so "no trigger" reads
    // back as an absent field and not as a layer triggered by a key named "".
    const noTriggerBanner = rendered
      .split('\n')
      .find((line) => line.startsWith('// --- Layer: NoTrigger '))
    expect(noTriggerBanner).toBe(
      '// --- Layer: NoTrigger (hold, no trigger key) [q2l layer=layer-no-trigger mode=hold]',
    )
    expect(noTriggerBanner).not.toContain('trigger=')

    // The only "bind " line in the whole file is the other layer's trigger
    // bind - the trigger-less layer contributes none, not even a malformed one.
    const bindLines = rendered.split('\n').filter((line) => line.startsWith('bind '))
    expect(bindLines.map(unformat)).toEqual([
      `bind ${holdResult.triggerBind!.key} ${holdResult.triggerBind!.command}`,
    ])
  })

  it('never emits a bind line with an empty key for a trigger-less layer', () => {
    const binds = { UPARROW: '+forward' }
    const p = profile({
      id: 'layers-id',
      cvars: {},
      binds,
      layers: [noTriggerLayer, holdLayer, toggleLayer],
    })

    const rendered = renderProfileFile(p)

    // A `bind` line with no key would show up as two consecutive spaces
    // (`bind  <command>`) - that must never happen, trigger-less layer or not.
    expect(rendered).not.toMatch(/^bind {2}/m)
  })

  it('renders a profile with layers: undefined identically to one without the field', () => {
    const p1 = profile({ id: 'no-layers', cvars: { crosshair: '0' }, binds: { c: '+movedown' } })
    const p2 = profile({
      id: 'no-layers',
      cvars: { crosshair: '0' },
      binds: { c: '+movedown' },
      layers: undefined,
    })

    expect(renderProfileFile(p2)).toBe(renderProfileFile(p1))
  })

  it('renders a profile with layers: [] identically to one without the field', () => {
    const p1 = profile({ id: 'no-layers', cvars: { crosshair: '0' }, binds: { c: '+movedown' } })
    const p2 = profile({
      id: 'no-layers',
      cvars: { crosshair: '0' },
      binds: { c: '+movedown' },
      layers: [],
    })

    expect(renderProfileFile(p2)).toBe(renderProfileFile(p1))
  })

  it('is deterministic across repeated calls on the same profile', () => {
    const p = profile({
      id: 'layers-id',
      cvars: { sensitivity: '3' },
      binds: { UPARROW: '+forward' },
      layers: [holdLayer, toggleLayer],
    })

    const first = renderProfileFile(p)
    const second = renderProfileFile(p)

    expect(second).toBe(first)
  })
})

describe('renderLoaderFile', () => {
  it('renders the sentinel line followed by the exec line', () => {
    const p = profile({ id: 'abc123' })

    expect(renderLoaderFile(p, 'My-Config.cfg')).toBe(
      ['// q2-launcher profile abc123 - hand-edited changes are read back', 'exec My-Config.cfg', ''].join('\n'),
    )
  })

  it('places the switch-bind chain after the exec line when given a usable chain input', () => {
    const p = profile({ id: 'abc123' })
    const switchBind: SwitchBindChainInput = {
      key: 'F9',
      defaultProfileId: 'abc123',
      profiles: [
        { id: 'abc123', name: 'Main', fileName: 'Main.cfg' },
        { id: 'def456', name: 'Alt', fileName: 'Alt.cfg' },
      ],
    }

    const rendered = renderLoaderFile(p, 'Main.cfg', switchBind)
    const lines = rendered.split('\n')
    const chainLines = renderSwitchBindChain(switchBind).split('\n')

    expect(lines).toEqual([
      '// q2-launcher profile abc123 - hand-edited changes are read back',
      'exec Main.cfg',
      ...chainLines,
      '',
    ])
  })

  it('renders byte-identical to the no-argument call when the chain input yields an empty chain', () => {
    const p = profile({ id: 'abc123' })
    const switchBind: SwitchBindChainInput = {
      key: 'F9',
      defaultProfileId: 'abc123',
      // Fewer than 2 profiles - renderSwitchBindChain returns '' for this.
      profiles: [{ id: 'abc123', name: 'Main', fileName: 'Main.cfg' }],
    }

    expect(renderLoaderFile(p, 'Main.cfg', switchBind)).toBe(renderLoaderFile(p, 'Main.cfg'))
  })

  it('round-trips latin1 byte-for-byte with a high-ASCII profile name in the chain', () => {
    const p = profile({ id: 'abc123' })
    const switchBind: SwitchBindChainInput = {
      key: 'F9',
      defaultProfileId: 'abc123',
      profiles: [
        { id: 'abc123', name: 'Bjørn', fileName: 'Bjorn.cfg' },
        { id: 'def456', name: 'Alt', fileName: 'Alt.cfg' },
      ],
    }

    const rendered = renderLoaderFile(p, 'Bjorn.cfg', switchBind)
    const roundTripped = Buffer.from(rendered, 'latin1').toString('latin1')

    expect(roundTripped).toBe(rendered)
  })
})

describe('renderProfileFile with actions', () => {
  // Same shape as `renderProfileFile with layers`'s own `holdLayer` (that one
  // is scoped to its own `describe` block, so it is redefined here rather
  // than reached across blocks).
  const holdLayer: AltLayer = {
    id: 'layer-drops',
    name: 'Drops',
    mode: 'hold',
    triggerKey: 'ALT',
    overrides: { '1': 'drop rl', '2': 'drop rg' },
  }

  /**
   * Story 040 D3 reversed the two alias blocks: an action's aliases now sit in their category's
   * own section *before* the layer sections. The bind sections sit between them, because a layer
   * section ends in that layer's trigger bind and has to be the last thing in the file that can
   * `bind` a key (`buildLayerSections`). Order between alias *definitions* is free - Quake 2
   * resolves an alias body when it runs, not when it is defined - so that half is a layout change;
   * the bind-vs-trigger half is not, and has its own regression test below.
   */
  it('renders the action alias sections, then the binds, then the layer sections', () => {
    const first = action({ name: 'One', id: 'aaaa0000' })
    const second = action({
      name: 'Two',
      id: 'bbbb1111',
      commands: [{ kind: 'raw', text: 'wave 2' }],
      keys: keySlots({ key: 'x' }),
    })
    const p = profile({
      id: 'actions-id',
      cvars: { sensitivity: '3' },
      // The `x` bind is the mirror `setActions` writes for the keyed action; the bind sections
      // emit it, and the reverse index is what files it under the action's own category.
      binds: { UPARROW: '+forward', x: 'two' },
      layers: [holdLayer],
      actions: [first, second],
    })

    const lines = renderProfileFile(p).split('\n')
    const codeLines = lines.map(unformat)

    const firstActionIndex = codeLines.indexOf('alias one drop rl')
    const secondActionIndex = codeLines.indexOf('alias two wave 2')
    const firstLayerAliasIndex = codeLines.indexOf('alias +drops "bind 1 drop rl; bind 2 drop rg"')
    const lastLayerAliasIndex = codeLines.indexOf('alias -drops "unbind 1; unbind 2"')
    const ownedBindIndex = codeLines.indexOf('bind x "two"')
    const unownedBindIndex = codeLines.indexOf('bind UPARROW "+forward"')

    expect(firstActionIndex).toBeGreaterThanOrEqual(0)
    expect(secondActionIndex).toBe(firstActionIndex + 1)
    expect(ownedBindIndex).toBeGreaterThan(secondActionIndex)
    expect(unownedBindIndex).toBeGreaterThan(ownedBindIndex)
    expect(firstLayerAliasIndex).toBeGreaterThan(unownedBindIndex)
    expect(lastLayerAliasIndex).toBeGreaterThan(firstLayerAliasIndex)

    // Both actions sit in the same (weapons) category, so they share one alias section, and the
    // keyed one's bind is filed under that same category with the entry's name on it.
    expect(lines).toContain(
      '// --- Aliases: Weapons [q2l cat=weapons ord=0] --------------------------------',
    )
    expect(lines).toContain(`alias one drop rl  // One ${entryTag()}`)
    expect(lines).toContain(`alias two wave 2   // Two ${entryTag()}`)
    expect(lines).toContain(
      '// --- Binds: Weapons [q2l cat=weapons ord=0] ----------------------------------',
    )
    expect(lines).toContain(`bind x "two"  // Two ${entryTag()}`)
  })

  it('renders a profile with actions: [] identically to one without the field', () => {
    const base = { id: 'no-actions', cvars: { crosshair: '0' }, binds: { c: '+movedown' } }

    expect(renderProfileFile(profile({ ...base, actions: [] }))).toBe(
      renderProfileFile(profile(base)),
    )
  })

  it('renders a profile with actions: undefined identically to one without the field', () => {
    const base = { id: 'no-actions', cvars: { crosshair: '0' }, binds: { c: '+movedown' } }

    expect(renderProfileFile(profile({ ...base, actions: undefined }))).toBe(
      renderProfileFile(profile(base)),
    )
  })

  it('leaves a profile with layers untouched when it has no actions', () => {
    const base = {
      id: 'no-actions',
      cvars: { crosshair: '0' },
      binds: { c: '+movedown' },
      layers: [holdLayer],
    }

    expect(renderProfileFile(profile({ ...base, actions: [] }))).toBe(
      renderProfileFile(profile(base)),
    )
  })

  it('round-trips a high-ASCII message action through latin1 byte-for-byte', () => {
    // One constant for input and expectation, so the assertion cannot silently
    // disagree with the action about which bytes it means.
    const text = 'Bjørn sagt: Größe ÿ'
    const p = profile({
      id: 'hi-ascii',
      actions: [
        action({
          name: 'Greet',
          id: 'ab12cd34',
          commands: [{ kind: 'message', channel: 'say', text }],
        }),
      ],
    })

    const rendered = renderProfileFile(p)

    expect(rendered).toContain(`alias greet say ${text}`)
    expect(Buffer.from(rendered, 'latin1').toString('latin1')).toBe(rendered)
  })

  it('is deterministic across repeated calls on the same profile', () => {
    const p = profile({
      id: 'actions-id',
      actions: [action({ name: 'One', id: 'aaaa0000' }), action({ name: 'Two', id: 'bbbb1111' })],
    })

    expect(renderProfileFile(p)).toBe(renderProfileFile(p))
  })

  /**
   * Story 038: an action whose bind mirror does not go through its alias, and
   * whose alias name nothing else in the profile calls, gets no alias line -
   * `alias q2l_a_attack_3137 +attack` next to `bind MOUSE1 "+attack"` is a
   * line that does nothing.
   *
   * Every "kept" case below is a silent-unbind risk, not a tidiness one:
   * dropping a line something still calls turns a live key dead in a saved
   * profile. They are grouped by *where* the reference comes from, one per
   * source, because that is the axis the guard can be wrong on.
   */
  describe('story 038: no alias line for a directly bindable action', () => {
    /**
     * A continuous catalogue row (story 034): `bindValueFor` mirrors it as its
     * own `+command`, so its alias is defined and - unless something else in
     * the profile names it - called by nobody.
     */
    function catalogueRow(overrides: Partial<ConfigAction>): ConfigAction {
      return action({
        categoryId: 'movement',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+forward' }],
        ...overrides,
      })
    }

    const forwardRow = catalogueRow({
      id: 'f0f0',
      name: 'Forward',
      catalogId: 'movement:forward',
      keys: keySlots({ key: 'w' }),
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const attackRow = catalogueRow({
      id: 'a1a1',
      name: 'Attack',
      catalogId: 'attack:primary',
      keys: keySlots({ key: 'MOUSE1' }),
      commands: [{ kind: 'raw', text: '+attack' }],
    })
    const forwardAlias = aliasNameFor(forwardRow)
    const attackAlias = aliasNameFor(attackRow)

    it('emits no alias line for a catalogue row, and leaves its bind line exactly as it was', () => {
      const p = profile({
        id: 'dead-alias',
        // What `applyActionBindMirror` writes for a continuous row since story
        // 034: the command itself, never the alias name.
        binds: { MOUSE1: '+attack', w: '+forward' },
        actions: [forwardRow, attackRow],
      })

      expect(renderProfileFile(p)).toBe(
        [
          ...testProfileHeader('dead-alias'),
          ...TEST_PROFILE_UNBINDALL,
          ...cvarBlock(),
          '',
          // Both binds are owned (each row's `bindValueFor` is the bare command sitting on the
          // key that row holds), so they are filed under the owning action's category and
          // ordered by that action's index in `profile.actions` - `w` before `MOUSE1`, which is
          // neither alphabetical nor insertion order.
          '// --- Binds: Movement [q2l cat=movement ord=0] --------------------------------',
          `bind w      "+forward"  // Forward ${entryTag({ cid: 'movement:forward' })}`,
          `bind MOUSE1 "+attack"   // Attack ${entryTag({ cid: 'attack:primary' })}`,
          '',
        ].join('\n'),
      )
    })

    it('changes no bind in the file: every bind line survives an action list that produces no aliases', () => {
      // AC5 in miniature - the dead alias lines go, and no bind line is added, removed or
      // reworded. Since story 040 D3 the action list *does* legitimately change a bind's
      // section and its trailing comment (that is the whole point of the reverse index), so the
      // comparison is over the bind commands themselves rather than over the whole file.
      const base = {
        id: 'unchanged',
        cvars: { sensitivity: '3', cl_run: '0' },
        binds: { MOUSE1: '+attack', UPARROW: '+forward', w: '+forward' },
        layers: [holdLayer],
      }
      const bindCommands = (text: string): string[] =>
        text
          .split('\n')
          .filter((line) => line.startsWith('bind '))
          .map(unformat)
          .sort()

      const withActions = renderProfileFile(profile({ ...base, actions: [forwardRow, attackRow] }))
      const withoutActions = renderProfileFile(profile(base))

      expect(withActions).not.toContain(`alias ${forwardAlias}`)
      expect(withActions).not.toContain(`alias ${attackAlias}`)
      expect(bindCommands(withActions)).toEqual(bindCommands(withoutActions))
      // The cvar block above them is untouched by the action list either way.
      expect(withActions.split('\n').filter((line) => line.startsWith('set '))).toEqual(
        withoutActions.split('\n').filter((line) => line.startsWith('set ')),
      )
    })

    it('keeps the alias line when a base bind still points at it (a pre-story-034 mirror)', () => {
      // A profile saved before story 034 has the alias name in `binds`, not the
      // bare command. Dropping the alias there would leave `bind w
      // "q2l_a_forward_f0f0"` calling nothing - the key goes dead.
      const p = profile({
        id: 'legacy-mirror',
        binds: { w: forwardAlias },
        actions: [forwardRow],
      })

      const rendered = renderProfileFile(p)

      expect(rendered).toContain(`alias ${forwardAlias} +forward`)
      expect(rendered).toContain(`bind w "${forwardAlias}"`)
    })

    it('keeps the alias line when a layer override points at it (a pre-story-034 modifier mirror)', () => {
      // Same legacy shape on the layer side: `applyActionLayerMirror` used to
      // write `aliasNameFor` into a modifier layer's overrides. The action
      // carries no base bind at all here (a modified slot belongs to the
      // layer), so the override is the *only* reference in the profile.
      const alt: AltLayer = {
        id: 'layer-alt',
        name: 'Alt',
        mode: 'hold',
        triggerKey: 'ALT',
        overrides: { r: forwardAlias },
      }
      const modified = { ...forwardRow, keys: keySlots({ key: 'r', modifier: 'ALT' }) }
      const p = profile({ id: 'modifier-mirror', layers: [alt], actions: [modified] })

      const rendered = renderProfileFile(p)

      expect(rendered).toContain(`alias ${forwardAlias} +forward`)
      // Unquoted: the generated body is a single command with no `;` in it.
      expect(rendered).toContain(`alias +alt bind r ${forwardAlias}`)
    })

    it('keeps the alias line when another action`s command calls it', () => {
      const caller = action({
        id: 'cccc3333',
        name: 'Combo',
        commands: [{ kind: 'raw', text: `wait; ${forwardAlias}` }],
      })
      const p = profile({ id: 'called-by-action', actions: [forwardRow, caller] })

      const rendered = renderProfileFile(p)

      expect(rendered).toContain(`alias ${forwardAlias} +forward`)
      expect(rendered).toContain(`alias ${aliasNameFor(caller)} "wait; ${forwardAlias}"`)
    })

    it('keeps the alias line when a hold layer`s generated body calls it', () => {
      // The layer's own alias body is generated, not stored: an override whose
      // value chains two commands is hoisted into `alias <base>_c1 "<chain>"`,
      // and *that* line is what names the two aliases. A scan comparing whole
      // override values against alias names would miss both.
      const drops: AltLayer = {
        id: 'layer-chain',
        name: 'Drops',
        mode: 'hold',
        triggerKey: 'ALT',
        overrides: { '1': `${forwardAlias}; ${attackAlias}` },
      }
      const p = profile({
        id: 'generated-body',
        layers: [drops],
        actions: [forwardRow, attackRow],
      })

      const codeLines = renderProfileFile(p).split('\n').map(unformat)

      expect(codeLines).toContain(`alias drops_c1 "${forwardAlias}; ${attackAlias}"`)
      expect(codeLines).toContain(`alias ${forwardAlias} +forward`)
      expect(codeLines).toContain(`alias ${attackAlias} +attack`)
    })

    it('keeps an unreferenced kind: alias entry (AC6 - that is Care`s business, not the writer`s)', () => {
      const aliasEntry = action({
        id: 'aliasent',
        name: '+test',
        kind: 'alias',
        commands: [{ kind: 'raw', text: '+attack' }],
      })
      const p = profile({ id: 'alias-entry', actions: [aliasEntry] })

      expect(renderProfileFile(p)).toContain('alias +test +attack')
    })

    it('keeps a keyless, unreferenced user-authored action (User decision)', () => {
      const freeform = action({
        id: 'ffff4444',
        name: 'My combo',
        commands: [{ kind: 'raw', text: 'wait' }, { kind: 'raw', text: '+attack' }],
      })
      const p = profile({ id: 'keyless', actions: [freeform] })

      expect(renderProfileFile(p)).toContain(`alias ${aliasNameFor(freeform)} "wait; +attack"`)
    })

    it('drops a chunk-split action whole: neither the parent nor any _p<n> line', () => {
      // The only shape that is both dropped and split: `bindValueFor` returns
      // the bare command for a *single*-command catalogue row, so a multi-command
      // action can never be dropped - but that one command can still be too long
      // for a line, which is what splits it.
      const huge = catalogueRow({
        id: 'hhhh5555',
        name: 'Huge',
        catalogId: 'movement:forward',
        keys: keySlots({ key: 'w' }),
        commands: [{ kind: 'raw', text: `+forward ${'z'.repeat(2000)}` }],
      })
      const p = profile({
        id: 'chunked-drop',
        binds: { w: `+forward ${'z'.repeat(2000)}` },
        actions: [huge],
      })

      const rendered = renderProfileFile(p)
      const aliasName = aliasNameFor(huge)

      // Split when rendered on its own - so this asserts the family is gone,
      // not that there was never a family to emit.
      expect(renderActionAliasLines([huge])).toHaveLength(2)
      expect(rendered).not.toContain(`alias ${aliasName}`)
      expect(rendered).not.toContain(`${aliasName}_p1`)
    })

    it('is deterministic across repeated calls on a profile that mixes dropped and kept actions', () => {
      const p = profile({
        id: 'mixed',
        cvars: { sensitivity: '3' },
        binds: { MOUSE1: '+attack', q: aliasNameFor(action({ id: 'qqqq6666', name: 'SSG SG' })) },
        layers: [holdLayer],
        actions: [
          forwardRow,
          attackRow,
          action({ id: 'qqqq6666', name: 'SSG SG', keys: keySlots({ key: 'q' }) }),
          action({ id: 'aliasent', name: '+test', kind: 'alias' }),
        ],
      })

      expect(renderProfileFile(p)).toBe(renderProfileFile(p))
    })
  })

  describe('story 015: dual-bound actions', () => {
    it('renders a drop row with both keys set as two bind lines to the same alias, and one alias definition', () => {
      // Shaped like a materialised drop-catalogue row (decision 6): item, ammo,
      // then the team message. `profile.binds` is hand-built here to mirror
      // exactly what `setActions` (D1, tested in `profiles.test.ts`) writes for
      // a two-key action - both `key` and `secondaryKey` point at the same
      // generated alias name - matching this file's existing pattern of
      // hand-constructing the bind mirror rather than re-testing `setActions`.
      const dropRow = action({
        name: 'Rocket Launcher',
        id: 'ab12cd34',
        categoryId: 'drops',
        catalogId: 'dropWeapon:rlauncher',
        keys: keySlots({ key: 'r' }, { key: 'PGUP' }),
        commands: [
          { kind: 'raw', text: 'drop rocket launcher' },
          { kind: 'raw', text: 'drop rockets' },
          { kind: 'message', channel: 'say_team', text: 'need ammo' },
        ],
      })
      const aliasName = aliasNameFor(dropRow)
      const p = profile({
        id: 'dual-bind-id',
        binds: { r: aliasName, PGUP: aliasName },
        actions: [dropRow],
      })

      const rendered = renderProfileFile(p)
      const lines = rendered.split('\n')
      const bindLines = lines.filter((line) => line.startsWith('bind '))
      const aliasLines = lines.filter((line) => line.startsWith('alias '))

      // Both slots of one action, so both binds land in that action's category section, ordered
      // by key within it, and both carry the same entry name as their trailing comment.
      expect(bindLines.map(unformat)).toEqual([
        `bind PGUP "${aliasName}"`,
        `bind r "${aliasName}"`,
      ])
      expect(aliasLines.map(unformat)).toEqual([
        `alias ${aliasName} "drop rocket launcher; drop rockets; say_team need ammo"`,
      ])

      // Story 050 D6's own acceptance for this shape (AC4): the two bind lines are *identical*
      // past the key - same catalogue tag, no `e` to pair them and no `slot` to tell them apart.
      // What pairs them back into one two-key entry on import is the bind value they share, and
      // which of the two is slot 1 is the order they appear in the file, not a field.
      const catalogue = { cid: 'dropWeapon:rlauncher' }
      expect(bindLines.map((line) => line.slice(line.indexOf('  // ') + '  // '.length))).toEqual([
        `Rocket Launcher ${entryTag(catalogue)}`,
        `Rocket Launcher ${entryTag(catalogue)}`,
      ])
      expect(aliasLines[0]!.endsWith(`  // Rocket Launcher ${entryTag(catalogue)}`)).toBe(true)

      // Asserted as a property too, not only against the literals above: no line of this entry
      // carries any of the three keys story 050 removed.
      for (const line of [...bindLines, ...aliasLines]) {
        expect(line).not.toMatch(/\be=|\bk=|\bslot=/)
      }
    })

    it('renders a movement row with only a Primary key as exactly one bind line', () => {
      const movementRow = action({
        name: 'Jump',
        id: 'cccc2222',
        categoryId: 'movement',
        catalogId: 'movement:jump',
        keys: keySlots({ key: 'SPACE' }),
        commands: [{ kind: 'raw', text: '+moveup' }],
      })
      const aliasName = aliasNameFor(movementRow)
      const p = profile({
        id: 'single-bind-id',
        binds: { SPACE: aliasName },
        actions: [movementRow],
      })

      const rendered = renderProfileFile(p)
      const bindLines = rendered.split('\n').filter((line) => line.startsWith('bind '))

      expect(bindLines).toEqual([`bind SPACE "${aliasName}"`])
      // No secondaryKey was set, so no second bind to this alias exists anywhere.
      expect(bindLines.filter((line) => line.includes(aliasName))).toHaveLength(1)
    })
  })
})

/**
 * Story 040 D3 - the alias, layer and bind sections themselves.
 *
 * The risky half of this story: it reads the actions -> `binds` mirror *backwards* (a reverse
 * index no helper provided before), and a mistake there is silent on disk - a bind filed under
 * the wrong banner with the wrong name, or, worse, one that stops being written at all. Every
 * block below therefore asserts on the bind *count* or the bind *set* as well as on the layout,
 * so a lost keybinding cannot hide behind a passing formatting assertion.
 */
describe('story 040 D3: alias, layer and bind sections', () => {
  /** Every section banner in a rendered file, in order, with the trailing `-` fill stripped. */
  function banners(rendered: string): string[] {
    return rendered
      .split('\n')
      .filter((line) => line.startsWith('// --- '))
      .map((line) => line.slice('// --- '.length).replace(/\s*-+$/, ''))
  }

  /** Every `bind <key>` key in a rendered file, in file order. */
  function boundKeys(rendered: string): string[] {
    return rendered
      .split('\n')
      .filter((line) => line.startsWith('bind '))
      .map((line) => line.split(/\s+/)[1]!)
  }

  describe('grouping and order', () => {
    /**
     * Story 052 D4: deliberately neither alphabetical nor built-ins-first, and with one former
     * built-in (`drops`) renamed by its `name`. The section order below is exactly this array's
     * order, which is what makes reordering and renaming a category in the rail move and rename its
     * section in the file (AC 8).
     */
    const categories: ConfigActionCategory[] = [
      { id: 'cat-bravo', name: 'Bravo' },
      { id: 'drops', name: 'Drops' },
      { id: 'cat-alpha', name: 'Alpha' },
      { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
      { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
    ]

    /** One entry per section a category can produce, plus one whose category the profile no
     * longer has - built so both the alias and the bind side of each category is exercised. */
    const entries: ConfigAction[] = [
      action({ id: 'e-move', name: 'Strafe left', categoryId: 'movement', keys: keySlots({ key: 'a' }), aliasName: 'strafe_l', commands: [{ kind: 'raw', text: 'wait' }, { kind: 'raw', text: '+moveleft' }] }),
      action({ id: 'e-weap', name: 'SSG + SG', categoryId: 'weapons', keys: keySlots({ key: 'q' }), aliasName: 'ssg_sg', commands: [{ kind: 'raw', text: 'use super shotgun' }, { kind: 'raw', text: 'use shotgun' }] }),
      action({ id: 'e-drop', name: 'Drop RL', categoryId: 'drops', keys: keySlots({ key: 'r' }), aliasName: 'drop_rl', commands: [{ kind: 'raw', text: 'drop rocket launcher' }, { kind: 'raw', text: 'say_team dropped rl' }] }),
      action({ id: 'e-bravo', name: 'Bravo entry', categoryId: 'cat-bravo', keys: keySlots({ key: 'b' }), aliasName: 'bravo_e', commands: [{ kind: 'raw', text: 'wave 1' }, { kind: 'raw', text: 'wait' }] }),
      action({ id: 'e-alpha', name: 'Alpha entry', categoryId: 'cat-alpha', keys: keySlots({ key: 'z' }), aliasName: 'alpha_e', commands: [{ kind: 'raw', text: 'wave 2' }, { kind: 'raw', text: 'wait' }] }),
      action({ id: 'e-gone', name: 'Orphan entry', categoryId: 'deleted-category', keys: keySlots({ key: 'o' }), aliasName: 'orphan_e', commands: [{ kind: 'raw', text: 'wave 3' }, { kind: 'raw', text: 'wait' }] }),
    ]

    const grouped = profile({
      id: 'grouped',
      categories,
      actions: entries,
      binds: {
        // The mirror `setActions` would have written for each entry above, plus one bind the
        // user typed themselves.
        ...Object.fromEntries(
          entries.map((entry) => [keySlotAt(entry, 0)!.key, entry.aliasName!]),
        ),
        F1: 'say hello',
      },
    })

    it('orders alias and bind sections by profile.categories array order, then other', () => {
      // `profile.categories` is deliberately stored Bravo-before-Alpha, so a section order of
      // Alpha-before-Bravo would prove the code sorted by name instead of following the array.
      // Story 052 D4: the three former built-ins are in that same array and get no head start -
      // `drops` sits second because the array says so, under the profile's own name for it
      // ("Drops", not the template's "Weapon dropping"), and `movement`/`weapons` come last.
      // (This profile has no layers; the layer sections' own placement - last, after "Other
      // binds" - is pinned by the tests in the layers block above.)
      // Story 042 D2: every category section header carries its own `cat` id, which is what lets
      // an import file these lines back under the right category (and a custom one under a
      // category minted from the banner's title). The two "Other" buckets carry no tag: their
      // members' `categoryId` matches no category the profile has, so there is no id to record and
      // a tag would invent one. "Other binds" carries none either - those lines have no owner.
      // Story 052 (F3 fix): each of those headers also carries `ord`, the category's own position in
      // `profile.categories` - the same value on all three of a category's headers, and the only
      // thing that tells a reader the order apart when two categories share no section block.
      // Story 048 D2: the four cvar group banners lead every file now - no group can be empty once
      // every catalogue cvar is written.
      expect(banners(renderProfileFile(grouped))).toEqual([
        ...CVAR_GROUP_BANNERS,
        'Aliases: Bravo [q2l cat=cat-bravo ord=0]',
        'Aliases: Drops [q2l cat=drops ord=1]',
        'Aliases: Alpha [q2l cat=cat-alpha ord=2]',
        'Aliases: Movement [q2l cat=movement ord=3]',
        'Aliases: Weapons [q2l cat=weapons ord=4]',
        'Aliases: Other',
        'Binds: Bravo [q2l cat=cat-bravo ord=0]',
        'Binds: Drops [q2l cat=drops ord=1]',
        'Binds: Alpha [q2l cat=cat-alpha ord=2]',
        'Binds: Movement [q2l cat=movement ord=3]',
        'Binds: Weapons [q2l cat=weapons ord=4]',
        'Binds: Other',
        'Other binds',
      ])
    })

    it('writes every bind exactly once and gives every generated bind and alias a trailing label', () => {
      const rendered = renderProfileFile(grouped)
      const lines = rendered.split('\n')

      // Nothing lost, nothing duplicated: the file's bind lines are exactly the profile's keys.
      expect(boundKeys(rendered).sort()).toEqual(Object.keys(grouped.binds).sort())

      for (const entry of entries) {
        // Every category here holds exactly one entry, so no column padding is in play and the
        // bind line can be pinned byte-for-byte, comment and (story 042 D2) metadata tag included.
        expect(lines).toContain(
          `bind ${keySlotAt(entry, 0)!.key} "${entry.aliasName}"  // ${entry.name} ${entryTag()}`,
        )
        expect(
          lines.some(
            (line) =>
              line.startsWith(`alias ${entry.aliasName} `) &&
              line.endsWith(`  // ${entry.name} ${entryTag()}`),
          ),
        ).toBe(true)
      }

      // The one bind no entry owns: written, in the "other binds" section, with no comment -
      // the file has no display name for a line the user typed.
      expect(lines).toContain('bind F1 "say hello"')
    })

    it('orders the binds inside a category section by the owning action index, and the unowned ones by key', () => {
      const twoSlots = action({
        id: 'e-two-slots',
        name: 'Two slots',
        categoryId: 'movement',
        keys: keySlots({ key: 'k' }, { key: 'HOME' }),
        aliasName: 'two_slots',
        commands: [{ kind: 'raw', text: 'wave 1' }, { kind: 'raw', text: 'wait' }],
      })
      const first = action({
        id: 'e-first',
        name: 'First',
        categoryId: 'movement',
        keys: keySlots({ key: 'zzz_last_key' }),
        aliasName: 'first_e',
        commands: [{ kind: 'raw', text: 'wave 2' }, { kind: 'raw', text: 'wait' }],
      })
      const p = profile({
        id: 'ordering',
        // `first` sits *before* `twoSlots` in the array but holds the alphabetically last key,
        // so an alphabetical sort would put it second.
        actions: [first, twoSlots],
        binds: {
          zzz_last_key: 'first_e',
          k: 'two_slots',
          HOME: 'two_slots',
          b: 'hand typed b',
          A: 'hand typed A',
        },
      })

      const rendered = renderProfileFile(p)

      expect(boundKeys(rendered)).toEqual([
        // Owned, by action index; the two slots of one action then by key among themselves.
        'zzz_last_key',
        'HOME',
        'k',
        // Unowned, by normalized key.
        'A',
        'b',
      ])
    })
  })

  describe('the reverse index (bind value -> owning action)', () => {
    const ssgSg = action({
      id: 'own-1',
      name: 'SSG + SG',
      categoryId: 'weapons',
      keys: keySlots({ key: 'q' }),
      aliasName: 'ssg_sg',
      commands: [{ kind: 'raw', text: 'use super shotgun' }, { kind: 'raw', text: 'use shotgun' }],
    })

    it('does not claim the same value on a key the action does not hold (story 039 key-scoping)', () => {
      // Since story 039 an alias name is a readable word, so a user's own `bind e "ssg_sg"` is
      // byte-for-byte the mirror value - only the key tells the two apart.
      const p = profile({ id: 'key-scoped', actions: [ssgSg], binds: { q: 'ssg_sg', e: 'ssg_sg' } })
      const lines = renderProfileFile(p).split('\n')

      expect(lines).toContain(`bind q "ssg_sg"  // SSG + SG ${entryTag()}`)
      // The unclaimed key keeps no comment at all - neither the label nor a tag that would hand a
      // hand-typed bind to an entry that does not own it.
      expect(lines).toContain('bind e "ssg_sg"')
      expect(lines.filter((line) => line.startsWith('bind e '))).toEqual(['bind e "ssg_sg"'])
      expect(banners(renderProfileFile(p))).toContain('Other binds')
    })

    it('does not claim a key whose value is not the action`s own mirror value', () => {
      const p = profile({ id: 'value-scoped', actions: [ssgSg], binds: { q: 'something else' } })
      const rendered = renderProfileFile(p)

      // The key is right, the value is not - so this is a hand-typed bind on a slot the entry
      // also holds, and it is written unlabelled rather than mislabelled.
      expect(rendered.split('\n')).toContain('bind q "something else"')
      expect(banners(rendered)).not.toContain('Binds: Weapons [q2l cat=weapons]')
    })

    it('does not claim a plain key for an action whose slot carries a modifier (story 016)', () => {
      // `Alt+R` is mirrored into the ALT layer's overrides, never into `binds`, so a plain `r`
      // in `binds` belongs to whoever typed it - not to this entry.
      const modified = { ...ssgSg, keys: keySlots({ key: 'r', modifier: 'ALT' }) }
      const p = profile({ id: 'modified-slot', actions: [modified], binds: { r: 'ssg_sg' } })
      const rendered = renderProfileFile(p)

      expect(rendered.split('\n')).toContain('bind r "ssg_sg"')
      expect(banners(rendered)).not.toContain('Binds: Weapons [q2l cat=weapons]')
    })

    it('never lets a kind: alias entry own a bind (story 019)', () => {
      const aliasEntry = action({
        id: 'alias-entry',
        name: '+slow',
        kind: 'alias',
        categoryId: 'weapons',
        keys: keySlots({ key: 'g' }),
        commands: [{ kind: 'raw', text: 'cl_maxfps 30' }],
      })
      const p = profile({ id: 'alias-owner', actions: [aliasEntry], binds: { g: '+slow' } })
      const rendered = renderProfileFile(p)

      expect(rendered.split('\n')).toContain('bind g "+slow"')
      expect(banners(rendered)).toContain('Other binds')
      expect(banners(rendered)).not.toContain('Binds: Weapons [q2l cat=weapons]')
    })

    it('labels a continuous catalogue row`s direct command mirror (story 034), not just an alias mirror', () => {
      const forward = action({
        id: 'cat-forward',
        name: 'Forward',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        keys: keySlots({ key: 'w' }),
        commands: [{ kind: 'raw', text: '+forward' }],
      })
      const p = profile({ id: 'direct-mirror', actions: [forward], binds: { w: '+forward' } })

      // `bindValueFor` returns the bare command here, so the reverse index has to match on that
      // and not on the alias name - the catalogue label is what proves it did.
      expect(renderProfileFile(p).split('\n')).toContain(
        `bind w "+forward"  // Forward ${entryTag({ cid: 'movement:forward' })}`,
      )
    })
  })

  describe('what is written and what is not', () => {
    it('does not write a bind whose command is empty, and does not mutate profile.binds', () => {
      const binds = { w: '+forward', i: '', j: '   ' }
      const p = profile({ id: 'empty-binds', binds })

      const rendered = renderProfileFile(p)

      expect(boundKeys(rendered)).toEqual(['w'])
      expect(rendered).not.toContain('bind i')
      expect(rendered).not.toContain('bind j')
      // Render-time omission only: the profile still carries both entries afterwards.
      expect(binds).toEqual({ w: '+forward', i: '', j: '   ' })
      expect(p.binds).toBe(binds)
    })

    /**
     * A base bind sitting on a layer's trigger key is a state the app knowingly allows and warns
     * about (`generateLayerAliases`' `layer.triggerConflict`), and the warning's own copy promises
     * which of the two wins: "the layer's trigger binding will take priority".
     *
     * That promise is decided purely by *file order*. A `.cfg` is `exec`d top to bottom and the
     * engine's binding table holds one command per key, so the last `bind` line on a key is the
     * one that survives - both lines run, only the later one is in effect afterwards. So this is
     * not a layout assertion: it is the assertion that the rendered file still means what the
     * Care warning says it means.
     *
     * Asserted as a relative index rather than a whole-file match on purpose - the property is
     * "the trigger comes after", not "the file looks like this".
     */
    it('writes a layer trigger bind after an unowned base bind colliding on the same key', () => {
      const p = profile({
        id: 'trigger-conflict',
        binds: { ALT: '+attack' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
        ],
      })

      const codeLines = renderProfileFile(p).split('\n').map(unformat)

      // Nothing dropped for tidiness: both lines are in the file...
      expect(codeLines).toContain('bind ALT +drops')
      expect(codeLines).toContain('bind ALT "+attack"')
      // ...and the trigger is the later of the two, so it is the one the engine keeps.
      expect(codeLines.indexOf('bind ALT +drops')).toBeGreaterThan(
        codeLines.indexOf('bind ALT "+attack"'),
      )
    })

    /**
     * The same invariant for the collision that is *not* in the "other binds" section: a base bind
     * owned by an action, which renders in that action's category bind section. Worth its own case
     * because the two kinds of bind are emitted by different code paths and, before the layer
     * sections were moved to the end of the file, an owned bind was written even later than an
     * unowned one - so it was the harder half of the same bug, not a duplicate of the case above.
     */
    it('writes a layer trigger bind after an owned category bind colliding on the same key', () => {
      const attack = action({
        id: 'e-attack',
        name: 'Attack',
        categoryId: 'weapons',
        keys: keySlots({ key: 'ALT' }),
        aliasName: 'attack_e',
        commands: [{ kind: 'raw', text: 'use blaster' }, { kind: 'raw', text: '+attack' }],
      })
      const p = profile({
        id: 'trigger-conflict-owned',
        actions: [attack],
        binds: { ALT: 'attack_e' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
        ],
      })

      const rendered = renderProfileFile(p)
      const codeLines = rendered.split('\n').map(unformat)

      // The base bind really did land in its owning category's section, not in "other binds" -
      // otherwise this case would silently be the previous test over again.
      expect(banners(rendered)).toContain('Binds: Weapons [q2l cat=weapons ord=0]')
      expect(codeLines).toContain('bind ALT "attack_e"')
      expect(codeLines).toContain('bind ALT +drops')
      expect(codeLines.indexOf('bind ALT +drops')).toBeGreaterThan(
        codeLines.indexOf('bind ALT "attack_e"'),
      )
    })

    it('emits no banner for a category with nothing in it', () => {
      const p = profile({
        id: 'sparse',
        // The empty one first, so its absence from the output cannot be an ordering artefact.
        categories: [{ id: 'cat-empty', name: 'Empty category' }, ...TEMPLATE_CATEGORIES],
        actions: [
          action({ id: 'only', name: 'Only', categoryId: 'weapons', aliasName: 'only_e', commands: [{ kind: 'raw', text: 'wave 1' }, { kind: 'raw', text: 'wait' }] }),
        ],
      })

      expect(banners(renderProfileFile(p))).toEqual([
        ...CVAR_GROUP_BANNERS,
        // `ord=0`, not `ord=1`: `categoryOrdinals` numbers only the categories that carry an entry,
        // so the empty one that writes no section does not consume an ordinal either - see that
        // function's own doc comment for why a gap here would cost story 042's fixed point.
        'Aliases: Weapons [q2l cat=weapons ord=0]',
      ])
    })
  })

  describe('budget, encoding and determinism over the whole file', () => {
    /** A profile touching every section kind this deliverable adds. */
    function richProfile(nameSuffix = ''): ConfigProfile {
      const entry = action({
        id: 'rich-1',
        name: `Nahkampf${nameSuffix}`,
        categoryId: 'cat-melee',
        keys: keySlots({ key: 'x' }),
        aliasName: 'melee_x',
        commands: [{ kind: 'raw', text: 'use blaster' }, { kind: 'raw', text: '+attack' }],
      })
      return profile({
        id: 'rich',
        name: 'Bjørn - Test',
        cvars: { sensitivity: '3', unknown_cvar: 'ÿ' },
        categories: [{ id: 'cat-melee', name: 'Nähkampf' }],
        actions: [entry],
        binds: { x: 'melee_x', F1: 'say Grüße' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
        ],
      })
    }

    it('round-trips the whole file - banners, labels and all - through latin1 byte-for-byte', () => {
      const rendered = renderProfileFile(richProfile())

      expect(rendered).toContain('Nähkampf')
      expect(Buffer.from(rendered, 'latin1').toString('latin1')).toBe(rendered)
    })

    it('is deterministic across repeated calls on a profile with every section kind', () => {
      expect(renderProfileFile(richProfile())).toBe(renderProfileFile(richProfile()))
    })

    it('keeps every line inside the strictest engine line budget, comments included', () => {
      for (const line of renderProfileFile(richProfile()).split('\n')) {
        expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
      }
    })

    /**
     * Story 042 D2 inverts story 040's give-way order, and this is where that inversion is pinned
     * end to end: the display name is decoration, the `[q2l ...]` tag is state nothing else in the
     * file records, so under budget pressure the *prose* is cut and the tag comes through whole.
     */
    it('truncates the display name rather than the command, and keeps the metadata tag whole', () => {
      const label = 'N'.repeat(200)
      const command = 'x'.repeat(900)
      const p = profile({
        id: 'truncated-comment',
        actions: [
          action({ id: 'long', name: label, categoryId: 'weapons', aliasName: 'long_entry', commands: [{ kind: 'raw', text: command }] }),
        ],
        binds: { k: 'long_entry' },
      })

      const aliasLine = renderProfileFile(p)
        .split('\n')
        .find((line) => line.startsWith('alias long_entry'))!

      expect(aliasLine.length).toBeLessThan(STRICTEST_LINE_BUDGET)
      // The command survives whole; only the label is cut, and it is cut from its own end.
      expect(aliasLine).toContain(command)
      const comment = aliasLine.slice(aliasLine.indexOf('  // ') + '  // '.length)
      const tag = entryTag()
      expect(comment.endsWith(` ${tag}`)).toBe(true)

      const prose = comment.slice(0, comment.length - tag.length - 1)
      expect(prose.length).toBeGreaterThan(0)
      expect(prose.length).toBeLessThan(label.length)
      expect(label.startsWith(prose)).toBe(true)
    })

    /**
     * One step past the case above: the line leaves room for the tag but not for a single character
     * of prose plus its separating space. The name goes entirely and the tag stays - the opposite
     * of what story 040 would have done with the same line.
     */
    it('drops the display name entirely before it shortens the metadata tag', () => {
      const tag = entryTag({ cid: 'movement:forward' })
      // Sized so `bind w "<command>"  // ` plus the bare tag lands exactly on the last byte the
      // engine's line budget allows, leaving nothing at all for the name.
      const filler = STRICTEST_LINE_BUDGET - 1 - 'bind w ""  // '.length - tag.length
      const command = `+forward ${'z'.repeat(filler - '+forward '.length)}`
      const huge = action({
        id: 'drop-prose',
        name: 'A display name that has to go',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        keys: keySlots({ key: 'w' }),
        commands: [{ kind: 'raw', text: command }],
      })
      const p = profile({ id: 'dropped-prose', actions: [huge], binds: { w: command } })

      const bindLine = renderProfileFile(p)
        .split('\n')
        .find((line) => line.startsWith('bind w'))!

      expect(bindLine).toBe(`bind w "${command}"  // ${tag}`)
      expect(bindLine.length).toBe(STRICTEST_LINE_BUDGET - 1)
      expect(bindLine).not.toContain('A display name')
    })

    /**
     * And one step past *that*: the tag itself no longer fits. It is dropped whole rather than cut
     * short - a truncated `[q2l` with no closing bracket reads back as malformed, which loses the
     * metadata anyway and reports the whole comment as garbage while doing it - and the line falls
     * back to exactly what story 040 would have written for it: the display name alone.
     * Unreachable through the app (a command this long is already at the engine's own line limit),
     * which is why it is handled rather than asserted away.
     */
    it('drops the metadata tag whole - never a half tag - when not even the bare tag fits', () => {
      const tag = entryTag({ cid: 'movement:forward' })
      const filler = STRICTEST_LINE_BUDGET - 1 - 'bind w ""  // '.length - tag.length + 1
      const command = `+forward ${'z'.repeat(filler - '+forward '.length)}`
      const huge = action({
        id: 'no-room',
        name: 'Forward',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        keys: keySlots({ key: 'w' }),
        commands: [{ kind: 'raw', text: command }],
      })
      const p = profile({ id: 'no-room-at-all', actions: [huge], binds: { w: command } })

      const bindLine = renderProfileFile(p)
        .split('\n')
        .find((line) => line.startsWith('bind w'))!

      expect(bindLine).toBe(`bind w "${command}"  // Forward`)
      expect(bindLine).not.toContain('[q2l')
      expect(bindLine.length).toBeLessThan(STRICTEST_LINE_BUDGET)
    })

    it('drops a comment outright when not even one character of it fits, keeping the command intact', () => {
      // A continuous catalogue row mirrors as its own bare command (story 034), which is how a
      // *bind* value gets long enough to leave no room at all for a label.
      const command = `+forward ${'z'.repeat(1005)}`
      const huge = action({
        id: 'huge',
        name: 'Forward',
        categoryId: 'movement',
        catalogId: 'movement:forward',
        keys: keySlots({ key: 'w' }),
        commands: [{ kind: 'raw', text: command }],
      })
      const p = profile({ id: 'dropped-comment', actions: [huge], binds: { w: command } })

      const bindLine = renderProfileFile(p)
        .split('\n')
        .find((line) => line.startsWith('bind w'))!

      expect(bindLine).toBe(`bind w "${command}"`)
      expect(bindLine).not.toContain('//')
      expect(bindLine.length).toBeLessThan(STRICTEST_LINE_BUDGET)
    })

    /**
     * The named consequence of this deliverable (D3's own acceptance): the trailing comments are
     * real bytes, so the size Care measures grows with them and a large profile can newly cross
     * the engine's exec-buffer warning. That is the intended surface, not a bug - so it is
     * asserted rather than hidden.
     */
    it('counts comment bytes toward the size Care evaluates on r1q2, and not on q2pro', () => {
      const short = renderProfileFile(richProfile())
      const long = renderProfileFile(richProfile(` ${'L'.repeat(60)}`))

      // r1q2 measures the raw file, comments included - so a longer entry name really does cost
      // the user exec-buffer budget.
      expect(effectiveSize(short, 'r1q2')).toBe(short.length)
      expect(effectiveSize(long, 'r1q2')!).toBeGreaterThan(effectiveSize(short, 'r1q2')!)
      // q2pro measures after `COM_Compress`, which strips comments, so it is unaffected.
      expect(effectiveSize(short, 'q2pro')!).toBeLessThan(short.length)
    })

    /**
     * The reverse index keys on `<normalized key><NUL><value>`. Without a separator the two halves
     * run together and `a` + `bc` collides with `ab` + `c` - which would file a hand-typed
     * `bind ab "c"` under the owning action's category with that entry's name on it, the exact
     * silent mis-attribution `buildBindOwnerIndex` exists to avoid. Asserted behaviourally so the
     * separator cannot be dropped (or silently stripped from the source) without a red test.
     */
    it('does not confuse key+value pairs whose concatenation is identical', () => {
      const owner = action({
        id: 'sep-1',
        name: 'Alpha',
        categoryId: 'movement',
        keys: keySlots({ key: 'a' }),
        aliasName: 'bc',
        commands: [{ kind: 'raw', text: 'use rl' }],
      })
      const lines = renderProfileFile(
        profile({ id: 'separator', actions: [owner], binds: { a: 'bc', ab: 'c' } }),
      ).split('\n')

      expect(lines.some((line) => /^\/\/ --- Other binds -+$/.test(line))).toBe(true)
      expect(lines.find((line) => line.startsWith('bind a '))).toContain('// Alpha')
      // The unowned bind keeps no comment and never lands in the owner's section.
      expect(lines.find((line) => line.startsWith('bind ab '))).toBe('bind ab "c"')
    })

    /**
     * `findCvar` matches case-insensitively, so two spellings of one cvar are one cvar. Since story
     * 048 D2 the pair must collapse to a single `set` line: a second line for the same cvar would
     * now be a *default* rendering after the user's real value and winning at exec time (the engine
     * runs the whole file top to bottom, last `set` wins), which is a silent clobber rather than a
     * cosmetic duplicate. The surviving line is the spelling that sorts last - the one that already
     * rendered last, and therefore already won, before this change - and the choice cannot depend on
     * `Object.keys` insertion order (AC5: "never insertion-order-dependent").
     */
    it('collapses two differently-cased spellings of one cvar into a single set line', () => {
      const forward = renderProfileFile(profile({ cvars: { sensitivity: '3', Sensitivity: '4' } }))
      const reversed = renderProfileFile(profile({ cvars: { Sensitivity: '4', sensitivity: '3' } }))

      expect(forward).toBe(reversed)
      expect(setLines(forward).filter((line) => /^set sensitivity\b/i.test(line))).toEqual([
        'set sensitivity "3"',
      ])
    })

    /**
     * AC7 covers the banner lines too, and `banner()` never truncates by design - so `render.ts`
     * clamps every title it hands over. Unreachable through the IPC schemas (they cap these names
     * at 120 characters), but the persisted schema caps none of them, and a multi-kilobyte comment
     * line in front of the engine's `char line[1024]` cbuf is not a failure mode worth leaving to
     * a validator elsewhere.
     */
    it('keeps a banner line inside the budget even for an absurdly long profile or category name', () => {
      const long = 'x'.repeat(4000)
      const withLongName = renderProfileFile(profile({ name: long }))
      const withLongCategory = renderProfileFile(
        profile({
          categories: [{ id: 'cat-long', name: long }],
          actions: [action({
            id: 'long-cat',
            name: 'E',
            categoryId: 'cat-long',
            keys: keySlots({ key: 'z' }),
            aliasName: 'e',
          })],
          binds: { z: 'e' },
        }),
      )

      for (const rendered of [withLongName, withLongCategory]) {
        for (const line of rendered.split('\n')) {
          expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
        }
      }
    })
  })
})

/**
 * Story 048 D2 - the rendered file carries a `set` line for *every* cvar in `ALL_CVARS`, so it
 * states the complete intended configuration and `exec`ing it is idempotent no matter what ran
 * before (`config.cfg`, an `autoexec.cfg`, another profile, a mod).
 *
 * The failure mode this block exists for is a silent clobber: two `set` lines for one cvar, the
 * catalogue default rendering *after* the user's real value. The engine executes the file top to
 * bottom and the last `set` on a cvar wins, so such a pair does not look broken in the file and
 * does not fail a layout assertion - it just quietly throws the user's setting away in-game. The
 * differently-cased-stored-key case below is exactly that trap, since `findCvar` matches
 * case-insensitively while a plain `Object.keys` walk does not.
 */
describe('story 048 D2: every catalogue cvar is written', () => {
  /** The cvar name of every `set` line, lowercased - the granularity a duplicate has to be checked
   * at, since `sensitivity` and `Sensitivity` are one cvar to `findCvar` and to the catalogue. */
  function setNamesLower(rendered: string): string[] {
    return setLines(rendered).map((line) => setName(line).toLowerCase())
  }

  it('writes one line for every catalogue cvar, and no cvar twice', () => {
    const names = setNamesLower(renderProfileFile(profile({ cvars: {} })))

    // Counted against the real array, not against a number in this file: a cvar added to the
    // catalogue has to fail here even though `TEST_PROFILE_CVAR_DEFAULTS`' literal knows nothing
    // about it.
    expect(names).toHaveLength(ALL_CVARS.length)
    expect([...names].sort()).toEqual(ALL_CVARS.map((def) => def.name.toLowerCase()).sort())
  })

  it('writes each catalogue cvar at its own default when the profile stored nothing for it', () => {
    const rendered = renderProfileFile(profile({ cvars: {} }))
    const written = new Map(
      setLines(rendered).map((line) => [setName(line), /"([^"]*)"$/.exec(line)![1]!]),
    )

    for (const def of ALL_CVARS) expect(written.get(def.name)).toBe(def.default)
  })

  /**
   * The named risk of this deliverable, asserted head-on. A profile that stored `Sensitivity`
   * (reachable through an import that keeps a file's own casing) must produce *one* line, carrying
   * the stored value - not a second one at the catalogue default that would win at exec time.
   */
  it('writes a differently-cased stored cvar exactly once, with the stored value and no default line', () => {
    const rendered = renderProfileFile(profile({ id: 'cased', cvars: { Sensitivity: '9' } }))

    expect(setLines(rendered).filter((line) => /^set sensitivity\b/i.test(line))).toEqual([
      'set Sensitivity "9"',
    ])
    // `sensitivity`'s catalogue default is 4; it must appear nowhere in the file, in any casing.
    expect(rendered).not.toMatch(/^set sensitivity +"4"$/im)
    // And the file still carries every catalogue cvar exactly once overall.
    expect(setNamesLower(rendered)).toHaveLength(ALL_CVARS.length)
    expect(new Set(setNamesLower(rendered)).size).toBe(ALL_CVARS.length)
  })

  it('keeps exactly one line per cvar when the profile stores several spellings of several cvars', () => {
    const rendered = renderProfileFile(
      profile({
        id: 'many-spellings',
        cvars: { Sensitivity: '9', sensitivity: '3', FOV: '110', fov: '95', CL_RUN: '0' },
      }),
    )

    expect(new Set(setNamesLower(rendered)).size).toBe(setNamesLower(rendered).length)
    // Largest stored spelling wins - the one that already rendered last, and so already won at
    // exec time, before this deliverable collapsed the pair.
    expect(setLines(rendered)).toContain('set sensitivity "3"')
    expect(setLines(rendered)).toContain('set fov         "95"')
    // A single stored spelling wins whatever its casing, and keeps that casing.
    expect(setLines(rendered)).toContain('set CL_RUN      "0"')
  })

  it('falls back to the catalogue default for a stored value that is empty or whitespace only', () => {
    const blank = renderProfileFile(
      profile({ id: 'blank', cvars: { fov: '', sensitivity: '   ', crosshair: '0' } }),
    )

    // Byte-identical to a profile that never stored the two blank keys at all: `writeValueFor`
    // treats "nothing there" and "not stored" as the same thing, and the stored spelling of both
    // happens to be the catalogue's own.
    expect(blank).toBe(renderProfileFile(profile({ id: 'blank', cvars: { crosshair: '0' } })))
    expect(setLines(blank)).toContain('set fov         "100"')
    expect(setLines(blank)).toContain('set sensitivity "4"')
    expect(setLines(blank)).toContain('set crosshair   "0"')
  })

  it('leaves an unrecognized stored cvar in the Other section, verbatim and never defaulted', () => {
    const lines = renderProfileFile(
      profile({
        id: 'unknown-cvars',
        cvars: { zz_unknown: 'kept', gl_frobnicate: '7', q_empty: '' },
      }),
    ).split('\n')
    const start = lines.findIndex((line) => line.startsWith('// --- Other '))

    expect(start).toBeGreaterThan(-1)
    // Alphabetical inside "Other" (never `Object.keys` insertion order), aligned among themselves
    // only, and `q_empty` keeps its empty value - the default substitution is for catalogue cvars,
    // and an unrecognized name has no default to substitute.
    expect(lines.slice(start + 1, start + 4)).toEqual([
      'set gl_frobnicate "7"',
      'set q_empty       ""',
      'set zz_unknown    "kept"',
    ])
    expect(lines[start + 4]).toBe('')
  })

  it('renders byte-identically on a second render, with every cvar now emitted', () => {
    const p = profile({
      id: 'stable',
      cvars: { Sensitivity: '9', sensitivity: '3', zz_unknown: 'kept', vid_gamma: '1.0' },
      actions: [action({ id: 'st-1', name: 'One', keys: keySlots({ key: 'q' }), aliasName: 'one_e' })],
      binds: { q: 'one_e' },
    })

    expect(renderProfileFile(p)).toBe(renderProfileFile(p))
  })

  it('keeps every cvar line inside the engine line budget with the whole catalogue written', () => {
    for (const line of renderProfileFile(profile({ cvars: {} })).split('\n')) {
      expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
    }
  })
})

/**
 * Story 051 D2 - the writer emits the header as a small four-line banner (rule / name / rule /
 * right-aligned tag) instead of a `sentinelLine()` prefix plus a five-line block carrying the old
 * hand-edit sentence. Each case here pins one bullet of the deliverable's own "Accepted when" list.
 */
describe('story 051 D2: the header block is a small banner', () => {
  it('starts the file with exactly the four header lines, and nothing before them', () => {
    const p = profile({ id: 'header-shape', cvars: {}, binds: {} })
    const lines = renderProfileFile(p).split('\n')

    expect(lines.slice(0, 4)).toEqual(testProfileHeader('header-shape'))
  })

  it('contains the profile id exactly once, only inside the header tag', () => {
    const p = profile({
      id: 'only-in-tag',
      actions: [action({ id: 'a-1', name: 'One', keys: keySlots({ key: 'q' }), aliasName: 'one_e' })],
      binds: { q: 'one_e' },
    })
    const rendered = renderProfileFile(p)
    const lines = rendered.split('\n')

    expect(lines[3]).toBe(testProfileHeader('only-in-tag')[3])
    expect(rendered.split('only-in-tag').length - 1).toBe(1)
  })

  it('never writes "hand-edited", "metadata", "version" or "generated", case-insensitively', () => {
    const p = profile({
      id: 'no-banned-words',
      cvars: { sensitivity: '3' },
      binds: { q: '+forward' },
      layers: [
        { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
      ],
    })
    const rendered = renderProfileFile(p).toLowerCase()

    for (const word of ['hand-edited', 'metadata', 'version', 'generated']) {
      expect(rendered).not.toContain(word)
    }
  })

  it('renders the header frame as pure ASCII, even with a non-ASCII (latin1) profile name', () => {
    // The name line carries the user's own prose (latin1-safe, not ASCII-only - see the round-trip
    // tests) and is deliberately excluded here; the *frame* - both rules and the tag line - is what
    // this AC pins as ASCII-only, same as every other decoration this writer emits.
    const p = profile({ id: 'ascii-frame', name: 'Bjørn', cvars: {}, binds: {} })
    const [topRule, , bottomRule, tagLine] = renderProfileFile(p).split('\n')

    for (const line of [topRule!, bottomRule!, tagLine!]) {
      for (const ch of line) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7f)
    }
  })

  it('renders byte-identically twice in a row', () => {
    const p = profile({ id: 'idempotent-header', cvars: { sensitivity: '3' }, binds: { q: '+forward' } })

    expect(renderProfileFile(p)).toBe(renderProfileFile(p))
  })

  it('neutralises a profile named literally "[q2l id=x]" on the name line', () => {
    const p = profile({ id: 'neutral-name', name: '[q2l id=x]', cvars: {}, binds: {} })
    const lines = renderProfileFile(p).split('\n')

    expect(lines[1]).toBe('//  (q2l id=x]')
  })

  it('falls back to a left-aligned tag line when the tag alone exceeds BANNER_WIDTH - 3', () => {
    const id = 'x'.repeat(200)
    const p = profile({ id, cvars: {}, binds: {} })
    const lines = renderProfileFile(p).split('\n')

    expect(lines[3]).toBe(`//  [q2l v=1 id=${id}]`)
  })
})

/**
 * Story 042 D2 - the metadata the writer now emits, as a format rather than as decoration.
 *
 * The failure mode this block exists for is a tag that renders but cannot be read back: a hash
 * that changes between renders, a value that smuggles a `]` or a `//` out of a display name, a
 * prose that forges a tag, or a `v` marker that lands on the sentinel line and breaks every
 * ownership check in `writer.ts`/`cleanup.ts`/`canonical.ts`. Each of those is silent on a green
 * layout assertion, so each gets its own case here.
 */
describe('story 042 D2: the [q2l ...] metadata the writer emits', () => {
  it('carries the version marker exactly once, only in the header block\'s own tag line (story 051 D2)', () => {
    const lines = renderProfileFile(
      profile({
        id: 'versioned',
        actions: [action({ id: 'v-1', name: 'One', keys: keySlots({ key: 'q' }), aliasName: 'one_e' })],
        binds: { q: 'one_e' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
        ],
      }),
    ).split('\n')

    const tagLine = testProfileHeader('versioned')[3]!
    // Ownership travels only as the `id` field in this same tag now (story 051) - no second,
    // sentinel-shaped line repeats the profile id anywhere else in the file.
    expect(lines.filter((line) => line.includes('v=1'))).toEqual([tagLine])
    expect(lines.filter((line) => line.includes('versioned'))).toEqual([tagLine])
    expect(lines[3]).toBe(tagLine)
    expect(lines[0]).not.toContain('[q2l')
  })

  it('neutralises a display name that tries to forge a tag, so only the real tag parses as one', () => {
    const p = profile({
      id: 'forged',
      categories: [{ id: 'cat-real', name: 'Weapons [q2l cat=movement]' }],
      actions: [
        action({
          id: 'forge-1',
          name: 'Gib [q2l cid=attack:primary]',
          categoryId: 'cat-real',
          keys: keySlots({ key: 'q' }),
          aliasName: 'gib_e',
        }),
      ],
      binds: { q: 'gib_e' },
    })

    const rendered = renderProfileFile(p)

    // One `[q2l` per line, always the trailing one: the user's own text reads back as inert
    // `(q2l ...)`-ish decoration, never as a real field.
    for (const line of rendered.split('\n')) {
      expect(line.split('[q2l').length - 1).toBeLessThanOrEqual(1)
    }
    expect(rendered).toContain(`// Gib (q2l cid=attack:primary] ${entryTag()}`)
    expect(rendered).toContain('// --- Aliases: Weapons (q2l cat=movement] [q2l cat=cat-real ord=0] ')
    // The forged fields did not become real ones - the only `cid` and `cat` in the file are the
    // ones the writer put there itself.
    expect(rendered).not.toContain('[q2l cid=attack:primary]')
    expect(rendered).not.toContain('[q2l cat=movement]')
  })

  it('percent-escapes a tag value that carries a space, a `]` or a `/`', () => {
    // A `catalogId` is machine-minted today, so this is the defensive path: a value that could
    // otherwise close the tag early, split a token, or open a second `//` inside the comment.
    const p = profile({
      id: 'escaped',
      actions: [
        action({
          id: 'esc-1',
          name: 'Odd',
          catalogId: 'weird id]with/slash%',
          keys: keySlots({ key: 'q' }),
          aliasName: 'odd_e',
        }),
      ],
      binds: { q: 'odd_e' },
    })

    const rendered = renderProfileFile(p)
    const bindLine = rendered.split('\n').find((line) => line.startsWith('bind q '))!

    expect(bindLine).toContain('cid=weird%20id%5Dwith%2Fslash%25')
    // Exactly one `//` on the line - the comment's own. An unescaped `/` in a value could pair up
    // with the next one and read as a command separator inside the comment.
    expect(bindLine.split('//').length - 1).toBe(1)
    expect(bindLine.endsWith(']')).toBe(true)
  })

  it('keeps a banner inside the line budget even when the tag value itself is absurdly long', () => {
    // The title-side of this is already covered above; this is the tag side. A category id this
    // long is unreachable through the IPC schemas but uncapped in the persisted store, and the
    // rule is that the tag is dropped whole rather than cut into a `[q2l` with no closing bracket.
    const id = 'x'.repeat(4000)
    const rendered = renderProfileFile(
      profile({
        id: 'long-cat-id',
        categories: [{ id, name: 'Long id' }],
        actions: [action({
          id: 'long-1',
          name: 'E',
          categoryId: id,
          keys: keySlots({ key: 'z' }),
          aliasName: 'e',
        })],
        binds: { z: 'e' },
      }),
    )

    for (const line of rendered.split('\n')) {
      expect(line.length).toBeLessThan(STRICTEST_LINE_BUDGET)
      if (line.includes('[q2l')) expect(line).toMatch(/\[q2l[^\]]*\]/)
    }
    expect(rendered).toContain('// --- Aliases: Long id ')
  })

  it('is deterministic and latin1-safe with every tag kind in one file', () => {
    const build = (): ConfigProfile =>
      profile({
        id: 'tagged-rich',
        name: 'Bjørn',
        categories: [{ id: 'cat-melee', name: 'Nähkampf' }],
        actions: [
          action({
            id: 'rich-a',
            name: 'Nahkampf',
            categoryId: 'cat-melee',
            catalogId: 'weapon:blaster',
            keys: keySlots({ key: 'x' }, { key: 'MOUSE3' }),
            aliasName: 'melee_x',
            commands: [{ kind: 'raw', text: 'use blaster' }, { kind: 'raw', text: '+attack' }],
          }),
        ],
        binds: { x: 'melee_x', MOUSE3: 'melee_x', F1: 'say Grüße' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
          { id: 'l2', name: 'Zoom', mode: 'toggle', triggerKey: null, overrides: { MOUSE2: 'zoom' } },
        ],
      })

    const rendered = renderProfileFile(build())

    expect(renderProfileFile(build())).toBe(rendered)
    expect(Buffer.from(rendered, 'latin1').toString('latin1')).toBe(rendered)
    // The two slots of the one entry: one catalogue tag, twice, with nothing left to tell the
    // two lines apart but the key each of them binds.
    const catalogue = { cid: 'weapon:blaster' }
    expect(
      rendered.split('\n').filter((line) => line.endsWith(`  // Nahkampf ${entryTag(catalogue)}`)),
    ).toHaveLength(3)
    // The trigger-less layer's header still records the layer and its mode, just no trigger.
    expect(rendered).toContain('[q2l layer=l2 mode=toggle]')
    expect(rendered).toContain('[q2l layer=l1 mode=hold trigger=ALT]')
  })

  it('marks a fieldless entry line with the bare [q2l] tag, and never a kind or a slot', () => {
    const p = profile({
      id: 'kinds',
      actions: [
        action({ id: 'k-alias', name: '+slow', kind: 'alias', commands: [{ kind: 'raw', text: 'cl_maxfps 30' }] }),
        action({ id: 'k-msg', name: 'GG', kind: 'message', aliasName: 'gg_e', commands: [{ kind: 'message', channel: 'say', text: 'gg' }] }),
      ],
    })

    const lines = renderProfileFile(p).split('\n')

    // Neither entry is catalogue-backed, so neither tag has a single field left to carry - and
    // both lines still get one. That bare marker is the only thing that still says "the launcher
    // wrote this line", so a line rendering without it would come back as a hand-typed bind.
    expect(lines.some((line) => line.endsWith(`// +slow ${entryTag()}`))).toBe(true)
    expect(lines.some((line) => line.endsWith(`// GG ${entryTag()}`))).toBe(true)
    expect(entryTag()).toBe('[q2l]')
    for (const line of lines) expect(line).not.toMatch(/\be=|\bk=|\bslot=/)
  })
})

/**
 * Story 050 D6 - the writer's half of the tag shrink.
 *
 * Every byte on these lines is what story 042's round-trip property is measured against, and both
 * failure modes of this deliverable are silent: a tag that carries one field too many reads back
 * as an unknown key, and a tag (or an anchor line) that carries one field too *few* reads back as
 * a different set of entries and slots than was saved - no error either way, just a file that
 * reconstructs into something else. So the three things the reader depends on are pinned here
 * byte-for-byte: what an entry line's tag says, that every entry line has one, and that an
 * entry's anchors appear once per modified slot in slot order.
 */
describe('story 050 D6: the reduced [q2l ...] tag', () => {
  /**
   * The story's own example, byte for byte, alignment included.
   *
   * `movement:attack` is a real continuous catalogue row, so its mirror value is the bare
   * `+attack` (story 034) and it keeps no alias line - which is exactly the shape the story's
   * example line has. The `movement:forward` row next to it is what puts the third space in front
   * of the `//`: the two rows share one category section, so `"+attack"` is padded to the width of
   * `"+forward"` before `attachTaggedComment` adds its own two spaces.
   */
  it("renders the story's example line exactly", () => {
    const catalogueRow = (overrides: Partial<ConfigAction>): ConfigAction =>
      action({ categoryId: 'movement', kind: 'bind', ...overrides })
    const forward = catalogueRow({
      id: 'ex-forward',
      name: 'Forward',
      catalogId: 'movement:forward',
      keys: keySlots({ key: 'w' }),
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const attack = catalogueRow({
      id: 'ex-attack',
      name: 'Attack',
      catalogId: 'movement:attack',
      keys: keySlots({ key: 'mouse1' }),
      commands: [{ kind: 'raw', text: '+attack' }],
    })
    const lines = renderProfileFile(
      profile({
        id: 'story-example',
        actions: [forward, attack],
        binds: { w: '+forward', mouse1: '+attack' },
      }),
    ).split('\n')

    expect(lines).toContain('bind mouse1 "+attack"   // Attack [q2l cid=movement:attack]')
    expect(lines).toContain('bind w      "+forward"  // Forward [q2l cid=movement:forward]')
    // The comment on its own, so this half of the acceptance holds independently of whatever the
    // surrounding section's column alignment happens to be.
    const bindLine = lines.find((line) => line.startsWith('bind mouse1'))!
    expect(bindLine.slice(bindLine.indexOf('// '))).toBe('// Attack [q2l cid=movement:attack]')
  })

  /**
   * The multi-slot half of the story (its "more than two key slots" decision) meeting the anchor
   * rule: an anchor per *modified* slot, for every slot, in slot order.
   *
   * Slot order is the whole point of the assertion being an `toEqual` over an ordered list rather
   * than three `toContain`s. Since `slot` left the tag, the only record of which key is slot 1 is
   * the order the claiming lines appear in the file, so an anchor block emitted in any other order
   * silently permutes the entry's keys on the next import - and every individual line would still
   * look perfectly correct.
   */
  it('emits one anchor line per modified slot, for all slots, in slot order', () => {
    const multi = action({
      id: 'multi-slot',
      name: 'Multi key',
      categoryId: 'movement',
      aliasName: 'multi_e',
      keys: keySlots(
        { key: 'r', modifier: 'ALT' },
        { key: 'p' },
        { key: 'F5', modifier: 'CTRL' },
        { key: 'F6', modifier: 'SHIFT' },
      ),
      commands: [{ kind: 'raw', text: 'use rl' }, { kind: 'raw', text: 'wait' }],
    })
    const lines = renderProfileFile(
      profile({ id: 'multi-anchor', actions: [multi], binds: { p: 'multi_e' } }),
    ).split('\n')

    // One anchor per modified slot - slots 0, 2 and 3 - in that order, and none for the plain
    // slot 1, whose `bind p` line already says everything the file needs about it.
    expect(lines.filter((line) => line.startsWith('// Multi key'))).toEqual([
      `// Multi key ${entryTag({ key: 'r', mod: 'ALT' })}`,
      `// Multi key ${entryTag({ key: 'F5', mod: 'CTRL' })}`,
      `// Multi key ${entryTag({ key: 'F6', mod: 'SHIFT' })}`,
    ])
    expect(lines).toContain(`bind p "multi_e"  // Multi key ${entryTag()}`)
    expect(lines.filter((line) => line.includes('key=p'))).toEqual([])
    // `an` is omitted: this entry keeps a real alias line (the `bind p` mirror references it), and
    // that line's own name is the authoritative spelling of the alias name.
    expect(lines.some((line) => line.includes('an='))).toBe(false)
  })

  /**
   * The one shape that still needs `an`: a continuous catalogue row on a *modified* key. Its
   * mirror is the bare `+forward` rather than its alias (story 034), so story 038 drops the alias
   * line as unreachable, and the modifier means story 016 writes no `bind` line either - leaving no
   * code in the file whose own text could spell the entry's alias name. Its anchor is the only
   * place that name can live, which is why `an` survived the cut.
   */
  it('carries an= on the anchor of an entry that has no other line in the file', () => {
    const lonely = action({
      id: 'lonely',
      name: 'Forward',
      categoryId: 'movement',
      kind: 'bind',
      catalogId: 'movement:forward',
      aliasName: 'lonely_e',
      keys: keySlots({ key: 'w', modifier: 'ALT' }),
      commands: [{ kind: 'raw', text: '+forward' }],
    })
    const lines = renderProfileFile(profile({ id: 'lonely-anchor', actions: [lonely] })).split('\n')

    expect(lines.some((line) => line.startsWith('alias lonely_e'))).toBe(false)
    expect(lines.some((line) => line.startsWith('bind '))).toBe(false)
    expect(lines).toContain(
      `// Forward ${entryTag({ cid: 'movement:forward', an: 'lonely_e', key: 'w', mod: 'ALT' })}`,
    )
  })

  /**
   * AC1, as a whole-file audit rather than as one more literal: no tag the writer emits anywhere
   * carries `e`, `k` or `slot`.
   *
   * Checked by parsing each line's tag and looking at its *keys*, never by searching the line for
   * the substring `e=` - `[q2l layer=l1 mode=hold]` contains that substring inside `mode=`, and a
   * substring check would either fail on a legitimate layer header or have to be weakened into
   * something that no longer proves anything. The corpus is both the round-trip fixtures (the
   * profiles story 042's fixed point is measured on) and a local set covering the line kinds those
   * fixtures do not all have at once: an anchor block, a multi-slot entry, a layer with and
   * without a trigger, an unowned bind and an orphaned category.
   */
  it('emits no e=, k= or slot= field in any tag, on any line, for the whole fixture corpus', () => {
    const local: ConfigProfile[] = [
      profile({
        id: 'audit-1',
        categories: [{ id: 'cat-melee', name: 'Nähkampf' }],
        actions: [
          action({
            id: 'audit-a',
            name: 'Nahkampf',
            categoryId: 'cat-melee',
            catalogId: 'weapon:blaster',
            aliasName: 'melee_x',
            keys: keySlots({ key: 'x' }, { key: 'MOUSE3' }, { key: 'F7', modifier: 'CTRL' }),
            commands: [{ kind: 'raw', text: 'use blaster' }, { kind: 'raw', text: '+attack' }],
          }),
          action({
            id: 'audit-b',
            name: 'Orphaned',
            categoryId: 'category-that-is-gone',
            aliasName: 'orphan_e',
            keys: keySlots({ key: 'o', modifier: 'ALT' }),
            commands: [{ kind: 'raw', text: 'wave 3' }, { kind: 'raw', text: 'wait' }],
          }),
        ],
        binds: { x: 'melee_x', MOUSE3: 'melee_x', F1: 'say hello' },
        layers: [
          { id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: { '1': 'drop rl' } },
          { id: 'l2', name: 'Zoom', mode: 'toggle', triggerKey: null, overrides: { MOUSE2: 'zoom' } },
        ],
      }),
      ...ROUND_TRIP_FIXTURES,
    ]

    const removed = ['e', 'k', 'slot']
    for (const p of local) {
      for (const line of renderProfileFile(p).split('\n')) {
        const tag = /\[q2l(?<body>(?:\s+[^\s\]]+)*)\s*\]\s*$/.exec(line)
        if (!tag) continue
        const keys = (tag.groups!.body ?? '')
          .trim()
          .split(/\s+/)
          .filter((token) => token.length > 0)
          .map((token) => token.slice(0, token.indexOf('=')))
        for (const key of removed) expect(keys).not.toContain(key)
        // Positive side of the same check, so a tag that renders no field at all cannot make the
        // assertion above pass by emitting nothing: every key is one the post-050 registry has.
        for (const key of keys) {
          // `lbl` (story 045, D4) is the tenth registered key - a toggle/press-release state's own
          // display label - `ord` (story 052's F3 fix) the eleventh, a category section header's
          // own position in `profile.categories`, and `sub` (story 053 D2) the twelfth, a
          // second-level section header's own sub-category id. `cvs`/`cvsub` (story 059 D2) are the
          // thirteenth and fourteenth, a cvar section/sub-section header's own id - a distinct
          // namespace from `cat`/`sub`. Each joined the list here rather than replacing anything,
          // which is exactly what "a key addition alone needs no `META_FORMAT_VERSION` bump" means.
          // `id` (story 051 D2) is the profile's own stable id - like `v`, only ever emitted on the
          // header block's own tag line, never a per-line one.
          expect([
            'v',
            'id',
            'cid',
            'an',
            'key',
            'mod',
            'cat',
            'layer',
            'mode',
            'trigger',
            'lbl',
            'ord',
            'sub',
            'cvs',
            'cvsub',
          ]).toContain(key)
        }
      }
    }
  })
})

/**
 * Story 045, D4: a toggle/press-release entry's `lbl` tag field. `buildAliasSections` has to put a
 * state's own `parts[i].label` on that state's own rendered alias line - never on the dispatch alias
 * or on a `_p<n>` chunk line - which `entryTag`/`twoPartAliasNames` are what this deliverable added.
 */
describe('story 045 D4: toggle/press-release state labels ride the `lbl` tag', () => {
  const zoom = action({
    id: 'zoom-lbl',
    name: 'Zoom',
    categoryId: 'weapons',
    kind: 'toggle',
    catalogId: 'movement:zoom',
    commands: [],
    keys: keySlots({ key: 'v' }),
    parts: [
      { label: 'In', commands: [{ kind: 'raw', text: 'zoom_fov' }] },
      { label: 'Out', commands: [{ kind: 'raw', text: 'norm_fov' }] },
    ],
  })

  it('puts each state`s label on that state`s own alias line, and neither on the dispatch line', () => {
    const lines = renderProfileFile(profile({ id: 'zoom-lbl', actions: [zoom] })).split('\n')
    const commentOf = (prefix: string): string => {
      const line = lines.find((l) => l.startsWith(prefix))!
      return line.slice(line.indexOf('// '))
    }

    expect(commentOf('alias zoom_s1 ')).toBe(`// Zoom ${entryTag({ cid: 'movement:zoom', lbl: 'In' })}`)
    expect(commentOf('alias zoom_s2 ')).toBe(`// Zoom ${entryTag({ cid: 'movement:zoom', lbl: 'Out' })}`)
    // Note the trailing space: distinguishes the dispatch line (`alias zoom zoom_s1`) from either
    // state line (`alias zoom_s1 ...`) - both share the `alias zoom` prefix otherwise.
    expect(commentOf('alias zoom ')).toBe(`// Zoom ${entryTag({ cid: 'movement:zoom' })}`)
  })

  it('puts no `lbl` on a chunk line of either half', () => {
    const longHalf = Array.from({ length: 40 }, (_, i) => ({
      kind: 'raw' as const,
      text: `command_number_${i}_padded_to_be_long_enough_to_force_a_chunk_split`,
    }))
    const chunked = action({
      ...zoom,
      id: 'zoom-lbl-chunked',
      parts: [
        { label: 'In', commands: longHalf },
        { label: 'Out', commands: [{ kind: 'raw', text: 'norm_fov' }] },
      ],
    })
    const lines = renderProfileFile(profile({ id: 'zoom-lbl-chunked', actions: [chunked] })).split(
      '\n',
    )
    const chunkLines = lines.filter((line) => line.startsWith('alias zoom_s1_p'))

    expect(chunkLines.length).toBeGreaterThan(0)
    for (const line of chunkLines) expect(line).not.toContain('lbl=')
  })

  it('round-trips a label containing characters the tag grammar escapes', () => {
    const rawLabel = 'In/Out 100% [x]'
    const withEscapes = action({
      ...zoom,
      id: 'zoom-lbl-escape',
      parts: [
        { label: rawLabel, commands: [{ kind: 'raw', text: 'zoom_fov' }] },
        { label: 'Out', commands: [{ kind: 'raw', text: 'norm_fov' }] },
      ],
    })
    const lines = renderProfileFile(
      profile({ id: 'zoom-lbl-escape', actions: [withEscapes] }),
    ).split('\n')
    const stateLine = lines.find((line) => line.startsWith('alias zoom_s1 '))!
    const tagStart = stateLine.lastIndexOf('[q2l')
    const tagText = stateLine.slice(tagStart)

    // The escaped form actually reached the file - space, `%` and `]` are all among the four
    // characters `escapeMetaValue` percent-encodes, so a byte-identical round trip is not a no-op.
    expect(tagText).not.toContain(rawLabel)
    const parsed = parseMetaTag(tagText)
    expect(parsed.fields.lbl).toBe(rawLabel)
  })

  it('renders a press/release entry with no labels exactly as D3 already verified - no `lbl` anywhere', () => {
    const slow = action({
      id: 'slow-no-lbl',
      name: 'Slow',
      categoryId: 'weapons',
      kind: 'press-release',
      commands: [],
      keys: keySlots({ key: 'CTRL' }),
      parts: [
        { commands: [{ kind: 'raw', text: 'cl_run 0' }] },
        { commands: [{ kind: 'raw', text: 'cl_run 1' }] },
      ],
    })
    const lines = renderProfileFile(profile({ id: 'slow-no-lbl', actions: [slow] })).split('\n')
    const commentOf = (prefix: string): string => {
      const line = lines.find((l) => l.startsWith(prefix))!
      return line.slice(line.indexOf('// '))
    }

    expect(commentOf('alias +slow ')).toBe(`// Slow ${entryTag()}`)
    expect(commentOf('alias -slow ')).toBe(`// Slow ${entryTag()}`)
    expect(lines.some((line) => line.includes('lbl='))).toBe(false)
  })
})

describe('profileFileName', () => {
  it('produces q2l-profile-<id>.cfg', () => {
    expect(profileFileName('abc123')).toBe('q2l-profile-abc123.cfg')
  })
})

describe('sentinelLine', () => {
  it('produces the exact sentinel format', () => {
    expect(sentinelLine('abc123')).toBe('// q2-launcher profile abc123 - hand-edited changes are read back')
  })

  it('is prefixed by OWNERSHIP_MARKER', () => {
    expect(sentinelLine('abc123').startsWith(OWNERSHIP_MARKER)).toBe(true)
  })
})
