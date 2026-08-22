/**
 * Plain-English display labels for the config-file writer's section banners and trailing
 * comments (story 040 D1).
 *
 * `render.ts` (D2/D3) is pure shared code that also runs in main, where no `t()` exists, and a
 * translated comment would break both latin-1 safety and byte-determinism the moment the UI
 * locale changes (see that story's Decisions). So every name this module resolves comes from a
 * plain ASCII literal already sitting in the shared layer (`action-catalog.ts`'s `label` fields,
 * `BUILT_IN_ACTION_CATEGORIES`' `label`) rather than from i18n - never a `useTranslation()` import,
 * never a `t()` call.
 *
 * Reuse check (done before writing this file, per the story): story 039's
 * `alias-render.ts`/`alias-names.ts` resolve an action's *engine alias name* (`ssg_sg`, not
 * `q2l_a_ssg_sg_9a2f`) - a different question from "what plain-English name does a comment show
 * for this entry", and neither file exports anything answering that. This module is the first
 * shared display-label source, not a second one.
 */

import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { BUILT_IN_ACTION_CATEGORIES } from '@shared/modules/config'
import { DROPPABLES, MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import { buildDropGroups, buildMovementRows, buildWeaponRows } from '@shared/config/catalog-rows'

/**
 * `catalogId -> label`, built once from the same shared, pure catalogue-row builders the renderer's
 * `controls-row-entries.ts#zip` already uses to pair a `CatalogRow` with its source catalogue
 * entry (same rows, same order, same index-based pairing) - just resolving `label` instead of
 * `labelKey`. Not exported: `commentLabelFor` below is the only thing that needs a `catalogId`
 * looked up by label, and building the map lazily per call would just repeat the same constant
 * work on every action this module is asked about.
 */
function buildCatalogLabels(): ReadonlyMap<string, string> {
  const labels = new Map<string, string>()
  const pair = (rows: { catalogId: string }[], source: { label: string }[]): void => {
    rows.forEach((row, index) => labels.set(row.catalogId, source[index]!.label))
  }

  pair(buildMovementRows(), MOVEMENT_ACTIONS)
  const { useRows, extraRows } = buildWeaponRows()
  pair(useRows, WEAPON_ACTIONS)
  pair(extraRows, WEAPON_EXTRA_ACTIONS)
  const drops = buildDropGroups()
  pair(drops.weapon, DROPPABLES.filter((d) => d.kind === 'weapon'))
  pair(drops.ammo, DROPPABLES.filter((d) => d.kind === 'ammo'))
  pair(drops.misc, DROPPABLES.filter((d) => d.kind === 'powerup' || d.kind === 'tech'))

  return labels
}

const CATALOG_LABELS = buildCatalogLabels()

/**
 * The display name a trailing `//` comment shows for `action` (story 040 D3 is the actual caller;
 * this is the pure resolver it calls).
 *
 * A materialised catalogue row (`action.catalogId` matches a real catalogue entry) always shows
 * that entry's catalogue label, never `action.name` - the two already agree in practice (catalogue
 * rows are seeded with their catalogue label as their `name`), but the catalogue is the source of
 * truth a comment should never disagree with even if that ever changes. Everything else - a
 * free-form bind/message, a `kind: 'alias'` entry, or an action whose `catalogId` no longer matches
 * any catalogue row (a row retired from the catalogue after the action was created) - falls back to
 * `action.name` verbatim, the only name a user-created entry has.
 *
 * `profile` is accepted, not read, purely so this function and `categoryLabelFor` below share one
 * two-argument shape: `render.ts` resolves both a comment and a category label per entry and can
 * call either uniformly without checking which one actually needs the profile in scope. Prefixed
 * with `_` under this project's `noUnusedParameters`.
 */
export function commentLabelFor(action: ConfigAction, _profile: ConfigProfile): string {
  const catalogLabel = action.catalogId ? CATALOG_LABELS.get(action.catalogId) : undefined
  return catalogLabel ?? action.name
}

/**
 * The display name a section banner shows for a category id (built-in or user-defined), or for a
 * user-defined category's own `name` passed straight through.
 *
 * Checks `BUILT_IN_ACTION_CATEGORIES` first (its `label`, never `action.name` or a translation),
 * then `profile.categories` (a user-created category's stored `name`, verbatim - it is user-typed
 * text, not translatable UI prose, same distinction `BuiltInActionCategory`/`ConfigActionCategory`
 * already draw). `profile.categories` is optional on `ConfigProfile` (pre-story-008 profiles omit
 * it), hence the `?? []`.
 *
 * A `categoryIdOrName` matching neither list - stale data pointing at a category that was since
 * removed - falls back to the id itself, so a section banner is never empty even for a category
 * the profile no longer really has.
 */
export function categoryLabelFor(categoryIdOrName: string, profile: ConfigProfile): string {
  const builtIn = BUILT_IN_ACTION_CATEGORIES.find((category) => category.id === categoryIdOrName)
  if (builtIn) return builtIn.label

  const custom = (profile.categories ?? []).find((category) => category.id === categoryIdOrName)
  if (custom) return custom.name

  return categoryIdOrName
}
