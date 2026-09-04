/**
 * Imported `alias` definitions -> catalogue entries (story 041, D3).
 *
 * D1 taught the parser to recognise `alias <name> <body>` and D2 folded those
 * definitions across files and `exec` depth. Both stop at "a name and a body
 * string". This is the stage that decides what a body *is*: a chat message, a
 * multi-command alias entry, or - when the body rebinds keys - a construct the
 * launcher refuses to guess about and hands back to the user.
 *
 * Same shape as `bind-adoption.ts` next door: plain data in, entries out, `newId`
 * injected, no `node:*`, no DOM, no electron. It is pure because the import
 * preview (renderer) and the commit (main) must agree byte-for-byte about what
 * ninety of a player's aliases become - two implementations of this table would
 * be two answers.
 *
 * ## Body splitting
 *
 * `splitAliasBody` reuses the shared tokenizer (`command-tokenizer.ts`, D1) so
 * the `"`/`;`/`//` rules are the parser's own, not a second set: split on
 * top-level `;` FIRST, then strip a `//` comment from each segment. That order is
 * the engine's: `Cbuf_Execute` cuts the buffer at the first unquoted `;`, and
 * only then does `Cmd_TokenizeString` see a `//` and drop the rest of *that one*
 * command. So `a;b // c;d` is three commands (`a`, `b`, `d`), not one.
 *
 * Empty segments (`a;;b`, a segment that was nothing but a comment) are no-ops in
 * the engine and are dropped here too - but an alias whose whole body is empty
 * stays an entry with `commands: []` (the story's Decisions: the writer's "no
 * usable commands -> no alias line" rule is scoped to *generated* aliases, and
 * swallowing a user's `alias blaster_settings ""` hook on the first save would be
 * silent data loss).
 *
 * ## Message vs. raw
 *
 * A segment whose command word is `say`/`say_team` **and** that carries an
 * argument becomes `{ kind: 'message', channel, text }`; everything else is
 * `{ kind: 'raw', text }` with the segment kept verbatim. The text is the raw
 * remainder of the segment, so every chat macro (`%l`, `%N`, `%T`, `%h`, `%a`,
 * `$loc_here`, `$g`, whatever a mod invented) survives byte-identical - unknown
 * macros pass through unvalidated per the story's Decisions. The single
 * exception is one surrounding pair of quotes, which `CL_Say_f` itself strips
 * before sending, and which the writer would not re-emit either
 * (`alias-render.ts` renders a message as `<channel> <text>`).
 *
 * An argument-less bare `say` stays raw: it does nothing in the engine, and
 * `config-parser.ts` already treats "recognised command, not enough arguments"
 * as not-that-command rather than guessing an empty value.
 *
 * The entry as a whole is `kind: 'message'` only when the body is *exactly* one
 * message command and nothing else; every other body - mixed, multi-command,
 * empty - is `kind: 'alias'` with its commands. That keeps `drop_shotgun`
 * (drops + a `say_team` + a `wave`) out of the message editor while still
 * modelling its chat part.
 *
 * ## Names
 *
 * `name` and `aliasName` (story 039's own-name field, which wins verbatim in
 * `aliasNameFor`) both get the source name unchanged, sign included: `+slow`
 * stays `+slow`, `drop_rail` stays `drop_rail`. The first write-back has to
 * reproduce the player's own file, not rename ninety aliases.
 *
 * ## Category guess
 *
 * A crude, deliberately overridable guess (an ordinary `categoryId` the user can
 * change later), first match wins: `drop ` -> `drops`, `use ` -> `weapons`,
 * only messages (± `play`) -> `messages`, only `play` -> `sounds`, movement
 * commands/cvars -> `movement`, otherwise `imported`. Two narrowings of the
 * story's "body contains ..." wording, both in the same direction - never let
 * prose decide a category:
 *
 *  - the tests run against the *commands*, not the raw body text, and never
 *    against a message's text. `say drop the flag; say use the rail` is a chat
 *    message about dropping, not a drop entry.
 *  - a command is tested at its start (`^drop\s`), because that is where a
 *    command word is. A substring test would file `say mouse settings` under
 *    weapons (`"mouse "` contains `"use "`).
 *
 * `messages`, `sounds` and `imported` are not built-in categories, so they are
 * synthesized on first use with `newId()` and returned in `categories`; the
 * three built-ins (`movement`/`weapons`/`drops`) are referenced by their
 * constant ids and never created.
 *
 * ## Order independence
 *
 * The definitions are folded into a name-keyed map before a single body is
 * looked at, so nothing here depends on the order they arrive in. `alias lol
 * "lol1;lol2;lol3"` may be defined before `lol1` exists - which is normal in
 * real configs, since the engine resolves an alias body when it *runs*, not when
 * it is defined. A body's reference to another alias is plain command text and
 * is preserved verbatim either way; deciding whether that reference resolves is
 * the reference graph's job (D4), not this function's.
 *
 * The fold is last-definition-wins by name, keeping the first-seen position -
 * the same rule and the same `Map#set` idiom `import-reader.ts#applyAlias` uses,
 * repeated here rather than assumed: the input normally arrives already folded,
 * but a caller handing over raw definitions must not end up with two entries
 * fighting over one alias name. Names are compared exactly, matching
 * `Cmd_Alias_f`'s own case-sensitive redefinition check (its *lookup* at execute
 * time is case-insensitive, but that does not merge two stored definitions).
 *
 * ## Aliases that rebind keys
 *
 * `alias cali "bind KP_END fuck; bind KP_DOWNARROW ..."` is functionally a
 * toggle layer, and the story's Decisions forbid guessing: every alias with at
 * least one top-level `bind` segment is reported in `ambiguous` - whichever way
 * it is converted - so the import flow can ask. `layerAliases` carries the
 * answers back: a name in it becomes a toggle `AltLayer` (the body's `bind`
 * pairs as `overrides`) and produces no `ConfigAction` at all; a name absent
 * from it converts as an ordinary `kind: 'alias'` entry, which is the default.
 *
 * `triggerKey` is resolved from `binds` - the key whose bind value is exactly
 * this alias name - and is `null` when nothing binds it (nothing binds `cali` in
 * the fixture's `dm.cfg`), the state `AltLayer.triggerKey` is nullable for.
 * Reading it out of `binds` rather than always writing `null` is what keeps a
 * layer the user *did* bind reachable from the keyboard after the import.
 *
 * ## What this deliberately does NOT do
 *
 * Entries come from `aliases` and from nowhere else. `binds` is read for one
 * thing only (the trigger lookup above): a raw `bind e "+forward"` or
 * `bind ALT "+x2"` never becomes an entry here, because turning raw binds into
 * catalogue rows is `bind-adoption.ts`'s pipeline (stories 038/039), and a
 * `bind KP_END "drop_shotgun"` stays a raw bind pointing at the entry by name
 * (the story's Decisions).
 */

