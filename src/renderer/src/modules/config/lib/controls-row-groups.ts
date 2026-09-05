/**
 * Catalogue-group derivation for the Controls grid (story 020 D3, generalised in D4).
 *
 * Decision (Sprint): "Group rules (label + count) come from the action catalogue's own groups; a
 * category without catalogue groups (every custom one) renders its entries as one ungrouped run —
 * grouping is a catalogue property, not something the user authors in this story." A row's group
 * is therefore read off its `catalogId`'s namespace prefix (`lib/catalog-binds.ts`'s
 * `CatalogRowKind`: `movement`, `weaponUse`, `weaponExtra`, `dropWeapon`, `dropAmmo`, `dropMisc`),
 * not off `categoryId` — movement has a `CatalogRowKind` of its own but no subgroup, so it (like
 * every custom category, and any entry with no `catalogId` at all) falls into the ungrouped run.
 *
 * D4 widens this from `ConfigAction[]` to `ControlsRowEntry[]` (`lib/controls-row-entries.ts`): a
 * `'catalog'` entry's group comes off `row.catalogId`, a plain `'action'` entry's off
 * `action.catalogId` (empty for a free-form entry, so it lands in the ungrouped run).
 *
 * Story 052 D8 changes nothing here, deliberately: this module is a pure function of whatever row
 * list it is handed, and that list is now the profile's own entries in the profile's own order
 * instead of the catalogue's full shape. So the headers stay catalogue-derived (until story 053
 * makes them real sub-categories) but only ever over rows that exist - a group the profile has no
 * entries for is never rendered, and a group's rows are however many the profile carries.
 *
 * Pure and hook-free like `catalog-binds.ts`, so `ControlsTab`/`ControlsGrid` can resolve the
 * group's i18n label with `useTranslation()` while this module stays trivially testable.
 */

import type { ControlsRowEntry } from './controls-row-entries'

/** i18n key for each `CatalogRowKind` prefix that has a catalogue subgroup of its own. A prefix
 * missing from this map (including `movement`, which has no subgroup) resolves to `null` — the
 * ungrouped run. */
const GROUP_LABEL_KEY_BY_PREFIX: Record<string, string> = {
  weaponUse: 'config.controls.dualBind.weaponsUseGroup',
  weaponExtra: 'config.controls.dualBind.weaponsCycleGroup',
  dropWeapon: 'config.controls.dropBind.weaponsGroup',
  dropAmmo: 'config.controls.dropBind.ammoGroup',
  dropMisc: 'config.controls.dropBind.miscGroup',
}

function labelKeyForPrefix(catalogId: string | undefined): string | null {
  if (!catalogId) return null
  const prefix = catalogId.split(':')[0] ?? ''
  return GROUP_LABEL_KEY_BY_PREFIX[prefix] ?? null
}

/** The i18n key naming `entry`'s catalogue group, or `null` when it has none. */
export function groupLabelKeyForEntry(entry: ControlsRowEntry): string | null {
  return labelKeyForPrefix(entry.kind === 'catalog' ? entry.row.catalogId : entry.action.catalogId)
}

export interface ControlsRowGroup {
  /** `null` renders as the ungrouped run (no rule/label/count row) — see the module doc comment. */
  labelKey: string | null
  entries: ControlsRowEntry[]
}

/**
 * Groups `entries` (already filtered to one category, in the profile's own array order — story
 * 019's ordering model, which story 052 D8 extends to catalogue-backed rows) by
 * catalogue group. Preserves each entry's relative order and each group's first-seen position;
 * every entry with no group (including all of a custom category's, and every legacy "Other
 * actions" entry) collapses into a single `labelKey: null` bucket rather than one group per entry.
 */
export function groupControlsRowEntries(entries: ControlsRowEntry[]): ControlsRowGroup[] {
  const groups: ControlsRowGroup[] = []
  const indexByLabelKey = new Map<string | null, number>()

  for (const entry of entries) {
    const labelKey = groupLabelKeyForEntry(entry)
    let index = indexByLabelKey.get(labelKey)
    if (index === undefined) {
      index = groups.length
      indexByLabelKey.set(labelKey, index)
      groups.push({ labelKey, entries: [] })
    }
    groups[index]!.entries.push(entry)
  }

  return groups
}
