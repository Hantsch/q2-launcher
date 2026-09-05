/**
 * Catalogue knowledge about a Controls row, and the write paths that edit one
 * (story 015 D3; lazy materialisation removed by story 052 D8).
 *
 * A row used to be able to exist without a `ConfigAction` behind it: the
 * Movement/Weapons/Weapon-dropping categories rendered one row per catalogue
 * entry whether or not the profile carried it, and an action was created
 * *lazily*, on the first assignment (decision 3), then pruned again the moment
 * nothing was assigned (decision 4). Story 052 makes categories and rows
 * ordinary, persisted, profile-owned data - every row is one of
 * `profile.actions` (`controls-row-entries.ts`) - so both halves of that are
 * gone: nothing here creates an action, and nothing here deletes one. An entry
 * the user clears simply becomes an unbound entry, which is a shape the file
 * itself can now carry (story 052 D2/D3's unbound line).
 *
 * What stays is the catalogue's *knowledge* about an entry that names one of
 * its rows: `CatalogRow` says what the row's engine commands are and whether it
 * has an ammo variant, `deriveRowState` reads a row's current state back off
 * its action, and the `apply*` functions - all keyed by the action's own `id`
 * now, never by `catalogId` - are the only way the actions array changes.
 *
 * A row is identified by `catalogId`, never by its action's `name`
 * (decision 2) - `name` is plain, non-translated ASCII text (the row's own raw
 * engine command, e.g. `+forward` or `use rocket launcher`), not its i18n
 * label: resolving a `labelKey` needs `useTranslation()`, a React hook, and
 * this module has to stay hook-free so both a component and this file's own
 * vitest suite can import it without a DOM environment.
 *
 * Story 016 D9: a modifier held during a capture ("Alt+R") is an ordinary
 * property of the row's action - the `modifier` of the key slot it was captured
 * for (`ActionKeySlot`, story 050: one entry of `action.keys`, read through
 * `@shared/config/action-slots`) - so `RowState` carries it and `applySlot`
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
 * IPC, and (since story 052 D8 stopped minting actions here) no
 * `crypto.randomUUID()` either.
 */

import { keySlotAt, withKeySlot } from '@shared/config/action-slots'
import { commandsForRow, type CatalogRow } from '@shared/config/catalog-rows'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import type { ActionKeySlot, ConfigAction, ConfigCommand } from '@shared/modules/config'

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
   * `modifier` of the action's key slot 0. Only ever set when `primary` is - a modifier without a
   * key is not a binding (see `applySlot`) - so a slot renders `Alt+R` from the pair and `R`
   * without it. */
  primaryModifier?: ModifierTrigger
  /** The `secondary` twin of `primaryModifier` (the `modifier` of key slot 1). */
  secondaryModifier?: ModifierTrigger
  /** Meaningless for a row with no `ammoCommand` - always a boolean anyway, defaulting to true
   * (decision 7), so a caller never has to special-case `undefined`. */
  withAmmo: boolean
  /** '' when no message command exists. */
  message: string
  /** The channel of the message command `message` was read from - `say` or `say_team`. Undefined
   * alongside `message === ''`, since there is then no message command to have a channel at all. */
  messageChannel?: 'say' | 'say_team'
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

/**
 * Read a row's current state back out of its `ConfigAction`.
 *
 * Story 052 D8: the action is no longer optional - a row *is* an entry, so there is no
 * "unmaterialised row" state left to model. What is left of decision 3's "nothing bound yet" is an
 * entry that carries no commands at all (`commands: []`), the shape the template seed and D6's
 * migration give a still-unbound catalogue row; see the ammo rule below.
 */
