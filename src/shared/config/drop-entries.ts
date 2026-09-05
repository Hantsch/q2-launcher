/**
 * Recognising and editing a "drop" entry (story 055) - one small pure module, read by Controls, the
 * Aliases tab and the import path alike (D1's own scope stops at this file: nothing here is wired
 * into any of those three yet).
 *
 * ## What a drop is
 *
 * Not a persisted `kind` - a drop stays an ordinary `kind: 'alias' | 'bind'` entry (the Decisions
 * section rules out a new `ActionEntryKind`, since that would mean a schema migration). Dropness is
 * a derived predicate, computed the same way `guessCategoryKey` (`alias-import.ts`) already decides
 * an imported entry's category: off the entry's *rendered* alias name (`aliasNameFor`, so a
 * user-renamed entry - story 039's `aliasName` - is still recognised) plus its parsed
 * `ConfigCommand[]` body, never the raw body text. An entry is a drop iff both hold:
 *
 * - its rendered alias name starts with `drop_`;
 * - its body contains at least one `drop <item>` command *anywhere*, not only as the first command
 *   (the User's "Body shape" decision). The item itself is the first such command's argument.
 *
 * `dall` (`docs/fixtures/dmalias.cfg:105`) needs no special case: its body is nothing but `drop`
 * commands, but its name does not start with `drop_`, so the name test alone excludes it - exactly
 * the fixture's own point.
 *
 * Any *further* `drop <argument>` command whose argument is one of the catalogue's known ammo names
 * (`action-catalog.ts#DROPPABLES`, `kind: 'ammo'` items - the same names a weapon or ammo-carrying
 * powerup row's own `ammo` field points at) is the ammo toggle's command. Everything else in the
 * body - a `say_team` message, `wave 1`, a second unrelated `drop shells` - is an extra this module
 * never touches.
 *
 * ## Command surgery, not body rebuild
 *
 * `withDropAmmo`/`withDropMessage` splice *only* their own command in or out of `action.commands`,
 * by index, and hand back every other command untouched and in its original relative order. A
 * rebuild from a catalogue row (`commandsForRow`'s usual shape) would silently discard exactly the
 * extras the story's AC6 requires to survive - that is the Decisions section's "index-based command
 * surgery, not body rebuild from a catalogue row" line, spelled out in code.
 *
 * Pure by contract, like `alias-references.ts`/`action-mirror.ts`: no `fs`, no DOM, no electron.
 */

import type { ConfigAction, ConfigCommand } from '../modules/config'
import { aliasNameFor } from './alias-render'
import { DROPPABLES } from './action-catalog'

/** A `drop <argument>` command, the argument captured. Matches anywhere a `drop` command can occur -
 * this module never assumes it is the body's first command (the User's "Body shape" decision). */
const DROP_COMMAND = /^drop\s+(.+)$/i

/** Every item name the catalogue calls out as an ammo type (`DROPPABLES`, `kind: 'ammo'`) - shells,
 * bullets, rockets, cells, slugs, grenades today. A weapon or ammo-carrying powerup row's own `ammo`
 * field always points at one of these same names (`itemAmmoFor` below reads that field directly), so
 * one set here is enough to recognise a further `drop <ammo>` command wherever it names one. */
const AMMO_NAMES: ReadonlySet<string> = new Set(
  DROPPABLES.filter((droppable) => droppable.kind === 'ammo').map((droppable) => droppable.item.toLowerCase()),
)

function isKnownAmmoName(argument: string): boolean {
  return AMMO_NAMES.has(argument.trim().toLowerCase())
}

/** The catalogue's own item -> ammo knowledge (a weapon's or an ammo-carrying powerup's `ammo`
 * field), looked up by the exact `item` text a `drop` command carries - independent of anything the
 * body itself says, and independent of whether a `drop <ammo>` command for it is actually present.
 * `undefined` for an item the catalogue does not know at all (a foreign mod's item) or knows but with
 * no ammo of its own (`tech`, hand grenades, an ordinary ammo item) - both read the same way: this
 * item's ammo toggle has nothing to add, and must stay disabled. */
function itemAmmoFor(item: string): string | undefined {
  const normalized = item.trim().toLowerCase()
  return DROPPABLES.find((droppable) => droppable.item.toLowerCase() === normalized)?.ammo
}

