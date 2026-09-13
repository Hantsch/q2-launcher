/**
 * The alias reference graph — one function that answers "does anything in
 * this profile call this alias by name" (story 038).
 *
 * Before this module the question had exactly one asker,
 * `validate-actions.ts`'s lenient "referenced by anything" pass, computed
 * inline there. Story 038 needs the same answer from a second, unrelated
 * asker — the writer, deciding whether an action's alias line has any reason
 * to exist at all — so the scan is extracted here verbatim (same shapes, same
 * lower-casing) rather than duplicated. `collectAliasReferences` is exactly
 * that extraction, widened by exactly one shape (see below); `bareTokens`'/
 * `undefinedAlias`'s own, *stricter* scan in `validate-actions.ts` is
 * untouched — that one has a `catalogId` exclusion and a sign requirement
 * neither asker here needs, and is still that module's own business.
 *
 * Story 044, D1 adds the third asker and folds all three onto one traversal:
 * `buildAliasIndex` answers "which names does this profile define, who owns
 * each and what calls it" for the Aliases tab, and `validate-actions.ts`'s
 * duplicate/unreferenced/undefined checks now read that same index instead of
 * walking the profile again. Everything public here — `collectAliasReferences`,
 * `findAliasReferrers(ByName)`, `buildAliasIndex` — is a different view of the
 * one `buildReferrerIndex` pass, so Care and the tab cannot drift apart.
 *
 * Pure by contract, like `action-mirror.ts`: no `fs`, no DOM, no electron.
 *
 * ## What counts as a reference
 *
 * An alias takes no arguments, so the only shape that can ever *call* one is
 * a bare (argument-less) top-level segment of a raw command — same rule
 * `validate-actions.ts`'s own file doc comment explains at length. Candidates
 * come from three places, all lower-cased into one set. Each value is run
 * through `alt-layers.ts`'s `sanitizeCommand` before it is scanned — the same
 * transform `render.ts`/`alt-layers.ts` apply before a `binds`/`overrides`
 * value is actually written to the `.cfg` file — so a value that reaches the
 * scan quote-wrapped (schema-legal for `binds`/`overrides`, though the UI's
 * own save path already strips quotes before it gets that far) is recognised
 * exactly the way the real render treats it, rather than being compared,
 * quotes and all, against an alias name that never carries any:
 *
 * - every `kind: 'raw'` command of every action in `sources.actions` (not
 *   only "candidate bindings" — an alias's own recursive body, a message
 *   entry's text, anything), including both halves of a two-part entry's
 *   `parts` (story 045). Action command text is already
 *   schema-guaranteed quote-free (`actionTextSchema`), so sanitizing it here
 *   is a no-op kept only for uniformity with the other two sources;
 * - every value of `sources.binds` (a hand-typed `bind r "+test"` on the raw
 *   Binds tab is exactly as real a reference as one typed into an action);
 * - every value of every layer's `overrides` in `sources.layers`.
 *
 * Widened by exactly one further shape (the one addition over the pass this
 * extracts): the **target token** of a `bind <key> <token>` segment. Story
 * 041 imports precisely that construct (`alias cali "bind KP_END
 * drop_shotgun"`) — a plain bare-token scan would miss `drop_shotgun`
 * entirely because the segment as a whole has whitespace and is therefore
 * never a *candidate* under the bare-segment rule above. Only the widening
 * changes; a target token that itself carries arguments (more than one
 * further token after the key) is not a shape this module recognises and is
 * left alone, same as any other segment with whitespace left in it.
 *
 * Missing a real reference here means the writer silently drops an alias line
 * something still calls — a live key going dead. The widening can therefore
 * only ever add candidates, never remove one the un-widened scan already
 * found; on the validation side it can only make `aliasUnreferenced` quieter,
 * never noisier.
 *
 * No self-exclusion: an action whose own command text happens to contain its
 * own alias name (a recursive body) counts as referenced by that text, same
 * as any other occurrence. That is the user's business, and treating it as a
 * reference is the safe side (keeping a line beats dropping a live one).
 */

import type { ConfigAction, ConfigCommand } from '../modules/config'
import { actionKeySlots } from './action-slots'
import { generateLayerAliases, sanitizeCommand, type AltLayer } from './alt-layers'
import { aliasNameFor, commandLineFor, twoPartAliasNames } from './alias-render'
import { bindValueFor } from './action-mirror'
import { normalizeBindKey } from './key-names'

