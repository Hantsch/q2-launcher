/**
 * Alias-wiring checks — story 019 D8.
 *
 * Runs over the profile's own `ConfigAction[]`, never over rendered text
 * (unlike D3's `validate-structure.ts`): the three things this module reports
 * — a binding calling an alias that no longer exists, an alias nobody calls, a
 * duplicate alias name — are all about the *entries the user edited*, not
 * about the bytes `render.ts` would put on disk. A deleted alias entry leaves
 * no trace in the rendered file at all, so the only place left to catch a now-
 * dangling reference is here, before it is even rendered.
 *
 * ## What counts as "references an alias"
 *
 * An alias takes no arguments (`alias +test ...` is called by typing exactly
 * `+test`, nothing else — same rule `alias-suggestions.ts` relies on: picking
 * a suggestion "writes its exact name"). So a `kind: 'raw'` command's text is
 * split on top-level `;` (a user can chain several commands in one typed
 * entry, same as `alt-layers.ts`), and a segment counts as a *candidate*
 * reference only when it is a single bare token with no arguments at all —
 * `drop rocket launcher` or `say hello` can never be a call to an alias
 * (which takes none), so they are never even considered.
 *
 * That alone is not enough to call a candidate "undefined", though: plenty of
 * genuine built-in engine commands are also bare, argument-less tokens
 * (`+forward`, `+attack`, `wait`, ...) and this module has no built-in-command
 * catalogue to check them against (none exists elsewhere in this codebase
 * either — `validate-structure.ts`'s own reference graph only ever looks at
 * alias *bodies*, never at bind commands, for exactly this reason). Reporting
 * every unmatched bare command as an "undefined alias" would flag every
 * ordinary movement/weapon bind a profile has — the opposite of AC 8's "a
 * clean profile produces none of them".
 *
 * Two narrowings keep this module from doing that:
 *
 * - Catalogue-materialised binds (story 015's `catalogId`) are excluded
 *   entirely. Their commands come straight from `action-catalog.ts`'s
 *   source-cited engine command list, never from a user typing an alias name,
 *   so they can never be a broken alias reference by construction.
 * - Only a token that itself starts with `+` or `-` is treated as a candidate
 *   "undefined alias" at all — the press/release convention every alias
 *   example in this story uses (`+test`/`-test`, mirroring `alt-layers.ts`'s
 *   `+drops`/`-drops`). A bare command with no sign (`wait`, `centerview`) is
 *   left alone rather than guessed at.
 *
 * A third narrowing (review fix, Finding 2) keeps the sign check itself from
 * over-firing: `+forward`/`-attack`/`+moveup`/... are ordinary, hand-typeable
 * engine commands with no alias involved at all, and this module has no
 * built-in-command catalogue to tell them apart from a genuine (broken) alias
 * call — except for the one list of engine commands this codebase already
 * carries, `action-catalog.ts`'s continuous `MOVEMENT_ACTIONS` (the only
 * commands that are ever typed in bare `+`/`-` press/release form to begin
 * with). Any bare token matching one of those — `+forward`/`-forward`,
 * `+attack`/`-attack`, etc., regardless of whether *this* row happens to be
 * catalogue-materialised — is a known engine command, not a candidate alias
 * reference, and is excluded before the "is it a defined alias" check ever
 * runs. This is deliberately narrow (it recognises only the handful of
 * commands `action-catalog.ts` already knows about) rather than broad (e.g.
 * "any bare token that isn't a defined alias is fine") — AC 8 still needs a
 * hand-typed call to a genuinely deleted alias, whose name matches no known
 * engine command, to be reported.
 *
 * A fourth narrowing (second review fix) excludes a different, independent
 * source of "known, not actually broken" bare tokens: this profile's *own*
 * hold-mode modifier layers generate their own `+`/`-` press/release alias
 * pair per layer (`alt-layers.ts`'s `generateLayerAliases`, e.g.
 * `+drops`/`-drops`) and binding to one via its raw command is completely
 * ordinary in-app configuration, not a broken alias reference. Computed from
 * the real generator's output (`knownLayerPressReleaseCommands`, below, reading
 * the shared index's layer rows) rather than re-deriving its name/slug rules
 * here.
 *
 * This still cannot catch a hand-typed, non-catalogue, non-hold-layer
 * press/release command this module's known-command lists do not happen to
 * include, nor a non-`+`/`-` alias call with an undefined target — both are
 * the accepted cost of having no full built-in-command catalogue to check
 * against, not this module's job to invent. Because that gap is real and this
 * module cannot tell "ordinary uncatalogued engine command" apart from
 * "genuinely broken alias reference" for anything outside the two exclusion
 * lists above, `undefinedAlias` is reported at `warning`, not `error` (second
 * review fix): flagging it at all still serves AC 8, but claiming certainty
 * ("this profile is broken") the available signal cannot support would not.
 *
 * "Never referenced" is checked the other way round and does not need this
 * caution at all: it is a *positive* match (does this alias's name show up
 * anywhere?), so it now comes from the shared `collectAliasReferences`
 * (`alias-references.ts`, story 038) rather than a copy of the scan kept
 * here — computed over every bare token in every action (catalogue or not,
 * signed or not) — and, since an alias has no key slot of its own and can
 * only be *called* from a hand-typed raw command, also over every bare token
 * in `profile.binds`'s values and every layer's `overrides` values (review
 * fix, Finding 3, now the shared collector's job too), further widened by a
 * `bind <key> <token>` segment's target token (story 038, for story 041's
 * `alias cali "bind KP_END drop_shotgun"` shape): a `bind r "+test"` typed
 * straight on the raw Binds tab is exactly as real a reference as one typed
 * into another entry's own commands, and ignoring it would warn about an
 * alias that is, in fact, wired up. A false negative here (missing a real
 * reference) is far worse than the false positive this rule risks, while a
 * false positive would just be an unreferenced-alias warning for an alias
 * that actually is called, which the sign/catalogue narrowing above would
 * only ever make *more* likely to miss, never less. This pass stays the
 * *lenient* one — `bareTokens`/`undefinedAlias` below keep their own,
 * stricter, unshared scan (the `catalogId` exclusion and sign requirement
 * have no equivalent in the shared collector, by design).
 *
 * Duplicate alias names reuse `aliasNameFor` (`alias-render.ts`), the exact
 * function the writer uses to decide an entry's rendered name — so a
 * collision this module reports is the same collision that would actually
 * land in the file, and the slugging/`MAX_ALIAS_NAME` rules stay that
 * module's business (S04 watch-out against re-deriving them here). Two
 * entries whose *typed* names differ but whose rendered names collide are a
 * duplicate too, and are compared case-insensitively (`Test`/`test`), because
 * `Cmd_Alias_f` matches alias names case-insensitively — the same rule
 * `validate-structure.ts`'s own `aliasDuplicate` check already applies to a
 * rendered file's `alias` lines.
 *
 * Story 039, D8 generalises `aliasDuplicate` from `kind: 'alias'`-only to
 * *every* action: every kind (`bind`, `alias`, `message`) is written under
 * `aliasNameFor`'s resolved name (`alias-render.ts`'s file doc comment — "every
 * action is written as one alias"), so a `bind` entry and a `message` entry can
 * collide on a name exactly as two `alias` entries can, now that D7 gives every
 * entry a short, readable, collision-prone derived name instead of an id-suffixed
 * one. Downgraded from `error` to `warning` at the same time (the story's
 * Decisions): the collision is symmetric and last-definition-wins, not a broken
 * reference, so every colliding entry gets its own finding naming the *other*
 * colliding entries (mirroring `undefinedAlias`'s two-entity param shape) rather
 * than the single `{ name }` this rule used to carry. No suffix is ever appended
 * and nothing is renamed — this rule only reports.
 *
 * A separate new rule, `aliasShadowsCommand`, fires per action whose own
 * resolved name is in `alias-names.ts`'s `reservedAliasNames()` — a name that
 * would otherwise render a dead, self-referential `alias weapnext weapnext`.
 * It is independent of `aliasDuplicate`: a name can be both a collision and a
 * shadow, and both findings fire for that entry — nothing here dedupes them.
 *
 * Story 039's fourth pass adds a third name-level rule, `aliasSelfReference`,
 * for the shape the User's decision moved out of the writer's drop guard: an
 * entry whose body has other, real commands *and* one segment that calls the
 * entry's own alias name. The writer keeps that line as authored (see
 * `alias-references.ts#isSelfMirroringAlias` for why dropping it would lose the
 * user's own content), so this rule is the only thing that tells the user the
 * loop is there. Independent of the two rules above in the same way — a name can
 * shadow a command *and* be called from its own body — and independent of
 * `validate-structure.ts`'s `aliasCycle`, which reports the same situation about
 * the rendered file rather than about the entry the user can edit.
 *
 * ## Story 041, D4 - an imported profile's reference shapes
 *
 * The three shapes an import produces - a raw bind pointing at an entry by bare
 * name (`bind KP_END "drop_shotgun"`), one entry's body calling another's
 * (`wait20`'s body calling `wait5`), and a `;`-list bind value calling two
 * (`bind w "shotgun;super_shotgun"`) - need nothing new on the *reference* side:
 * `collectAliasReferences` (story 038) already scans every action's raw command
 * text, every `binds` value and every layer override, splitting each on `;`, and
 * every caller of `validateActions` passes `binds`/`layers` through. Widening the
 * graph again for D4 would have been a second copy of it (story 038 AC3), so the
 * only change here is on the *definition* side: `definedKeys` used to be built
 * from `kind: 'alias'` entries alone, which made a bind calling an imported
 * `kind: 'message'` entry look like a call into nothing - see the comment at that
 * set for why `message` belongs in it and `bind` does not.
 *
 * ## Story 041, D4 fix - press/release pairing
 *
 * D4's Plan (the story's own requirements doc, step 4) named a second widening
 * this file shipped without: a `-x` release alias is never referenced by name
 * in any config text (the engine calls it itself on key-up whenever `+x` is
 * bound), so an imported `+slow`/`-slow` pair got a permanent, unfixable
 * `aliasUnreferenced` finding on the `-slow` half even though `+slow` was
 * correctly bound. The fix widens `referencedKeys` (not `collectAliasReferences`
 * itself - see the "referenced-by-anything" section below): when a plain
 * `kind: 'alias'` `+x`/`-x` pair's press half is referenced, its release half
 * is now treated as referenced too. One direction only, and only for a
 * genuinely matched pair - see the "referenced-by-anything" section below for
 * the pairing itself.
 *
 * Story 045, D10 folded the standalone `press-release.ts` pairing helper
 * (`pressReleasePairs`) into this widening directly: it was written for
 * exactly this purpose (D5's own doc comment named `ControlsTab.tsx` as its
 * *other*, UI-only caller, which story 045 gave a real `kind: 'press-release'`
 * entry and no longer needs name-pairing for), and this file's own copy of the
 * same `+`/`-` base-name match is the one remaining, still-necessary use -
 * a plain `kind: 'alias'` fallback pair (the shape D5-D7's recogniser declined
 * to promote to a first-class entry) still needs this to avoid a permanent
 * false `aliasUnreferenced` on its release half.
 *
 * ## Story 044, D1 - one name space, two surfaces
 *
 * None of the rules above change; where their answers come from does. The three
 * name-level rules (`aliasDuplicate`, `aliasUnreferenced`, `undefinedAlias`)
 * used to each assemble their own view of the profile - a resolved-name list, a
 * `collectAliasReferences` token set, a second `generateLayerAliases` pass - and
 * story 044 adds a fourth asker of exactly those questions, the Aliases tab. So
 * all of it now comes from one call to `alias-references.ts#buildAliasIndex`:
 * the resolved name and owner of every defined name, its complete referrer
 * list, and the layer aliases the launcher emits. The AC driving that ("this
 * surface and Care never disagree about what is referenced - one reference
 * graph, one function") is only true if neither side can compute it separately,
 * which is why this file no longer calls `collectAliasReferences` or
 * `generateLayerAliases` at all.
 *
 * Every finding is unchanged by the move, deliberately and to the byte - same
 * rules, same order, same params, same ids. An index row carries its referrers
 * with *no* exclusions (an entry's own recursive body and its own bind mirror
 * count, exactly as the flat token set counted them), so "this row has
 * referrers" is the same predicate as the old set membership; and the duplicate
 * rule still groups the entry rows here, since the index's duplicate partners
 * deliberately also span layer aliases - a collision the tab flags inline and no
 * Care finding has ever reported.
 */

