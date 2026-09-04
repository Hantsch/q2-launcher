/**
 * Recognising the three config idioms story 045 turns into first-class entries -
 * out of nothing but a list of `alias <name> <body>` definitions (story 045, D5).
 *
 * Two readers must agree, byte for byte, about what a group of alias definitions
 * *is*: `alias-import.ts` (a foreign, hand-written config - story 041) and
 * `profile-restore.ts` (the launcher's own file, read back off disk - story 042).
 * Story 050 drops the `k`/`e`/`slot` tag fields, so neither reader has a tag to
 * lean on any more: an entry's kind has to be derivable from the config text
 * itself. That is what this module is - one recogniser, not two, for the same
 * "one table, not two" reason `configCommandFor`/`entryKindFor` are shared.
 *
 * Pure data in, plain data out. No `node:*`, no DOM, no electron, no ids, no
 * `ConfigAction`: building entries out of what was recognised is D6's and D7's
 * job, and keeping this file down to "which definitions form which shape" is
 * what lets both of them use it without either one's entry-building rules
 * leaking into the other's.
 *
 * ## All-or-nothing, and why it has to be
 *
 * Recognition is all-or-nothing per idiom (story 045's Decisions). Every check
 * below rejects the *whole* group on any deviation - an extra segment in the
 * dispatch body, a third state, both states pointing at the same one, a `bind`
 * segment anywhere in a body - and the definitions fall back to the plain alias
 * entries they import as today (AC4's "rather than guessing").
 *
 * The asymmetry is deliberate: a missed recognition costs a user one nicer UI
 * row, while a loose match silently *retypes* a hand-written alias family into
 * the wrong entry kind - and the next save then rewrites the user's own file
 * from that wrong model. Nothing here does best-effort repair.
 *
 * ## Structure, never names
 *
 * A toggle trio is grouped structurally (story 045's Decisions: "not by name
 * suffix or prose"): the dispatch body names state 1, and each state body ends
 * in `alias <dispatch> <the other state>`. That is what keeps an imported
 * `zoom`/`zoomin`/`zoomout` trio recognisable verbatim, where the launcher's own
 * output happens to read `zoom`/`zoom_s1`/`zoom_s2` (`alias-render.ts`'s
 * `twoPartAliasNames`). Same for the wait family: `wait5` is recognised because
 * its body resolves to five frames, not because it is called `wait5`.
 *
 * The one place a name *is* the signal is the press/release pair, because there
 * the sign is the engine's own idiom: only a bind value starting with `+` makes
 * the engine send the `-` half on key-up, so `+slow`/`-slow` is a shape, not a
 * convention someone made up.
 *
 * ## Names are matched case-insensitively, and kept verbatim
 *
 * The engine's alias lookup (`Cmd_ExecuteString` -> `Q_stricmp`) is
 * case-insensitive, so `alias zoom ZoomIn` really does run `zoomin`; every
 * name comparison here is therefore case-insensitive. Every name *returned* is
 * the defining line's own spelling, because the first write-back has to
 * reproduce the player's file rather than re-case ninety aliases
 * (`alias-import.ts`'s "Names" section).
 *
 * Two definitions whose names differ only in case (`Zoom` and `zoom`) are
 * ambiguous under that lookup - the engine stores both and runs whichever its
 * list hands over first. Neither is claimed by any idiom here, and no reference
 * resolves to that name: an ambiguity the engine itself resolves by list order
 * is not one this module guesses at. Both definitions fall back.
 *
 * ## `_p<n>` chunks are the caller's problem, not this file's
 *
 * A body too long for one line is split by `alias-render.ts` into `<name>_p<n>`
 * chunks called by a parent whose body is nothing but their names - so a chunked
 * toggle state reads `alias zoom_s1 "zoom_s1_p1; zoom_s1_p2"` and the trailing
 * `alias zoom zoom_s2` rewrite sits inside the *last chunk*, not in the state's
 * own body. Such a state body does not end in a rewrite and is therefore **not**
 * recognised here.
 *
 * That is on purpose: undoing the split needs the chunk-family knowledge the
 * caller already has (`profile-restore.ts#commandsFromAliases` concatenates the
 * chunk bodies in `_p<n>` order and drops the parent's body), and re-deriving it
 * here would mean this file guessing which `_p<n>` names are launcher-owned.
 * Callers therefore fold chunks *before* calling: pass one `AliasLike` per entry
 * whose `body` is the recombined body. A foreign config has no launcher chunks
 * at all, so `alias-import.ts` has nothing to do. `entry-idioms.test.ts` pins
 * both halves of this contract.
 *
 * ## Body splitting
 *
 * `bodySegments` below is the same rule as `alias-import.ts#splitAliasBody`:
 * split on top-level `;` first, then strip a `//` comment off each segment, then
 * drop what is left empty - the engine's own order (`Cbuf_Execute` cuts at the
 * first unquoted `;`, and only then does `Cmd_TokenizeString` see a `//`), and
 * the same shared tokenizer primitives (`command-tokenizer.ts`).
 *
 * It is a local copy rather than an import purely to keep the dependency
 * direction right: D6 makes `alias-import.ts` call *into* this file, so an
 * import back the other way would be a cycle. The two copies want to become one
 * shared primitive in `command-tokenizer.ts` when D6 wires the import path up.
 */

