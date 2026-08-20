/**
 * Unified row-entry adapter for the Controls grid (story 020 D4).
 *
 * `ControlsGrid`/`ControlsRow` render one list per category, but a category's
 * rows come from two different sources depending on which category is
 * selected: `movement`/`weapons`/`drops` are catalogue-driven (`catalog-
 * binds.ts`'s `CatalogRow`, lazily materialised into a `ConfigAction` only
 * once something is actually bound - see that file's docstring), while every
 * other (custom) category is a plain, user-authored `ConfigAction[]`. Both
 * idioms already exist and are proven in `DualBindPanel.tsx`/`DropBindPanel.tsx`;
 * this module only gives `ControlsTab`/`ControlsGrid` one row-entry shape that
 * covers both, so the grid does not need to know which category it is
 * rendering.
 *
 * `labelKey`, not a resolved `label` string, is what a catalogue entry
 * carries here: resolving it needs `useTranslation()`, and this module stays
 * hook-free like `catalog-binds.ts` so it can be unit-tested without a DOM.
 * The caller (`ControlsTab`, which already has `t`) resolves it at render
 * time.
 */

import { DROPPABLES, MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import type { ConfigAction } from '@shared/modules/config'
import { buildDropGroups, buildMovementRows, buildWeaponRows, type CatalogRow } from './catalog-binds'

/** A row that came from the action catalogue - `action` is only present once the row has been
 * lazily materialised (decision 3 in `catalog-binds.ts`); an unbound catalogue row is still a
 * real entry, just with `action: undefined`. */
export interface CatalogControlsRowEntry {
  kind: 'catalog'
  row: CatalogRow
  labelKey: string
  action?: ConfigAction
}

/** A plain, user-authored entry: a custom category's action, or a pre-catalogue ("legacy")
 * free-form action living in a catalogue category under "Other actions" (decision 5 in
 * `DualBindPanel`/`DropBindPanel`). */
export interface ActionControlsRowEntry {
  kind: 'action'
  action: ConfigAction
}

export type ControlsRowEntry = CatalogControlsRowEntry | ActionControlsRowEntry

export type DualBindCategoryId = 'movement' | 'weapons' | 'drops'

function zip(rows: CatalogRow[], source: { labelKey: string }[], actions: ConfigAction[]): CatalogControlsRowEntry[] {
  return rows.map((row, index) => ({
    kind: 'catalog',
    row,
    labelKey: source[index]!.labelKey,
    action: actions.find((action) => action.catalogId === row.catalogId),
  }))
}

/**
 * The catalogue-driven row list for `movement`/`weapons`/`drops`, unioned with that category's
 * legacy free-form actions (`!action.catalogId`) - the same "Other actions" carve-out
 * `DualBindPanel`/`DropBindPanel` already use. `actions` is the full draft array, not
 * pre-filtered, since a catalogue row's matching action must be found by `catalogId` across the
 * whole array.
 */
export function buildCatalogControlsRowEntries(
  categoryId: DualBindCategoryId,
  actions: ConfigAction[],
): ControlsRowEntry[] {
  const legacy: ActionControlsRowEntry[] = actions
    .filter((action) => action.categoryId === categoryId && !action.catalogId)
    .map((action) => ({ kind: 'action', action }))

  if (categoryId === 'movement') {
    return [...zip(buildMovementRows(), MOVEMENT_ACTIONS, actions), ...legacy]
  }

  if (categoryId === 'weapons') {
    const { useRows, extraRows } = buildWeaponRows()
    return [
      ...zip(useRows, WEAPON_ACTIONS, actions),
      ...zip(extraRows, WEAPON_EXTRA_ACTIONS, actions),
      ...legacy,
    ]
  }

  const groups = buildDropGroups()
  return [
    ...zip(groups.weapon, DROPPABLES.filter((d) => d.kind === 'weapon'), actions),
    ...zip(groups.ammo, DROPPABLES.filter((d) => d.kind === 'ammo'), actions),
    ...zip(groups.misc, DROPPABLES.filter((d) => d.kind === 'powerup' || d.kind === 'tech'), actions),
    ...legacy,
  ]
}