/**
 * Everything `collectAliasReferences`/`actionsWithAliasLine` read a profile's
 * reference candidates from. `binds`/`layers` default to "none" at the call
 * site (both optional here) since not every caller has both in scope — same
 * shape `validate-actions.ts`'s own `references` parameter already uses.
 */
export interface AliasReferenceSources {
  actions: ConfigAction[]
  binds?: Record<string, string>
  layers?: AltLayer[]
}

/**
 * The target token of a `bind <key> <token>` segment, lower-cased, or
 * `undefined` when `segment` is not exactly that three-word shape. `token`
 * itself must be a single further word - a target carrying its own arguments
 * is not a shape this widening recognises (see the file doc comment).
 */
function bindTargetToken(segment: string): string | undefined {
  const match = /^bind\s+(\S+)\s+(\S+)$/i.exec(segment.trim())
  if (!match) return undefined
  return match[2]!.toLowerCase()
}

/**
 * Every candidate reference token in one already-sanitized command string,
 * lower-cased. Callers pass `text` through `sanitizeCommand` first (see the
 * file doc comment) so a quote-wrapped value scans the same way the real
 * render treats it.
 */
function collectFromText(text: string, tokens: Set<string>): void {
  for (const segment of text.split(';').map((part) => part.trim())) {
    if (segment.length === 0) continue
    if (!/\s/.test(segment)) {
      tokens.add(segment.toLowerCase())
      continue
    }
    const target = bindTargetToken(segment)
    if (target) tokens.add(target)
  }
}

/**
 * The `sources.binds` key(s) `action`'s own base-layer mirror
 * (`action-mirror.ts#applyActionBindMirror`) writes for it: every one of its key
 * slots (`action.keys`, story 050) that carries no modifier (a modified slot
 * mirrors into a layer override instead, see `ownMirrorLayerKeys` below). Not conditioned on the slot's current value matching
 * `aliasNameFor(action)` - by the profile's own invariant a key this action
 * holds unmodified can only ever carry that mirror's value, so membership by
 * key alone is exact, same reasoning `action-mirror.ts#isMirroredValue`'s
 * key-scoped form already relies on.
 */
function ownMirrorBindKeys(action: ConfigAction): Set<string> {
  const keys = new Set<string>()
  for (const slot of actionKeySlots(action)) {
    if (slot.key && !slot.modifier) keys.add(normalizeBindKey(slot.key))
  }
  return keys
}

/**
 * The `layer.overrides` key(s) `action`'s own layer mirror
 * (`modifier-layers.ts#applyActionLayerMirror`) writes into *this* layer:
 * one of its two slots, when that slot carries a modifier whose normalized
 * trigger matches `layer.triggerKey` - the exact "found by normalized
 * triggerKey, never by name" rule that mirror pass itself uses to pick which
 * layer a modified slot belongs to.
 */
function ownMirrorLayerKeys(action: ConfigAction, layer: AltLayer): Set<string> {
  const keys = new Set<string>()
  const layerTrigger = normalizeBindKey(layer.triggerKey ?? '')
  for (const slot of actionKeySlots(action)) {
    if (slot.key && slot.modifier && slot.modifier === layerTrigger) keys.add(normalizeBindKey(slot.key))
  }
  return keys
}

/**
 * Every `ConfigCommand` of `action` a body is rendered from: its own `commands`, plus both halves
 * of a two-part entry (`parts`, story 045).
 *
 * Both, unconditionally, rather than one or the other by kind - the scan below only ever *adds*
 * reference candidates, and this module's own rule is that missing a real reference means the
 * writer drops an alias line something still calls (see the file doc comment). A toggle state that
 * calls `zoom_fov` is exactly as real a reference as a bind entry's command is, and before story
 * 045 those halves lived nowhere this pass could see them.
 */
function allActionCommands(action: ConfigAction): ConfigCommand[] {
  const parts = action.parts ?? []
  return parts.length === 0
    ? action.commands
    : [...action.commands, ...parts.flatMap((part) => part.commands)]
}

/** One thing that currently calls an alias name - what `findAliasReferrers` reports one of, what the
 * D9 rename-refusal dialog names in its message, and what fills an index row's `referrers` (story
 * 044, D1). */
export type AliasReferrer =
  | { kind: 'action'; name: string }
  | { kind: 'bind'; key: string }
  | { kind: 'override'; key: string; layerName: string }

