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
 * function the writer uses to decide an alias entry's rendered name — so a
 * collision this module reports is the same collision that would actually
 * land in the file, and the slugging/`MAX_ALIAS_NAME` rules stay that
 * module's business (S04 watch-out against re-deriving them here). Two
 * entries whose *typed* names differ but whose rendered names collide are a
 * duplicate too, and are compared case-insensitively (`Test`/`test`), because
 * `Cmd_Alias_f` matches alias names case-insensitively — the same rule
 * `validate-structure.ts`'s own `aliasDuplicate` check already applies to a
 * rendered file's `alias` lines.
 */

import type { AltLayer } from './alt-layers'
import type { ConfigAction } from '../modules/config'
import type { EngineKind } from '../types/engine'
import { MOVEMENT_ACTIONS } from './action-catalog'
import { generateLayerAliases } from './alt-layers'
import { aliasNameFor } from './alias-render'
import { collectAliasReferences } from './alias-references'
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

  // --- duplicate alias names -------------------------------------------------
  const byKey = new Map<string, { action: ConfigAction; name: string }[]>()
  for (const entry of aliasNames) {
    const key = entry.name.toLowerCase()
    const group = byKey.get(key) ?? []
    group.push(entry)
    byKey.set(key, group)
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    for (const entry of group) {
      add('aliasDuplicate', 'error', entry.action.name, { name: entry.name })
    }
  }

  const definedKeys = new Set(aliasNames.map((entry) => entry.name.toLowerCase()))

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
