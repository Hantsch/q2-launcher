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
 * (`illegalCharacters`), may it carry the sign it carries (`signedBaseName`,
 * `press-release` only - story 045), does it fit (`tooLong`), does it collide
 * with a name that already means something (`reserved`), does it collide with a
 * name another entry chose (`duplicate`).
 */

import type { ActionEntryKind } from '../modules/config'
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
 * Reserve for the `_s<n>` state suffix a toggle's two halves render under (`<name>_s1`/`<name>_s2`
 * - story 045, D3; mirrors `alias-render.ts`'s own `STATE_SUFFIX_RESERVE`, restated for exactly
 * the reason `PART_SUFFIX_RESERVE` above is): `'_s'.length` plus one digit. A toggle has two
 * states by definition, so unlike the chunk suffix there is no growth to budget for.
 */
const STATE_SUFFIX_RESERVE = '_s'.length + 1

/**
 * The full budget for a user-typed own alias name, sign included. Exported so a UI hint (D9) can
 * state the limit without re-deriving it.
 *
 * Unchanged by story 045, and deliberately: `Math.max(PART_SUFFIX_RESERVE, STATE_SUFFIX_RESERVE)`
 * is still `PART_SUFFIX_RESERVE` (4 > 3), so the three single-body kinds keep the exact number
 * they had. The two new kinds do *not* fit this budget, because they are the one case where two
 * suffixes stack onto the typed name - see `maxOwnAliasNameLength` below.
 */
export const MAX_OWN_ALIAS_NAME_LENGTH = USABLE_ALIAS_NAME - PART_SUFFIX_RESERVE

/**
 * The budget for a user-typed own alias name of `kind`, which is `MAX_OWN_ALIAS_NAME_LENGTH` for
 * every kind that renders as one alias body, and tighter for the two that render as a family
 * (story 045, D3):
 *
 * - `toggle` (24): the name is the dispatch alias, its states hang off it (`<name>_s1`) and a long
 *   state's chunks hang off *those* (`<name>_s1_p2`), so both suffixes have to be paid for - the
 *   sum, not the max, and the only place in this codebase where that is true. Same number, same
 *   reasoning as `alias-render.ts`'s `TOGGLE_DERIVED_ALIAS_NAME_BUDGET`, which shortens the
 *   *derived* name of a toggle the user never typed a name for.
 * - `press-release` (26): the typed name is the sign-free base, and render time prepends the `+`/
 *   `-` (see `validateAliasName`'s `signedBaseName` rejection), so one character of the budget is
 *   spent on a sign that is not in the typed string - unlike every other kind, where a sign the
 *   user typed is part of what is measured.
 *
 * A caller that passes no kind gets `MAX_OWN_ALIAS_NAME_LENGTH`, i.e. exactly the pre-045
 * behaviour.
 */