import {
  splitTopLevelSemicolons,
  stripLineComment,
  tokenize,
} from '@shared/config/command-tokenizer'
import { MAX_WAIT_FRAMES } from '@shared/config/engine-limits'

/**
 * The least a caller has to hand over: an alias definition's name and its body,
 * with the outer quotes already stripped by whoever parsed the line.
 *
 * Deliberately *not* `alias-import.ts`'s `ImportedAliasDefinition` (which also
 * carries `file`/`line`) and not `profile-restore.ts`'s line type either:
 * structural typing means both of those satisfy this interface as they are, so
 * neither reader has to map its own type into a third one - and this file stays
 * free of the dependency direction problem described in the file comment.
 */
export interface AliasLike {
  name: string
  body: string
}

/**
 * One half of a recognised two-part idiom: the alias definition it came from,
 * plus that half's own command segments.
 *
 * `segments` is the body already split the way the engine splits it (see
 * `bodySegments`), with a toggle state's trailing `alias <dispatch> <other>`
 * rewrite removed - that segment is the wiring, not a command the user typed.
 * Segments are handed over as text rather than as `ConfigCommand`s because the
 * classification table (`configCommandFor`) and the literal-`wait` collapse
 * (`collapseWaitRuns`) both live in `alias-import.ts`, which will depend on this
 * file, not the other way round.
 */
export interface RecognizedHalf {
  /** The defining alias's own name, verbatim (`zoomin`, `zoom_s1`, `+slow`). */
  name: string
  /** This half's commands, in body order, comment-stripped, blanks dropped. */
  segments: string[]
}

/**
 * A toggle-by-alias-reassignment trio: `alias zoom zoomin` (the dispatch, what a
 * key is bound to) plus two states that rewrite the dispatch to each other.
 *
 * `states[0]` is always the state the dispatch currently names - state 1, where
 * a toggle always starts after `exec`, since the file's static text cannot say
 * otherwise (story 045's Decisions).
 */
export interface RecognizedToggle {
  kind: 'toggle'
  /** The dispatch alias's name, verbatim - the name a bind points at. */
  dispatchName: string
  /** State 1 (the one the dispatch names) first, then state 2. */
  states: [RecognizedHalf, RecognizedHalf]
  /** The three names this idiom claims: dispatch, state 1, state 2. Verbatim. */
  consumedNames: string[]
}

/**
 * An `+x`/`-x` press/release pair - the engine's own hold idiom.
 *
 * `baseName` is sign-free, exactly what a `press-release` entry stores (story
 * 045's Decisions: `+`/`-` are appended at render time so the two halves cannot
 * drift), and it keeps the casing of the `+` definition's name.
 */
export interface RecognizedPressRelease {
  kind: 'press-release'
  /** The `+` name minus its sign, e.g. `slow` for `+slow`. */
  baseName: string
  press: RecognizedHalf
  release: RecognizedHalf
  /** Both claimed names, verbatim: the `+` half's, then the `-` half's. */
  consumedNames: string[]
}

/**
 * An alias whose whole body is nothing but frame waits - `wait5`, and `wait20`
 * built out of four `wait5`s.
 *
 * The alias keeps its `name`: the entry survives as an entry, so every other
 * body referencing it stays valid (story 045's Decisions). `consumedNames` is
 * therefore just its own name - a `wait5` referenced by `wait20` is *not* merged
 * away, because some third body may call `wait5` directly and dropping the
 * definition would break that reference on the next save.
 */
export interface RecognizedWaitAlias {
  kind: 'wait'
  /** The alias's own name, verbatim. */
  name: string
  /** Total frames, always `1..MAX_WAIT_FRAMES`. */
  frames: number
  /** Just `[name]` - see above. */
  consumedNames: string[]
}

