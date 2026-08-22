/**
 * Validation for a user-typed own alias name (story 039, D2).
 *
 * `aliasNameFor` (`alias-render.ts`) already lets an action carry an explicit
 * `aliasName` that wins verbatim over the derived name. This module is the
 * gate in front of that field: it decides whether a string the user just
 * typed is a name the engine's `Cmd_Alias_f` can actually define, before it
 * is ever stored. Pure, `src/shared` - no `fs`, no DOM, no electron - because
 * D9's renderer dialog validates as the user types and D8's Care rule
 * (`validate-actions.ts`) reuses the same reserved-name set after the fact;
 * neither side should have its own copy of these rules.
 *
 * ## Character rule
 *
 * An alias name is an optional leading `+` or `-` (the engine's press/release
 * idiom - see `alias-render.ts#ownAliasName`), followed by one or more of
 * `[a-z0-9_]`. No uppercase (the engine matches case-insensitively, so
 * allowing it would just invite a name that reads differently from how it
 * resolves), no space, no hyphen inside the body, no other punctuation.
 *
 * ## Length budget
 *
 * Derived from `MAX_ALIAS_NAME` (`engine-limits.ts`), never a literal:
 * `MAX_ALIAS_NAME` counts the implicit terminator (`validate-structure.ts`'s
 * own `aliasTooLong` check is `name.length >= maxAliasName`), so
 * `MAX_ALIAS_NAME - 1` is what actually fits on the wire. Off that, the same
 * `_p<n>` chunk-suffix reserve `alias-render.ts` already carries for a split
 * action's parts is taken again here, not re-derived differently: an own name
 * belongs to an action like any other, and that action's commands may still
 * be long enough to need `_p1`/`_p2` parts appended to whatever name it
 * renders under. Reserving the same four characters up front means a name
 * this module accepts can never later overflow once `alias-render.ts` appends
 * a chunk suffix to it.
 *
 * ## Reserved names
 *
 * A name that collides with a known engine command would render a dead,
 * self-referential `alias weapnext weapnext` after story 039's D7 (see the
 * story's Decisions). "Known" here is deliberately the same, limited set the
 * rest of this codebase already has no fuller catalogue than (this repo
 * carries no complete engine command list - see `validate-actions.ts`'s file
 * doc comment for the same gap): every `action-catalog.ts` row's first
 * command token, both as written and with a leading `+`/`-` stripped (so a
 * movement row's `+forward` reserves both `+forward` and `forward`), plus
 * every `cvar-catalog.ts` cvar name. A clash with an engine command outside
 * that set is accepted as a warning-only case elsewhere (the story's own
 * decision), not this module's job to catch.
 *
 * ## Duplicates
 *
 * Uniqueness is a profile-wide property this module cannot see on its own -
 * it validates one string, not a whole action list - so the caller passes
 * the other entries' already-resolved alias names in as `context` (typically
 * every other action's `aliasNameFor` result). Compared case-insensitively,
 * matching `Cmd_Alias_f`'s own case-insensitive lookup and the same rule
 * `validate-actions.ts`'s `aliasDuplicate` already applies.
 *
 * ## Reason precedence
 *
 * A caller only wants one reason back, so when several would apply the first
 * match wins, in the order a person would naturally read a name: is there
 * anything here at all (`empty`), is it made of the right characters
 * (`illegalCharacters`), does it fit (`tooLong`), does it collide with a name
 * that already means something (`reserved`), does it collide with a name
 * another entry chose (`duplicate`).
 */

import { ALL_CVARS } from './cvar-catalog'
import { DROP_ACTIONS, MOVEMENT_ACTIONS, WEAPON_ACTIONS, WEAPON_EXTRA_ACTIONS } from './action-catalog'
import { MAX_ALIAS_NAME } from './engine-limits'

/** `MAX_ALIAS_NAME` counts the implicit terminator - see `validate-structure.ts`'s own
 * `name.length >= maxAliasName` check. This is what a name may actually use. */
const USABLE_ALIAS_NAME = MAX_ALIAS_NAME - 1

/**
 * Reserve for the `_p<n>` chunk suffix `alias-render.ts#renderActionAlias` may append to a split
 * action's parts (mirrors that module's own `PART_SUFFIX_RESERVE`, restated rather than imported
 * since it is a private constant there - same reasoning as that file restating `alt-layers.ts`'s
 * `LINE_HEADROOM`): `'_p'.length` plus two digits, generous enough for any action whose commands
 * do not run into the tens of kilobytes.
 */
