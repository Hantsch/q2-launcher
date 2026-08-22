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
 * ordinary in-app configuration, not a broken alias reference. Computed by
 * calling the real generator (`knownHoldLayerCommands`, below) rather than
 * re-deriving its name/slug rules here.
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
 * itself - see the "referenced-by-anything" section below) using
 * `pressReleasePairs` (D5, `press-release.ts`, already on disk and reused
 * verbatim): when a matched pair's press half is referenced, its release half
 * is now treated as referenced too. One direction only, and only for halves
 * `pressReleasePairs` actually pairs - see that section for why.
 */

import type { AltLayer } from './alt-layers'
import type { ConfigAction } from '../modules/config'
import type { EngineKind } from '../types/engine'
import { MOVEMENT_ACTIONS } from './action-catalog'
import { generateLayerAliases } from './alt-layers'
import { aliasNameFor } from './alias-render'
import { bindValueFor } from './action-mirror'
import { reservedAliasNames } from './alias-names'
import { collectAliasReferences, isSelfMirroringAlias, selfReferencingSegments } from './alias-references'
import { pressReleasePairs } from './press-release'
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
 * Every `+<base>`/`-<base>` pair this profile's own hold-mode modifier layers
 * generate (`alt-layers.ts`'s `generateLayerAliases`, e.g. `+drops`/`-drops`
 * for a layer named "drops") - a second, independent source of "known, not
 * actually broken" bare press/release tokens alongside
 * `KNOWN_PRESS_RELEASE_COMMANDS` above (review fix, Finding: false positives
 * on the app's own hold-layer aliases).
 *
 * Computed by calling the real generator, never by re-deriving the slug/name
 * budget rules here (S04 watch-out): a hold layer's alias name depends on its
 * own reserve arithmetic (helper/chunk affixes), which only `alt-layers.ts`
 * itself should ever compute. `references.binds` is passed through unchanged
 * as the base-bind map that generator expects; this call only reads its
 * result's alias names; it never touches disk or renders anything.
 */
function knownHoldLayerCommands(layers: AltLayer[], binds: Record<string, string>): Set<string> {
  const commands = new Set<string>()
  for (const layer of layers) {
    if (layer.mode !== 'hold') continue
    const { aliases } = generateLayerAliases(layer, binds)
    for (const alias of aliases) {
      if (alias.name.startsWith('+') || alias.name.startsWith('-')) commands.add(alias.name)
    }
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

  const aliasActions = actions.filter((action) => action.kind === 'alias')
  const aliasNames = aliasActions.map((action) => ({ action, name: aliasNameFor(action) }))

  // --- duplicate alias names (generalised, D8: every action renders as an alias
  // under `aliasNameFor`, so the collision check runs over every action, not just
  // `kind: 'alias'` ones — see the file doc comment) --------------------------
  const allResolvedNames = actions.map((action) => ({ action, name: aliasNameFor(action) }))
  const byKey = new Map<string, { action: ConfigAction; name: string }[]>()
  for (const entry of allResolvedNames) {
    const key = entry.name.toLowerCase()
    const group = byKey.get(key) ?? []
    group.push(entry)
    byKey.set(key, group)
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    for (const entry of group) {
      const other = group
        .filter((candidate) => candidate !== entry)
        .map((candidate) => candidate.action.name)
        .join(', ')
      add('aliasDuplicate', 'warning', entry.action.name, {
        name: entry.name,
        entry: entry.action.name,
        other,
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

  // --- referenced-by-anything (lenient: shared reference graph, story 038) --
  const allReferences = collectAliasReferences({
    actions,
    binds: references.binds,
    layers: references.layers,
  })
  const referencedKeys = new Set<string>()
  for (const key of definedKeys) {
    if (allReferences.has(key)) referencedKeys.add(key)
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
  // `pressReleasePairs` (D5, `press-release.ts`) is the one place that already
  // knows the `+x`/`-x` convention for pairing purposes, so it is reused here
  // rather than re-deriving the sign/base-name rule. One direction only: a
  // referenced press half implies its release half is reachable too (the
  // engine's key-up call), but a referenced release half says nothing about
  // the press half (nothing in the engine calls `+x` because `-x` happens to
  // be referenced). An unmatched pair (only one half wired) is left exactly as
  // strict as before - only a *found* pair's press half being referenced adds
  // its release half here.
  for (const pair of pressReleasePairs(actions).pairs) {
    const pressKey = aliasNameFor(pair.press).toLowerCase()
    if (!allReferences.has(pressKey)) continue
    referencedKeys.add(aliasNameFor(pair.release).toLowerCase())
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
  const knownLayerCommands = knownHoldLayerCommands(references.layers ?? [], references.binds ?? {})
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

  return findings
}