import type { AltLayer } from './alt-layers'
import type { ConfigAction } from '../modules/config'
import type { EngineKind } from '../types/engine'
import { MOVEMENT_ACTIONS } from './action-catalog'
import { aliasNameFor } from './alias-render'
import { bindValueFor } from './action-mirror'
import { reservedAliasNames } from './alias-names'
import {
  buildAliasIndex,
  isSelfMirroringAlias,
  selfReferencingSegments,
  type AliasIndexRow,
} from './alias-references'
import type { Finding } from './validation'

/** Shared prefix of every message key this module emits, alongside D3/D4's own. */
export const ACTIONS_MESSAGE_PREFIX = 'config.validation.actions.'

/**
 * Every bare press/release command `action-catalog.ts`'s continuous
 * `MOVEMENT_ACTIONS` can ever render, both signs (`+forward`/`-forward`,
 * `+attack`/`-attack`, ...) - see the file doc comment's Finding 2 narrowing.
 * Built once at module load, not per call: the catalogue is a static
 * constant, not derived from any argument.
 */
const KNOWN_PRESS_RELEASE_COMMANDS = new Set<string>(
  MOVEMENT_ACTIONS.filter((movement) => movement.continuous).flatMap((movement) => {
    const base = movement.command.replace(/^[+-]/, '')
    return [`+${base}`, `-${base}`]
  }),
)