/**
 * The two exclusions a caller asking "who calls this *other than the entry itself*" needs (story
 * 039, D9), shared by every public function below. Both default to "exclude nothing", so the graph
 * a caller gets without options is the complete one - the safe side, per the file doc comment.
 */
export interface AliasReferenceOptions {
  /**
   * Exclude exactly the two `binds`/layer-override slots this action's own mirror pass writes for
   * it (`ownMirrorBindKeys`/`ownMirrorLayerKeys` above) from the `sources.binds`/`sources.layers`
   * scan - never its command text, which `excludeActionId` below is for.
   */
  ignoreOwnMirrorOf?: ConfigAction
  /**
   * Exclude this action's own `commands` from the `sources.actions` scan, matched by `id`. Without
   * it a recursive body counts as a reference to itself, per the file doc comment's "No
   * self-exclusion" rule.
   */
  excludeActionId?: string
}

/**
 * The whole reference graph in **one** pass: lower-cased token -> every place in `sources` that
 * calls it, in source order (every action in array order, then `binds`, then each layer's
 * `overrides`).
 *
 * Story 044, D1 makes this the single traversal every public function in this module answers from -
 * `collectAliasReferences` (its key set), `findAliasReferrers`/`findAliasReferrersByName` (one
 * bucket) and `buildAliasIndex` (one bucket per defined name). One graph, one scan: a reference
 * source added here reaches Care's tidy-up warnings and the Aliases tab in the same edit, which is
 * exactly what that story's "this surface and Care never disagree about what is referenced" AC
 * asks for. Before it, the same three source shapes were walked by two near-identical loops here.
 *
 * An action contributes at most **one** referrer per token however many of its commands mention it
 * - the `.some()` semantics `findAliasReferrers` has always had, restated as a per-action token set.
 */
function buildReferrerIndex(
  sources: AliasReferenceSources,
  options: AliasReferenceOptions,
): Map<string, AliasReferrer[]> {
  const byToken = new Map<string, AliasReferrer[]>()
  const record = (token: string, referrer: AliasReferrer): void => {
    const bucket = byToken.get(token)
    if (bucket) bucket.push(referrer)
    else byToken.set(token, [referrer])
  }

  for (const action of sources.actions) {
    if (options.excludeActionId !== undefined && action.id === options.excludeActionId) continue
    const tokens = new Set<string>()
    for (const command of allActionCommands(action)) {
      if (command.kind !== 'raw') continue
      collectFromText(sanitizeCommand(command.text), tokens)
    }
    for (const token of tokens) record(token, { kind: 'action', name: action.name })
  }

  const ignoreAction = options.ignoreOwnMirrorOf
  const ownBindKeys = ignoreAction ? ownMirrorBindKeys(ignoreAction) : undefined
  for (const [key, value] of Object.entries(sources.binds ?? {})) {
    if (ownBindKeys?.has(normalizeBindKey(key))) continue
    const tokens = new Set<string>()
    collectFromText(sanitizeCommand(value), tokens)
    for (const token of tokens) record(token, { kind: 'bind', key })
  }

  for (const layer of sources.layers ?? []) {
    const ownLayerKeys = ignoreAction ? ownMirrorLayerKeys(ignoreAction, layer) : undefined
    for (const [key, value] of Object.entries(layer.overrides)) {
      if (ownLayerKeys?.has(normalizeBindKey(key))) continue
      const tokens = new Set<string>()
      collectFromText(sanitizeCommand(value), tokens)
      for (const token of tokens) record(token, { kind: 'override', key, layerName: layer.name })
    }
  }

  return byToken
}

/**
 * The lower-cased set of every token anything in `sources` could be calling
 * by name - see the file doc comment for the three source shapes and the
 * `bind <key> <token>` widening. Not filtered against any "is this actually a
 * defined alias" set; the caller (`validate-actions.ts`'s `aliasUnreferenced`
 * pass, or `actionsWithAliasLine` below) decides what to do with membership.
 *
 * `options.ignoreOwnMirrorOf` (story 039, D9) excludes exactly the two
 * `binds`/layer-override slots `action`'s own mirror pass writes for it
 * (`ownMirrorBindKeys`/`ownMirrorLayerKeys` above) from the `sources.binds`/
 * `sources.layers` scan - never from `sources.actions`' command text, which
 * this option leaves untouched (a recursive alias body is still counted, per
 * the file doc comment's "No self-exclusion" rule; excluding an action's own
 * *command text* is what `options.excludeActionId` is for - see
 * `findAliasReferrers` below). Optional and defaulting to "ignore nothing", so
 * every existing caller's behaviour is unchanged.
 *
 * The key set of `buildReferrerIndex` above, exactly - a token is in this set
 * iff at least one source produced it, which is what that map's keys are. Kept
 * as its own function because most callers only ever ask "is this name called
 * at all" and have no use for the per-source detail.
 */