import type { AltLayer } from '@shared/config/alt-layers'
import {
  splitTopLevelSemicolons,
  stripLineComment,
  tokenize,
} from '@shared/config/command-tokenizer'
import { MAX_WAIT_FRAMES } from '@shared/config/engine-limits'
import {
  recognizeEntryIdioms,
  type RecognizedPressRelease,
  type RecognizedToggle,
  type RecognizedWaitAlias,
} from '@shared/config/entry-idioms'
import { normalizeBindKey } from '@shared/config/key-names'
import {
  BUILT_IN_ACTION_CATEGORIES,
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigCommand,
} from '@shared/modules/config'

/**
 * One folded `alias <name> <body>` as the importer hands it over - structurally
 * `import-reader.ts`'s `ImportedAlias`, restated here because that type lives in
 * `main` and this file is shared (the same reason `UnrecognizedConfigLine`
 * exists next to `ImportedUnrecognizedLine`). `body` is the raw argument text
 * with the outer quotes already stripped by the parser, unsplit.
 */
export interface ImportedAliasDefinition {
  name: string
  body: string
  /** On-disk file name the winning definition came from, e.g. `dmalias.cfg`. */
  file: string
  /** 1-based line number of the winning definition within that file. */
  line: number
}

/**
 * An alias whose body contains at least one top-level `bind` - i.e. one that
 * could be read either as a plain alias or as a layer, and that the import flow
 * therefore asks about instead of deciding (story 041's Decisions). Carries the
 * definition's own site so the review step can name it.
 */