/**
 * Is `action` a drop wherever it sits - see the file doc comment for the exact rule. False for an
 * entry whose name does not start with `drop_` (any category, any kind), and false for a `drop_`-
 * named entry whose body carries no `drop <item>` command at all (the hypothetical the story's D1
 * acceptance names alongside `dall`).
 */
export function isDropEntry(action: ConfigAction): boolean {
  const name = aliasNameFor(action).trim().toLowerCase()
  if (!name.startsWith('drop_')) return false
  return action.commands.some((command) => command.kind === 'raw' && DROP_COMMAND.test(command.text.trim()))
}

/**
 * Everything the two toggles and their tooltips need to know about a drop entry's current body -
 * `isDropEntry(action)` should be true before a caller relies on `item`/`itemIndex` being meaningful,
 * though every field still degrades sensibly (empty/`undefined`) for an entry with no `drop` command
 * at all.
 */
export interface DropState {
  /** The first `drop <item>` command's argument, trimmed, case kept exactly as written. Empty when
   * the body has no `drop` command at all. */
  item: string
  /** Index of that command in `action.commands`, or `undefined` when there is none. */
  itemIndex?: number
  /** The ammo name the catalogue knows for `item` (a weapon's or ammo-carrying powerup's own `ammo`
   * field) - independent of the body. `undefined` means the item has no known ammo at all, which is
   * exactly what should keep the ammo toggle disabled (`drop_tech`'s case). */
  itemAmmo?: string
  /** True iff the body already carries a further `drop <argument>` command whose argument is a
   * catalogue-known ammo name - the ammo toggle's current on/off state. Equivalent to `ammoIndex`
   * being defined. */
  hasAmmo: boolean
  /** Whether the ammo toggle can be operated at all - i.e. whether this entry's ammo command is
   * something the user can still add or remove. True when the catalogue knows an ammo type for the
   * item (`itemAmmo`, so there is something to *add*) **or** the body already carries an ammo
   * command (`hasAmmo`, so there is something to *remove*).
   *
   * The two halves matter because they are not the same set (story 055 review, finding 4). The
   * fixture's ammo-item drops - `drop_shells` = `drop shells; drop shells; say_team ...`, and its
   * five siblings - carry a real ammo command (`hasAmmo` true) while their item, being an ammo item
   * itself, has no `ammo` field of its own (`itemAmmo` undefined). Deriving "disabled" from
   * `itemAmmo` alone therefore rendered those entries *pressed and disabled at once*, with a
   * tooltip contradicting the pressed state and no way to un-press it. A pressed toggle must always
   * be releasable, so an existing ammo command enables the toggle by itself.
   *
   * Turning such an entry's ammo off is deliberately one-way: once the second `drop shells` is
   * gone, there is neither a command to remove nor a catalogue ammo to add, so the toggle goes
   * disabled *and* unpressed - consistent, which is the whole point, and honest about the fact that
   * the launcher has no ammo type to re-add for an ammo item. */
  canToggleAmmo: boolean
  /** That command's own argument, exactly as written - present iff `hasAmmo`. Usually equal to
   * `itemAmmo`, but not always: the body is read literally, not corrected against the catalogue (see
   * `drop_powers` in the fixture, whose second `drop` names a non-ammo item, leaving `hasAmmo` false
   * for that one entry even though the launcher's own template would have paired it with `cells`). */
  ammo?: string
  /** Index of that command in `action.commands` - present iff `hasAmmo`. Needed by `withDropAmmo` for
   * surgical removal. */
  ammoIndex?: number
  /** The say/say_team message text, when the body carries one `kind: 'message'` command. */
  message?: string
  /** That command's channel. */
  channel?: 'say' | 'say_team'
  /** Index of that command in `action.commands` - present iff `message` is defined. Needed by
   * `withDropMessage`. */
  messageIndex?: number
}

/**
 * Reads `action`'s current drop state off its parsed `commands` - see `DropState`'s own field docs
 * for exactly what each part means and where it comes from. Safe to call on an entry that turns out
 * not to be a drop at all: `item` comes back `''` and every index/optional field `undefined`.
 */