export function collectAliasReferences(
  sources: AliasReferenceSources,
  options: AliasReferenceOptions = {},
): Set<string> {
  return new Set(buildReferrerIndex(sources, options).keys())
}

/**
 * Every place in `sources` that calls `name` (case-insensitively), in source order - the by-name
 * core story 044 D1 generalises `findAliasReferrers` into, so a name with no owning action (a layer
 * alias, or a name a caller is merely considering) can be asked about too.
 *
 * Returns `[]` - never `undefined` - for a name nothing calls, so "nothing references this" is one
 * shape at every call site rather than two.
 */
export function findAliasReferrersByName(
  name: string,
  sources: AliasReferenceSources,
  options: AliasReferenceOptions = {},
): AliasReferrer[] {
  return buildReferrerIndex(sources, options).get(name.toLowerCase()) ?? []
}

/**
 * Every place other than `action`'s own two mirror slots that currently calls `aliasNameFor(action)`
 * by name (story 039, D9) - the detail `collectAliasReferences`'s flat token set does not carry, and
 * the rename-refusal dialog needs so it can name what it is refusing to leave dangling.
 *
 * A thin wrapper over `findAliasReferrersByName` since story 044, D1 - only the two exclusions are
 * its own. `action`'s own command text is never scanned (only *other* actions' are) and its own
 * mirror slots are excluded from `sources.binds`/`sources.layers`; together these two exclusions are
 * exactly "the entry's own two mirror slots" the story's D9 text asks to ignore, restated in terms an
 * open-ended reference count could not express (a boolean has no room to say "except these").
 */
export function findAliasReferrers(action: ConfigAction, sources: AliasReferenceSources): AliasReferrer[] {
  return findAliasReferrersByName(aliasNameFor(action), sources, {
    excludeActionId: action.id,
    ignoreOwnMirrorOf: action,
  })
}

/**
 * Which of the three name producers a row of `buildAliasIndex` came from (story 044's first AC:
 * "each labelled with which of the three it is"):
 *
 * - `user` - a `kind: 'alias'` entry, the only kind the user authored *as* an alias and the only
 *   kind editable from the Aliases tab;
 * - `generated` - the alias every other entry (`bind`, `message`) renders under, owned by that
 *   entry and edited there;
 * - `layer` - a name `alt-layers.ts#generateLayerAliases` emits for a modifier layer (its dispatch,
 *   press/release or `_on`/`_off` halves, plus its `_cN` helper and `_pN` chunk aliases).
 */
export type AliasOrigin = 'user' | 'generated' | 'layer'

/**
 * One defined alias name, with everything both askers of the name space need: Care's tidy-up
 * warnings (`validate-actions.ts`) and story 044's Aliases tab.
 */
export interface AliasIndexRow {
  /** The name exactly as it renders, case kept - `+Slow` stays `+Slow`. */
  name: string
  /** `name` lower-cased: the key every lookup and every duplicate comparison uses, because
   * `Cmd_Alias_f` matches alias names case-insensitively. */
  key: string
  origin: AliasOrigin
  /**
   * Display label of whatever defines this name - the entry's `name` for `user`/`generated`, the
   * layer's `name` for `layer`. What a finding or a table row calls the owner, and what the
   * `duplicateOf` list of every partner row holds.
   */
  owner: string
  /** The owning entry's `id`, for `origin: 'user' | 'generated'` only - the handle a deep link into
   * the Controls tab needs. */
  ownerActionId?: string
  /** The owning layer's `name`, for `origin: 'layer'` only. Same string as `owner`; spelled out
   * separately so a consumer can say "which layer" without first testing `origin`. */
  ownerLayerName?: string
  /** True only for `origin: 'user'`. Generated and layer aliases are read-only where they are
   * listed: they occupy names, but they are edited at their owning entry or layer. */
  editable: boolean
  /** Every place that calls this name, in source order; `[]` - never `undefined` - when nothing
   * does. See `buildAliasIndex` for exactly which sources count. */
  referrers: AliasReferrer[]
  /** The `owner` of every *other* row defining this same name, in index order; `[]` when the name
   * is unique. Both halves of a collision therefore carry each other, which is what story 044's
   * "flagged inline on both rows" AC asks for. */
  duplicateOf: string[]
}