export type AmbiguousRebindAlias = ImportedAliasDefinition

export interface ImportedActionsInput {
  /** The import's folded alias definitions, in document order. */
  aliases: readonly ImportedAliasDefinition[]
  /**
   * The import's binds (key -> command). Read only to resolve a layer's
   * `triggerKey`; never a source of entries. Optional, since most callers and
   * every conversion rule work without it.
   */
  binds?: Readonly<Record<string, string>>
  /**
   * Names of ambiguous aliases the user chose to "attempt as layer". Compared
   * case-insensitively, matching the engine's own alias lookup. Absent or empty
   * means the default for every ambiguous alias: import as a plain alias entry.
   */
  layerAliases?: readonly string[]
  /** The caller's id factory - same idiom as `adoptRawBinds`. */
  newId: () => string
}

export interface ImportedActionsResult {
  /** One entry per alias definition, minus the ones that became layers. */
  actions: ConfigAction[]
  /** Only the categories that had to be created (`messages`/`sounds`/`imported`). */
  categories: ConfigActionCategory[]
  /** One toggle layer per name in `layerAliases` that really did rebind keys. */
  layers: AltLayer[]
  /** Every alias with a top-level `bind` segment, however it was converted. */
  ambiguous: AmbiguousRebindAlias[]
}

/** The six categories the guess table can land on. */
type CategoryKey = 'movement' | 'weapons' | 'drops' | 'messages' | 'sounds' | 'imported'

const BUILT_IN_CATEGORY_IDS = new Set<string>(BUILT_IN_ACTION_CATEGORIES.map((c) => c.id))

/**
 * Names for the three categories an import may have to create. Plain English
 * data, not UI prose: `ConfigActionCategory.name` is user-typed text the user can
 * rename, so it is not translatable (unlike `BuiltInActionCategory.labelKey`).
 */
const IMPORT_CATEGORY_NAMES: Record<'messages' | 'sounds' | 'imported', string> = {
  messages: 'Messages',
  sounds: 'Sounds',
  imported: 'Imported',
}

/**
 * Splits an alias body into its top-level command segments: `;` first, then a
 * `//` comment off each segment, then drop what is left empty - see the file
 * doc comment for why that order is the engine's. Exported because the reference
 * graph (D4) has to walk the same segments this conversion produced.
 */
export function splitAliasBody(body: string): string[] {
  return splitTopLevelSemicolons(body)
    .map((segment) => stripSegmentComment(segment).trim())
    .filter((segment) => segment.length > 0)
}

/**
 * `stripLineComment`'s quote-aware cut, but only when the `//` actually starts a
 * token. `COM_Parse` skips a comment at the point it is looking for the next
 * token, so `use rl // note` really does lose its note - while
 * `say join http://example.com` keeps its URL, because that `//` sits mid-token
 * and the engine never reads it as a comment. Without this guard a chat macro's
 * neighbour, a URL, would be silently truncated by an importer whose one promise
 * about message text is that it survives byte-identical.
 */
function stripSegmentComment(segment: string): string {
  const stripped = stripLineComment(segment)
  if (stripped.length === segment.length) return segment
  const preceding = stripped[stripped.length - 1]
  return preceding === undefined || /\s/.test(preceding) ? stripped : segment
}

/** The lower-cased first token of a segment, or `''` when there is none. */
function commandWord(segment: string): string {
  return tokenize(segment)[0]?.toLowerCase() ?? ''
}

/** `say`/`say_team` plus at least one character of message. `say_team` first so the
 * alternation cannot stop at `say` on a `say_team` segment. */
const MESSAGE_SEGMENT = /^(say_team|say)\s+([\s\S]+)$/i

/** One surrounding pair of quotes removed - `CL_Say_f` strips it before sending, and
 * `alias-render.ts` would not write it back. Anything else is left exactly as it is. */
