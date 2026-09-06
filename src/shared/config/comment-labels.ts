/**
 * Plain-English display labels for the config-file writer's section banners and trailing
 * comments (story 040 D1).
 *
 * `render.ts` (D2/D3) is pure shared code that also runs in main, where no `t()` exists, and a
 * translated comment would break both latin-1 safety and byte-determinism the moment the UI
 * locale changes (see that story's Decisions). So every name this module resolves comes from
 * plain text already sitting in the profile or in the shared layer (`action-catalog.ts`'s `label`
 * fields, a `ConfigActionCategory`'s own `name`) rather than from i18n - never a
 * `useTranslation()` import, never a `t()` call, and never a `nameKey` (which is a key, not prose).
 *
 * Reuse check (done before writing this file, per the story): story 039's
 * `alias-render.ts`/`alias-names.ts` resolve an action's *engine alias name* (`ssg_sg`, not
 * `q2l_a_ssg_sg_9a2f`) - a different question from "what plain-English name does a comment show
 * for this entry", and neither file exports anything answering that. This module is the first
 * shared display-label source, not a second one.
 */

import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
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
 * The display name a section banner shows for a category id - the profile's own name for it, and
 * nothing else (story 052 D4).
 *
 * Until 052 this consulted `BUILT_IN_ACTION_CATEGORIES` first, so the three built-in ids resolved to
 * a constant's `label` whatever the profile said - which is exactly what made renaming one of them
 * impossible: the file kept writing `Movement` over the user's own name. Categories are ordinary,
 * profile-owned data now, so the one authority on a category's name is `profile.categories`' stored
 * `name` (user-typed text, verbatim - never `nameKey`, which is an i18n key the renderer resolves
 * and this file may not: `render.ts` runs in main, where no `t()` exists, and prose is what a config
 * comment needs). A template-seeded category carries the English default as its `name`, so a
 * seeded Movement section still reads `Movement` until the user renames it.
 *
 * `profile.categories` is optional on `ConfigProfile` (pre-story-008 profiles omit it), hence the
 * `?? []`. A `categoryIdOrName` the profile does not carry - stale data pointing at a category that
 * was since removed - falls back to the id itself, so a banner is never empty. (`render.ts` never
 * asks about one: `orderedCategoryIds` only offers ids the profile has, and everything else lands in
 * its trailing "other" bucket. The fallback stands for the other callers, and so that a future one
 * cannot get an empty string.)
 */
export function categoryLabelFor(categoryIdOrName: string, profile: ConfigProfile): string {
  const category = (profile.categories ?? []).find((entry) => entry.id === categoryIdOrName)
  return category?.name ?? categoryIdOrName
}

/**
 * The display name a second-level section banner shows for a sub-category id (story 053 D2) -
 * mirrors `categoryLabelFor` one level down: the profile's own stored `name` for that
 * sub-category, and nothing else (never `nameKey` - `ConfigActionSubcategory` has none, since a
 * sub-category is always user-typed, never seeded from a translated built-in).
 *
 * `categoryId` narrows the search to the one category the sub-category has to belong to (a
 * sub-category id is only unique within its own category's `subcategories` array, never
 * profile-wide) - the same reason `render.ts` never calls this without already knowing which
 * category section the banner sits inside. A `subcategoryId` the named category does not carry -
 * stale data, or a category looked up by the wrong id - falls back to the id itself, so a banner
 * is never empty, exactly like `categoryLabelFor`'s own fallback.
 */
export function subcategoryLabelFor(
  categoryId: string,
  subcategoryId: string,
  profile: ConfigProfile,
): string {
  const category = (profile.categories ?? []).find((entry) => entry.id === categoryId)
  const subcategory = category?.subcategories?.find((entry) => entry.id === subcategoryId)
  return subcategory?.name ?? subcategoryId
}

/**
 * The display name a cvar-section banner shows for a section id (story 059 D2) - mirrors
 * `categoryLabelFor` one level down, field for field: the profile's own stored `name`, never
 * `nameKey` (a `ConfigCvarSection` carries one for the same reason a category does - a seeded
 * section's renderer-side i18n hint - but `render.ts` runs in main, where no `t()` exists, so the
 * frozen English `name` is the only prose this file may show, exactly as `categoryLabelFor`
 * decided for categories). A `sectionId` the profile does not carry - stale data pointing at a
 * section since removed, or the reserved `defaults`/`other` ids this file never looks up by name -
 * falls back to the id itself, so a banner is never empty.
 */
export function cvarSectionLabelFor(sectionId: string, profile: ConfigProfile): string {
  const section = (profile.cvarSections ?? []).find((entry) => entry.id === sectionId)
  return section?.name ?? sectionId
}

/**
 * The display name a cvar-sub-section banner shows for a sub-section id (story 059 D2) - mirrors
 * `subcategoryLabelFor` one level down: the profile's own stored `name`, never `nameKey`
 * (`ConfigCvarSubsection` has none, same "always user-typed, never seeded from a translated
 * built-in" rule `ConfigActionSubcategory` follows). `sectionId` narrows the search to the one
 * section the sub-section has to belong to, same reasoning `subcategoryLabelFor` gives. A
 * `subsectionId` the named section does not carry falls back to the id itself.
 */
export function cvarSubsectionLabelFor(
  sectionId: string,
  subsectionId: string,
  profile: ConfigProfile,
): string {
  const section = (profile.cvarSections ?? []).find((entry) => entry.id === sectionId)
  const subsection = section?.subsections?.find((entry) => entry.id === subsectionId)
  return subsection?.name ?? subsectionId
}