/**
 * The profile's whole alias name space as one list (story 044, D1) - the single graph Care and the
 * Aliases tab both read, so the two can never disagree about what is defined or what is referenced.
 *
 * ## One row per *definition*, not per name
 *
 * Two entries whose resolved names collide get **two** rows, each naming the other in its
 * `duplicateOf`. A row keyed by name alone could not carry that: the partners share the name, so
 * the only thing that tells them apart is their owner - and both Care's `aliasDuplicate` finding
 * (one finding per colliding entry, naming the others) and the AC's "flagged inline on both rows"
 * need the owners, not the name. So every defined name appears in this list at least once, and more
 * than once exactly when more than one definition claims it.
 *
 * ## Order
 *
 * Every entry of `sources.actions` produces exactly one *primary* row, in array order, before any
 * layer row - a contract `validate-actions.ts` relies on to pair a row back with the entry it came
 * from by array position (`index[position]`), and one `alias-references.test.ts` asserts. That
 * contract is about the first `sources.actions.length` rows only, and is unaffected by the extra
 * rows below.
 *
 * A two-part entry (`kind: 'toggle'`/`'press-release'`, story 045) renders under more than one alias
 * name - a toggle's dispatch plus its two states, a press/release pair's `+base`/`-base` - and every
 * one of those names has to be a known, referenceable row or it reads as `undefinedAlias`/
 * `aliasUnreferenced` noise (story 045, D8). The primary row (in array position) carries the name a
 * *bind* would use - `bindValueFor(action)`, which is the dispatch alias for a toggle and `+base` for
 * a press/release entry, not the sign-free `aliasNameFor` a press/release action's `commands`-based
 * kinds otherwise resolve to (`twoPartAliasNames`'s doc comment explains why `aliasNameFor` alone is
 * not one of the two real rendered names for these two kinds). One extra row per *other* generated
 * name follows immediately after all primary rows and before any layer row: two for a toggle (its
 * two state names off `twoPartAliasNames`), one for a press/release entry (its release half, `-base`
 * - the press half is already the primary row). Both extra-row kinds share the owning action's
 * `owner`/`ownerActionId`, `origin: 'generated'` and `editable: false` - same as the primary row,
 * since renaming or deleting the entry moves every one of its names together (story 045 AC3).
 *
 * Layer rows follow the extra rows, per layer in `sources.layers` order and within a layer in
 * `generateLayerAliases`' own emission order.
 *
 * A row exists for every entry, including one whose alias line the writer may end up dropping
 * (`actionsWithAliasLine` above: a continuous catalogue mirror, a self-mirroring alias). That is
 * deliberate - the duplicate check has always run over every entry, since a name two entries resolve
 * to is a collision the user must see regardless of which of the two the writer emits - and a
 * consumer that wants only the names that really reach the file filters through
 * `actionsWithAliasLine` itself.
 *
 * ## What `referrers` covers, and what it deliberately does not
 *
 * Exactly the four sources story 044's D1 names, i.e. everything `buildReferrerIndex` scans: base
 * binds, layer overrides, other aliases' bodies and other entries' commands - with **no**
 * exclusions, so an entry's own recursive body and its own bind mirror count as referrers too. That
 * is the safe side (the risk this index exists to avoid is a referenced alias reading as
 * unreferenced and Care offering to delete it), and it is what keeps
 * `row.referrers.length > 0` exactly equivalent to `collectAliasReferences(sources).has(row.key)`,
 * which is how `validate-actions.ts` derives an unchanged `aliasUnreferenced` from this index.
 *
 * Not modelled, because they are render-time products rather than profile-authored references: a
 * layer's own trigger bind (`bind ALT +drops`, `generateLayerAliases`' `triggerBind`) and the calls
 * a generated layer alias' body makes into its own `_cN`/`_pN` family. A layer row can therefore
 * read as unreferenced even though the rendered file wires it up - which no rule reports, since
 * Care's `aliasUnreferenced` only ever covers `kind: 'alias'` entries. Adding either would widen
 * "referenced" for entry rows too (a name colliding with a layer alias) and is a change to Care's
 * behaviour, not to a table's presentation.
 *
 * Pure, like everything else here: `generateLayerAliases` is called only to learn the names a layer
 * occupies; nothing is rendered or written.
 */
