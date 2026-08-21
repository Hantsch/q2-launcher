/**
 * Catalogue row model for the Movement/Weapons/Weapon-dropping dual-bind
 * editor (story 015 D3).
 *
 * Movement, Weapons and Weapon dropping stop being free-form action lists
 * (story 008's `ActionEditor` path) and become a fixed set of rows read
 * straight from `action-catalog.ts` - one row per catalogue entry, each with
 * a Primary and a Secondary bind slot. A row is *not* a `ConfigAction`: most
 * rows are never touched by the user and must render "not bound" without a
 * matching persisted action existing at all (decision 3 - lazy
 * materialisation), so this module keeps the two concerns separate -
 * `CatalogRow` describes what a row *could* become, `deriveRowState` reads
 * back what it *did* become from `ConfigAction[]`, and the three `apply*`
 * functions are the only way that array changes.
 *
 * A row is identified by `catalogId`, never by its generated action's `name`
 * (decision 2) - `name` only exists because `ConfigAction` requires one, and
 * because it is what a legacy free-form action list ("Other actions",
 * decision 5) would show. It is plain, non-translated ASCII text (the row's
 * own raw engine command, e.g. `+forward` or `use rocket launcher`), not its
 * i18n label: resolving a `labelKey` needs `useTranslation()`, a React hook,
 * and this module has to stay hook-free so both a future component and this
 * file's own vitest suite can import it without a DOM environment.
 *
 * Story 016 D9: a modifier held during a capture ("Alt+R") is an ordinary
 * property of the row's action - `keyModifier`/`secondaryKeyModifier`, sitting
 * right next to `key`/`secondaryKey` - so `RowState` carries it and `applySlot`
 * writes it, and that is the whole of the renderer's involvement. Nothing here
 * touches `layers`: main derives every modifier layer's `overrides` from the
 * actions array on save (`applyActionLayerMirror`, called inside `setActions`).
 * There is deliberately no way to read a row's state out of a layer override
 * and no way to write one from here - the previous design did exactly that, by
 * reverse-parsing an override's command text, and could not tell apart two rows
 * that render the same command (`dropWeapon:grenades` vs. `dropAmmo:hgrenades`,
 * both `drop grenades`). Row identity lives in `catalogId` and the action's own
 * `id`; command text is never an identifier.
 *
 * Pure, like `trigger-keys.ts` and `bind-collision.ts` - no DOM, no store, no
 * IPC. `crypto.randomUUID()` is the one runtime dependency, same idiom
 * `ControlsTab.tsx`/`LayersPanel.tsx` already use for a fresh action/layer id.
 */

import { commandsForRow, type CatalogRow } from '@shared/config/catalog-rows'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigCommand } from '@shared/modules/config'

/**
 * Story 034: the row model itself (`CatalogRow`, the three builders, the
 * `catalogId` format) moved to `@shared/config/catalog-rows` - main's bind
 * adoption has to mint the identical `catalogId` for a raw bind it recognises,
 * and two implementations of that id format would drift. Re-exported here so
 * this module stays the one place the rest of the renderer imports the row
 * model from, exactly as before.
 */
export {
  buildDropGroups,
  buildMovementRows,
  buildWeaponRows,
  type CatalogRow,
  type CatalogRowKind,
} from '@shared/config/catalog-rows'

