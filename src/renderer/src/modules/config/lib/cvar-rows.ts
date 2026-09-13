/**
 * Story 021 D1: the row model behind the Settings tab's dense-rows redesign, regrouped by story
 * 059 D7.
 *
 * Pure, like every other `lib/*.ts` file in this module (see
 * `engine-scope.ts`) - no DOM, no hooks, no IPC - so grouping, filtering and
 * "changed" can be unit-tested without a component harness, and the JSX
 * (`SettingsTab.tsx`/`CvarRow.tsx`) reads counts and rows off this module
 * instead of recomputing them inline.
 *
 * Story 059 D7 replaces what a group *is*: the fixed Player/Network/Graphics/Sound split by
 * `CvarDef.group` is gone, and rows are grouped by the profile's own `cvarSections`
 * (`@shared/modules/config`'s `ConfigCvarSection`) - ungrouped run first, then one group per
 * sub-section, exactly the shape `controls-row-groups.ts` already gives the Controls grid one level
 * up, and exactly the order the file writer emits (`render.ts#buildCvarSectionBlock`). The two
 * reserved buckets the writer appends (`Defaults` for unplaced catalogue cvars when
 * `writeCatalogDefaults !== false`, `Other` for unplaced non-catalogue ones) are mirrored here for
 * the same reason: the story's premise is that what Settings shows and what the file gets are the
 * same list, so a cvar the writer would emit must have a row and one it would omit must not.
 *
 * A row is therefore one of two kinds (AC3):
 * - `'catalog'` - the name resolves through `findCvar`, so the row keeps today's rich rendering
 *   (label, control, engine facts, caveats).
 * - `'plain'` - a name the catalogue does not know, carried only by `profile.cvars`. Name, text
 *   value and the unsaved marker; no facts, no validation, and never behind the Advanced collapse
 *   (the story's decision: with no def there is nothing to call "advanced", so hiding it would be a
 *   guess).
 *
 * "Changed" is deliberately a value comparison, not a presence check: a
 * per-row reset writes the default value into `draft.cvars`, so a
 * `name in values`-style test would leave that row marked changed right
 * after the reset that was supposed to clear it (sprint decision, story doc
 * "Decisions (Sprint)").
 *
 * The effective default follows the same honesty rule story 009 already
 * established for `CvarRow`: an engine only contributes a default when it is
 * in scope *and* the catalog has source-cited facts for it
 * (`hasEngineFacts`/`resolveCvar` from `@shared/config/cvar-facts`). No
 * fallback engine is substituted here - `effectiveDefaultFor` reuses those
 * two primitives instead of re-deriving the "which engine, if any" question.
 */

import type { CvarDef } from '@shared/config/cvar-facts'
import { hasEngineFacts, resolveCvar } from '@shared/config/cvar-facts'
import { ALL_CVARS, findCvar } from '@shared/config/cvar-catalog'
import { cvarChangeKey } from '@shared/config/profile-diff'
import { CVAR_DEFAULTS_SECTION_ID } from '@shared/config/render'
import type { ConfigCvarSection, ConfigCvarSubsection } from '@shared/modules/config'
import type { EngineKind } from '@shared/types/engine'

/** Numeric-aware equality, mirroring `cvar-facts.ts`'s private `sameValue`: two values that both
 * parse as numbers compare numerically (`"1.0"` equals `"1"`), everything else compares as
 * trimmed, case-insensitive text. Not imported from `cvar-facts.ts` because that helper is not
 * exported - re-deriving this one rule locally is simpler than exporting an internal for one
 * caller. */