/**
 * What `recognizeEntryIdioms` found. Everything a caller needs to build entries
 * for the shapes that matched, plus the list of names it must keep handling
 * exactly as it does today.
 */
export interface RecognitionResult {
  toggles: RecognizedToggle[]
  pressReleases: RecognizedPressRelease[]
  waitAliases: RecognizedWaitAlias[]
  /**
   * Every name claimed by one of the above, verbatim, in the order the idioms
   * were recognised. Compare case-insensitively - see the file comment.
   */
  consumedNames: string[]
  /**
   * The fallback list: one verbatim name per input definition that no idiom
   * claimed, in input order (so a caller can walk its own definitions against
   * it). These import and restore exactly as they do today - untouched.
   */
  unmatchedNames: string[]
}

/**
 * How deep a wait chain may nest before it stops resolving.
 *
 * Termination does not depend on this - the in-progress path guard below makes
 * a cycle unresolvable, and the definition set is finite. It is a cost and
 * sanity rail: 8 levels are plenty for any real chain (the story's own
 * `wait5` -> `wait20` -> `wait50` stack is three), reaching the 50-frame cap by
 * doubling takes six, and 8 stays half of the engine's own `ALIAS_LOOP_COUNT`
 * (16) - beyond which the engine refuses to expand a nested alias anyway, so a
 * "chain" that deep would not run in-game to begin with. Over the cap the body
 * stays raw, which is what the story's Decisions ask for.
 */
export const MAX_WAIT_RESOLVE_DEPTH = 8

/** One definition plus the two things every check below needs off it. */
interface IndexedAlias {
  definition: AliasLike
  /** Lower-cased name - the key every comparison and lookup goes through. */
  key: string
  /** `bodySegments(definition.body)`, computed once. */
  segments: string[]
}

interface AliasIndex {
  /** Every definition, in input order, duplicates included. */
  all: IndexedAlias[]
  /** Lookup by lower-cased name; ambiguous names are absent, see `ambiguous`. */
  byKey: Map<string, IndexedAlias>
  /** Lower-cased names carried by more than one definition - see the file comment. */
  ambiguous: Set<string>
}

/**
 * Splits an alias body into its top-level command segments - `;` first, then a
 * `//` comment off each segment, then drop what is left empty. Same rule, same
 * order and same primitives as `alias-import.ts#splitAliasBody`; see the file
 * comment for why it is copied rather than imported.
 */
function bodySegments(body: string): string[] {
  return splitTopLevelSemicolons(body)
    .map((segment) => stripSegmentComment(segment).trim())
    .filter((segment) => segment.length > 0)
}

/**
 * `stripLineComment`'s quote-aware cut, but only when the `//` actually starts a
 * token - `alias-import.ts#stripSegmentComment` verbatim. `COM_Parse` skips a
 * comment where it looks for the next token, so `use rl // note` loses its note
 * while `say join http://example.com` keeps its URL.
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

/**
 * Does any of this body's segments rebind a key? `alias-import.ts#isBindSegment`
 * over a whole body.
 *
 * A body with a top-level `bind` is the key-rebinding alias construct story 045
 * AC8 puts explicitly out of scope and story 041's ambiguous-rebind path owns.
 * It disqualifies the whole group it appears in - a toggle trio or a `+`/`-`
 * pair one of whose halves rebinds keys is exactly the ambiguity neither story
 * wants guessed at, and half-recognising it would take that decision away from
 * the user.
 */
function rebindsKeys(entry: IndexedAlias): boolean {
  return entry.segments.some((segment) => commandWord(segment) === 'bind')
}

/**
 * The single bare alias name a body consists of, or `null`.
 *
 * "Bare" is the engine's reading, not a text match: the body must be exactly one
 * top-level segment tokenizing to exactly one token, so `zoomin` and `"zoomin"`
 * both qualify (`Cmd_TokenizeString` sees one argument either way) while
 * `zoomin; something_else` and `zoomin arg` do not.
 */
function loneReference(entry: IndexedAlias): string | null {
  if (entry.segments.length !== 1) return null
  const tokens = tokenize(entry.segments[0]!)
  if (tokens.length !== 1) return null
  const name = tokens[0]!
  return name.length > 0 ? name : null
}