export function buildAliasIndex(sources: AliasReferenceSources): AliasIndexRow[] {
  const referrers = buildReferrerIndex(sources, {})
  // Copied per row rather than handed out by reference: two rows of a duplicate pair share one
  // bucket, and a consumer sorting or filtering a row's `referrers` in place must not reach the
  // other row through it.
  const referrersFor = (name: string): AliasReferrer[] => [...(referrers.get(name.toLowerCase()) ?? [])]

  const rows: AliasIndexRow[] = sources.actions.map((action) => {
    // `aliasNameFor` for every kind but `press-release`, where it is sign-free (`base`, not `+base`)
    // and therefore not one of the two names the file actually renders - `bindValueFor` is what
    // returns the real `+base` bind-facing name for that one kind (see the file doc comment's
    // "## Order" section). A toggle's `bindValueFor` already equals its `aliasNameFor` (both are the
    // dispatch alias), so this only actually changes behaviour for `press-release`.
    const name = action.kind === 'press-release' ? bindValueFor(action) : aliasNameFor(action)
    return {
      name,
      key: name.toLowerCase(),
      origin: action.kind === 'alias' ? 'user' : 'generated',
      owner: action.name,
      ownerActionId: action.id,
      editable: action.kind === 'alias',
      referrers: referrersFor(name),
      duplicateOf: [],
    }
  })

  // A two-part entry's *other* generated name(s), one row each - the toggle's two state names, or a
  // press/release entry's release half. Appended after every primary row and before any layer row,
  // so the "one row per `sources.actions` element, in array order" contract above still holds for
  // exactly the first `sources.actions.length` rows.
  for (const action of sources.actions) {
    const halves = twoPartAliasNames(action)
    if (!halves) continue
    const extraNames = action.kind === 'toggle' ? [halves.first, halves.second] : [halves.second]
    for (const name of extraNames) {
      rows.push({
        name,
        key: name.toLowerCase(),
        origin: 'generated',
        owner: action.name,
        ownerActionId: action.id,
        editable: false,
        referrers: referrersFor(name),
        duplicateOf: [],
      })
    }
  }

  for (const layer of sources.layers ?? []) {
    // The real generator, never a re-derivation of its slug/affix budget here (the same S04
    // watch-out `validate-actions.ts`'s own hold-layer lookup already respected). `sources.binds`
    // is the base-bind map it expects; only the resulting names are read.
    for (const alias of generateLayerAliases(layer, sources.binds ?? {}).aliases) {
      rows.push({
        name: alias.name,
        key: alias.name.toLowerCase(),
        origin: 'layer',
        owner: layer.name,
        ownerLayerName: layer.name,
        editable: false,
        referrers: referrersFor(alias.name),
        duplicateOf: [],
      })
    }
  }

  const byKey = new Map<string, AliasIndexRow[]>()
  for (const row of rows) {
    const group = byKey.get(row.key) ?? []
    group.push(row)
    byKey.set(row.key, group)
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue
    for (const row of group) {
      row.duplicateOf = group.filter((partner) => partner !== row).map((partner) => partner.owner)
    }
  }

  return rows
}

/**
 * The top-level (`;`-separated) segments of an already-rendered alias body,
 * trimmed, empties dropped - the same split `validate-structure.ts`'s
 * `splitTopLevelSemicolons` performs on the body it reads back out of a
 * rendered `alias` line.
 *
 * A plain `split(';')` is exact here rather than an approximation of that
 * quote-aware version: every command in the body has been through
 * `sanitizeCommand` (via `commandLineFor`), which drops every `"`, so no
 * quoted span can exist for a `;` to hide inside.
 */
