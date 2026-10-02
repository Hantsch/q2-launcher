import type {
  ActionKeySlot,
  ConfigAction,
  ConfigActionCategory,
  ConfigProfile,
} from '@shared/modules/config'
import { STANDARD_TEMPLATE, TEMPLATE_ACTION_CATEGORIES } from '@shared/modules/config'

/**
 * The three template categories as `STANDARD_TEMPLATE` seeds them (`{ id, name, nameKey }`).
 *
 * Story 052 D4: the file's category sections are `profile.categories`, in that array's order, and
 * nothing else - the three former built-ins are no longer prepended by the writer. So a test profile
 * whose actions sit in `movement`/`weapons`/`drops` has to *carry* those categories, exactly as a
 * template-seeded profile does; without them its entries are uncategorised and land in the trailing
 * "Other" bucket (which is what several tests below now deliberately check).
 */
export const TEMPLATE_CATEGORIES: ConfigActionCategory[] = TEMPLATE_ACTION_CATEGORIES.map(
  (category) => ({
    id: category.id,
    name: category.label,
    nameKey: category.labelKey,
  }),
)

/**
 * Story 059 D2: the writer's cvar sections now come from `profile.cvarSections`, not from
 * `CvarDef.group`/`CVAR_GROUP_ORDER` directly - a test profile that carries no sections of its own
 * would put every catalogue cvar into the reserved `Defaults` bucket instead of the four
 * Player/Network/Graphics/Sound sections this file's literals below pin. Seeding the default
 * `profile()` with `STANDARD_TEMPLATE.cvarSections` (which places every `ALL_CVARS` name across
 * those same four sections) keeps every pre-059 assertion in this file byte-identical, exactly the
 * same rebaselining `TEMPLATE_CATEGORIES` above did for story 052's category change.
 */
export function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
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
export function action(overrides: Partial<ConfigAction> = {}): ConfigAction {
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
export function testProfileHeader(id: string): string[] {
  const tag = `[q2l v=1 id=${id}]`
  const rule = '// ============================================================================='
  return [rule, '//  Test', rule, `//${' '.repeat(rule.length - 2 - tag.length)}${tag}`]
}

/** Builds an action's `keys` array from a sparse list of slots - `undefined` entries are skipped,
 * so a caller can express "no primary slot, only a secondary one" as `keySlots(undefined, slot)`.
 * Same helper `action-mirror.test.ts` uses since story 050 D3. */
export function keySlots(...slots: (ActionKeySlot | undefined)[]): ActionKeySlot[] {
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
export function entryTag(
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
export const TEST_PROFILE_UNBINDALL = ['', 'unbindall']

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
export const TEST_PROFILE_CVAR_DEFAULTS = [
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
export const CVAR_GROUP_BANNERS = [
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
export function cvarBlock(overrides: Record<string, string> = {}): string[] {
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
export function unformat(line: string): string {
  return line.replace(/\s{2,}\/\/ .*$/, '').replace(/\s{2,}/g, ' ')
}

/** Every `set <name> <value>` line of a rendered file, in file order. */
export function setLines(rendered: string): string[] {
  return rendered.split('\n').filter((line) => line.startsWith('set '))
}

/** The cvar name a `set` line writes - the token between `set ` and the aligned value column. */
export function setName(line: string): string {
  return line.slice('set '.length).trimEnd().split(' ')[0]!
}