/**
 * The state name `entry`'s body reassigns `dispatchKey` to, if its **last**
 * segment is exactly `alias <dispatch> <name>` and nothing more.
 *
 * Last, not "somewhere": the rewrite is what runs after the state's commands, so
 * an extra segment behind it means the shape is not the idiom (and, in-engine,
 * that the toggle would be flipped by whatever follows). Exactly three tokens,
 * so `alias zoom zoomout extra` is rejected rather than read as a rewrite with
 * junk attached.
 */
function reassignmentTarget(entry: IndexedAlias, dispatchKey: string): string | null {
  const last = entry.segments[entry.segments.length - 1]
  if (last === undefined) return null
  const tokens = tokenize(last)
  if (tokens.length !== 3) return null
  if (tokens[0]!.toLowerCase() !== 'alias') return null
  if (tokens[1]!.toLowerCase() !== dispatchKey) return null
  return tokens[2]!.length > 0 ? tokens[2]! : null
}

/**
 * The toggle trio `dispatch` would be the dispatch alias of, or `null`.
 *
 * Every step is a rejection point, and a rejection is the whole trio's:
 *
 *  1. `dispatch`'s body is exactly one bare alias name, naming another
 *     definition. Anything else - a second segment, an argument, a name nothing
 *     defines - is not a dispatch. Note that plain `alias a b` forwarding is the
 *     overwhelmingly common shape here, which is why steps 2-4 have to hold too
 *     before anything is claimed.
 *  2. that definition (state 1) ends in `alias <dispatch> <state 2>`, and state 2
 *     is defined.
 *  3. state 2 ends in `alias <dispatch> <state 1>` - pointing *back*. A trailing
 *     rewrite to a third name is a three-state chain, not a two-state loop, and
 *     falls back whole.
 *  4. the three names are pairwise distinct (case-insensitively) - which is what
 *     rejects a cross-wired trio whose states both reassign to the same state,
 *     and a state named after its own dispatch.
 *  5. no body of the three carries a top-level `bind` (see `rebindsKeys`).
 */
function toggleCandidate(dispatch: IndexedAlias, index: AliasIndex): RecognizedToggle | null {
  if (index.ambiguous.has(dispatch.key)) return null

  const firstName = loneReference(dispatch)
  if (firstName === null) return null
  const first = index.byKey.get(firstName.toLowerCase())
  if (!first || first.key === dispatch.key) return null

  const secondName = reassignmentTarget(first, dispatch.key)
  if (secondName === null) return null
  const second = index.byKey.get(secondName.toLowerCase())
  if (!second) return null

  const backReference = reassignmentTarget(second, dispatch.key)
  if (backReference === null || backReference.toLowerCase() !== first.key) return null

  if (new Set([dispatch.key, first.key, second.key]).size !== 3) return null
  if (rebindsKeys(dispatch) || rebindsKeys(first) || rebindsKeys(second)) return null

  return {
    kind: 'toggle',
    dispatchName: dispatch.definition.name,
    states: [stateHalf(first), stateHalf(second)],
    consumedNames: [dispatch.definition.name, first.definition.name, second.definition.name],
  }
}

/** A toggle state's half: its body minus the trailing dispatch rewrite. */
function stateHalf(entry: IndexedAlias): RecognizedHalf {
  return { name: entry.definition.name, segments: entry.segments.slice(0, -1) }
}

/** A press/release half: its body verbatim, rewrites being none of its business. */
function pairHalf(entry: IndexedAlias): RecognizedHalf {
  return { name: entry.definition.name, segments: [...entry.segments] }
}

/**
 * The `+x`/`-x` pair `press` would be the press half of, or `null`.
 *
 * The `+` is case-sensitive (it is a character, not a name) and the counterpart
 * lookup is not (it is a name). A `+x` with no `-x` - or a lone `-x`, which
 * never gets here because only `+` names are offered as candidates - is not a
 * pair: both fall back to the plain alias entries `alias-import.ts` already
 * imports them as, sign kept, and Care reports the half-missing shape (D8).
 */
function pressReleaseCandidate(
  press: IndexedAlias,
  index: AliasIndex,
): RecognizedPressRelease | null {
  if (index.ambiguous.has(press.key)) return null
  if (!press.definition.name.startsWith('+')) return null

  const base = press.definition.name.slice(1)
  if (base.length === 0) return null

  const release = index.byKey.get(`-${base}`.toLowerCase())
  if (!release || release.key === press.key) return null
  if (rebindsKeys(press) || rebindsKeys(release)) return null

  return {
    kind: 'press-release',
    baseName: base,
    press: pairHalf(press),
    release: pairHalf(release),
    consumedNames: [press.definition.name, release.definition.name],
  }
}

