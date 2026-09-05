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

import {
  actionKeySlots,
  clearKeySlot,
  keySlotAt,
  keySlotCount,
  withKeySlot,
} from '@shared/config/action-slots'
import { commandsForRow, type CatalogRow } from '@shared/config/catalog-rows'
import { withDropAmmo, withDropMessage } from '@shared/config/drop-entries'
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
  /**
   * Every key the row actually has, in file/array order (story 056 D1). This replaces the
   * `primary`/`secondary`/`primaryModifier`/`secondaryModifier` quartet: the Controls grid renders
   * one key per line - `keys[0]` in the Key column, `keys[1..n]` as sub-rows - so a row's slot
   * count is data now, not a fixed pair of columns.
   *
   * Slots holding an empty `key` are filtered out (the legacy cleared marker story 050's in-place
   * clear used to leave behind, and the one the shared `releaseKey` still writes when another row
   * takes a key away). They would otherwise render as a phantom sub-row with no cap in it. That
   * makes an index into this array a *compacted* index, which is exactly the index the write
   * functions below take - they compact the same way before writing, so the two can never disagree.
   *
   * Story 016 D9: a slot's `modifier` (the modifier held while it was captured) rides along on the
   * slot itself, so a sub-row renders `Alt+R` from the pair and `R` without it. A modifier can
   * never appear without its key here, since a slot with no key is not in this list at all.
   */
  keys: readonly ActionKeySlot[]
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
// Slot list normalisation
// ---------------------------------------------------------------------------

/** Does this slot hold a key at all? An empty `key` is "nothing assigned" everywhere it is read
 * (`action-mirror.ts`'s mirror pass, `render.ts#buildBindOwnerIndex`), and story 056 makes it
 * invisible in the Controls tab too. */
function hasKey(slot: ActionKeySlot): boolean {
  return Boolean(slot.key)
}

/**
 * The action with every empty-key slot dropped - the shape story 056's decision "a `{ key: '' }`
 * slot read from an existing profile is filtered out on read and dropped on the next write" calls
 * for on the write side.
 *
 * Every write path below runs the entry through this *before* applying its `slotIndex`, and that is
 * not tidiness: `deriveRowState` hands the UI a filtered slot list, so the index the UI hands back
 * is an index into that filtered list. Writing it against the raw array would put a key in the
 * wrong slot (or clear the wrong one) for any entry still carrying an empty slot - and two of them
 * are still produced outside this module, by the shared `releaseKey` and by `applyModifierReplace`,
 * both of which blank a *different* row's slot in place when it loses its key to a Replace.
 * Normalising here is what keeps read indices and write indices the same thing, and it heals such a
 * row on its own next edit.
 *
 * Returns the action unchanged (same object) when it has no empty slot to drop, and drops `keys`
 * entirely rather than leaving `[]` when nothing survives - matching `clearKeySlot`'s own
 * "absent means none" reading.
 */
