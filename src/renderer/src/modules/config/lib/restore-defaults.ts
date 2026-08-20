/**
 * Story 020 D10: "Restore defaults" for the whole profile (sprint decision - not per category).
 *
 * The only definition of "default" this repo has (sprint decision): a catalogue row's own
 * `suggestedKeys[0]` goes into its primary slot, its secondary is cleared, and a catalogue row
 * with no `suggestedKeys` (or an empty array) is cleared exactly like a row with no catalogue
 * entry at all - there is nothing to restore it to. Every other action (a custom category's own
 * `bind`/`message`/`alias` entry, or a legacy free-form "Other actions" entry - anything with no
 * `catalogId`) keeps existing but loses its key/secondary/modifiers; its `commands`, `name`,
 * `kind` and `categoryId` are never touched, because "restored" here means "unbound", not "gone".
 *
 * Pure, like every other `lib/*.ts` file in this module - no DOM, no hooks, no IPC - so it can run
 * synchronously from `ControlsTab`'s confirm handler and be unit-tested without a DOM environment.
 *
 * `CatalogRow` itself carries no `suggestedKeys` (see `catalog-binds.ts`'s own docstring on why it
 * stays hook-free and label-free) - `zip` below pairs each row back to its source catalogue
 * entry's `suggestedKeys` by index, the same technique `DualBindPanel`/`DropBindPanel` already use
 * to resolve a row's `labelKey`. `buildDropGroups`'s three groups need no such pairing:
 * `DroppableDef` has no `suggestedKeys` field at all, so every drops row is always cleared.
 */

import { MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import type { ConfigAction } from '@shared/modules/config'
import {
  applyPlainSlot,
  applySlot,
  buildDropGroups,
  buildMovementRows,
  buildWeaponRows,
  type CatalogRow,
} from './catalog-binds'

interface DefaultableRow {
  row: CatalogRow
  suggestedKeys?: string[]
}

/** Pairs catalogue rows back to their source defs' `suggestedKeys` by index (same technique
 * `DualBindPanel`/`DropBindPanel` use for `labelKey`) - `suggestedKeys` is `Action.suggestedKeys`
 * for movement/weapon rows and always `undefined` for drop rows, since `DroppableDef` has no such
 * field at all (there is nothing to restore a drop row to). */
function zip(rows: CatalogRow[], suggestedKeys: (string[] | undefined)[]): DefaultableRow[] {
  return rows.map((row, index) => ({ row, suggestedKeys: suggestedKeys[index] }))
}

/** Every catalogue row across all three built-in categories, paired with its source def's
 * `suggestedKeys` (movement/weapon-use/weapon-extra actions carry it directly; droppables never
 * do, so every drops row zips to `undefined` and is therefore always cleared, never defaulted). */
function allCatalogRows(): DefaultableRow[] {
  const { useRows, extraRows } = buildWeaponRows()
  const { weapon, ammo, misc } = buildDropGroups()

  // `DroppableDef` has no `suggestedKeys` field at all - every drops row zips to `undefined`
  // directly, there is nothing in `DROPPABLES` to pull it from.
  const noDefault = (row: CatalogRow): DefaultableRow => ({ row, suggestedKeys: undefined })

  return [
    ...zip(
      buildMovementRows(),
      MOVEMENT_ACTIONS.map((action) => action.suggestedKeys),
    ),
    ...zip(
      useRows,
      WEAPON_ACTIONS.map((action) => action.suggestedKeys),
    ),
    ...zip(
      extraRows,
      WEAPON_EXTRA_ACTIONS.map((action) => action.suggestedKeys),
    ),
    ...weapon.map(noDefault),
    ...ammo.map(noDefault),
    ...misc.map(noDefault),
  ]
}

/**
 * Restore every catalogue row to its `suggestedKeys[0]` default (secondary cleared), and clear
 * every other action's key data - across the whole `actions` array, in one pass. Threaded
 * reduce-style through `applySlot`/`applyPlainSlot` so each write sees the previous ones' results,
 * exactly as it would if the user had clicked through every row by hand. Always a new array - the
 * input is never mutated, same discipline `catalog-binds.ts`/`bind-slot-collision.ts` follow.
 */
export function restoreDefaultActions(actions: ConfigAction[]): ConfigAction[] {
  let next = actions

  for (const { row, suggestedKeys } of allCatalogRows()) {
    const defaultKey = suggestedKeys && suggestedKeys.length > 0 ? suggestedKeys[0] : undefined
    next = applySlot(next, row, 'primary', defaultKey)
    next = applySlot(next, row, 'secondary', undefined)
  }

  // Every action with no `catalogId` - a custom category's own entry or a legacy free-form
  // "Other actions" entry - has no catalogue default; it is cleared, never removed (decision:
  // "cleared" means "no longer bound", not "gone"). Collected before mutating so a row created
  // above (a previously-unbound catalogue row that just got a default) is never mistaken for one
  // of these - it always carries a `catalogId` and is skipped here regardless.
  const plainActionIds = next.filter((action) => !action.catalogId).map((action) => action.id)
  for (const actionId of plainActionIds) {
    next = applyPlainSlot(next, actionId, 'primary', undefined)
    next = applyPlainSlot(next, actionId, 'secondary', undefined)
  }

  return next
}
