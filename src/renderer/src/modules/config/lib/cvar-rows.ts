/**
 * Story 021 D1: the row model behind the Settings tab's dense-rows redesign.
 *
 * Pure, like every other `lib/*.ts` file in this module (see
 * `engine-scope.ts`) - no DOM, no hooks, no IPC - so grouping, filtering and
 * "changed" can be unit-tested without a component harness, and the JSX
 * (`SettingsTab.tsx`/`CvarRow.tsx`, later deliverables) reads counts and rows
 * off this module instead of recomputing them inline.
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
import type { EngineKind } from '@shared/types/engine'

/** Fixed group order for the Settings tab; `def.group` also carries `network`/`sound` entries that
 * `PLAYER_CVARS`/`GRAPHICS_CVARS` mix into their arrays for authoring convenience only (see
 * `cvar-catalog.ts`'s own docstring) - grouping here always goes by `def.group`, never by which
 * convenience array a def happens to live in. */
const GROUP_ORDER: CvarDef['group'][] = ['player', 'network', 'graphics', 'sound']

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

/** One renderable row: the def plus whether its current value is changed, so callers never
 * recompute `isChanged` a second time for the same row. */
export interface CvarRowEntry {
  def: CvarDef
  changed: boolean
}

/** One group's rows plus the counts the group header and the Advanced "N more" affordance need. */
export interface CvarGroupResult {
  group: CvarDef['group']
  /** Every cvar in this group, regardless of filter/changedOnly/showAdvanced. */
  total: number
  /** How many of `total` are changed, regardless of filter/changedOnly/showAdvanced. */
  changed: number
  /** The rows to actually render, after filter, changedOnly and the Advanced collapse. */
  rows: CvarRowEntry[]
  /** Rows hidden by the Advanced collapse specifically (not by the filter or changedOnly) - the
   * count a "N more" affordance would show. May be 0 while the group still has advanced rows, e.g.
   * when `showAdvanced` is already true, or when the active filter already reveals every advanced
   * row on its own merits - see `hasAdvanced` for whether the toggle itself should still appear. */
  advancedHidden: number
  /** Whether this group contains any `def.common === false` row at all, computed over every def in
   * the group independently of `filter`, `changedOnly` and `showAdvanced`. Unlike `advancedHidden`
   * (which can legitimately read 0 while expanded, or while a filter already reveals everything),
   * this is what the "Show/Hide advanced" toggle button's own visibility should gate on - otherwise
   * expanding a group makes its own collapse button disappear, and an active filter can make the
   * button vanish while rows are still really collapsed underneath it (review finding). */
  hasAdvanced: boolean
}

export interface BuildCvarGroupsOptions {
  /** `draft.cvars`-shaped map; a missing key is treated as unset (`''`), same as `CvarRow` today. */
  values: Record<string, string>
  engine: EngineKind | null
  /** Case-insensitive; matched against the cvar's name and its resolved label/description text (per
   * the sprint decision "Filter matches cvar name, label and description (case-insensitive)") -
   * falling back to `labelKey`/`descriptionKey` themselves when no resolver is supplied. Empty/
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
  /** Restrict rendered rows to changed ones. Does not affect `total`/`changed` counts. */
  changedOnly?: boolean
  /** When `false`, rows where `def.common` is falsy are hidden - unless the row also matches an
   * active `filter`, in which case it is revealed: a filter hit inside a collapsed Advanced
   * section must never look like "no results". */
  showAdvanced?: boolean
}

/**
 * True when `filter` (already known non-empty) matches `def`'s name or its resolved label/
 * description text. `labelText`/`descriptionText` are optional so existing callers that only care
 * about matching the cvar name (or that have no i18n resolver handy, e.g. this file's own tests)
 * keep working - they fall back to the untranslated key, which is never what a real user types but
 * is still a stable, deterministic string to match against.
 */
function matchesFilter(
  def: CvarDef,
  filter: string,
  labelText?: (def: CvarDef) => string,
  descriptionText?: (def: CvarDef) => string,
): boolean {
  const needle = filter.trim().toLowerCase()
  const label = (labelText?.(def) ?? def.labelKey).toLowerCase()
  const description = (descriptionText?.(def) ?? def.descriptionKey).toLowerCase()
  return (
    def.name.toLowerCase().includes(needle) || label.includes(needle) || description.includes(needle)
  )
}

/**
 * Groups `defs` into the fixed Player/Network/Graphics/Sound order, each with the rows to render
 * and the counts their header needs.
 *
 * `total`/`changed` are computed over every cvar in the group before filter, `changedOnly` or the
 * Advanced collapse are applied - the group header always reports the group's real size, not the
 * current view's. `rows` is what is left after all three: the Advanced collapse is checked first
 * (an active filter match rescues a non-common row from it), then the filter, then `changedOnly`.
 */
export function buildCvarGroups(
  defs: CvarDef[],
  {
    values,
    engine,
    filter = '',
    labelText,
    descriptionText,
    changedOnly = false,
    showAdvanced = true,
  }: BuildCvarGroupsOptions,
): CvarGroupResult[] {
  const filterActive = filter.trim() !== ''

  return GROUP_ORDER.map((group) => {
    const groupDefs = defs.filter((def) => def.group === group)
    // Independent of `filter`/`changedOnly`/`showAdvanced` - the group genuinely has an advanced
    // section iff any of its defs are non-common, full stop (review finding: this must not go to 0
    // just because the section happens to be expanded or a filter happens to reveal everything).
    const hasAdvanced = groupDefs.some((def) => def.common === false)

    let changedCount = 0
    let advancedHidden = 0
    const rows: CvarRowEntry[] = []

    for (const def of groupDefs) {
      const value = values[def.name] ?? ''
      const changed = isChanged(def, engine, value)
      if (changed) changedCount += 1

      const matches = !filterActive || matchesFilter(def, filter, labelText, descriptionText)

      // Advanced collapse: a non-common row is hidden unless a filter is active and this row is
      // one of its hits - otherwise filtering into a collapsed section would look like "no
      // results" (sprint decision).
      if (!showAdvanced && !def.common && !(filterActive && matches)) {
        advancedHidden += 1
        continue
      }

      if (filterActive && !matches) continue
      if (changedOnly && !changed) continue

      rows.push({ def, changed })
    }

    return { group, total: groupDefs.length, changed: changedCount, rows, advancedHidden, hasAdvanced }
  })
}
