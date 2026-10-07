/**
 * Plain-English display labels for the writer's section banners and trailing comments. `render.ts`
 * also runs in main, where no `t()` exists, and a translated comment would break latin-1 safety and
 * byte-determinism on a locale change, so every name comes from plain text in the profile or the
 * shared layer - never `t()` or a `nameKey`.
 */

import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import {
  DEMO_ACTIONS,
  DROPPABLES,
  MOVEMENT_ACTIONS,
  WEAPON_ACTIONS,
  WEAPON_EXTRA_ACTIONS,
} from '@shared/config/catalog/action-catalog'
import {
  buildDemoRows,
  buildDropGroups,
  buildMovementRows,
  buildWeaponRows,
} from '@shared/config/catalog/catalog-rows'

/**
 * `catalogId -> label`, built once from the same catalogue-row builders (same rows, order and
 * index-based pairing) as the renderer's `controls-row-entries.ts#zip`, resolving `label` instead
 * of `labelKey`.
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
  pair(
    drops.weapon,
    DROPPABLES.filter((d) => d.kind === 'weapon'),
  )
  pair(
    drops.ammo,
    DROPPABLES.filter((d) => d.kind === 'ammo'),
  )
  pair(
    drops.misc,
    DROPPABLES.filter((d) => d.kind === 'powerup' || d.kind === 'tech'),
  )
  pair(buildDemoRows(), DEMO_ACTIONS)

  return labels
}

const CATALOG_LABELS = buildCatalogLabels()

/**
 * The display name a trailing `//` comment shows for `action`: a materialised catalogue row always
 * shows its catalogue label (the source of truth); everything else, including a retired
 * `catalogId`, shows `action.name`. `_profile` only keeps this and `categoryLabelFor` on one shape.
 */
export function commentLabelFor(action: ConfigAction, _profile: ConfigProfile): string {
  const catalogLabel = action.catalogId ? CATALOG_LABELS.get(action.catalogId) : undefined
  return catalogLabel ?? action.name
}

/**
 * The display name a section banner shows for a category id: the stored `name` (so even a built-in
 * can be renamed), never `nameKey`. `profile.categories` is optional, hence `?? []`; a stale id
 * falls back to itself so a banner is never empty.
 */
export function categoryLabelFor(categoryIdOrName: string, profile: ConfigProfile): string {
  const category = (profile.categories ?? []).find((entry) => entry.id === categoryIdOrName)
  return category?.name ?? categoryIdOrName
}

/**
 * The display name a second-level banner shows for a sub-category id: the stored
 * `name`, never `nameKey` (a sub-category is always user-typed). `categoryId` narrows the search
 * because a sub-category id is only unique within its category. An unknown id falls back to the id.
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
 * The display name a cvar-section banner shows for a section id: the stored `name`,
 * never `nameKey` (main has no `t()`, so the frozen English `name` is the only prose allowed). An
 * unknown id, or the reserved `defaults`/`other` ids never looked up by name, falls back to the id.
 */
export function cvarSectionLabelFor(sectionId: string, profile: ConfigProfile): string {
  const section = (profile.cvarSections ?? []).find((entry) => entry.id === sectionId)
  return section?.name ?? sectionId
}

/**
 * The display name a cvar-sub-section banner shows: the stored `name`, never `nameKey`
 * (`ConfigCvarSubsection` has none). `sectionId` narrows the search; an unknown id falls back to
 * the id.
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