const PART_SUFFIX_RESERVE = '_p'.length + 2

/**
 * The full budget for a user-typed own alias name, sign included. Exported so a UI hint (D9) can
 * state the limit without re-deriving it.
 */
export const MAX_OWN_ALIAS_NAME_LENGTH = USABLE_ALIAS_NAME - PART_SUFFIX_RESERVE

/** Optional leading `+`/`-`, then one or more of `[a-z0-9_]`. No uppercase, no space, no hyphen
 * inside the body, nothing else. */
const ALIAS_NAME_PATTERN = /^[+-]?[a-z0-9_]+$/

/** First whitespace-separated token of a raw engine command string, e.g. `'use shotgun'` -> `'use'`,
 * `'+forward'` -> `'+forward'`, `'weapnext'` -> `'weapnext'`. */
function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? ''
}

/** `token` with a leading `+`/`-` removed, unchanged when it has none. */
function signStripped(token: string): string {
  return token.startsWith('+') || token.startsWith('-') ? token.slice(1) : token
}

/**
 * Built once at module load, not per call - every source array here is a static constant, the same
 * reasoning `validate-actions.ts`'s `KNOWN_PRESS_RELEASE_COMMANDS` uses.
 *
 * `DROP_ACTIONS` rows carry `commands: string[]` (a droppable with a matching ammo item yields two
 * commands); only the first is a row's "first command token" the story asks for - the ammo drop is
 * not a separate row.
 */
function buildReservedAliasNames(): Set<string> {
  const reserved = new Set<string>()

  const addCommand = (command: string): void => {
    const token = firstToken(command).toLowerCase()
    if (!token) return
    reserved.add(token)
    reserved.add(signStripped(token))
  }

  for (const action of MOVEMENT_ACTIONS) addCommand(action.command)
  for (const action of WEAPON_ACTIONS) addCommand(action.command)
  for (const action of WEAPON_EXTRA_ACTIONS) addCommand(action.command)
  for (const drop of DROP_ACTIONS) addCommand(drop.commands[0])

  for (const cvar of ALL_CVARS) reserved.add(cvar.name.toLowerCase())

  return reserved
}

let cachedReservedAliasNames: Set<string> | undefined

/**
 * Every reserved alias name: `action-catalog.ts`'s built-in commands (raw and sign-stripped) plus
 * `cvar-catalog.ts`'s `ALL_CVARS` names, all lower-cased. Exported so D8's Care rule
 * (`aliasShadowsCommand`) checks a resolved alias name against exactly this set rather than keeping
 * a second copy of it.
 */
export function reservedAliasNames(): Set<string> {
  if (!cachedReservedAliasNames) cachedReservedAliasNames = buildReservedAliasNames()
  return cachedReservedAliasNames
}

/** Why `validateAliasName` rejected a candidate name. */
export type AliasNameRejectReason = 'empty' | 'illegalCharacters' | 'tooLong' | 'reserved' | 'duplicate'

export type AliasNameValidation =
  | { ok: true }
  | { ok: false; reason: AliasNameRejectReason; params: Record<string, string | number> }

/**
 * Whether `name` is a legal, available own alias name.
 *
 * `context` is the other entries' already-resolved alias names (case-insensitive duplicate check
 * against them) - this function has no profile to look them up in itself, see the file doc
 * comment's "Duplicates" section. Defaults to empty so a caller checking a name in isolation (e.g.
 * a unit test) does not have to pass one.
 */
export function validateAliasName(name: string, context: readonly string[] = []): AliasNameValidation {
  if (name.trim().length === 0) {
    return { ok: false, reason: 'empty', params: {} }
  }

  if (!ALIAS_NAME_PATTERN.test(name)) {
    return { ok: false, reason: 'illegalCharacters', params: { name } }
  }

  if (name.length > MAX_OWN_ALIAS_NAME_LENGTH) {
    return {
      ok: false,
      reason: 'tooLong',
      params: { name, length: name.length, max: MAX_OWN_ALIAS_NAME_LENGTH },
    }
  }

  const lower = name.toLowerCase()

  if (reservedAliasNames().has(lower)) {
    return { ok: false, reason: 'reserved', params: { name } }
  }

  if (context.some((other) => other.toLowerCase() === lower)) {
    return { ok: false, reason: 'duplicate', params: { name } }
  }

  return { ok: true }
}