function unquoteMessage(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text
}

/**
 * One segment as a `ConfigCommand`. A nested `alias ...` segment lands here like
 * any other raw command - it is never a second definition (the story's
 * Decisions: `alias zoomin "...;alias zoom zoomout"` must not register `zoom`),
 * which needs no code of its own precisely because only the top-level `aliases`
 * list defines entries.
 *
 * Exported (story 042, D4) for `profile-restore.ts`, which reads a *launcher-written* alias body
 * back and has to classify its segments by the identical rule - `say`/`say_team` with an argument is
 * a message, everything else is raw, one surrounding quote pair stripped. Two implementations of
 * that table would be two answers to "is this line a chat message", which is exactly the drift the
 * file doc comment's "one function, not two" argument rules out.
 */
export function configCommandFor(segment: string): ConfigCommand {
  const match = MESSAGE_SEGMENT.exec(segment)
  if (!match) return { kind: 'raw', text: segment }
  const channel = match[1]!.toLowerCase() === 'say_team' ? 'say_team' : 'say'
  return { kind: 'message', channel, text: unquoteMessage(match[2]!) }
}

/** Exactly the raw `wait` command, no arguments - the literal segment `commandLineFor`
 * (`alias-render.ts`) writes for a `{ kind: 'wait' }` command. Case-sensitive and exact:
 * `wait5`, `Wait`, `wait ` (trailing junk already trimmed away by the caller anyway) do not
 * match, because those are a different alias's name or a different engine command, not a
 * literal wait frame. */
function isLiteralWaitCommand(command: ConfigCommand): boolean {
  return command.kind === 'raw' && command.text.trim() === 'wait'
}

/**
 * Collapses every maximal run of consecutive literal `wait` commands (story 045, D2) into one
 * or more `{ kind: 'wait', frames }` commands, capped at `MAX_WAIT_FRAMES` each so a body never
 * resolves to a `wait` command longer than the launcher's own cap - a run of 120 becomes
 * `wait(50), wait(50), wait(20)`, not one `wait(50)` that silently drops 70 frames. Everything
 * else in the list passes through unchanged, in order.
 *
 * Has to run over the whole list rather than per-segment (unlike `configCommandFor`, which turns
 * one segment into one command) because a run of several segments becomes one command - the
 * inverse of what `commandLineFor` expands one `wait` command back into. Exported for the same
 * reason `configCommandFor`/`entryKindFor` are (story 042, D4): `profile-restore.ts` reads a
 * launcher-written alias body back with the identical rule, and two implementations of "how many
 * literal waits collapse into one command" would be two answers.
 */
export function collapseWaitRuns(commands: readonly ConfigCommand[]): ConfigCommand[] {
  const result: ConfigCommand[] = []
  let run = 0

  const flush = (): void => {
    let remaining = run
    while (remaining > 0) {
      const frames = Math.min(remaining, MAX_WAIT_FRAMES)
      result.push({ kind: 'wait', frames })
      remaining -= frames
    }
    run = 0
  }

  for (const command of commands) {
    if (isLiteralWaitCommand(command)) {
      run++
      continue
    }
    flush()
    result.push(command)
  }
  flush()

  return result
}

/** Exactly one message command and nothing else, or anything else at all. Exported (story 042, D4)
 * for `profile-restore.ts`'s kind inference, for the same reason `configCommandFor` is: the
 * "message vs. everything else" test is one table, not two. */
export function entryKindFor(commands: readonly ConfigCommand[]): 'message' | 'alias' {
  return commands.length === 1 && commands[0]!.kind === 'message' ? 'message' : 'alias'
}

const DROP_COMMAND = /^drop\s/
const USE_COMMAND = /^use\s/
const PLAY_COMMAND = /^play\s/
/** The story's movement set: `+move*`, `+forward`, `+back`, `cl_*speed`. */
const MOVEMENT_COMMAND = /^(?:\+move\w*|\+forward|\+back|cl_\w*speed)\b/