/**
 * Every `+<base>`/`-<base>` pair this profile's own modifier layers generate
 * (e.g. `+drops`/`-drops` for a hold layer named "drops") - a second,
 * independent source of "known, not actually broken" bare press/release tokens
 * alongside `KNOWN_PRESS_RELEASE_COMMANDS` above (review fix, Finding: false
 * positives on the app's own hold-layer aliases).
 *
 * Read off the shared name-space index (story 044, D1) rather than by calling
 * `generateLayerAliases` a second time here: that index already built its
 * `origin: 'layer'` rows with the real generator, so this stays the "never
 * re-derive a layer's slug/affix budget" rule it always was (S04 watch-out),
 * now with one call instead of two.
 *
 * Unfiltered by layer mode, where the old form looked at `mode: 'hold'` layers
 * only - with the same result by construction: a toggle layer's family is
 * `base`/`base_on`/`base_off` plus `_cN`/`_pN`, and `slugAliasName` strips every
 * character outside `[a-z0-9_]`, so no toggle layer can produce a name starting
 * with `+`/`-` for the sign test below to let through.
 */
function knownLayerPressReleaseCommands(index: AliasIndexRow[]): Set<string> {
  const commands = new Set<string>()
  for (const row of index) {
    if (row.origin !== 'layer') continue
    if (row.key.startsWith('+') || row.key.startsWith('-')) commands.add(row.key)
  }
  return commands
}

/**
 * Bare (argument-less) top-level segments of `text` - the only shape an alias
 * call, which takes no parameters, can ever take. Split on `;` like
 * `alt-layers.ts`'s own bodies (a user can type several commands into one raw
 * entry); a segment with any whitespace left after trimming has an argument
 * and is never a candidate.
 */
function bareSegments(text: string): string[] {
  return text
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && !/\s/.test(segment))
}