export function dropStateFor(action: ConfigAction): DropState {
  const commands = action.commands

  let item = ''
  let itemIndex: number | undefined
  let ammo: string | undefined
  let ammoIndex: number | undefined
  let message: string | undefined
  let channel: 'say' | 'say_team' | undefined
  let messageIndex: number | undefined

  commands.forEach((command, index) => {
    if (command.kind === 'raw') {
      const match = DROP_COMMAND.exec(command.text.trim())
      if (!match) return
      const argument = match[1]!.trim()
      if (itemIndex === undefined) {
        item = argument
        itemIndex = index
      } else if (ammoIndex === undefined && isKnownAmmoName(argument)) {
        ammo = argument
        ammoIndex = index
      }
      return
    }
    if (command.kind === 'message' && messageIndex === undefined) {
      message = command.text
      channel = command.channel
      messageIndex = index
    }
  })

  const itemAmmo = itemIndex !== undefined ? itemAmmoFor(item) : undefined

  return {
    item,
    itemIndex,
    itemAmmo,
    hasAmmo: ammoIndex !== undefined,
    canToggleAmmo: itemAmmo !== undefined || ammoIndex !== undefined,
    ammo,
    ammoIndex,
    message,
    channel,
    messageIndex,
  }
}

/**
 * `action` with its ammo command added (`on: true`) or removed (`on: false`), every other command
 * left untouched and in its original relative order (see the file doc comment's "command surgery, not
 * body rebuild" section). A no-op - returns `action` itself - when the entry is already in the
 * requested state, or when switching on and the item has no known ammo at all
 * (`dropStateFor(action).itemAmmo` is `undefined`; the caller is expected to have disabled the toggle
 * in that case, but this function stays safe regardless).
 *
 * Turning on inserts `drop <itemAmmo>` immediately after the item's own `drop` command - the position
 * every hand-written and template body already uses - so a freshly-added ammo command reads exactly
 * like an authored one.
 */
export function withDropAmmo(action: ConfigAction, on: boolean): ConfigAction {
  const state = dropStateFor(action)
  if (on === state.hasAmmo) return action

  if (on) {
    if (!state.itemAmmo || state.itemIndex === undefined) return action
    const commands = [...action.commands]
    const newCommand: ConfigCommand = { kind: 'raw', text: `drop ${state.itemAmmo}` }
    commands.splice(state.itemIndex + 1, 0, newCommand)
    return { ...action, commands }
  }

  const commands = action.commands.filter((_, index) => index !== state.ammoIndex)
  return { ...action, commands }
}

/**
 * `action` with its `say`/`say_team` message added (`on: true`) or removed (`on: false`), every other
 * command left untouched and in its original relative order. Story 029's inline row + `MessageEditor`
 * stay the only way to edit the text itself (AC5) - this function only ever adds/removes/replaces the
 * one command.
 *
 * Turning on with an already-present message updates that command in place (new `message`/`channel`
 * win, whichever is given; the existing text/channel is kept for whichever argument is omitted).
 * Turning on with none present inserts a fresh one right after the last recognised drop command (the
 * item, or the ammo command when the entry also has one on) - the position every hand-written and
 * template body already uses, so a following extra like `wave 1` stays after it, not before.
 *
 * A no-op - returns `action` itself - when switching off an entry that has no message.
 */
export function withDropMessage(
  action: ConfigAction,
  on: boolean,
  message?: string,
  channel?: 'say' | 'say_team',
): ConfigAction {
  const state = dropStateFor(action)

  if (!on) {
    if (state.messageIndex === undefined) return action
    const commands = action.commands.filter((_, index) => index !== state.messageIndex)
    return { ...action, commands }
  }

  const newCommand: ConfigCommand = {
    kind: 'message',
    channel: channel ?? state.channel ?? 'say_team',
    text: message ?? state.message ?? '',
  }

  if (state.messageIndex !== undefined) {
    const commands = [...action.commands]
    commands[state.messageIndex] = newCommand
    return { ...action, commands }
  }

  const insertAt = (state.ammoIndex ?? state.itemIndex ?? action.commands.length - 1) + 1
  const commands = [...action.commands]
  commands.splice(insertAt, 0, newCommand)
  return { ...action, commands }
}