export function deriveRowState(action: ConfigAction, row: CatalogRow): RowState {
  const lastMessage = [...action.commands].reverse().find((command) => command.kind === 'message')

  // Decision 7: ammo defaults to ON. An entry with no commands at all has not had its catalogue
  // body written yet (`withCatalogBody` below does that on the first real assignment), so reading
  // "no `drop <ammo>` command" off it as "the user turned ammo off" would flip the checkbox of
  // every seeded/migrated drop row to unchecked - which is not what it showed before story 052 D8,
  // when the same row had no action at all and took the default. Only an entry that *does* carry a
  // body answers the question from its own commands.
  const withAmmo = row.ammoCommand
    ? action.commands.length === 0 ||
      action.commands.some((command) => command.kind === 'raw' && command.text === row.ammoCommand)
    : true

  // Story 050: the two editable UI columns ("primary"/"secondary") map onto slots 0/1 of the
  // action's `keys` array via `@shared/config/action-slots`'s accessor - the sole place this
  // codebase reads `action.keys`. A slot with an empty `key` (the "cleared but still occupies its
  // array position" state `applySlot` below writes so a further hand-added slot never shifts) reads
  // back here as `undefined`, exactly like a slot that was never set at all.
  const slot0 = keySlotAt(action, 0)
  const slot1 = keySlotAt(action, 1)

  return {
    primary: slot0?.key || undefined,
    secondary: slot1?.key || undefined,
    // Story 016 D9: a straight passthrough, deliberately not a derivation. The
    // modifier is stored on the slot, so reading it back is a field read -
    // there is nothing to look up in `layers` and no command text to parse.
    primaryModifier: slot0?.key ? slot0.modifier : undefined,
    secondaryModifier: slot1?.key ? slot1.modifier : undefined,
    withAmmo,
    message: lastMessage?.kind === 'message' ? lastMessage.text : '',
    messageChannel: lastMessage?.kind === 'message' ? lastMessage.channel : undefined,
  }
}

// ---------------------------------------------------------------------------
// Mutations - pure updates of an entry that already exists
// ---------------------------------------------------------------------------

function lastMessageCommand(commands: ConfigCommand[]): ConfigCommand | undefined {
  return [...commands].reverse().find((command) => command.kind === 'message')
}

/**
 * Give a catalogue-backed entry the commands its row stands for, if it does not carry any yet
 * (story 052 D8).
 *
 * A seeded or migrated catalogue entry exists in the profile with `commands: []` - present as a
 * row, running nothing (`STANDARD_TEMPLATE`'s `buildTemplateActions`, `migrations.ts`'s
 * `materialiseTemplateCategories`). Before D8 that state had no action at all and the first
 * assignment created one from the catalogue (`freshAction`, with `commandsForRow`), so the key the
 * user had just captured always ran something. Now the entry is already there, and *nothing else*
 * in the Controls tab would ever fill in its body - binding it would produce a key wired to an
 * empty alias, in-game a dead key. So every write path that puts a real assignment on a catalogue
 * row (a key, a modifier-bound key, a message) runs the entry through this first.
 *
 * Ammo defaults to ON (decision 7), matching what `freshAction` seeded and what `deriveRowState`
 * reports for a body-less entry, so writing the body never silently flips the row's ammo checkbox.
 *
 * Deliberately *not* applied on a clear: clearing the last key of an entry with no body must leave
 * it exactly as unbound as it was, not hand it a body it never had.
 */
export function withCatalogBody(
  actions: ConfigAction[],
  actionId: string,
  row: CatalogRow,
): ConfigAction[] {
  return actions.map((action) =>
    action.id === actionId && action.commands.length === 0
      ? { ...action, commands: commandsForRow(row, true) }
      : action,
  )
}

/**
 * Set or clear one bind slot of the entry `actionId` names.
 *
 * Story 052 D8: this is `applyPlainSlot` under its old, shorter name - the one write path for every
 * row, catalogue-backed or free-form, since neither kind is lazily created or pruned any more.
 * `actionId` must already name an entry in `actions`; if it does not, the array is returned
 * unchanged (defensive - every caller reads the id straight off an action it is rendering).
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
 *
 * Story 050: `primary`/`secondary` are this editor's own vocabulary for slots 0/1 of
 * `action.keys` (`@shared/config/action-slots`) - the two editable columns the Controls tab keeps.
 * Written through `withKeySlot`, never `clearKeySlot`: clearing a slot writes an empty-key slot
 * (`{ key: '' }`) in place rather than removing the array entry, so a slot at index 2+ that arrived
 * from a hand-edited `.cfg` never shifts position and is never touched by this function.
 */
export function applySlot(
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
  const slotIndex = slot === 'primary' ? 0 : 1
  const nextSlot: ActionKeySlot = normalizedKey
    ? modifier
      ? { key: normalizedKey, modifier }
      : { key: normalizedKey }
    : { key: '' }
  const updated = withKeySlot(base, slotIndex, nextSlot)
  return actions.map((action, i) => (i === index ? updated : action))
}

