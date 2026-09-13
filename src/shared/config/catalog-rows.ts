/**
 * The catalogue row model - one row per `action-catalog.ts` entry, identified
 * by a stable `catalogId` (story 015 D3; moved out of the renderer's
 * `modules/config/lib/catalog-binds.ts` by story 034).
 *
 * It lives in `src/shared` because both sides need the *same* row identity
 * vocabulary now: the Controls grid materialises a row into a `ConfigAction`
 * (renderer), and main's bind adoption (`bind-adoption.ts`) has to recognise a
 * raw `bind w "+forward"` as *that same row* and materialise the identical
 * `catalogId`. Two implementations of the id format would drift, and a drifted
 * `catalogId` is a row the editor can no longer find - the exact class of bug
 * `catalog-binds.ts`'s own docstring exists to prevent.
 *
 * Pure by contract, like every other file here: no node, no DOM, no electron,
 * and no `crypto.randomUUID` either - minting an action id stays with the
 * caller that has a suitable factory (the renderer's `freshAction`, main's
 * `randomUUID`).
 */

import type { ActionCategoryId, DroppableDef } from '@shared/config/action-catalog'
import { DROPPABLES, MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from '@shared/config/action-catalog'
import type { ConfigCommand } from '@shared/modules/config'

/** Which catalogue family a row was built from - used only to namespace `catalogId`s so two
 * different families' entries (e.g. movement's `attack` and a droppable named `attack`) can
 * never collide. */
export type CatalogRowKind = 'movement' | 'weaponUse' | 'weaponExtra' | 'dropWeapon' | 'dropAmmo' | 'dropMisc'

/**
 * The three `CatalogRowKind`s that make a row a *drop* row (story 055). Typed as a set of plain
 * strings because both readers start from a `catalogId`'s first segment, which is a `string`:
 * `alias-render.ts#isDropCatalogueEntry` (does this entry render under a `drop_` name?) and
 * `isDropCatalogRow` below (does this row get the two drop toggles?). One set, next to the kind
 * union it enumerates - two copies of "which kinds are drops" would drift the moment a fourth drop
 * family is added.
 */
export const DROP_CATALOG_ROW_KINDS: ReadonlySet<string> = new Set([
  'dropWeapon',
  'dropAmmo',
  'dropMisc',
])

/**
 * Is this catalogue row a drop row - *regardless of what its entry's body currently says*?
 *
 * Story 055 review, finding 1: `drop-entries.ts#isDropEntry` needs an actual `drop <item>` command
 * in the body, and a freshly-seeded template drop row starts with `commands: []`
 * (`migrations.ts#materialiseTemplateCategories`), so on a brand-new profile every one of the
 * template's drop rows would show no options at all. The row itself still knows what it is, from
 * its `catalogId`'s kind prefix - the same signal `alias-render.ts` reads - so the Options cell
 * gates on `isDropEntry(action) || isDropCatalogRow(row)` and gets the pre-D3 behaviour back for a
 * row whose body has not been written yet.
 */
export function isDropCatalogRow(row: CatalogRow): boolean {
  return DROP_CATALOG_ROW_KINDS.has(row.catalogId.split(':')[0] ?? '')
}

export interface CatalogRow {
  /** Stable id used to find/create the matching `ConfigAction` - never the row's label. */
  catalogId: string
  categoryId: ActionCategoryId
  /** Raw engine command(s) this row represents when nothing extra is chosen, e.g. `['+forward']`
   * or `['drop rocket launcher']`. Does not include the ammo command - see `ammoCommand`. */
  commands: string[]
  /** Present only when the row has a distinct ammo-drop command (a droppable with a matching
   * `ammo` item). Absent for rows with no ammo type at all (decision 8). */
  ammoCommand?: string
  /** Mirrors `Action.continuous` for movement rows - a `+command` press/release pair that must
   * never share a key with another command. */
  continuous?: boolean
}

function makeCatalogId(kind: CatalogRowKind, id: string): string {
  return `${kind}:${id}`
}

/** One row per `MOVEMENT_ACTIONS` entry - no ammo choice, no message (decision: movement-only). */
export function buildMovementRows(): CatalogRow[] {
  return MOVEMENT_ACTIONS.map((action) => ({
    catalogId: makeCatalogId('movement', action.id),
    categoryId: 'movement',
    commands: [action.command],
    continuous: action.continuous,
  }))
}

/**
 * Two independent groups (decision 10): the 11 `use <weapon>` rows (incl.
 * Blaster) and the 3 weapon-cycling rows. Neither group has an ammo choice or
 * a message.
 */
export function buildWeaponRows(): { useRows: CatalogRow[]; extraRows: CatalogRow[] } {
  return {
    useRows: WEAPON_ACTIONS.map((action) => ({
      catalogId: makeCatalogId('weaponUse', action.id),
      categoryId: 'weapons',
      commands: [action.command],
    })),
    extraRows: WEAPON_EXTRA_ACTIONS.map((action) => ({
      catalogId: makeCatalogId('weaponExtra', action.id),
      categoryId: 'weapons',
      commands: [action.command],
    })),
  }
}

function dropRow(kind: CatalogRowKind, droppable: DroppableDef): CatalogRow {
  return {
    catalogId: makeCatalogId(kind, droppable.id),
    categoryId: 'drops',
    commands: [`drop ${droppable.item}`],
    ammoCommand: droppable.ammo ? `drop ${droppable.ammo}` : undefined,
  }
}

/**
 * Three groups from `DROPPABLES` (decision 11's Blaster exclusion falls out
 * for free: `DROPPABLES` already excludes it). `weapon`/`ammo` are their own
 * `kind`; `misc` folds `powerup` and `tech` together, matching the story's
 * "Misc (everything else droppable: powerups, tech)".
 */
export function buildDropGroups(): { weapon: CatalogRow[]; ammo: CatalogRow[]; misc: CatalogRow[] } {
  return {
    weapon: DROPPABLES.filter((d) => d.kind === 'weapon').map((d) => dropRow('dropWeapon', d)),
    ammo: DROPPABLES.filter((d) => d.kind === 'ammo').map((d) => dropRow('dropAmmo', d)),
    misc: DROPPABLES.filter((d) => d.kind === 'powerup' || d.kind === 'tech').map((d) => dropRow('dropMisc', d)),
  }
}

/**
 * Every catalogue row there is, in one flat list, in the order the Controls
 * grid itself renders them (movement, `use` weapons, weapon cycling, then the
 * three drop groups).
 *
 * The order is not cosmetic here: `bind-adoption.ts` resolves a raw command
 * back to a row by its command *text*, and two rows can render the same text
 * (`drop grenades` is both `dropWeapon:grenades` and `dropAmmo:hgrenades`), so
 * "first row in this list wins" is what makes that resolution deterministic.
 */
export function allCatalogRows(): CatalogRow[] {
  const { useRows, extraRows } = buildWeaponRows()
  const drops = buildDropGroups()
  return [...buildMovementRows(), ...useRows, ...extraRows, ...drops.weapon, ...drops.ammo, ...drops.misc]
}

/** Plain, non-translated, stable text for a catalogue row with no other display name yet - the
 * row's own raw command, the same "unbound row" name lazy materialisation already uses for these
 * rows (`catalog-binds.ts`'s `nameForRow`, `bind-adoption.ts`'s `materialise`). Exposed here so
 * `STANDARD_TEMPLATE` (`@shared/modules/config`, story 052 D1) can seed the same name for a
 * still-unbound row without a third, potentially-drifting copy of the rule. */
export function nameForCatalogRow(row: CatalogRow): string {
  return row.commands[0] ?? row.catalogId
}

/** A row's raw commands as `ConfigCommand`s, with the ammo command appended when applicable -
 * the shared piece of "what should this action's `commands` look like right now" that the
 * renderer's lazy materialisation and main's bind adoption both need. */
export function commandsForRow(row: CatalogRow, withAmmo: boolean): ConfigCommand[] {
  const commands: ConfigCommand[] = row.commands.map((text) => ({ kind: 'raw', text }))
  if (row.ammoCommand && withAmmo) commands.push({ kind: 'raw', text: row.ammoCommand })
  return commands
}