/**
 * The guess table, first match wins. Runs on the commands rather than the raw
 * body text and ignores message text entirely - see the file doc comment's two
 * narrowings.
 *
 * The `only ...` rules require at least one command of their own kind, so an
 * empty body falls through to `imported` instead of being vacuously "only
 * `play` commands".
 */
function guessCategoryKey(commands: readonly ConfigCommand[]): CategoryKey {
  const raw = commands.filter((c) => c.kind === 'raw').map((c) => c.text.trim().toLowerCase())
  if (raw.some((text) => DROP_COMMAND.test(text))) return 'drops'
  if (raw.some((text) => USE_COMMAND.test(text))) return 'weapons'

  const messages = commands.filter((c) => c.kind === 'message').length
  const plays = raw.filter((text) => PLAY_COMMAND.test(text)).length
  if (messages > 0 && messages + plays === commands.length) return 'messages'
  if (plays > 0 && plays === commands.length) return 'sounds'

  if (raw.some((text) => MOVEMENT_COMMAND.test(text))) return 'movement'
  return 'imported'
}

/** A category that has to be synthesized, i.e. one the built-in list does not already
 * carry - `BUILT_IN_ACTION_CATEGORIES` stays the authority on which those are. */
function isCreatedCategory(key: CategoryKey): key is 'messages' | 'sounds' | 'imported' {
  return !BUILT_IN_CATEGORY_IDS.has(key)
}

/**
 * Hands out category ids: a built-in id verbatim, or one `newId()` per created
 * category, remembered so twenty imported aliases share one `imported` drawer
 * instead of getting twenty.
 */
function categoryRegistry(newId: () => string): {
  idFor: (key: CategoryKey) => string
  created: () => ConfigActionCategory[]
} {
  const created = new Map<CategoryKey, ConfigActionCategory>()
  return {
    idFor(key: CategoryKey): string {
      if (!isCreatedCategory(key)) return key
      const existing = created.get(key)
      if (existing) return existing.id
      const category: ConfigActionCategory = { id: newId(), name: IMPORT_CATEGORY_NAMES[key] }
      created.set(key, category)
      return category.id
    },
    created: () => [...created.values()],
  }
}

/** Does this segment rebind a key - the one construct the import has to ask about? */
function isBindSegment(segment: string): boolean {
  return commandWord(segment) === 'bind'
}

/**
 * The key that runs `name`, or `null` when nothing does. A bind value counts only
 * when it is exactly this one alias name (`tokenize` so a quoted `"cali"` counts
 * and `cali; say hi` does not); compared case-insensitively, like
 * `Cmd_ExecuteString`'s own alias lookup. Keys are visited in sorted order so a
 * config that binds the same alias twice picks a deterministic trigger rather
 * than an insertion-order one - the same reasoning `adoptRawBinds` sorts for.
 */
function triggerKeyFor(name: string, binds: Readonly<Record<string, string>>): string | null {
  const wanted = name.trim().toLowerCase()
  for (const key of Object.keys(binds).sort()) {
    const tokens = tokenize(binds[key] ?? '')
    if (tokens.length === 1 && tokens[0]!.toLowerCase() === wanted) return normalizeBindKey(key)
  }
  return null
}

/**
 * The toggle layer an "attempt as layer" answer asks for: the body's
 * `bind <key> <command>` segments as `overrides`, everything else in the body
 * dropped (a layer is a key -> command map; it has no room for the `wait` or the
 * `echo` that sat next to the rebinds - which is exactly why this is a question
 * to the user and not an automatic conversion).
 *
 * `bind <key>` with no command is the engine's "print what this key does" form,
 * not an override, and is skipped. Keys are normalized the way every other
 * override map in this codebase stores them (`normalizeBindKey`), the command is
 * the remaining tokens joined by single spaces - `Cmd_Bind_f`'s own
 * concatenation.
 */