/**
 * Why a body is not a wait chain. `'depth'` is the only path-dependent verdict -
 * the same name may resolve fine from a shallower root - so it is the one
 * verdict `resolveFrames` must never memoize.
 */
type FrameFailure = 'shape' | 'cycle' | 'depth'

type FrameResolution = { frames: number } | { failure: FrameFailure }

/**
 * Resolves a body to a total frame count, recursively (story 045's Decisions:
 * "recognised by resolving it to a frame count").
 *
 * A segment counts when it is either the literal command `wait` - exactly, no
 * arguments, case-sensitive, the same rule `collapseWaitRuns` uses, since
 * `wait5` and `Wait` are a different alias's name and a different command - or a
 * single bare alias name that itself resolves. Anything else at all makes the
 * whole body unresolvable: a body is a wait chain or it is not, there is no
 * "mostly waits".
 *
 * The frame cap is not applied here but by the caller, on the *final* total of
 * the alias being reported: a chain member that resolves within the cap stays
 * recognised even when something built on top of it blows past it - that larger
 * alias simply does not resolve, and its segments keep referencing the smaller,
 * surviving ones (story 045's Decisions: over the cap the body stays raw).
 *
 * Successes and path-independent failures are memoized, so every name resolves
 * once and the whole pass stays linear in the number of definitions; the
 * in-progress path guard makes a cycle (`loopA` -> `loopB` -> `loopA`)
 * unresolvable instead of unbounded. A cycle failure *is* path-independent -
 * a name that reaches a cycle reaches it from every root - which is why only
 * `'depth'` escapes the memo.
 */
function resolveFrames(
  entry: IndexedAlias,
  index: AliasIndex,
  memo: Map<string, FrameResolution>,
  inProgress: Set<string>,
  depth: number,
): FrameResolution {
  const cached = memo.get(entry.key)
  if (cached) return cached
  if (inProgress.has(entry.key)) return { failure: 'cycle' }
  if (depth > MAX_WAIT_RESOLVE_DEPTH) return { failure: 'depth' }

  inProgress.add(entry.key)
  let result: FrameResolution = { frames: 0 }
  let frames = 0

  for (const segment of entry.segments) {
    if (segment === 'wait') {
      frames += 1
      continue
    }
    const tokens = tokenize(segment)
    const referenced = tokens.length === 1 ? index.byKey.get(tokens[0]!.toLowerCase()) : undefined
    if (!referenced) {
      result = { failure: 'shape' }
      break
    }
    const resolved = resolveFrames(referenced, index, memo, inProgress, depth + 1)
    if ('failure' in resolved) {
      result = resolved
      break
    }
    frames += resolved.frames
  }

  inProgress.delete(entry.key)
  if (!('failure' in result)) result = { frames }
  if (!('failure' in result) || result.failure !== 'depth') memo.set(entry.key, result)
  return result
}

/**
 * Every definition whose body resolves to `1..MAX_WAIT_FRAMES` frames.
 *
 * `1..`, not `0..`: an empty body resolves to zero segments and zero frames, and
 * `alias blaster_settings ""` is an empty user hook, not a wait of nothing.
 *
 * Intermediate members are reported too, each on its own - `wait5` *and* the
 * `wait20` built out of four of it, because the reference has to keep working
 * (see `RecognizedWaitAlias`). Names are shape-agnostic here: an alias called
 * anything at all whose body is only waits is a wait alias, the same way a
 * toggle trio is recognised by wiring rather than by suffix.
 */
function waitCandidates(index: AliasIndex): RecognizedWaitAlias[] {
  const memo = new Map<string, FrameResolution>()
  const inProgress = new Set<string>()
  const found: RecognizedWaitAlias[] = []

  for (const entry of index.all) {
    if (index.ambiguous.has(entry.key)) continue
    const resolved = resolveFrames(entry, index, memo, inProgress, 0)
    if ('failure' in resolved) continue
    if (resolved.frames < 1 || resolved.frames > MAX_WAIT_FRAMES) continue
    found.push({
      kind: 'wait',
      name: entry.definition.name,
      frames: resolved.frames,
      consumedNames: [entry.definition.name],
    })
  }

  return found
}