/** Every `kind: 'raw'` command's bare segments across `action.commands`, lower-cased. */
function bareTokens(action: ConfigAction): string[] {
  const tokens: string[] = []
  for (const command of action.commands) {
    if (command.kind !== 'raw') continue
    for (const segment of bareSegments(command.text)) tokens.push(segment.toLowerCase())
  }
  return tokens
}

/**
 * A catalogue-materialised bind can never be a broken alias reference by
 * construction (see the file doc comment) - only a free-form binding's own
 * commands are candidates at all.
 */
function isCandidateBinding(action: ConfigAction): boolean {
  return action.kind === 'bind' && !action.catalogId
}

/**
 * Story 045, D8 - Care on the *fallback* shapes.
 *
 * A first-class `kind: 'toggle'`/`'press-release'` entry cannot be cross-wired or
 * half-missing by construction (story 045's Decisions), so the three checks below
 * look at every *other* entry - the ones `entry-idioms.ts`'s recogniser (D5)
 * declined to merge into one of the two new kinds, whether because the shape was
 * broken to begin with or because the user hand-edited a previously-recognised
 * trio/pair back apart.
 *
 * **Every other entry, not just the `kind: 'alias'` ones** (story-045 review,
 * finding 2). What an entry's *kind* records is whether the file also binds it to
 * a key, not what its alias body is wired like: a broken toggle's dispatch alias
 * comes back as `kind: 'bind'` precisely because it carries the `bind v "zoom"`
 * the player actually uses, and a broken pair's `+` half likewise. Scanning only
 * `kind: 'alias'` therefore saw the orphan - an unbound, unreachable leftover -
 * and missed the realistic case the story's own Test Plan step 6 describes.
 * `bodySegmentsOf` reads the body off `commands`, which every one of these kinds
 * stores it in; the two `parts`-based kinds are the only ones excluded, and they
 * are excluded because they cannot be broken, not because they are bound.
 *
 * The sign checks additionally skip `KNOWN_PRESS_RELEASE_COMMANDS`: widening past
 * `kind: 'alias'` brings in the entries `adoptRawBinds`/`ownAliasNameFromBind`
 * name after their own bind command, so a hand-typed `bind MOUSE1 "+attack"`
 * arrives here as an entry called `+attack` - an engine command with no `-attack`
 * definition to find and nothing broken about it.
 *
 * `toggleCrossWired` is a narrower, standalone structural check rather than a
 * reuse of `entry-idioms.ts#recognizeEntryIdioms`: that module is deliberately
 * all-or-nothing and reports only what *did* match, never why a near-miss was
 * rejected (its own file doc comment). Reimplementing its "why" here as a second,
 * best-effort diagnostic would risk the two readings drifting apart on the shapes
 * that matter for that decision (an extra segment, a third state); this check
 * instead asks one narrower structural question - "do the states the file wires
 * onto this dispatch form a two-cycle" - directly off the resolved alias bodies,
 * using the same segment/token rules `bareSegments` above and
 * `entry-idioms.ts#bodySegments` already use (top-level `;`, no comment stripping
 * needed - `action.commands` text is schema-guaranteed comment-free, unlike a raw
 * `.cfg` line).
 *
 * That question is asked **symmetrically**, over every state at once (story-045
 * review round 2, finding 1). Asking it by walking from the dispatch through
 * state 1 to state 2 could only ever report a broken *state 2*: any shape where
 * state 1 itself is what is wrong - it rewrites the dispatch to itself (the
 * story's Test Plan step 6: "both toggle states reassign to `zoom_s1`"), or to a
 * state the file no longer defines, or a third state joins the family - ended the
 * walk early and produced no finding at all.
 */

/** Every top-level (`;`-separated) segment of every `kind: 'raw'` command of `action`, trimmed,
 * blanks dropped - the same split `bareSegments` performs, minus its argument-less filter, since a
 * toggle's dispatch rewrite segment (`alias zoom zoomout`) has arguments and must not be dropped. */
function bodySegmentsOf(action: ConfigAction): string[] {
  const segments: string[] = []
  for (const command of action.commands) {
    if (command.kind !== 'raw') continue
    for (const segment of command.text.split(';')) {
      const trimmed = segment.trim()
      if (trimmed.length > 0) segments.push(trimmed)
    }
  }
  return segments
}

/** The single bare name `segments` consists of, or `null` - `entry-idioms.ts#loneReference`,
 * restated over already-split segments. */
function loneReferenceOf(segments: string[]): string | null {
  if (segments.length !== 1) return null
  const tokens = segments[0]!.split(/\s+/).filter((token) => token.length > 0)
  return tokens.length === 1 ? tokens[0]! : null
}

/** One candidate for the three checks below: an entry whose alias body lives in `commands`, with
 * its resolved alias name and that body already split into segments. */
interface FallbackEntry {
  action: ConfigAction
  name: string
  segments: string[]
}

/**
 * The `alias <dispatch> <target>` rewrite `segments`' **last** entry is, or `null` when the body
 * does not end in one - `entry-idioms.ts#reassignmentTarget`, restated over already-split segments
 * and answering with *both* names rather than only the target.
 *
 * Both names, because the check below has to work from the states inwards as well as from the
 * dispatch outwards (story-045 review round 2, finding 1): a broken toggle is exactly the case where
 * walking from the dispatch through state 1 does not reach state 2, so "which entries rewrite this
 * dispatch" has to be answerable without already knowing which entry state 2 is.
 */