function toLayer(
  definition: ImportedAliasDefinition,
  segments: readonly string[],
  binds: Readonly<Record<string, string>>,
  newId: () => string,
): AltLayer {
  const overrides: Record<string, string> = {}
  for (const segment of segments) {
    if (!isBindSegment(segment)) continue
    const tokens = tokenize(segment)
    if (tokens.length < 3) continue
    overrides[normalizeBindKey(tokens[1]!)] = tokens.slice(2).join(' ')
  }
  return {
    id: newId(),
    name: definition.name,
    mode: 'toggle',
    triggerKey: triggerKeyFor(definition.name, binds),
    overrides,
  }
}

/**
 * Builds a two-part idiom's commands for one recognised half: its raw segments
 * (already stripped of any toggle rewrite by the recogniser) through the exact
 * same `configCommandFor`/`collapseWaitRuns` pipeline a normal entry's body goes
 * through - one table, not two, same as everywhere else in this file.
 */
function commandsForHalf(segments: readonly string[]): ConfigCommand[] {
  return collapseWaitRuns(segments.map(configCommandFor))
}

/**
 * A recognised toggle trio -> one `kind: 'toggle'` entry. `parts[i].aliasName`
 * carries the recognised state's own name verbatim (story 045's Decisions: "an
 * imported toggle keeps its own state names in `parts[i].aliasName`"), which is
 * what makes `alias-render.ts`'s `twoPartHalfNames` render `zoomin`/`zoomout`
 * instead of deriving a fresh `_s1`/`_s2` name.
 */
function toggleEntry(
  toggle: RecognizedToggle,
  categories: ReturnType<typeof categoryRegistry>,
  newId: () => string,
): ConfigAction {
  const state1 = commandsForHalf(toggle.states[0].segments)
  const state2 = commandsForHalf(toggle.states[1].segments)
  return {
    id: newId(),
    categoryId: categories.idFor(guessCategoryKey([...state1, ...state2])),
    name: toggle.dispatchName,
    kind: 'toggle',
    commands: [],
    aliasName: toggle.dispatchName,
    parts: [
      { commands: state1, aliasName: toggle.states[0].name },
      { commands: state2, aliasName: toggle.states[1].name },
    ],
  }
}

/**
 * A recognised `+x`/`-x` pair -> one `kind: 'press-release'` entry. No
 * per-part `aliasName`: the sign-free base name lives on the action itself and
 * `+`/`-` are appended at render time (story 045's Decisions), so setting a
 * per-part name here would only be ignored by `alias-render.ts`.
 */
function pressReleaseEntry(
  pair: RecognizedPressRelease,
  categories: ReturnType<typeof categoryRegistry>,
  newId: () => string,
): ConfigAction {
  const press = commandsForHalf(pair.press.segments)
  const release = commandsForHalf(pair.release.segments)
  return {
    id: newId(),
    categoryId: categories.idFor(guessCategoryKey([...press, ...release])),
    name: pair.baseName,
    kind: 'press-release',
    commands: [],
    aliasName: pair.baseName,
    parts: [{ commands: press }, { commands: release }],
  }
}

/**
 * A recognised `waitN` alias -> one ordinary `kind: 'alias'` entry with a
 * single `{ kind: 'wait', frames }` command. Not a new `ActionEntryKind` - the
 * entry (and its name, so every other body still referencing it stays valid)
 * is just an alias whose one command happens to be a wait.
 */
function waitAliasEntry(
  wait: RecognizedWaitAlias,
  categories: ReturnType<typeof categoryRegistry>,
  newId: () => string,
): ConfigAction {
  const commands: ConfigCommand[] = [{ kind: 'wait', frames: wait.frames }]
  return {
    id: newId(),
    categoryId: categories.idFor(guessCategoryKey(commands)),
    name: wait.name,
    kind: entryKindFor(commands),
    commands,
    aliasName: wait.name,
  }
}