/**
 * Slot 0 as a **modifier-blind editor** has to write it: the key that editor captured, with the
 * slot's existing `modifier` carried over untouched.
 *
 * `ActionEditor` and `MessageEditor` both edit an entry as a whole (its commands, its message) and
 * both offer exactly one key field with no modifier capture at all - so neither can show a modifier
 * and neither may drop one. That makes them the opposite case from `applySlot`
 * above, where the *absence* of a `modifier` argument is a real user statement ("this capture was
 * plain, clear whatever was there") because that UI does capture modifiers.
 *
 * Extracted here (story-050 review, finding 2) because it was inlined in `ActionEditor.save` and
 * *missing* from `ControlsTab`'s `MessageEditor` save, which wrote a fresh `{ key }` instead: an
 * entry bound to `Alt+F1` silently became one bound to plain `F1` the moment its message text was
 * edited, and that plain `F1` then overwrote whatever else held it. One helper, one behaviour, one
 * place to test it.
 *
 * An empty/blank `key` clears the slot the same way `applySlot` does - in place, `{ key: '' }`, so
 * no later slot moves - and takes the modifier with it, since a modifier with no key is not a
 * binding.
 */
export function editorKeySlot(action: ConfigAction, key: string | undefined): ActionKeySlot {
  const normalizedKey = key && key.trim().length > 0 ? key : ''
  const existing = keySlotAt(action, 0)
  return normalizedKey.length > 0 && existing?.modifier !== undefined
    ? { key: normalizedKey, modifier: existing.modifier }
    : { key: normalizedKey }
}

/**
 * Toggle whether `row`'s ammo command is included in the entry's commands.
 * A no-op (returns a shallow copy) for a row with no `ammoCommand` at all -
 * decision 8, there is nothing to toggle - and for an `actionId` that names
 * no entry.
 *
 * The row's raw commands are rewritten from the catalogue (`commandsForRow`) rather than the ammo
 * line being spliced in or out, which is what this has always done: the row *is* its catalogue
 * definition, and rebuilding is the only way "on" can restore an ammo command a previous "off"
 * removed. The entry's trailing message survives (it is not a catalogue command and is carried over
 * explicitly), so the drops row's two options stay independent of each other.
 *
 * Story 052 D8: no creation and no prune any more - the entry exists (it is the row) and turning
 * ammo on or off never adds or removes one. Turning ammo off on an entry with no body yet writes
 * the body without the ammo command, which is the same array `freshAction` + the old prune bypass
 * produced before D8.
 */
export function applyAmmo(
  actions: ConfigAction[],
  actionId: string,
  row: CatalogRow,
  withAmmo: boolean,
): ConfigAction[] {
  if (!row.ammoCommand) return [...actions]

  const index = actions.findIndex((action) => action.id === actionId)
  if (index < 0) return [...actions]

  const base = actions[index]!
  const message = lastMessageCommand(base.commands)
  const commands = commandsForRow(row, withAmmo)
  if (message) commands.push(message)

  return actions.map((action, i) => (i === index ? { ...action, commands } : action))
}

/**
 * Set, replace or clear the trailing message command of the entry `actionId` names. Setting `text`
 * to `''` removes the message entirely; the entry itself stays either way (story 052 D8 - an entry
 * with nothing assigned is an unbound row, not a row to delete). `channel` defaults to `'say_team'`
 * so existing callers that don't pass one keep writing exactly what they always did.
 *
 * Every non-message command is preserved in place, so a drop row keeps its `drop <item>`/
 * `drop <ammo>` pair and a message lands after them - the command order the file writer and
 * `deriveRowState` both expect.
 */
export function applyMessage(
  actions: ConfigAction[],
  actionId: string,
  text: string,
  channel: 'say' | 'say_team' = 'say_team',
): ConfigAction[] {
  const index = actions.findIndex((action) => action.id === actionId)
  if (index < 0) return [...actions]

  const base = actions[index]!
  const withoutMessage = base.commands.filter((command) => command.kind !== 'message')
  const commands: ConfigCommand[] =
    text.trim().length > 0 ? [...withoutMessage, { kind: 'message', channel, text }] : withoutMessage

  return actions.map((action, i) => (i === index ? { ...action, commands } : action))
}