function trailingReassignmentOf(segments: string[]): { dispatch: string; target: string } | null {
  const last = segments[segments.length - 1]
  if (last === undefined) return null
  const tokens = last.split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length !== 3) return null
  if (tokens[0]!.toLowerCase() !== 'alias') return null
  if (tokens[1]!.length === 0 || tokens[2]!.length === 0) return null
  return { dispatch: tokens[1]!, target: tokens[2]! }
}

/**
 * Alias-wiring findings for `actions` - a binding calling an undefined alias,
 * an alias nobody calls, and a duplicate alias name. `engine` is carried on
 * every finding only to fit `Finding.engine` (same shape D3/D4 use); nothing
 * here reads engine facts or varies by engine - the caller runs this once per
 * assigned engine, same as `validateStructure`/`validateCvars` (D5's own
 * pattern), so the three checks appear once per engine section rather than as
 * a fourth kind of result the Validation panel would need to special-case.
 *
 * `references` (review fix, Finding 3) carries the profile's `binds` and
 * `layers`, both optional and defaulted to empty: a hand-typed `bind r "+test"`
 * on the raw Binds tab, or the same typed straight into a layer's `overrides`,
 * is exactly as real a reference to an alias as one typed into another
 * entry's own `commands` - see the file doc comment's "never referenced"
 * section. Only feeds the lenient "referenced by anything" pass; the stricter
 * undefined-alias check still only looks at `actions`, since a `catalogId`
 * exclusion has no equivalent concept on a base bind or layer override.
 */