/**
 * Converts an import's alias definitions into catalogue entries.
 *
 * Independent of the order the definitions arrive in, and of everything in
 * `binds` except a layer's trigger - see the file doc comment.
 *
 * Story 045, D6: before the per-definition loop below, `entry-idioms.ts`'s
 * shared recogniser runs once over this same de-duplicated, last-definition-
 * wins set and finds the toggle/press-release/`waitN` idioms. A name it claims
 * is skipped in the loop - never converted twice - and instead produces exactly
 * one `toggle`/`press-release`/`alias` entry, built once, at the position of
 * that idiom's primary defining name (the toggle's dispatch, the pair's `+`
 * half, the wait alias's own name) so the result stays in the same document
 * order the untouched per-definition path already produces. A name a
 * recognised idiom did not claim falls through to the loop exactly as before -
 * AC4's "falls back to plain alias entries" - including every rebind/ambiguous
 * check (D5's recogniser never claims a body with a top-level `bind` segment,
 * so a consumed name could never have reached that check anyway).
 */
export function buildImportedActions(input: ImportedActionsInput): ImportedActionsResult {
  const { newId } = input
  const binds = input.binds ?? {}
  const asLayer = new Set((input.layerAliases ?? []).map((name) => name.trim().toLowerCase()))
  const categories = categoryRegistry(newId)

  // Every definition first, before any body is read: last definition of a name
  // wins, first-seen position kept (`Map#set` on an existing key replaces the
  // value without moving it).
  const byName = new Map<string, ImportedAliasDefinition>()
  for (const definition of input.aliases) byName.set(definition.name, definition)

  const recognized = recognizeEntryIdioms(
    [...byName.values()].map(({ name, body }) => ({ name, body })),
  )
  const consumedKeys = new Set(recognized.consumedNames.map((name) => name.toLowerCase()))
  const toggleByPrimaryKey = new Map(
    recognized.toggles.map((toggle) => [toggle.dispatchName.toLowerCase(), toggle]),
  )
  const pairByPrimaryKey = new Map(
    recognized.pressReleases.map((pair) => [pair.press.name.toLowerCase(), pair]),
  )
  const waitByPrimaryKey = new Map(
    recognized.waitAliases.map((wait) => [wait.name.toLowerCase(), wait]),
  )

  const actions: ConfigAction[] = []
  const layers: AltLayer[] = []
  const ambiguous: AmbiguousRebindAlias[] = []

  for (const definition of byName.values()) {
    const nameKey = definition.name.toLowerCase()
    if (consumedKeys.has(nameKey)) {
      const toggle = toggleByPrimaryKey.get(nameKey)
      if (toggle) actions.push(toggleEntry(toggle, categories, newId))
      const pair = pairByPrimaryKey.get(nameKey)
      if (pair) actions.push(pressReleaseEntry(pair, categories, newId))
      const wait = waitByPrimaryKey.get(nameKey)
      if (wait) actions.push(waitAliasEntry(wait, categories, newId))
      // A name consumed but matching none of the maps above is a non-primary
      // member of an already-built idiom (a toggle's state, a pair's release
      // half) - it produced no entry of its own and is simply skipped here.
      continue
    }

    const segments = splitAliasBody(definition.body)
    const rebinds = segments.some(isBindSegment)

    if (rebinds) {
      const { name, body, file, line } = definition
      ambiguous.push({ name, body, file, line })
      if (asLayer.has(name.trim().toLowerCase())) {
        layers.push(toLayer(definition, segments, binds, newId))
        continue
      }
    }

    const commands = collapseWaitRuns(segments.map(configCommandFor))
    const kind = entryKindFor(commands)
    actions.push({
      id: newId(),
      categoryId: categories.idFor(guessCategoryKey(commands)),
      name: definition.name,
      kind,
      commands,
      aliasName: definition.name,
      // Story 041, D3 ("Decided in refine"): an empty-body alias (`alias blaster_settings ""`) is a
      // user-authored hook, not a generated action with nothing left to say - the writer's "no
      // usable commands -> no alias line" rule (story 038 AC6) must not swallow it. `kind` is always
      // 'alias' here (an empty body can never satisfy `entryKindFor`'s one-message-command test), but
      // the check is spelled out rather than assumed, since only a `kind: 'alias'` entry's own name
      // is what `alias-render.ts` would otherwise silently drop.
      ...(kind === 'alias' && commands.length === 0 ? { keepEmptyAlias: true as const } : {}),
    })
  }

  return { actions, categories: categories.created(), layers, ambiguous }
}