function bodySegments(body: string): string[] {
  return body
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/**
 * The first whitespace-separated token of `segment`, lower-cased - the token
 * `Cmd_ExecuteString` dispatches on, and the one `validate-structure.ts`'s
 * `buildEdges` builds its edge from (`tokenize(segment)[0]`). Whitespace-split
 * rather than tokenized for the same reason as above: a sanitized body carries
 * no quotes, so there is no quoted-token case to handle.
 */
function segmentHead(segment: string): string {
  return segment.split(/\s+/)[0]!.toLowerCase()
}

/**
 * `action`'s alias body exactly as `renderActionAlias` joins it (before any
 * `_p<n>` chunking, which only redistributes these same segments).
 */
function renderedAliasBody(action: ConfigAction): string {
  return action.commands
    .map((command) => commandLineFor(command))
    .filter((command) => command.length > 0)
    .join('; ')
}

/**
 * Every top-level body segment of `action`'s rendered alias line whose head
 * token *is* `action`'s own resolved alias name - the segments that make the
 * line dispatch itself (story 039 review fix, widened in the third pass,
 * split out of the writer's drop guard in the fourth).
 *
 * Exported for `validate-actions.ts`'s `aliasSelfReference` Care finding, which
 * names the offending command(s) to the user. Same rule
 * `validate-structure.ts#buildEdges` applies when it decides what an alias body
 * dispatches - the head token of every top-level `;` segment - so a segment
 * reported here is exactly a segment that draws a cycle edge in the rendered
 * file.
 *
 * Reachable since story 039 made the derived alias name a readable slug of the
 * display name: an entry whose name and (first) command are the same word -
 * `bind-adoption.ts` materialising a raw `bind MWHEELUP "weapnext"` into the
 * `weapnext` catalogue row (it names an adopted row after `row.commands[0]`),
 * the built-in `weapnext`/`weapprev`/`weaplast`/`centerview` rows, or a user
 * entry whose `aliasName` is pinned to its own command - derives the alias name
 * `weapnext` for the command `weapnext`. Before the rename the `q2l_a_` prefix
 * made name and command textually distinct by construction, so this could not
 * happen.
 *
 * Such a segment is dead in every direction: `Cmd_ExecuteString` matches
 * registered *commands* before aliases, so an alias named after a real command
 * is unreachable, and one named after a non-command loops until
 * `ALIAS_LOOP_COUNT` cuts it off. `validate-structure.ts` reports the rendered
 * line as an error-level `aliasCycle`, correctly - which is *why* it is reported
 * here too rather than silently written.
 *
 * ## What is deliberately *not* matched
 *
 * Literal equality of the head token, so the two shapes `referencedAlias`
 * separates stay separated:
 *
 * - `alias forward "+forward; ..."` (the `holdLayer`/`catalogueMirror` corpus
 *   shape) is legal and not a self-reference. `forward` is no engine command, so
 *   that alias really is what a caller reaches, and its body really does dispatch
 *   the engine's `+forward` - which is why `referencedAlias`'s
 *   `isEnginePressReleaseCommand` carve-out refuses that edge, and why a
 *   literal-only head comparison here (`+forward` is not `forward`) agrees with
 *   it without needing to restate it.
 * - `alias zoom "set fov 30; -zoom"` is the one place the two rules differ:
 *   `referencedAlias` *does* build a self-edge there (sign-stripped, and `-zoom`
 *   names no engine command), so that render still draws an `aliasCycle`, while
 *   nothing here reports it. Left that way on purpose: `zoom` is no engine
 *   command, so the alias is live and its `set fov 30` really runs, and whether
 *   that sign-stripped self-edge should be reported at all is
 *   `validate-structure.ts`'s judgement to revisit - not something to restate
 *   here as if the body were self-dispatching.
 */
export function selfReferencingSegments(action: ConfigAction): string[] {
  const name = aliasNameFor(action).trim().toLowerCase()
  if (name.length === 0) return []
  return bodySegments(renderedAliasBody(action)).filter((segment) => segmentHead(segment) === name)
}

/**
 * Is `action`'s whole rendered alias body *nothing but* its own alias name -
 * `alias weapnext weapnext`, the one shape whose alias line the writer may drop
 * outright?
 *
 * ## Why exactly this shape, and no wider (fourth pass, the User's decision)
 *
 * The third pass dropped the line whenever **any** body segment self-referenced,
 * arguing that the alias was unreachable anyway so the body's other commands had
 * never run either. The User's decision (story 039, Decisions (Sprint)) overrules
 * that for the multi-command case: `alias weapnext "weapnext; centerview"` is
 * kept and rendered as authored, because dropping it silently loses `centerview`
 * - the user's own content - and which of the three ways out to take (remove the
 * command, rename the entry, accept the loop) is the user's call, not the
 * writer's. `validate-actions.ts`'s `aliasSelfReference` finding (fed by
 * `selfReferencingSegments` above) is what puts that call in front of them, and
 * the error-level `aliasCycle` `validate-structure.ts` then reports for the kept
 * line is correct and expected, not a bug: calling yourself in a chain really is
 * a cycle in-engine.
 *
 * What is left here is the case where dropping is lossless *by construction*: the
 * body holds one segment and that segment is the alias name itself, so the line
 * defines nothing but its own dead self-call. `bindValueFor` equals the alias name
 * equals that one command, so the emitted `bind MWHEELUP weapnext` runs the
 * command directly and the key behaves identically - the same shape story 038
 * produces for `+attack`/`+moveup` - and `validate-actions.ts`'s
 * `aliasShadowsCommand` still says out loud that the name is unusable as an alias
 * (its `bindValueFor(action) === aliasNameFor(action)` condition holds here by
 * construction). A body of `weapnext arg` is deliberately *not* this case: the
 * argument would be lost, so that one is kept and reported like any other
 * multi-segment self-reference.
 *
 * Checked **before** the three guards in `actionsWithAliasLine`, and deliberately
 * not conditioned on references: a bind carrying the literal token `weapnext` is
 * the direct mirror of the command, not a call into an alias of the same name, so
 * counting it as a reason to keep the alias alive would keep exactly the line
 * that must go.
 */
export function isSelfMirroringAlias(action: ConfigAction): boolean {
  const name = aliasNameFor(action).trim().toLowerCase()
  if (name.length === 0) return false
  const segments = bodySegments(renderedAliasBody(action))
  return segments.length === 1 && segments[0]!.toLowerCase() === name
}

/**
 * `actions`, minus every entry whose alias line the writer has no reason to
 * emit (story 038's root fix, plus story 039's self-mirror guard -
 * `isSelfMirroringAlias` above, which drops an entry outright and before
 * anything else). Beyond that an action is dropped exactly when all three
 * guards hold:
 *
 * - `action.kind !== 'alias'` - a `kind: 'alias'` entry exists to be called by
 *   name and may legitimately be unreferenced (that is Care's
 *   `aliasUnreferenced` warning, not the writer's business - AC6).
 * - `bindValueFor(action) !== aliasNameFor(action)` - the action's own bind
 *   mirror does not go through the alias at all (a continuous catalogue row
 *   bound to its bare command, `action-mirror.ts`'s story 034 case), so the
 *   alias has no bind of its own calling it either.
 * - its alias name is not in `collectAliasReferences(sources)` - nothing
 *   else in the profile (another action, a base bind, a layer override, a
 *   `bind <key> <token>` body) calls it by name.
 *
 * A keyless, unreferenced `kind: 'bind'`/`'message'` action survives: its
 * `bindValueFor` equals its alias name (no catalogue mirror in play), so the
 * second guard already keeps it - user-authored content the user may be
 * about to bind, not this story's dead-catalogue-row case (User decision).
 *
 * Pure, like `collectAliasReferences` - no `fs`, no DOM, no electron. The
 * drop is per action, so a chunked `_p1`/`_p2` family (`alias-render.ts`'s
 * `renderActionAlias`) always disappears whole: dropping the action here
 * means `renderActionAliasLines` never sees it and never emits any of its
 * parts.
 */
export function actionsWithAliasLine(
  actions: ConfigAction[],
  sources: AliasReferenceSources,
): ConfigAction[] {
  const referenced = collectAliasReferences(sources)
  return actions.filter((action) => {
    // Story 045, D3: a two-part entry's lines are always kept, checked before every other guard.
    // Its internal wiring makes plain reference counting unreliable - a toggle's states are only
    // ever called by the dispatch alias and by each other's `alias <dispatch> <state>` rewrite,
    // and a press/release entry's `bindValueFor` is `+<base>`, which is *not* its own alias name,
    // so the third guard below would put a keyless pair's survival down to whether something else
    // in the profile happens to mention it. Dropping either kind's family is never right: it is
    // one entry the user created, and a half-emitted family is worse than an unreferenced one.
    if (action.kind === 'toggle' || action.kind === 'press-release') return true
    if (isSelfMirroringAlias(action)) return false
    if (action.kind === 'alias') return true
    if (bindValueFor(action) === aliasNameFor(action)) return true
    return referenced.has(aliasNameFor(action).toLowerCase())
  })
}