export function maxOwnAliasNameLength(kind?: ActionEntryKind): number {
  if (kind === 'toggle') return USABLE_ALIAS_NAME - STATE_SUFFIX_RESERVE - PART_SUFFIX_RESERVE
  if (kind === 'press-release') return USABLE_ALIAS_NAME - 1 - PART_SUFFIX_RESERVE
  return MAX_OWN_ALIAS_NAME_LENGTH
}

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
export type AliasNameRejectReason =
  | 'empty'
  | 'illegalCharacters'
  | 'tooLong'
  | 'reserved'
  | 'duplicate'
  /**
   * A `press-release` entry's name carried a leading `+`/`-` (story 045, D3). Only reachable for
   * that kind, so no existing call site can produce it; the renderer string for it lands with D9,
   * which is what makes `ActionEditor`/`RenameActionDialog` pass a `kind` in the first place.
   */
  | 'signedBaseName'

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
 *
 * `kind` (story 045, D3) is the entry the name is for, and changes three things for the two kinds
 * that render as an alias *family* rather than as one body - every other kind, and a caller that
 * passes no kind at all, behaves byte-for-byte as before:
 *
 * - the length budget is `maxOwnAliasNameLength(kind)` (see there for the two numbers and why);
 * - the duplicate check runs over every name the family would define, not just the typed one
 *   (`renderedNamesFor` - story-045 review, finding 3), so a toggle called `zoom` is refused while a
 *   user alias named `zoom_s1` exists. `params.name` then names the *colliding* name rather than the
 *   typed one, which is the only spelling that tells the user what the clash actually is;
 * - a `press-release` name is validated **sign-free** (`signedBaseName`). The stored name is the
 *   base only; `alias-render.ts` appends the `+`/`-` per half at render time so the two halves can
 *   never drift (story 045's Decisions), which means a typed `+slow` would render as `++slow`.
 *   Reported as its own reason rather than folded into `illegalCharacters`: the character is legal,
 *   it is the sign the launcher already adds that is not the user's to type.
 */
export function validateAliasName(
  name: string,
  context: readonly string[] = [],
  kind?: ActionEntryKind,
): AliasNameValidation {
  if (name.trim().length === 0) {
    return { ok: false, reason: 'empty', params: {} }
  }

  if (!ALIAS_NAME_PATTERN.test(name)) {
    return { ok: false, reason: 'illegalCharacters', params: { name } }
  }

  // After the character rule (a `+` on its own is `illegalCharacters`, not a signed base name) and
  // before the length check, whose budget already assumes the sign is not part of the string.
  if (kind === 'press-release' && (name.startsWith('+') || name.startsWith('-'))) {
    return { ok: false, reason: 'signedBaseName', params: { name, base: name.slice(1) } }
  }

  const maxLength = maxOwnAliasNameLength(kind)
  if (name.length > maxLength) {
    return {
      ok: false,
      reason: 'tooLong',
      params: { name, length: name.length, max: maxLength },
    }
  }

  const lower = name.toLowerCase()

  if (reservedAliasNames().has(lower)) {
    return { ok: false, reason: 'reserved', params: { name } }
  }

  const taken = new Set(context.map((other) => other.toLowerCase()))
  for (const candidate of renderedNamesFor(name, kind)) {
    if (taken.has(candidate.toLowerCase())) {
      return { ok: false, reason: 'duplicate', params: { name: candidate } }
    }
  }

  return { ok: true }
}

/**
 * Every alias name an entry of `kind` called `name` would actually define in the file - the set the
 * duplicate check has to run over, not just the typed string (story-045 review, finding 3).
 *
 * For the three single-body kinds that is the name itself, exactly as before. The two family kinds
 * define more than they are called:
 *
 * - `toggle`: the dispatch alias plus its two derived states, `<name>_s1`/`<name>_s2`. The file
 *   comment's "Length budget" section already reserved room for that suffix; reserving *room* is not
 *   reserving the *name*, and without this a user alias literally called `zoom_s1` was silently
 *   overwritten by a toggle called `zoom` - the launcher's own line wins in the file, and the user's
 *   alias is simply gone the next time the profile is written.
 * - `press-release`: `+<name>`/`-<name>`, the two halves `alias-render.ts#twoPartHalfNames` prepends
 *   the signs to. The sign-free base itself defines nothing, so it is not checked.
 *
 * The suffix and the signs are restated here rather than imported from `alias-render.ts` for the
 * same reason `STATE_SUFFIX_RESERVE` above is restated: this module is the gate that runs *before*
 * anything is stored, and `alias-render.ts` imports nothing from here, so the dependency would only
 * go the wrong way. `alias-names.test.ts` pins the two spellings against `twoPartAliasNames`' own.
 */
function renderedNamesFor(name: string, kind?: ActionEntryKind): string[] {
  if (kind === 'toggle') return [name, `${name}_s1`, `${name}_s2`]
  if (kind === 'press-release') return [`+${name}`, `-${name}`]
  return [name]
}
