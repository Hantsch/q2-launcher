/**
 * Unified row-entry adapter for the Controls grid (story 020 D4, rewritten by story 052 D8).
 *
 * A row is one of `profile.actions`, full stop. Until story 052 this module also *invented* rows:
 * for `movement`/`weapons`/`drops` it walked the action catalogue and emitted one row per catalogue
 * entry whether or not the profile carried it, with `action: undefined` for the ones it did not
 * ("lazy materialisation", `catalog-binds.ts`). That is what made the Controls tab a catalogue with
 * the user's config laid over it rather than an editor of that config - and an invented row has no
 * entry to reorder, which is why only free-form rows could be moved. D6's migration has since
 * materialised every catalogue row into every existing profile, and `STANDARD_TEMPLATE` seeds them
 * for new ones, so nothing is lost by building the list from `profile.actions` alone.
 *
 * The catalogue does not disappear, it changes job: it is now *knowledge about an entry the profile
 * already has*, not a source of rows. An action whose `catalogId` names a known catalogue row still
 * renders as a `'catalog'` entry - that is what gives it its translated display name, its fixed
 * command text, and (for drops) the ammo/message options - but its `action` is always present, so
 * every editing path writes to a real entry by id.
 *
 * `labelKey`, not a resolved `label` string, is what a catalogue entry carries here: resolving it
 * needs `useTranslation()`, and this module stays hook-free like `catalog-binds.ts` so it can be
 * unit-tested without a DOM. The caller (`ControlsTab`, which already has `t`) resolves it at
 * render time.
 */

import {
  DROPPABLES,
  MOVEMENT_ACTIONS,
  WEAPON_ACTIONS,
  WEAPON_EXTRA_ACTIONS,
} from '@shared/config/action-catalog'
import type { ConfigAction } from '@shared/modules/config'
import { buildDropGroups, buildMovementRows, buildWeaponRows, type CatalogRow } from './catalog-binds'

/** What the catalogue knows about one of its rows: the row itself plus the i18n key naming it. */
export interface CatalogRowInfo {
  row: CatalogRow
  labelKey: string
}

/** A row backed by an entry the profile has *and* whose `catalogId` still names a catalogue row.
 * `action` is always present - an entry the profile does not carry has no row (story 052 D8). */
export interface CatalogControlsRowEntry extends CatalogRowInfo {
  kind: 'catalog'
  action: ConfigAction
}

/** Every other entry: a free-form action the user authored, or one whose `catalogId` names nothing
 * the catalogue still has (a row retired from the catalogue after the entry was created). */
export interface ActionControlsRowEntry {
  kind: 'action'
  action: ConfigAction
}

export type ControlsRowEntry = CatalogControlsRowEntry | ActionControlsRowEntry

/**
 * `catalogId -> { row, labelKey }` for every catalogue row there is, built once at module load.
 *
 * The index-based pairing of a builder's rows with its source catalogue array is the same idiom
 * `comment-labels.ts#buildCatalogLabels` uses in the shared layer (same rows, same order) - it
 * resolves `label` for the file writer, this one resolves `labelKey` for the UI.
 */
function buildCatalogRowIndex(): ReadonlyMap<string, CatalogRowInfo> {
  const index = new Map<string, CatalogRowInfo>()
  const pair = (rows: CatalogRow[], source: { labelKey: string }[]): void => {
    rows.forEach((row, i) => index.set(row.catalogId, { row, labelKey: source[i]!.labelKey }))
  }

  pair(buildMovementRows(), MOVEMENT_ACTIONS)
  const { useRows, extraRows } = buildWeaponRows()
  pair(useRows, WEAPON_ACTIONS)
  pair(extraRows, WEAPON_EXTRA_ACTIONS)
  const drops = buildDropGroups()
  pair(drops.weapon, DROPPABLES.filter((d) => d.kind === 'weapon'))
  pair(drops.ammo, DROPPABLES.filter((d) => d.kind === 'ammo'))
  pair(drops.misc, DROPPABLES.filter((d) => d.kind === 'powerup' || d.kind === 'tech'))

  return index
}

const CATALOG_ROWS_BY_ID = buildCatalogRowIndex()

/** What the catalogue knows about `catalogId`, or `undefined` for an entry with no `catalogId` and
 * for one naming a row the catalogue no longer has. */
export function catalogRowInfo(catalogId: string | undefined): CatalogRowInfo | undefined {
  return catalogId ? CATALOG_ROWS_BY_ID.get(catalogId) : undefined
}

/** Every catalogue row there is, in the catalogue's own order - the source "Add action"'s
 * suggestion list draws from (story 052 D9). Same knowledge `catalogRowInfo` exposes per id, just
 * as one flat list rather than a lookup. */
export function allCatalogRowInfos(): CatalogRowInfo[] {
  return Array.from(CATALOG_ROWS_BY_ID.values())
}

/** The row `action` renders as: a catalogue row when the catalogue still knows its `catalogId`,
 * a plain entry otherwise. */
export function controlsRowEntryFor(action: ConfigAction): ControlsRowEntry {
  const info = catalogRowInfo(action.catalogId)
  return info ? { kind: 'catalog', row: info.row, labelKey: info.labelKey, action } : { kind: 'action', action }
}

/**
 * The rows of one category: exactly the profile's entries filed under `categoryId`, in
 * `profile.actions`' own array order (story 019's ordering model, which `swapEntries` edits) - no
 * row for an entry the profile does not have, in any category (story 052 AC 3).
 *
 * `actions` is the full draft array rather than a pre-filtered one, so a row's index here and the
 * neighbour walk a move does stay derived from the same source.
 */
export function buildControlsRowEntries(
  categoryId: string,
  actions: ConfigAction[],
): ControlsRowEntry[] {
  return actions
    .filter((action) => action.categoryId === categoryId)
    .map((action) => controlsRowEntryFor(action))
}