export interface RowState {
  primary?: string
  secondary?: string
  /** Story 016 D9: the modifier that was held while capturing `primary`, straight off the
   * action's `keyModifier`. Only ever set when `primary` is - a modifier without a key is not a
   * binding (see `applySlot`) - so a slot renders `Alt+R` from the pair and `R` without it. */
  primaryModifier?: ModifierTrigger
  /** The `secondary` twin of `primaryModifier` (`action.secondaryKeyModifier`). */
  secondaryModifier?: ModifierTrigger
  /** Meaningless for a row with no `ammoCommand` - always a boolean anyway, defaulting to true
   * (decision 7), so a caller never has to special-case `undefined`. */
  withAmmo: boolean
  /** '' when no `say_team` message command exists. */
  message: string
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

/**
 * Read a row's current state back out of its matching `ConfigAction` (or the
 * "nothing bound" default when none exists yet - decision 3).
 */
export function deriveRowState(action: ConfigAction | undefined, row: CatalogRow): RowState {
  if (!action) {
    // The ammo default (decision 7) applies even before anything is saved, so
    // a checkbox can show a sensible state on an unmaterialised row. For a
    // row with no `ammoCommand` this value is never read by anything - there
    // is no ammo control to reflect it (decision 8).
    return {
      primary: undefined,
      secondary: undefined,
      primaryModifier: undefined,
      secondaryModifier: undefined,
      withAmmo: true,
      message: '',
    }
  }

  const lastMessage = [...action.commands]
    .reverse()
    .find((command) => command.kind === 'message' && command.channel === 'say_team')

  const withAmmo = row.ammoCommand
    ? action.commands.some((command) => command.kind === 'raw' && command.text === row.ammoCommand)
    : true

  return {
    primary: action.key,
    secondary: action.secondaryKey,
    // Story 016 D9: a straight passthrough, deliberately not a derivation. The
    // modifier is stored on the action, so reading it back is a field read -
    // there is nothing to look up in `layers` and no command text to parse.
    primaryModifier: action.keyModifier,
    secondaryModifier: action.secondaryKeyModifier,
    withAmmo,
    message: lastMessage?.kind === 'message' ? lastMessage.text : '',
  }
}

// ---------------------------------------------------------------------------
// Mutations - lazy create, pure update, prune
// ---------------------------------------------------------------------------

/** Plain, non-translated, stable text for a freshly materialised action's `name` - the row's own
 * raw command (see the module docstring for why not the i18n label). */
function nameForRow(row: CatalogRow): string {
  return row.commands[0] ?? row.catalogId
}

/** A brand-new action for `row`, with default ammo ON (decision 7) and no key/message yet - the
 * starting point for whichever `apply*` call is the first to touch this row. */
function freshAction(row: CatalogRow): ConfigAction {
  return {
    id: crypto.randomUUID(),
    categoryId: row.categoryId,
    name: nameForRow(row),
    // Story 019: the catalogue only ever produced binds - a movement/weapon/drop row is a key
    // binding by definition, and neither a chat message nor an alias definition.
    kind: 'bind',
    catalogId: row.catalogId,
    commands: commandsForRow(row, true),
  }
}

function lastMessageCommand(commands: ConfigCommand[]): ConfigCommand | undefined {
  return [...commands].reverse().find((command) => command.kind === 'message' && command.channel === 'say_team')
}

/**
 * Whether an action represents "nothing assigned" and should be dropped from
 * the profile (decision 4).
 *
 * The rule is deliberately simple: both keys empty and no non-empty message,
 * full stop - an ammo choice by itself never keeps an action alive. That
 * matches decision 3's "assigns something (key, ammo choice or message)":
 * an ammo choice only becomes an actual assignment once something can fire
 * it, i.e. once a key or a message exists too. Without either, the `drop`
 * commands the row would carry can never run, so persisting the action would
 * only add a dead alias to the rendered file with nothing pointing at it.
 */
function isEmptyAction(action: ConfigAction): boolean {
  const hasKey = Boolean(action.key && action.key.trim().length > 0)
  const hasSecondary = Boolean(action.secondaryKey && action.secondaryKey.trim().length > 0)
  const hasMessage = action.commands.some(
    (command) => command.kind === 'message' && command.channel === 'say_team' && command.text.trim().length > 0,
  )
  return !hasKey && !hasSecondary && !hasMessage
}

/** Replace/insert `updated` at `index` (or append when `index < 0`), unless it is now empty, in
 * which case it is removed (or, for a never-existed row, simply not added). Always a new array -
 * `actions` and its elements are never mutated. */
function upsertOrPrune(actions: ConfigAction[], index: number, updated: ConfigAction): ConfigAction[] {
  if (isEmptyAction(updated)) {
    return index >= 0 ? actions.filter((_, i) => i !== index) : [...actions]
  }
  return index >= 0 ? actions.map((action, i) => (i === index ? updated : action)) : [...actions, updated]
}

/**
 * Set or clear one bind slot for `row`. Lazily creates the action on the
 * first non-empty assignment, and prunes it away again once both slots and
 * any message are empty.
 *
 * Story 016 D9: `modifier` is the modifier that was held while capturing `key`
 * ("Alt+R"), and it is stored on the action next to the key itself - there is
 * no second write path for a modifier capture, and nothing about the action's
 * `commands` differs because of one. Whether main mirrors the slot as a base
 * bind or as an override inside that modifier's layer follows from this field
 * alone (`applyActionLayerMirror`, run inside `setActions`).
 *
 * The modifier is bound to its slot's key, in both directions: clearing a key
 * clears its modifier, and a call that passes no `modifier` (a plain capture, a
 * Replace, a Clear) overwrites whatever the slot had - so a slot that used to
 * be `Alt+R` and is re-captured as plain `R` becomes an ordinary base bind
 * instead of silently keeping the old modifier. A modifier with no key is not a
 * state this function can produce, which is what keeps the mirror's
 * "both a key and a modifier" rule from ever seeing a half-filled slot.
 * The slot that is *not* being written is left exactly as it was, key and
 * modifier alike.
 */
export function applySlot(
  actions: ConfigAction[],
  row: CatalogRow,
  slot: 'primary' | 'secondary',
  key: string | undefined,
  modifier?: ModifierTrigger,
): ConfigAction[] {
  const normalizedKey = key && key.trim().length > 0 ? key : undefined
  const index = actions.findIndex((action) => action.catalogId === row.catalogId)
  const base = index >= 0 ? actions[index]! : freshAction(row)
  const updated: ConfigAction = {
    ...base,
    key: slot === 'primary' ? normalizedKey : base.key,
    keyModifier: slot === 'primary' ? (normalizedKey ? modifier : undefined) : base.keyModifier,
    secondaryKey: slot === 'secondary' ? normalizedKey : base.secondaryKey,
    secondaryKeyModifier:
      slot === 'secondary' ? (normalizedKey ? modifier : undefined) : base.secondaryKeyModifier,
  }
  return upsertOrPrune(actions, index, updated)
}

/**
 * `applySlot`'s counterpart for a plain `ConfigAction` that already exists as a concrete entry -
 * a custom category's own `bind`/`message` entry, or a legacy free-form action living inside a
 * catalogue category ("Other actions", decision 5). Story 020 D6/plan-gap fix: those rows used to
 * get neither a live slot nor an inert placeholder because `applySlot`/`applyReplace`/
 * `applyModifierReplace` are all keyed on a `CatalogRow`'s `catalogId` to find-or-lazily-create
 * the matching action - a plain action already exists with a real `id` and no `catalogId`, so it
 * is not "lazily materialised" from a row and those functions do not fit it.
 *
 * Two differences from `applySlot`, both because the action is not a `CatalogRow`-derived one:
 *
 * - No lazy creation. `actionId` must already name an entry in `actions` - if it does not, the
 *   array is returned unchanged (defensive; should not happen, since every caller reads the id
 *   straight off an action it is currently rendering).
 * - No pruning. `catalog-binds.ts`'s own `isEmptyCatalogAction` (`bind-slot-collision.ts`) is
 *   gated on `catalogId` for exactly this action: "a pre-015 free-form action that loses its key
 *   must stay in the list" - the user created it by hand and can re-bind it, so losing its last
 *   key must not delete it.
 */
export function applyPlainSlot(
  actions: ConfigAction[],
  actionId: string,
  slot: 'primary' | 'secondary',
  key: string | undefined,
  modifier?: ModifierTrigger,
): ConfigAction[] {
  const normalizedKey = key && key.trim().length > 0 ? key : undefined
  const index = actions.findIndex((action) => action.id === actionId)
  if (index < 0) return [...actions]
  const base = actions[index]!
  const updated: ConfigAction = {
    ...base,
    key: slot === 'primary' ? normalizedKey : base.key,
    keyModifier: slot === 'primary' ? (normalizedKey ? modifier : undefined) : base.keyModifier,
    secondaryKey: slot === 'secondary' ? normalizedKey : base.secondaryKey,
    secondaryKeyModifier:
      slot === 'secondary' ? (normalizedKey ? modifier : undefined) : base.secondaryKeyModifier,
  }
  return actions.map((action, i) => (i === index ? updated : action))
}

/**
 * Toggle whether `row`'s ammo command is included in its action's commands.
 * A no-op (returns a shallow copy) for a row with no `ammoCommand` at all -
 * decision 8, there is nothing to toggle.
 *
 * Story 015 decision 3 lists "ammo choice" alongside key and message as one
 * of the things that materialises a row - turning ammo *off* (the row's
 * default, decision 7, is ON) is exactly that choice, so it must survive
 * `isEmptyAction`'s prune even with no key or message set yet. `isEmptyAction`
 * itself stays key/message-only (it has no row to read the ammo default off
 * of), so that bypass lives here instead: `withAmmo` at its default goes
 * through the normal prune-if-empty path unchanged, and only the non-default
 * (off) case is kept alive unconditionally (bug fix - this used to fall
 * through to `upsertOrPrune` regardless, silently discarding the toggle on
 * every row with no key/message yet, which is most of them).
 */
export function applyAmmo(actions: ConfigAction[], row: CatalogRow, withAmmo: boolean): ConfigAction[] {
  if (!row.ammoCommand) return [...actions]

  const index = actions.findIndex((action) => action.catalogId === row.catalogId)
  const base = index >= 0 ? actions[index]! : freshAction(row)
  const message = lastMessageCommand(base.commands)
  const commands = commandsForRow(row, withAmmo)
  if (message) commands.push(message)
  const updated: ConfigAction = { ...base, commands }

  if (!withAmmo) {
    return index >= 0 ? actions.map((action, i) => (i === index ? updated : action)) : [...actions, updated]
  }
  return upsertOrPrune(actions, index, updated)
}

/**
 * Set, replace or clear `row`'s trailing `say_team` message command. Setting
 * `text` to `''` removes the message entirely (and prunes the action if
 * nothing else is set).
 */
export function applyMessage(actions: ConfigAction[], row: CatalogRow, text: string): ConfigAction[] {
  const index = actions.findIndex((action) => action.catalogId === row.catalogId)
  const base = index >= 0 ? actions[index]! : freshAction(row)
  const withoutMessage = base.commands.filter(
    (command) => !(command.kind === 'message' && command.channel === 'say_team'),
  )
  const commands: ConfigCommand[] =
    text.trim().length > 0 ? [...withoutMessage, { kind: 'message', channel: 'say_team', text }] : withoutMessage

  return upsertOrPrune(actions, index, { ...base, commands })
}