export function validateActions(
  actions: ConfigAction[],
  engine: EngineKind,
  references: { binds?: Record<string, string>; layers?: AltLayer[] } = {},
): Finding[] {
  const findings: Finding[] = []
  let sequence = 0

  const add = (
    rule: string,
    level: Finding['level'],
    id: string,
    params: Record<string, string | number>,
  ): void => {
    findings.push({
      id: `${engine}:actions:${rule}:${sequence++}`,
      level,
      engine,
      messageKey: `${ACTIONS_MESSAGE_PREFIX}${rule}`,
      params,
      subject: { kind: 'action', id },
    })
  }

  // The profile's whole alias name space, built once (story 044, D1) - the same graph the Aliases
  // tab reads, so the two surfaces can never disagree about what is defined or what is referenced.
  // Every rule below draws its names, its owners and its references from here; nothing in this file
  // walks the profile for references any more.
  const index = buildAliasIndex({ actions, binds: references.binds, layers: references.layers })

  // The index's entry rows, paired back with the entry they came from: `buildAliasIndex` emits
  // exactly one row per `actions` element, in array order, before any layer row (its documented
  // contract, asserted in `alias-references.test.ts`). The pairing is needed because two of the
  // rules below ask questions about the *entry* (its kind, its bind mirror, its body) that a row
  // does not carry, while still taking the resolved name from the one place that derives it.
  const allResolvedNames = actions.map((action, position) => {
    const row = index[position]!
    return { action, name: row.name, row }
  })
  const aliasNames = allResolvedNames.filter((entry) => entry.action.kind === 'alias')

  // --- duplicate alias names (generalised, D8: every action renders as an alias
  // under `aliasNameFor`, so the collision check runs over every action, not just
  // `kind: 'alias'` ones — see the file doc comment) --------------------------
  //
  // Grouped here rather than read off `row.duplicateOf`, for two reasons that both come down to
  // this rule being about *entries*: the index's duplicate partners also include `origin: 'layer'`
  // rows (an entry colliding with a generated layer alias is a real collision the Aliases tab
  // flags, but reporting it here would be a new Care finding this deliverable does not introduce),
  // and the findings are emitted group by group, in first-appearance order of the name, which is
  // the order this rule has always produced them in.
  //
  // Story-045 review, finding 3: the candidate rows are every row the index owns *for an entry*, not
  // only the one primary row per action. A two-part entry defines more names than it is called by -
  // a toggle's `<name>_s1`/`<name>_s2` states, a press/release entry's `-<base>` half - and the file
  // holds one definition per name, so a user alias colliding with one of those loses its body on the
  // next save exactly as a primary-name collision would. `buildAliasIndex` already emits those rows
  // (its "## Order" section) and the Aliases tab already flags them through `duplicateOf`; Care was
  // the one surface still blind to them. Layer rows stay excluded, for the reason above.
  const actionById = new Map(actions.map((action) => [action.id, action]))
  const entryRows = index.flatMap((row) => {
    const action = row.ownerActionId === undefined ? undefined : actionById.get(row.ownerActionId)
    return action ? [{ action, name: row.name, row }] : []
  })

  const byKey = new Map<string, typeof entryRows>()
  for (const entry of entryRows) {
    const key = entry.row.key
    const group = byKey.get(key) ?? []
    group.push(entry)
    byKey.set(key, group)
  }
  // One finding per colliding *entry*, not per colliding name: two press/release entries sharing a
  // base collide on both `+base` and `-base`, which is one problem the user fixes once.
  const reportedDuplicates = new Set<string>()
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    for (const entry of group) {
      const partners = group.filter((candidate) => candidate !== entry)
      const signature = [entry.action.id, ...partners.map((p) => p.action.id).sort()].join('|')
      if (reportedDuplicates.has(signature)) continue
      reportedDuplicates.add(signature)
      add('aliasDuplicate', 'warning', entry.action.name, {
        name: entry.name,
        entry: entry.action.name,
        other: partners.map((candidate) => candidate.action.name).join(', '),
      })
    }
  }

  // --- a derived name shadows a known engine command/cvar (D8) ----------------
  // Independent of the duplicate check just above: fires on an entry's own
  // resolved name alone, never suppressed by a collision also firing for it.
  //
  // Review fix: a *continuous* catalogue mirror (a movement/weapon row bound
  // straight to its own `+`/`-` command, e.g. `+forward`) is excluded, but not
  // every catalogue-materialised bind - unlike `isCandidateBinding`'s blanket
  // exclusion above, which is about a different question ("can this action's
  // own command be a broken reference", never true for a catalogue row) than
  // this one ("does this action's own alias line, if the writer emits one,
  // collide with a reserved name"). A continuous row's own sign-stripped
  // command is deliberately part of `reservedAliasNames()` too (see
  // `alias-names.ts`), so *every* adopted movement/weapon catalogue bind would
  // otherwise derive a "shadowing" name by construction - but `bindValueFor`
  // mirrors such a row straight into its bind value and the writer's own
  // `actionsWithAliasLine` (story 038) never emits an alias line for it at
  // all (`bindValueFor(action) !== aliasNameFor(action)`), so warning about it
  // would be pure noise for a line that is never written.
  //
  // A *discrete* catalogue row (no `+`/`-`, e.g. `weapnext`) is the opposite:
  // `bindValueFor` has no continuous fast path for it and falls through to
  // `aliasNameFor` itself, so `bindValueFor(action) === aliasNameFor(action)`
  // holds and this rule fires - exactly the case the story's own Decisions
  // section names. The old blanket exclusion silenced the one warning this
  // rule exists for.
  //
  // Second review fix (story 039): the writer no longer emits that entry's
  // `alias weapnext weapnext` line at all - `actionsWithAliasLine`'s
  // self-reference guard drops it - but the warning stays, and is if anything
  // more accurate for it: the point is that the name the user picked cannot
  // work as an alias name (the engine's command of that name always wins), not
  // that a dead line was written. The bind still runs the right command,
  // which is why this is a `warning` and not an `error`.
  const reserved = reservedAliasNames()
  for (const entry of allResolvedNames) {
    if (bindValueFor(entry.action) !== entry.name) continue
    if (!reserved.has(entry.name.toLowerCase())) continue
    add('aliasShadowsCommand', 'warning', entry.action.name, {
      entry: entry.action.name,
      name: entry.name,
    })
  }

  // --- an entry's own alias body calls its own alias name (fourth pass) -------
  // The User's decision (story 039, Decisions (Sprint)) for the multi-command
  // self-reference case: the writer keeps `alias weapnext "weapnext; centerview"`
  // as authored - dropping it would silently lose `centerview` - and Care names
  // the entry and the self-referencing command so the user can decide (remove the
  // command, rename the entry, accept the loop). This finding therefore appears
  // *alongside* the error-level `aliasCycle` `validate-structure.ts` reports for
  // the kept line, and never replaces it: calling yourself in a chain really is a
  // cycle in-engine, and that finding describes the rendered file while this one
  // describes the entry the user can actually edit.
  //
  // Skipped for the one shape the writer still drops outright
  // (`isSelfMirroringAlias`: the whole body is nothing but the alias name), where
  // nothing is lost, there is nothing to decide, and `aliasShadowsCommand` above
  // already reports the unusable name. The rule the segments come from is
  // `alias-references.ts`'s, i.e. the writer's own - never a second scan here.
  for (const entry of allResolvedNames) {
    if (isSelfMirroringAlias(entry.action)) continue
    const segments = selfReferencingSegments(entry.action)
    if (segments.length === 0) continue
    add('aliasSelfReference', 'warning', entry.action.name, {
      entry: entry.action.name,
      name: entry.name,
      command: [...new Set(segments)].join(', '),
    })
  }

  // Every name this profile really defines as a callable alias (story 041, D4).
  //
  // Not `aliasNames` (the `kind: 'alias'` subset) any more: an imported
  // `alias +teamsay "say_team go go go"` becomes a `kind: 'message'` entry
  // (`alias-import.ts#entryKindFor` - exactly one message command and nothing
  // else), and `actionsWithAliasLine` emits its alias line unconditionally, the
  // same as for a `kind: 'alias'` entry (its `bindValueFor` equals its own alias
  // name, so the writer's second drop guard keeps it). A hand-typed bind calling
  // `+teamsay` is therefore calling a name that exists, and reporting it as an
  // undefined alias would be a false positive on ninety imported chat entries.
  //
  // `kind: 'bind'` entries are deliberately *not* here even though they too
  // render under `aliasNameFor`: theirs is the one kind whose alias line the
  // writer may legitimately not emit (a continuous catalogue mirror's
  // `bindValueFor !== aliasNameFor`, `isSelfMirroringAlias`), so their resolved
  // name is not reliably a callable alias - and a bind entry is reached by its
  // own key, not by being called by name, which is why nothing needs it to be.
  //
  // Derived from `allResolvedNames` rather than a second `aliasNameFor` pass, so
  // there stays exactly one place an entry's rendered name comes from.
  const definedKeys = new Set(
    allResolvedNames
      .filter((entry) => entry.action.kind === 'alias' || entry.action.kind === 'message')
      .map((entry) => entry.name.toLowerCase()),
  )

  // --- referenced-by-anything (lenient: shared reference graph, story 038; read
  // off the shared index since story 044, D1) -------------------------------
  //
  // A row's `referrers` is built with no exclusions at all - an entry's own recursive body and its
  // own bind mirror count, exactly as `collectAliasReferences` (which this used to call) always
  // counted them - so `row.referrers.length > 0` is precisely the old
  // `allReferences.has(key)`, with the referring bind/override/entry now named as well.
  const referencedKeys = new Set<string>()
  for (const entry of allResolvedNames) {
    if (!definedKeys.has(entry.row.key)) continue
    if (entry.row.referrers.length > 0) referencedKeys.add(entry.row.key)
  }

  // --- press/release pairing widens "referenced" one more step (story 041, D4
  // fix; the story's own Plan named this and D4 shipped without it) --------
  //
  // A `-x` release alias is never called by name anywhere in the config text -
  // no bind, no alias body, no `;`-list ever literally says `-slow`. The
  // engine invokes it itself, on key-up, whenever the matching `+x` press half
  // is bound (`bind SHIFT +slow`). `collectAliasReferences` has no way to know
  // that, by design (it only ever scans text for a name), so a real,
  // legitimately-wired `-x` half would otherwise fail `aliasUnreferenced`
  // forever - not a false positive that clears once the user "fixes" anything,
  // since there is nothing to fix.
  //
  // One direction only: a referenced press half implies its release half is
  // reachable too (the engine's key-up call), but a referenced release half
  // says nothing about the press half (nothing in the engine calls `+x`
  // because `-x` happens to be referenced). An unmatched pair (only one half
  // wired) is left exactly as strict as before - only a *found* pair's press
  // half being referenced adds its release half here. Pairing mirrors the
  // retired `press-release.ts#pressReleasePairs`: first `-x` seen per base is
  // that base's release half, first `+x` seen per base is matched against it.
  //
  // "Is the press half referenced" is the index's answer too: both halves are entries, so each has
  // a row, and a row's `referrers` covers the same sources the flat token set did.
  const rowByKey = new Map<string, AliasIndexRow>()
  for (const row of index) if (!rowByKey.has(row.key)) rowByKey.set(row.key, row)
  const releaseHalfByBase = new Map<string, ConfigAction>()
  for (const candidate of actions) {
    if (!candidate.name.startsWith('-') || candidate.name.length <= 1) continue
    const base = candidate.name.slice(1)
    if (!releaseHalfByBase.has(base)) releaseHalfByBase.set(base, candidate)
  }
  const seenPressBases = new Set<string>()
  for (const candidate of actions) {
    if (!candidate.name.startsWith('+') || candidate.name.length <= 1) continue
    const base = candidate.name.slice(1)
    if (seenPressBases.has(base)) continue
    seenPressBases.add(base)
    const release = releaseHalfByBase.get(base)
    if (!release) continue
    const pressKey = aliasNameFor(candidate).toLowerCase()
    if (!rowByKey.get(pressKey)?.referrers.length) continue
    referencedKeys.add(aliasNameFor(release).toLowerCase())
  }

  // --- undefined alias reference (strict: candidate bindings, signed, not a known engine command) --
  //
  // Severity: `warning`, not `error` (review fix, second respin). Excluding
  // `KNOWN_PRESS_RELEASE_COMMANDS` and this profile's own hold-layer aliases
  // (`knownHoldLayerCommands`, just above) still leaves a real gap - any other
  // built-in engine `+`/`-` command this codebase has no catalogue of at all
  // (there is no full engine-command list anywhere in this repo to check a
  // bare token against, see the file doc comment). A hand-typed, genuinely
  // undefined alias reference and an ordinary, uncatalogued engine command are
  // indistinguishable from here, so this can never be an `error`-level "this
  // profile is broken" claim without an authoritative command list to confirm
  // it against. Reporting it as a `warning` keeps AC 8's "undefined alias
  // reference gets flagged" intact without asserting more certainty than the
  // available signal supports.
  const knownLayerCommands = knownLayerPressReleaseCommands(index)
  for (const action of actions) {
    if (!isCandidateBinding(action)) continue
    for (const token of bareTokens(action)) {
      if (!token.startsWith('+') && !token.startsWith('-')) continue
      if (KNOWN_PRESS_RELEASE_COMMANDS.has(token)) continue
      if (knownLayerCommands.has(token)) continue
      if (definedKeys.has(token)) continue
      add('undefinedAlias', 'warning', action.name, { action: action.name, alias: token })
    }
  }

  // --- alias never referenced -------------------------------------------------
  for (const entry of aliasNames) {
    if (referencedKeys.has(entry.name.toLowerCase())) continue
    add('aliasUnreferenced', 'warning', entry.action.name, { name: entry.name })
  }

  // --- story 045, D8: broken toggle/press-release shapes on the fallback entries -----------------
  // See the block comment above `bodySegmentsOf` for why these checks exist, why `toggleCrossWired`
  // is a standalone structural check rather than a reuse of `entry-idioms.ts#recognizeEntryIdioms`,
  // and why the candidate set is every entry whose body lives in `commands` rather than the
  // `kind: 'alias'` subset (story-045 review, finding 2: a *bound* dispatch or `+` half restores as
  // `kind: 'bind'`, which is the normal case, and was invisible here).
  const fallbackEntries = new Map<string, FallbackEntry>()
  for (const entry of allResolvedNames) {
    if (entry.action.kind === 'toggle' || entry.action.kind === 'press-release') continue
    fallbackEntries.set(entry.name.toLowerCase(), {
      action: entry.action,
      name: entry.name,
      segments: bodySegmentsOf(entry.action),
    })
  }

  // Every state the file wires onto a dispatch name, found from the *state* side: an entry whose
  // body ends in `alias <dispatch> <target>` is a toggle state of `<dispatch>`, whatever it hands
  // over to. Indexed once, by dispatch name, so the check below can ask "which states does this
  // dispatch have" instead of walking from one state to the next (story-045 review round 2,
  // finding 1: walking is what made a broken state 1 invisible - the walk stopped there).
  const statesByDispatch = new Map<string, { entry: FallbackEntry; target: string }[]>()
  for (const entry of fallbackEntries.values()) {
    const rewrite = trailingReassignmentOf(entry.segments)
    if (rewrite === null) continue
    const key = rewrite.dispatch.toLowerCase()
    const list = statesByDispatch.get(key) ?? []
    list.push({ entry, target: rewrite.target })
    statesByDispatch.set(key, list)
  }

  // toggleCrossWired: `dispatch`'s body is a lone reference to `first`, and `first` rewrites
  // `dispatch` - so far exactly a healthy toggle's opening move - but the two states the file wires
  // onto `dispatch` are not a **two-cycle**: a healthy toggle has exactly two of them, each
  // rewriting the dispatch to the other, with three distinct names. Anything else is reported, and
  // that is the symmetric question this used to get wrong: it navigated *through* state 1 to find
  // state 2, so state 1 rewriting to itself (the story's Test Plan step 6 verbatim - "both toggle
  // states reassign to `zoom_s1`"), a state 2 the file no longer defines, and a third state all
  // walked off the end of the check and reported nothing at all.
  //
  // One finding per trio, not per participating alias - mirrors `aliasSelfReference`/
  // `aliasDuplicate`'s "one finding per group" convention.
  const reportedToggleTrios = new Set<string>()
  for (const dispatch of fallbackEntries.values()) {
    const firstName = loneReferenceOf(dispatch.segments)
    if (firstName === null) continue
    const first = fallbackEntries.get(firstName.toLowerCase())
    if (!first || first === dispatch) continue

    const states = statesByDispatch.get(dispatch.name.toLowerCase()) ?? []
    const firstState = states.find((state) => state.entry === first)
    // `first` rewrites nothing of `dispatch`'s: an ordinary alias calling another alias, no toggle
    // shape claimed and nothing for this check to say. The one branch that still declines to look.
    if (firstState === undefined) continue

    // The other state: the one state 1 hands over to, when that is a state of this dispatch at all;
    // otherwise any other state the file wires onto it. Its *name* is what the finding reports, and
    // with no other state defined at all that is the name state 1 points at - the state 2 the file
    // is missing.
    const pointedAt = states.find(
      (state) =>
        state.entry !== first && state.entry.name.toLowerCase() === firstState.target.toLowerCase(),
    )
    const other = pointedAt ?? states.find((state) => state.entry !== first)
    const secondName = other?.entry.name ?? firstState.target

    const namesDistinct =
      new Set([dispatch.name, first.name, secondName].map((n) => n.toLowerCase())).size === 3
    const closesCleanly =
      states.length === 2 &&
      other !== undefined &&
      other === pointedAt &&
      other.target.toLowerCase() === first.name.toLowerCase() &&
      namesDistinct
    if (closesCleanly) continue

    const groupKey = [dispatch.name, first.name, secondName]
      .map((n) => n.toLowerCase())
      .sort()
      .join('|')
    if (reportedToggleTrios.has(groupKey)) continue
    reportedToggleTrios.add(groupKey)

    add('toggleCrossWired', 'warning', dispatch.action.name, {
      dispatch: dispatch.name,
      first: first.name,
      second: secondName,
    })
  }

  // pressWithoutRelease / releaseWithoutPress: a signed entry with no matching opposite-sign entry
  // among the profile's own fallback entries, case-insensitively - not the names a first-class
  // press/release entry generates (those are a pair by construction and never a candidate).
  // `KNOWN_PRESS_RELEASE_COMMANDS` is skipped: an entry named after the engine command its own bind
  // line runs (`+attack`) has no missing half - see the block comment above `bodySegmentsOf`.
  for (const entry of fallbackEntries.values()) {
    const lower = entry.name.toLowerCase()
    if (KNOWN_PRESS_RELEASE_COMMANDS.has(lower)) continue
    if (entry.name.startsWith('+')) {
      const base = entry.name.slice(1)
      if (base.length === 0) continue
      if (fallbackEntries.has(`-${base}`.toLowerCase())) continue
      add('pressWithoutRelease', 'warning', entry.action.name, { entry: entry.action.name, name: entry.name })
    } else if (entry.name.startsWith('-')) {
      const base = entry.name.slice(1)
      if (base.length === 0) continue
      if (fallbackEntries.has(`+${base}`.toLowerCase())) continue
      add('releaseWithoutPress', 'warning', entry.action.name, { entry: entry.action.name, name: entry.name })
    }
  }

  return findings
}