function withoutEmptySlots(action: ConfigAction): ConfigAction {
  const slots = actionKeySlots(action)
  if (slots.every(hasKey)) return action

  const kept = slots.filter(hasKey)
  if (kept.length === 0) {
    const { keys: _keys, ...rest } = action
    return rest
  }
  return { ...action, keys: kept }
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
/**
 * The RAW `action.keys` array index that corresponds to the Nth non-empty ("compacted"/UI-facing)
 * slot - the inverse of what `deriveRowState`'s `keys` filtering (and `ControlsTab.tsx`'s
 * `plainKeySlots`) already do in the read direction.
 *
 * Needed anywhere a compacted slot index has to be compared against `action.keys` directly (e.g.
 * `findBindCollision`'s `ignore.slot`, which is a raw index): a raw in-place blank (written by the
 * shared `releaseKey` or `bind-slot-collision.ts#applyModifierReplace`, both of which deliberately
 * still blank a slot in place rather than compact) can leave raw and compacted indices out of step
 * for a row until its next write recompacts it. Passing a compacted index straight through as
 * `ignore.slot` then names the wrong raw slot - see story 056's second review pass.
 *
 * Returns `actionKeySlots(action).length` (an append position, one past the last raw slot) for a
 * `compactedIndex` at or past the end of the row's real keys, so a not-yet-existing "add key" slot
 * still resolves to a sane, always-safe-to-ignore raw index.
 */
export function rawKeyIndex(action: ConfigAction, compactedIndex: number): number {
  const slots = actionKeySlots(action)
  let seen = 0
  for (let i = 0; i < slots.length; i += 1) {
    if (hasKey(slots[i]!)) {
      if (seen === compactedIndex) return i
      seen += 1
    }
  }
  return slots.length
}

export function deriveRowState(action: ConfigAction, row: CatalogRow): RowState {
  // First occurrence, not last: `@shared/config/drop-entries#withDropMessage` removes the FIRST
  // `say`/`say_team` command it finds (`dropStateFor`'s `messageIndex` locks onto the first match
  // and never overwrites it), so a body with two message commands - an edge case this story's own
  // entries never produce, but an imported/hand-written one could - has to show the same one here
  // that turning the toggle off would delete. Showing the last one instead would let a user see text
  // that a follow-up "turn off" then fails to remove (story 055 review, finding 2).
  const firstMessage = action.commands.find((command) => command.kind === 'message')

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

  return {
    // Story 056: the whole slot list, minus the empty-key ones (see `RowState.keys`). Read through
    // `@shared/config/action-slots` like every other access to `action.keys` in this codebase, and
    // a straight passthrough of each slot - the `modifier` is stored on the slot, so there is
    // nothing to look up in `layers` and no command text to parse (story 016 D9).
    keys: actionKeySlots(action).filter((slot) => hasKey(slot)),
    withAmmo,
    message: firstMessage?.kind === 'message' ? firstMessage.text : '',
    messageChannel: firstMessage?.kind === 'message' ? firstMessage.channel : undefined,
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
 * No slot other than the one being written has its key or modifier changed - a
 * clear moves the later ones up a position (see below) but never edits one.
 *
 * Story 056: `slotIndex` is a plain index into the entry's key list, replacing story 050's
 * `'primary' | 'secondary'` union - the last place in the codebase that capped the already-N-ary
 * `action.keys` at two. It is an index into the *compacted* list `deriveRowState` returns (see
 * `withoutEmptySlots`), which is the list the Controls grid renders one line per.
 *
 * And a clear now **removes** the slot (`clearKeySlot`), so every later key moves up one: with each
 * slot editable in its own right, story 050's "blank it in place so a hand-added slot at index 2+
 * never shifts column" has nothing left to protect, and AC 5's "clearing the primary key promotes
 * the next key" is precisely that removal. Clearing an index the entry does not have is a no-op.
 */
export function applySlot(
  actions: ConfigAction[],
  actionId: string,
  slotIndex: number,
  key: string | undefined,
  modifier?: ModifierTrigger,
): ConfigAction[] {
  const normalizedKey = key && key.trim().length > 0 ? key : undefined
  const index = actions.findIndex((action) => action.id === actionId)
  if (index < 0) return [...actions]
  const base = withoutEmptySlots(actions[index]!)
  const nextSlot: ActionKeySlot | undefined = normalizedKey
    ? modifier
      ? { key: normalizedKey, modifier }
      : { key: normalizedKey }
    : undefined
  const updated = nextSlot
    ? withKeySlot(base, slotIndex, nextSlot)
    : clearKeySlot(base, slotIndex)
  return actions.map((action, i) => (i === index ? updated : action))
}

/**
 * Add one more key to the entry `actionId` names, after its last one (story 056 AC 4's "add key"
 * affordance).
 *
 * A thin wrapper around `applySlot` rather than a second write path: the index it appends at is the
 * entry's *real* slot count - empty slots dropped first, same normalisation every write does - so
 * a row carrying a legacy `{ key: '' }` gains its new key at the end of what the user can actually
 * see, not one position past a slot that renders as nothing. Unknown `actionId` returns the array
 * unchanged, like `applySlot`; a blank `key` is not an append at all and falls through to
 * `applySlot`'s clear, which is a no-op one past the end.
 */
export function appendKeySlot(
  actions: ConfigAction[],
  actionId: string,
  key: string,
  modifier?: ModifierTrigger,
): ConfigAction[] {
  const action = actions.find((candidate) => candidate.id === actionId)
  if (!action) return [...actions]
  return applySlot(actions, actionId, keySlotCount(withoutEmptySlots(action)), key, modifier)
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
 * An empty/blank `key` blanks the slot **in place** (`{ key: '' }`) and takes the modifier with it,
 * since a modifier with no key is not a binding. Story 056 deliberately leaves this as it was
 * rather than following `applySlot` into a compacting removal: this is a single-key editor with no
 * notion of a slot list to promote within (`ActionEditor`/`MessageEditor` write the result at
 * index 0 with `withKeySlot`, and neither can show, let alone edit, a further slot), so removing
 * the entry here would silently promote a key those editors never displayed into the field they
 * do. The blank it leaves is filtered out of `deriveRowState` and dropped by the entry's next
 * Controls-tab write, so it never shows up as a phantom key in the grid.
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

/**
 * Story 055 D3: `applyAmmo`'s action-based sibling - toggles the ammo command of the entry
 * `actionId` names by delegating to D1's `withDropAmmo` (`@shared/config/drop-entries`), which
 * splices the command in or out by index rather than rebuilding the row from `commandsForRow`.
 *
 * Needed because `isDropEntry` now recognises a drop wherever it sits - a `drop_` alias imported
 * into any category, or living outside the catalogue entirely, has no `CatalogRow` for the old
 * `applyAmmo` to rebuild from, but still has to survive its own extras (`wave 1`, a second
 * `drop shells`) exactly like a catalogue drops row does. `actionId` not naming an entry returns the
 * array unchanged, matching every other write function here.
 */
export function applyDropAmmo(
  actions: ConfigAction[],
  actionId: string,
  on: boolean,
): ConfigAction[] {
  const index = actions.findIndex((action) => action.id === actionId)
  if (index < 0) return [...actions]
  return actions.map((action, i) => (i === index ? withDropAmmo(action, on) : action))
}

/**
 * Story 055 D3: `applyMessage`'s action-based-and-surgical sibling, delegating to D1's
 * `withDropMessage` - same reasoning as `applyDropAmmo` above. Unlike `applyMessage` (which always
 * rebuilds the message command from `text`/`channel`), `on: false` here is a pure removal call with
 * no text argument needed, mirroring `withDropMessage`'s own on/off shape.
 */
export function applyDropMessage(
  actions: ConfigAction[],
  actionId: string,
  on: boolean,
  message?: string,
  channel?: 'say' | 'say_team',
): ConfigAction[] {
  const index = actions.findIndex((action) => action.id === actionId)
  if (index < 0) return [...actions]
  return actions.map((action, i) =>
    i === index ? withDropMessage(action, on, message, channel) : action,
  )
}