function buildIndex(definitions: readonly AliasLike[]): AliasIndex {
  const all: IndexedAlias[] = []
  const byKey = new Map<string, IndexedAlias>()
  const ambiguous = new Set<string>()

  for (const definition of definitions) {
    const key = definition.name.toLowerCase()
    const entry: IndexedAlias = { definition, key, segments: bodySegments(definition.body) }
    all.push(entry)
    if (byKey.has(key)) ambiguous.add(key)
    byKey.set(key, entry)
  }

  // A name two definitions share (case-insensitively) resolves by list order
  // in-engine and is not something this module guesses at: drop it from the
  // lookup entirely, so nothing references it and nothing claims it.
  for (const key of ambiguous) byKey.delete(key)

  return { all, byKey, ambiguous }
}

/**
 * Recognise story 045's three idioms in one config's alias definitions.
 *
 * The input is the *whole* list, because none of the three shapes can be decided
 * from a single definition: a toggle trio spans three of them and a press/release
 * pair two. Input order does not influence what matches (a body may reference an
 * alias defined further down - the engine resolves a body when it runs, not when
 * it is defined, `alias-import.ts`'s "Order independence"); it only fixes the
 * order of the returned lists, so the same input always produces the same
 * output.
 *
 * ## A definition belongs to at most one idiom
 *
 * Candidates are collected first and only then accepted, because "consumed"
 * has to be decided globally:
 *
 *  - **Two grouping candidates that overlap on any name cancel each other out.**
 *    Neither claims anything and every definition involved falls back. The
 *    story does not specify a tie-break, and picking one candidate over the
 *    other would be exactly the guess AC4 rules out - a definition that is
 *    readable as two different entry kinds is ambiguous, and the fallback is the
 *    behaviour the launcher has today. The reachable case is cross-idiom: a
 *    `+x`/`-x` pair whose halves are *also* wired as the two states of a toggle
 *    (`alias hold +x` with `+x` ending in `alias hold -x`) matches both shapes,
 *    and neither is claimed. Two toggle trios cannot overlap - a dispatch body
 *    is one bare name and a state body ends in a three-token rewrite, so no
 *    definition can be both, and a state's rewrite names its own dispatch.
 *  - **A wait alias yields to an accepted grouping candidate.** `alias +nuke
 *    "wait;wait;wait"` with a `-nuke` next to it is one press/release entry, not
 *    a press/release entry *and* a wait entry; the half's waits are the caller's
 *    to collapse per command (`collapseWaitRuns`). Yielding rather than
 *    cancelling keeps a real pair recognised, and a wait alias never *costs* a
 *    toggle or a pair its recognition.
 */
export function recognizeEntryIdioms(definitions: readonly AliasLike[]): RecognitionResult {
  const index = buildIndex(definitions)

  const toggles: RecognizedToggle[] = []
  const pressReleases: RecognizedPressRelease[] = []
  for (const entry of index.all) {
    const toggle = toggleCandidate(entry, index)
    if (toggle) toggles.push(toggle)
    const pair = pressReleaseCandidate(entry, index)
    if (pair) pressReleases.push(pair)
  }

  // How many grouping candidates want each name. Anything above one is an
  // ambiguity that costs every candidate involved its recognition.
  const claimCount = new Map<string, number>()
  for (const candidate of [...toggles, ...pressReleases]) {
    for (const name of candidate.consumedNames) {
      const key = name.toLowerCase()
      claimCount.set(key, (claimCount.get(key) ?? 0) + 1)
    }
  }
  const uncontested = (candidate: { consumedNames: string[] }): boolean =>
    candidate.consumedNames.every((name) => claimCount.get(name.toLowerCase()) === 1)

  const acceptedToggles = toggles.filter(uncontested)
  const acceptedPairs = pressReleases.filter(uncontested)

  const consumed = new Set<string>()
  const consumedNames: string[] = []
  const claim = (candidate: { consumedNames: string[] }): void => {
    for (const name of candidate.consumedNames) {
      consumed.add(name.toLowerCase())
      consumedNames.push(name)
    }
  }
  for (const candidate of acceptedToggles) claim(candidate)
  for (const candidate of acceptedPairs) claim(candidate)

  const acceptedWaits = waitCandidates(index).filter(
    (candidate) => !consumed.has(candidate.name.toLowerCase()),
  )
  for (const candidate of acceptedWaits) claim(candidate)

  return {
    toggles: acceptedToggles,
    pressReleases: acceptedPairs,
    waitAliases: acceptedWaits,
    consumedNames,
    unmatchedNames: index.all
      .filter((entry) => !consumed.has(entry.key))
      .map((entry) => entry.definition.name),
  }
}
