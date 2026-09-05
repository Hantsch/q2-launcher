/**
 * Sub-category derivation for the Controls grid (story 020 D3, generalised in D4, replaced by
 * story 053 D5).
 *
 * D5 deletes the catalogue-id-prefix grouping this module used to do (`GROUP_LABEL_KEY_BY_PREFIX`,
 * which read a row's `CatalogRowKind` namespace off its `catalogId`) and groups by the profile's
 * own data instead: a category's `subcategories` array (story 053 D1,
 * `@shared/modules/config`'s `ConfigActionCategory.subcategories`), in that array's own order, and
 * each entry's `action.subcategoryId`. An entry whose `subcategoryId` is unset, or names an id the
 * category's `subcategories` does not have, is ungrouped - mirroring how a dangling `categoryId`
 * already falls into `render.ts`'s "other" bucket instead of erroring (story 053's own decision).
 *
 * The ungrouped run always renders first, then one group per `subcategories` entry in the
 * category's own order - the same shape the file writer (`render.ts`'s `withSubcategoryBuckets`,
 * story 053 D2) already produces on disk. Every subcategory the category has gets a group here,
 * even one with no rows yet: an empty sub-category still has to be visible so it can be renamed,
 * reordered or deleted (story 053 D6) and so a freshly created one does not appear to vanish.
 *
 * Pure and hook-free like `catalog-binds.ts`, so `ControlsTab`/`ControlsGrid` can resolve
 * everything else (i18n, row rendering) while this module stays trivially testable.
 */

import type { ConfigActionSubcategory } from '@shared/modules/config'
import type { ControlsRowEntry } from './controls-row-entries'

export interface ControlsRowGroup {
  /** `null` renders as the ungrouped run (no header/rule/count row) - see the module doc comment.
   * Otherwise the real sub-category this group's rows belong to; its `name` is the profile's own
   * user-typed prose, not an i18n key. */
  subcategory: ConfigActionSubcategory | null
  entries: ControlsRowEntry[]
}

/**
 * Groups `entries` (already filtered to one category, in the profile's own array order - story
 * 019's ordering model) by `subcategories` (the same category's `ConfigActionCategory.subcategories`,
 * or `[]` for a category with none). Preserves each entry's relative order within its group.
 *
 * The ungrouped run collects every entry with no `subcategoryId`, or one that does not match any
 * of `subcategories` - and is always the first group, even when empty (its `labelKey`-equivalent,
 * `subcategory: null`, keeps `ControlsGrid` from rendering a header/count for it either way).
 */
export function groupControlsRowEntries(
  entries: ControlsRowEntry[],
  subcategories: readonly ConfigActionSubcategory[] = [],
): ControlsRowGroup[] {
  const groups: ControlsRowGroup[] = [{ subcategory: null, entries: [] }]
  const indexById = new Map<string, number>()
  subcategories.forEach((subcategory) => {
    indexById.set(subcategory.id, groups.length)
    groups.push({ subcategory, entries: [] })
  })

  for (const entry of entries) {
    const subcategoryId = entry.action.subcategoryId
    const index = subcategoryId !== undefined ? indexById.get(subcategoryId) : undefined
    groups[index ?? 0]!.entries.push(entry)
  }

  return groups
}