function sameValue(a: string, b: string): boolean {
  const na = Number(a)
  const nb = Number(b)
  if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
    return na === nb
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Normalizes a raw cvar value per its `kind` so it can be compared to a default.
 *
 * Only `toggle` needs real normalization: a config file, an import, or a user typing into the
 * text fallback can all produce `"1"`, `"true"`, `"TRUE"` etc. for "on" - all of that collapses to
 * the canonical `"1"`/`"0"` the catalog's `default`/`engineDefault` strings already use. Every
 * other kind is returned trimmed; `sameValue` above absorbs the remaining numeric-formatting
 * differences (`"1.0"` vs `"1"`) when comparing.
 */
export function normalizeCvarValue(def: CvarDef, rawValue: string): string {
  const trimmed = rawValue.trim()
  if (def.kind === 'toggle') {
    const lower = trimmed.toLowerCase()
    return lower === '1' || lower === 'true' ? '1' : '0'
  }
  return trimmed
}

/**
 * The default a row should show and compare against: the engine's own default when `engine` is in
 * scope and the catalog has source-cited facts for it, otherwise the catalog's own recommendation
 * (`def.default`).
 *
 * Never attributes an engine-specific number when there is no engine in scope (`engine === null`),
 * the engine has no facts at all (`hasEngineFacts` false - the story 009 honesty rule), or the
 * engine has facts for other cvars but none for this one (`resolveCvar(...).engineDefault` is
 * `undefined`, e.g. `gl_shadows` has no `byEngine` entry for any engine).
 */
export function effectiveDefaultFor(def: CvarDef, engine: EngineKind | null): string {
  if (engine !== null && hasEngineFacts(engine)) {
    const engineDefault = resolveCvar(def, engine).engineDefault
    if (engineDefault !== undefined) return engineDefault
  }
  return def.default
}

/**
 * Whether `value` differs from `def`'s effective default on `engine`.
 *
 * An empty `value` means "unset" (the same convention `CvarRow` already uses for
 * `draft.cvars[def.name] ?? ''`) and is never "changed" - there is nothing to compare, the row
 * falls back to the default outright.
 */
export function isChanged(def: CvarDef, engine: EngineKind | null, value: string): boolean {
  if (value.trim() === '') return false
  const normalizedValue = normalizeCvarValue(def, value)
  const normalizedDefault = normalizeCvarValue(def, effectiveDefaultFor(def, engine))
  return !sameValue(normalizedValue, normalizedDefault)
}

/** A row for a cvar the catalogue knows (`findCvar`) - today's rich row. `name` is the spelling to
 * read from / write into `profile.cvars`: the profile's own if it stores one (a foreign file may
 * spell it `FOV`), otherwise `def.name`, mirroring the writer's `stored?.name ?? def.name`. */
export interface CatalogCvarRow {
  kind: 'catalog'
  name: string
  /** Current stored value, `''` for "unset" - the same convention `CvarRow` already renders as
   * "falls back to the default". */
  value: string
  def: CvarDef
  edited: boolean
}

/** A row for a cvar only `profile.cvars` knows (story 059 D7 / AC3): name, text value, unsaved
 * marker - no def, therefore no facts and nothing to validate against. */
export interface PlainCvarRow {
  kind: 'plain'
  name: string
  value: string
  edited: boolean
}

/** One renderable row plus whether its current value is unsaved (present in the profile's change
 * set against `profile.baseline`, story 049 D7), so callers never recompute the change-set lookup a
 * second time for the same row. */
export type CvarRowEntry = CatalogCvarRow | PlainCvarRow

/** Which of the three kinds of group a `CvarSectionResult` is: one the profile owns, or one of the
 * two reserved buckets the writer appends and the reader never mints as a real section
 * (`render.ts#buildCvarSections`). The reserved two are display-only here - creating, renaming,
 * reordering and deleting (D8) only ever applies to `'section'`. */
export type CvarGroupKind = 'section' | 'defaults' | 'other'

/** Reserved id for the trailing `Other` bucket. The writer's own label constant
 * (`render.ts`'s `OTHER_CVAR_GROUP_LABEL`) is not exported and is a *label*, not an id - the bucket
 * is untagged in the file - so this is a renderer-side identity used for the group key only; the
 * displayed name comes from i18n in `SettingsTab`. */
const CVAR_OTHER_GROUP_ID = 'other'

/** Stable identity for a group across renders and for `expandedSections`. Prefixed by kind so a
 * profile that happens to own a section with id `defaults` or `other` cannot collide with a
 * reserved bucket. */
export function cvarGroupKey(kind: CvarGroupKind, id: string): string {
  return `${kind}:${id}`
}

/** One sub-section's rows and counts - the second and final level, mirroring
 * `ControlsRowGroup` one level down. */
export interface CvarSubgroupResult {
  subsection: ConfigCvarSubsection
  /** Every cvar this sub-section holds, regardless of filter/editedOnly/showAdvanced. */
  total: number
  /** How many of `total` are unsaved, regardless of filter/editedOnly/showAdvanced. */
  edited: number
  /** The rows to actually render, after filter, editedOnly and the section's Advanced collapse. */
  rows: CvarRowEntry[]
}

/** One group's rows plus the counts the group header and the Advanced "N more" affordance need. */
export interface CvarSectionResult {
  kind: CvarGroupKind
  /** `cvarGroupKey(kind, id)` - React key and `expandedSections` key. */
  key: string
  /** The profile's own section, or `null` for one of the two reserved buckets. */
  section: ConfigCvarSection | null
  /** Every cvar in this group (its own run *and* its sub-sections), regardless of
   * filter/editedOnly/showAdvanced. */
  total: number
  /** How many of `total` are unsaved (present in the change set, story 049 D7), regardless of
   * filter/editedOnly/showAdvanced. */
  edited: number
  /** The section's own (ungrouped) rows to render, after filter, editedOnly and the Advanced
   * collapse - rendered before any sub-section, same order the file is written in. */
  rows: CvarRowEntry[]
  /** One entry per sub-section the section has, in the profile's own order - including an empty
   * one, which still has to be visible so D8 can rename/reorder/delete it (053 D5's rule). */
  subgroups: CvarSubgroupResult[]
  /** Rows hidden by the Advanced collapse specifically (not by the filter or editedOnly), across
   * this group's own run and its sub-sections - the count a "N more" affordance would show. May be
   * 0 while the group still has advanced rows, e.g. when `showAdvanced` is already true, or when the
   * active filter already reveals every advanced row on its own merits - see `hasAdvanced` for
   * whether the toggle itself should still appear. */
  advancedHidden: number
  /** Whether this group contains any `def.common === false` row at all, computed over every row in
   * the group independently of `filter`, `editedOnly` and `showAdvanced`. Unlike `advancedHidden`
   * (which can legitimately read 0 while expanded, or while a filter already reveals everything),
   * this is what the "Show/Hide advanced" toggle button's own visibility should gate on - otherwise
   * expanding a group makes its own collapse button disappear, and an active filter can make the
   * button vanish while rows are still really collapsed underneath it (review finding). A plain row
   * never counts: a non-catalogue cvar is always common (the story's decision). */
  hasAdvanced: boolean
}

export interface BuildCvarSectionGroupsOptions {
  /** The profile's own sections, in profile order (`draft.cvarSections`). Omitted/empty means the
   * profile has none - every cvar then lands in one of the two reserved buckets, exactly what the
   * writer does for the same profile. */
  sections?: readonly ConfigCvarSection[]
  /** `draft.cvars` - both the value store and, together with `sections`, the source of the rows:
   * a name a section lists but `profile.cvars` has no value for gets a row only when the catalogue
   * knows it (its default is what the writer would emit); a non-catalogue name with no stored value
   * produces no line in the file and no row here. */
  values: Record<string, string>
  /**
   * Story 049 D7: the current profile's pending change set, scoped to cvars
   * (`useProfileChanges().changeSet.keys.cvars`, `@shared/config/profile-diff`'s
   * `ProfileChangeSet.keys.cvars`) - a set of `cvarChangeKey`-shaped keys. A row is "edited"
   * (unsaved) exactly when its key is in this set, replacing story 048 D6's renderer-local
   * `baseline`/`isEdited` comparison: the change set is computed main-side from `profile.baseline`
   * (D1/D2), so it is reseeded at exactly the moments an adopt/conflict-resolution/save happens,
   * never lagging behind a renderer-local snapshot. Defaults to an empty set (nothing pending) so
   * existing callers that only care about grouping/filtering keep working without threading a
   * change set through.
   */
  unsavedKeys?: ReadonlySet<string>
  /** Case-insensitive; matched against the cvar's name and (for a catalogue row) its resolved
   * label/description text (per the sprint decision "Filter matches cvar name, label and
   * description (case-insensitive)") - falling back to `labelKey`/`descriptionKey` themselves when
   * no resolver is supplied. A plain row has neither, so it matches on its name alone. Empty/
   * omitted `filter` means "no filter". */
  filter?: string
  /**
   * Resolves a def's `labelKey`/`descriptionKey` to the translated text a user would actually type
   * into the filter. This module stays a pure, i18n-free module (like every other `lib/*.ts` file
   * here - no DOM, no hooks, no IPC, and now no i18n import either), so the caller (`SettingsTab.tsx`,
   * which already holds a `t` from `useTranslation()`) resolves the keys and hands the plain strings
   * in; `matchesFilter` never sees a translation function.
   */
  labelText?: (def: CvarDef) => string
  descriptionText?: (def: CvarDef) => string
  /** Restrict rendered rows to edited/unsaved ones (story 049 D7 - present in `unsavedKeys`, not
   * differing from the catalogue default). Does not affect `total`/`edited` counts. */
  editedOnly?: boolean
  /** Group keys (`cvarGroupKey`) whose Advanced collapse is expanded. A group not listed hides its
   * `def.common === false` rows - unless the row also matches an active `filter`, in which case it
   * is revealed: a filter hit inside a collapsed Advanced section must never look like "no
   * results". */
  expandedSections?: ReadonlySet<string>
  /** `profile.writeCatalogDefaults` (story 059 D1/D9). `false` means the writer emits no line for a
   * catalogue cvar no section placed, so Settings shows no `Defaults` group either - "what Settings
   * shows is what the file gets" (the story's decision) cuts both ways. Any other value, including
   * `undefined` for a profile predating the field, behaves as `true`, the same `!== false`
   * convention the writer uses. */
  writeCatalogDefaults?: boolean
}

/** One entry of `profile.cvars`, kept as a pair so a catalogue row can carry the profile's own
 * spelling of the name rather than the catalogue's. */
interface StoredCvar {
  name: string
  value: string
}

/**
 * `profile.cvars` split the way the writer splits it (`render.ts#buildCvarSections`): catalogue
 * cvars keyed by catalogue identity (`def.name` lower-cased, exactly what `findCvar` matches on,
 * so two spellings of the same cvar can never produce two rows), everything else kept verbatim in
 * insertion order. The tie-break for two spellings is the writer's own (`held.name < name`), so the
 * row shows the same spelling the file will get.
 */
function indexStoredCvars(values: Record<string, string>): {
  catalog: Map<string, StoredCvar>
  unknown: StoredCvar[]
} {
  const catalog = new Map<string, StoredCvar>()
  const unknown: StoredCvar[] = []
  for (const [name, value] of Object.entries(values)) {
    const def = findCvar(name)
    if (!def) {
      unknown.push({ name, value })
      continue
    }
    const id = def.name.toLowerCase()
    const held = catalog.get(id)
    if (held === undefined || held.name < name) catalog.set(id, { name, value })
  }
  return { catalog, unknown }
}

function catalogRow(
  def: CvarDef,
  stored: StoredCvar | undefined,
  unsavedKeys: ReadonlySet<string>,
): CatalogCvarRow {
  const name = stored?.name ?? def.name
  return {
    kind: 'catalog',
    name,
    value: stored?.value ?? '',
    def,
    edited: unsavedKeys.has(cvarChangeKey(name)),
  }
}

function plainRow(stored: StoredCvar, unsavedKeys: ReadonlySet<string>): PlainCvarRow {
  return {
    kind: 'plain',
    name: stored.name,
    value: stored.value,
    edited: unsavedKeys.has(cvarChangeKey(stored.name)),
  }
}

/**
 * Resolves one name listed by a section into the row it renders as, or `undefined` for a name that
 * renders nothing - mirroring `render.ts#makeCvarResolver` line for line, because the two must
 * agree about which cvar lands where:
 *
 * - a name already claimed by an earlier section is skipped ("a name listed twice is claimed by its
 *   first placement", the story's decision), and
 * - a non-catalogue name the profile stores no value for produces nothing at all - the same
 *   "unplaced, never an error" rule, one level in: there is nothing to show and nothing to complain
 *   about either.
 *
 * A catalogue name always resolves, stored value or not: the writer emits its default for it, so
 * Settings owes it a row (this is what keeps a template profile's tab identical to today, where
 * rows came from `ALL_CVARS` outright).
 */
function makeRowResolver(
  stored: { catalog: Map<string, StoredCvar>; unknown: StoredCvar[] },
  placedCatalogIds: Set<string>,
  placedUnknownNames: Set<string>,
  unsavedKeys: ReadonlySet<string>,
): (name: string) => CvarRowEntry | undefined {
  return (name: string): CvarRowEntry | undefined => {
    const def = findCvar(name)
    if (def) {
      const id = def.name.toLowerCase()
      if (placedCatalogIds.has(id)) return undefined
      placedCatalogIds.add(id)
      return catalogRow(def, stored.catalog.get(id), unsavedKeys)
    }
    if (placedUnknownNames.has(name)) return undefined
    const found = stored.unknown.find((line) => line.name === name)
    if (found === undefined) return undefined
    placedUnknownNames.add(name)
    return plainRow(found, unsavedKeys)
  }
}

/** Whether `row` is exempt from the Advanced collapse. A plain row always is (the story's decision:
 * the catalogue has no facts about it, so calling it advanced would be a guess); a catalogue row is
 * iff its def is not explicitly `common: false` - the same predicate `hasAdvanced` uses, so the
 * toggle's visibility and what it actually hides can never disagree. */
function isCommonRow(row: CvarRowEntry): boolean {
  return row.kind === 'plain' || row.def.common !== false
}

/**
 * True when `filter` (already known non-empty) matches `row`'s name or, for a catalogue row, its
 * resolved label/description text. `labelText`/`descriptionText` are optional so existing callers
 * that only care about matching the cvar name (or that have no i18n resolver handy, e.g. this
 * file's own tests) keep working - they fall back to the untranslated key, which is never what a
 * real user types but is still a stable, deterministic string to match against.
 */
function matchesFilter(
  row: CvarRowEntry,
  filter: string,
  labelText?: (def: CvarDef) => string,
  descriptionText?: (def: CvarDef) => string,
): boolean {
  const needle = filter.trim().toLowerCase()
  if (row.name.toLowerCase().includes(needle)) return true
  if (row.kind === 'plain') return false
  const label = (labelText?.(row.def) ?? row.def.labelKey).toLowerCase()
  const description = (descriptionText?.(row.def) ?? row.def.descriptionKey).toLowerCase()
  return label.includes(needle) || description.includes(needle)
}

/** Everything the row-visibility pass needs, resolved once per `buildCvarSectionGroups` call. */
interface RowFilterContext {
  filterActive: boolean
  filter: string
  labelText?: (def: CvarDef) => string
  descriptionText?: (def: CvarDef) => string
  editedOnly: boolean
}

/**
 * Applies the Advanced collapse, then the filter, then `editedOnly` to `candidates` - the same
 * order (and the same "an active filter rescues a non-common row from the collapse" rule) the
 * pre-059 `buildCvarGroups` used, only over rows instead of defs.
 */
function selectRows(
  candidates: CvarRowEntry[],
  showAdvanced: boolean,
  ctx: RowFilterContext,
): { rows: CvarRowEntry[]; advancedHidden: number } {
  const rows: CvarRowEntry[] = []
  let advancedHidden = 0

  for (const row of candidates) {
    const matches =
      !ctx.filterActive || matchesFilter(row, ctx.filter, ctx.labelText, ctx.descriptionText)

    // Advanced collapse: a non-common row is hidden unless a filter is active and this row is
    // one of its hits - otherwise filtering into a collapsed section would look like "no
    // results" (sprint decision).
    if (!showAdvanced && !isCommonRow(row) && !(ctx.filterActive && matches)) {
      advancedHidden += 1
      continue
    }

    if (ctx.filterActive && !matches) continue
    if (ctx.editedOnly && !row.edited) continue

    rows.push(row)
  }

  return { rows, advancedHidden }
}

/** One group's candidate rows before any filtering: its own run plus one bucket per sub-section. */
interface GroupCandidates {
  own: CvarRowEntry[]
  subs: { subsection: ConfigCvarSubsection; candidates: CvarRowEntry[] }[]
}

/**
 * Turns one group's candidate rows into its `CvarSectionResult`: `total`/`edited`/`hasAdvanced` are
 * computed over every candidate (own run *and* sub-sections) before filter, `editedOnly` or the
 * Advanced collapse are applied - the group header always reports the group's real size, not the
 * current view's - and `rows`/`subgroups[].rows` are what is left after all three.
 */
function finishGroup(
  kind: CvarGroupKind,
  id: string,
  section: ConfigCvarSection | null,
  { own, subs }: GroupCandidates,
  showAdvanced: boolean,
  ctx: RowFilterContext,
): CvarSectionResult {
  const all = [...own, ...subs.flatMap((sub) => sub.candidates)]
  const ownSelection = selectRows(own, showAdvanced, ctx)
  const subSelections = subs.map((sub) => ({
    subsection: sub.subsection,
    total: sub.candidates.length,
    edited: sub.candidates.filter((row) => row.edited).length,
    ...selectRows(sub.candidates, showAdvanced, ctx),
  }))

  return {
    kind,
    key: cvarGroupKey(kind, id),
    section,
    total: all.length,
    edited: all.filter((row) => row.edited).length,
    rows: ownSelection.rows,
    subgroups: subSelections.map(({ subsection, total, edited, rows }) => ({
      subsection,
      total,
      edited,
      rows,
    })),
    advancedHidden:
      ownSelection.advancedHidden +
      subSelections.reduce((sum, sub) => sum + sub.advancedHidden, 0),
    hasAdvanced: all.some((row) => !isCommonRow(row)),
  }
}

/**
 * Groups every cvar the profile has into the profile's own sections (story 059 D7), in profile
 * order, each with the rows to render and the counts its header needs.
 *
 * Order is the file's order, and for the same reason - `render.ts#buildCvarSections` and this
 * function are two readings of one list:
 *
 * 1. one group per `sections` entry, its own `cvars` first (the ungrouped run), then one subgroup
 *    per `subsections` entry - including an empty one, which still renders so a freshly created
 *    sub-section does not look like it vanished (053 D5's rule);
 * 2. the reserved `Defaults` group - every catalogue cvar no section placed - but only when
 *    `writeCatalogDefaults !== false`, and only when it has anything to hold (the writer drops an
 *    empty block, so a template profile, which places all of `ALL_CVARS`, never shows one);
 * 3. the reserved `Other` group - every non-catalogue cvar of `values` no section placed, sorted
 *    alphabetically exactly as the writer sorts its own trailing bucket, and never gated by the
 *    toggle: an unrecognised cvar has no catalogue default to omit in the first place.
 *
 * Together (2) and (3) are what makes AC3's "every cvar in the profile has a row, never hidden"
 * true for a profile whose sections do not mention everything it stores - an imported or migrated
 * one, or one that predates `cvarSections` entirely.
 */
export function buildCvarSectionGroups({
  sections = [],
  values,
  unsavedKeys = new Set<string>(),
  filter = '',
  labelText,
  descriptionText,
  editedOnly = false,
  expandedSections = new Set<string>(),
  writeCatalogDefaults,
}: BuildCvarSectionGroupsOptions): CvarSectionResult[] {
  const ctx: RowFilterContext = {
    filterActive: filter.trim() !== '',
    filter,
    labelText,
    descriptionText,
    editedOnly,
  }

  const stored = indexStoredCvars(values)
  const placedCatalogIds = new Set<string>()
  const placedUnknownNames = new Set<string>()
  const resolve = makeRowResolver(stored, placedCatalogIds, placedUnknownNames, unsavedKeys)
  const present = (row: CvarRowEntry | undefined): row is CvarRowEntry => row !== undefined

  const groups: CvarSectionResult[] = sections.map((section) => {
    // Resolution order matters and is the writer's: a section's own run claims its names before its
    // sub-sections do, and an earlier section before a later one.
    const candidates: GroupCandidates = {
      own: section.cvars.map(resolve).filter(present),
      subs: (section.subsections ?? []).map((subsection) => ({
        subsection,
        candidates: subsection.cvars.map(resolve).filter(present),
      })),
    }
    return finishGroup(
      'section',
      section.id,
      section,
      candidates,
      expandedSections.has(cvarGroupKey('section', section.id)),
      ctx,
    )
  })

  if (writeCatalogDefaults !== false) {
    const unplacedCatalog = ALL_CVARS.filter(
      (def) => !placedCatalogIds.has(def.name.toLowerCase()),
    ).map((def) => {
      placedCatalogIds.add(def.name.toLowerCase())
      return catalogRow(def, stored.catalog.get(def.name.toLowerCase()), unsavedKeys)
    })
    if (unplacedCatalog.length > 0) {
      groups.push(
        finishGroup(
          'defaults',
          CVAR_DEFAULTS_SECTION_ID,
          null,
          { own: unplacedCatalog, subs: [] },
          expandedSections.has(cvarGroupKey('defaults', CVAR_DEFAULTS_SECTION_ID)),
          ctx,
        ),
      )
    }
  }

  const unplacedUnknown = stored.unknown
    .filter((line) => !placedUnknownNames.has(line.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((line) => plainRow(line, unsavedKeys))
  if (unplacedUnknown.length > 0) {
    groups.push(
      finishGroup(
        'other',
        CVAR_OTHER_GROUP_ID,
        null,
        { own: unplacedUnknown, subs: [] },
        expandedSections.has(cvarGroupKey('other', CVAR_OTHER_GROUP_ID)),
        ctx,
      ),
    )
  }

  return groups
}

/** Every row a group renders right now, its own run and its sub-sections' - the one list the tab's
 * "visible" counts and the rows on screen both come from, so no counter can disagree with what is
 * actually rendered. */
export function visibleRowsOf(group: CvarSectionResult): CvarRowEntry[] {
  return [...group.rows, ...group.subgroups.flatMap((sub) => sub.rows)]
}
