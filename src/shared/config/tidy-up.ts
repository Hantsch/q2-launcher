/**
 * Tidy-up operations — the pure applier behind the Care tab's "fix this for me"
 * actions (story 025 D3).
 *
 * Every other write path in this codebase mutates a profile because the *user*
 * edited that exact field: `setCvars` replaces the map the cvar editor was
 * showing, `setActions` replaces the array the Controls grid was editing. A
 * tidy-up is the first path that mutates a *saved* profile from an automated
 * finding instead - the user clicks "remove this shadowed bind" on a row a
 * scanner produced, not on the field itself. Two consequences shape this whole
 * module, and both are the reason it exists as its own file rather than as four
 * more whole-field setters:
 *
 * 1. **Every operation is re-checked against the current profile before it is
 *    applied.** The findings a user acts on were computed from a snapshot the
 *    renderer holds; the profile may have moved on (another tab saved, an
 *    import ran, the same batch's earlier op already changed the thing). A
 *    stale operation must mutate *nothing* and come back in `rejected`. It
 *    never throws: one no-longer-applicable row must not fail a batch of nine
 *    good ones. Same shape and same reasoning as `cleanup.ts`'s
 *    `removeRedundantCopies`, which re-scans the disk before it deletes
 *    anything a user picked off an older scan (story 010 decision 8).
 * 2. **A batch is one commit.** A re-classify touches `unrecognized` *and* one
 *    of `cvars`/`binds`/`actions`; going through the existing whole-field
 *    setters would bump `updatedAt` twice and hand `syncAndPersist` two
 *    half-tidied profiles to write to every installation the profile is
 *    assigned to. So this function takes the whole list, returns one profile,
 *    and the caller commits it once.
 *
 * `updatedAt` is deliberately *not* bumped here: this stays a pure data
 * transform (no clock, no ids, no I/O), so the main handler owns the single
 * timestamp bump exactly as it owns the single commit and the single sync run.
 *
 * ## Sequential, against an accumulating draft
 *
 * Operations are applied in array order, and each one is re-checked against the
 * profile *as the preceding operations left it* - not against the original
 * snapshot. That is what makes two operations that interact inside one batch
 * resolve correctly: removing two of three claimants of one key rejects nothing
 * (the key is still contested when the second op is checked), while a
 * hypothetical third op removing the last claimant is rejected, because by then
 * nothing shadows anything. Checking every op against the original snapshot
 * would apply all three and leave the key unbound - exactly the silent
 * corruption this module is written to avoid.
 *
 * ## Reuse over re-derivation
 *
 * Every precondition is answered by the function that already owns that
 * question, never by a second copy of its rules:
 *
 * - "is this layer empty" -> `generateLayerAliases`'s own `layer.empty` issue.
 * - "is this alias still unreferenced" -> `validateActions`'s
 *   `aliasUnreferenced` rule.
 * - "would this new bind/key land on something" -> `findBindCollision`.
 * - "rebuild the binds mirror after adding an action" ->
 *   `applyActionBindMirror`, the same function `setActions` uses.
 *
 * `bind-collision.ts`'s `releaseKey` is the one *deliberate* non-reuse - it
 * frees a key entirely, which is the opposite of what removing one of several
 * claimants means; see `withoutOneClaim`.
 *
 * The other exception is `bindClaimsFor` below: "who else claims this key in
 * this scope" lives in `renderer/.../lib/bind-conflicts.ts`
 * (`findBindConflicts`), which `src/shared` may not import. Its claim rules are
 * mirrored here for the one key an op names, and a divergence between the two
 * can only ever produce a *rejected* op, never a wrong mutation - see
 * `bindClaimsFor`'s own comment. It is exported for D4's analyzer
 * (`renderer/.../lib/tidy-up-findings.ts`), which builds the
 * `removeShadowedBind` ops: sharing this one function is what makes the claim
 * an op names, and the claim this module re-checks it against, the same claim
 * by construction rather than by two agreeing copies.
 *
 * Pure by contract: `src/shared`, so no `node:*`, no DOM, no electron - same
 * rule `validate-actions.ts`/`alt-layers.ts` follow.
 */

import type { AltLayer } from './alt-layers'
import { actionKeySlots, keySlotAt, withKeySlot } from './action-slots'
import type { BindSlot } from './bind-collision'
import type {
  ConfigAction,
  ConfigProfile,
  UnrecognizedConfigLine,
} from '../modules/config'
import { BUILT_IN_ACTION_CATEGORIES } from '../modules/config'
import { ACTIONS_MESSAGE_PREFIX, validateActions } from './validate-actions'
import { applyActionBindMirror, bindValueFor, isMirroredValue } from './action-mirror'
import { aliasNameFor } from './alias-render'
import { findBindCollision } from './bind-collision'
import { generateLayerAliases, sanitizeCommand } from './alt-layers'
import { normalizeBindKey } from './key-names'
import type { ModifierTrigger } from './modifier-layers'

/**
 * Which of a profile's two independent bind channels a claim lives in -
 * the base layer, or one specific `AltLayer`. Shape-identical to
 * `BindConflict['scope']` (renderer's `bind-conflicts.ts`) on purpose: the
 * analyzer that emits these ops (D4) reads that scan's `scope` and passes it
 * straight through.
 */
export type TidyUpBindScope = 'base' | { layerId: string }

/**
 * *Which* of the claimants of a contested key an op means. A key can be claimed
 * from three independent places (the same three `bind-collision.ts` enumerates),
 * so naming the key alone would leave the applier guessing:
 *
 * - `baseBind` - a raw `profile.binds` entry. `command` is its current value and
 *   is compared on re-check, so an entry that has since been re-bound to
 *   something else is a reject rather than a blind delete. Only ever valid in
 *   `scope: 'base'`.
 * - `action` - one slot of one `ConfigAction`, named by the action's `id` (never
 *   its `name`: a label is user-editable and translatable, an id is not) plus the
 *   slot's numeric index into `keys` (story 050 - any number of slots, not just
 *   two). Lives in `scope: 'base'` when that slot carries no
 *   modifier, and in the matching modifier layer's scope when it does - a
 *   mismatch between the op's stated scope and the slot's current one is exactly
 *   the "the row moved to Alt+R since you looked at it" staleness this rejects.
 * - `layerOverride` - a hand-made entry in the scope layer's own `overrides`
 *   map. The layer is named by the scope, not repeated here. `command` is
 *   compared on re-check for the same reason as `baseBind`'s.
 */
export type TidyUpBindClaim =
  | { source: 'baseBind'; command: string }
  | { source: 'action'; actionId: string; slot: BindSlot }
  | { source: 'layerOverride'; command: string }

/**
 * What a re-classified preserved line becomes. Named by the `ConfigProfile`
 * field it is written into, so an op says literally which field it touches.
 *
 * The *decision* is the analyzer's (D4), never this applier's: nothing here
 * parses `text` or guesses what a line meant. The op carries the finished
 * entry - a cvar name+value, a key+command, or a whole `ConfigAction` - and
 * this module only checks that writing it is still safe and writes it.
 *
 * `actions` carries a complete `ConfigAction` because that is what the field
 * holds; the id is the analyzer's to generate (this module has no id factory,
 * being pure). Two narrowings keep an action target from creating the mess a
 * tidy-up is supposed to remove, both enforced below: its `categoryId` must
 * resolve to a real category, and a modifier-carrying slot is refused outright
 * (that needs an `AltLayer` created and mirrored, which is the Controls
 * editor's job, not a tidy-up's).
 */
export type TidyUpReclassifyTarget =
  | { field: 'cvars'; name: string; value: string }
  | { field: 'binds'; key: string; command: string }
  | { field: 'actions'; action: ConfigAction }

/**
 * One machine-readable tidy-up operation. Five members, one per fixable finding
 * kind the Care tab offers:
 *
 * - `removeShadowedBind` - drop one specific claimant of a key that is claimed
 *   more than once, keeping the others. Which claimant survives is the
 *   analyzer's call (render order / `findBindConflicts`); this op names the one
 *   to remove. Rejected unless that exact claim still exists **and** the key is
 *   still contested in that scope - removing the last claimant would silently
 *   unbind a key, which is a worse outcome than the duplicate it was fixing.
 * - `removeEmptyLayer` - drop an `AltLayer` whose every override is blank
 *   (`generateLayerAliases`'s `layer.empty`). Rejected once the layer has real
 *   content again, or is already gone.
 * - `removeUnreferencedAlias` - drop a `kind: 'alias'` action nothing calls
 *   (`validateActions`'s `aliasUnreferenced`). Rejected once something
 *   references it, or it is already gone.
 * - `dropPreservedLine` - forget one `unrecognized` line for good.
 * - `reclassifyPreservedLine` - promote one `unrecognized` line into real
 *   profile content: the line leaves `unrecognized` and its target field gains
 *   the entry, in the same result.
 *
 * A preserved line has no id of its own (`UnrecognizedConfigLine` is
 * `{ file, line, text }`), so the two preserved-line ops identify it by all
 * three fields together and match exactly. `line` alone would be unstable - a
 * re-import shifts line numbers - and `text` alone is not unique (two files can
 * carry the same garbled line). Requiring all three means a line that moved is a
 * reject, i.e. the user is asked again, rather than a different line being
 * dropped.
 */
export type TidyUpOp =
  | { kind: 'removeShadowedBind'; scope: TidyUpBindScope; key: string; claim: TidyUpBindClaim }
  | { kind: 'removeEmptyLayer'; layerId: string }
  | { kind: 'removeUnreferencedAlias'; actionId: string }
  | { kind: 'dropPreservedLine'; file: string; line: number; text: string }
  | {
      kind: 'reclassifyPreservedLine'
      file: string
      line: number
      text: string
      target: TidyUpReclassifyTarget
    }

export interface TidyUpApplyOutcome {
  /** The profile with every applied op's mutation, or the input profile by
   * reference when nothing applied. `updatedAt` is never touched here. */
  profile: ConfigProfile
  /** The ops that were applied, by reference, in input order. */
  applied: TidyUpOp[]
  /** The ops whose precondition no longer held, by reference, in input order.
   * Each mutated nothing. */
  rejected: TidyUpOp[]
}

/**
 * `validateActions` needs an `EngineKind` for the `Finding.engine` field it
 * stamps on every result. The alias-wiring rules this module consults do not
 * vary by engine (see that module's own note: "nothing here reads engine facts
 * or varies by engine"), and the findings are read and discarded here rather
 * than shown, so one fixed value is passed rather than threading a profile's
 * assigned engines into a pure precondition check.
 */
const PRECONDITION_ENGINE = 'r1q2' as const

/** The three literal modifier triggers a layer can be keyed by - same narrowing
 * `bind-conflicts.ts`'s `modifierForLayer` applies. */
function modifierForLayer(layer: AltLayer): ModifierTrigger | undefined {
  if (!layer.triggerKey) return undefined
  const normalized = normalizeBindKey(layer.triggerKey)
  return normalized === 'ALT' || normalized === 'CTRL' || normalized === 'SHIFT'
    ? normalized
    : undefined
}

/** A slot's raw key when that slot claims the *base* layer (no modifier), else
 * `undefined` - `bind-collision.ts`'s `slotValue` rule. */
function baseSlotKey(action: ConfigAction, slot: BindSlot): string | undefined {
  const found = keySlotAt(action, slot)
  if (!found || found.modifier) return undefined
  return found.key
}

function slotKey(action: ConfigAction, slot: BindSlot): string | undefined {
  return keySlotAt(action, slot)?.key
}

function slotModifier(action: ConfigAction, slot: BindSlot): ModifierTrigger | undefined {
  return keySlotAt(action, slot)?.modifier
}

/** Every entry of `map` whose key normalizes to `normalizedKey`, dropped. Same
 * normalized-key matching as `bind-collision.ts`'s own removal helper: a stored
 * key can be spelled `f9` or `F9` and must be found either way. */
function withoutNormalizedKey(
  map: Record<string, string>,
  normalizedKey: string,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [rawKey, value] of Object.entries(map)) {
    if (normalizeBindKey(rawKey) !== normalizedKey) next[rawKey] = value
  }
  return next
}

/**
 * Drop the **first** entry of `map` whose key normalizes to `normalizedKey` and
 * whose value is exactly `value` - one claim, not one key.
 *
 * This is the reason `bind-collision.ts`'s `releaseKey` is deliberately *not*
 * reused for a `removeShadowedBind`: `releaseKey` exists to free a key
 * *entirely* so a capture can land on it, and drops every entry that normalizes
 * to it. Here the whole point is that the key stays claimed - by whoever the
 * analyzer decided wins. On the exact input this op is for - two differently
 * spelled entries for one key, e.g. `{ MOUSE1: '+attack', mouse1: 'weapnext' }`
 * from an import - `releaseKey` would unbind the key completely while removing
 * "the shadowed one". First-match-only also keeps two byte-identical duplicate
 * entries resolvable: the op removes one of them and the other survives as the
 * winner, instead of both vanishing.
 */
function withoutOneClaim(
  map: Record<string, string>,
  normalizedKey: string,
  value: string,
): Record<string, string> {
  const next: Record<string, string> = {}
  let dropped = false
  for (const [rawKey, current] of Object.entries(map)) {
    if (!dropped && normalizeBindKey(rawKey) === normalizedKey && current === value) {
      dropped = true
      continue
    }
    next[rawKey] = current
  }
  return next
}

/** Every entry of `map` on `normalizedKey` whose value is `value`, dropped -
 * used only for *generated* mirror entries, where all copies are stale by
 * definition once the slot that produced them is cleared. */
function withoutMirrorEntries(
  map: Record<string, string>,
  normalizedKey: string,
  value: string,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [rawKey, current] of Object.entries(map)) {
    if (normalizeBindKey(rawKey) === normalizedKey && current.trim() === value) continue
    next[rawKey] = current
  }
  return next
}

/**
 * Everyone currently claiming `normalizedKey` in `scope` - the mirror of the
 * renderer's `findBindConflicts`, narrowed to one key and one scope.
 *
 * Duplicated rather than imported because `findBindConflicts` lives under
 * `src/renderer` and `src/shared` may not import from there. The duplication is
 * bounded and fail-safe: this function is only ever used to decide whether a
 * `removeShadowedBind` op *may* proceed, so if it ever became stricter than the
 * scan that produced the op, the result is a rejected op (the user is asked
 * again), never a claim removed on a key that turned out not to be contested.
 *
 * The rules, unchanged from that scan:
 *
 * - base scope: every non-alias action's non-modifier-carrying slot, plus every
 *   `profile.binds` entry that is not one of those actions' own mirror value
 *   (`bindValueFor`) - counting an action *and* the mirror `setActions` writes
 *   for it would make every keyed action look contested with itself.
 * - layer scope: every non-alias action slot whose modifier matches this layer's
 *   trigger, plus this layer's own hand-made `overrides` entries - a mirrored
 *   value (`isMirroredValue`) is the *result* of one of those slots, not a
 *   second independent claim.
 */
export function bindClaimsFor(
  profile: ConfigProfile,
  scope: TidyUpBindScope,
  normalizedKey: string,
): TidyUpBindClaim[] {
  const actions = profile.actions ?? []
  const claims: TidyUpBindClaim[] = []

  if (scope === 'base') {
    const ownMirrors = new Set<string>()
    for (const action of actions) {
      if (action.kind === 'alias') continue
      for (let slot = 0; slot < actionKeySlots(action).length; slot += 1) {
        const raw = baseSlotKey(action, slot)
        if (!raw || normalizeBindKey(raw) !== normalizedKey) continue
        claims.push({ source: 'action', actionId: action.id, slot })
        ownMirrors.add(bindValueFor(action))
      }
    }
    for (const [rawKey, command] of Object.entries(profile.binds)) {
      if (!command || normalizeBindKey(rawKey) !== normalizedKey) continue
      if (ownMirrors.has(command)) continue
      claims.push({ source: 'baseBind', command })
    }
    return claims
  }

  const layer = (profile.layers ?? []).find((candidate) => candidate.id === scope.layerId)
  if (!layer) return claims

  const modifier = modifierForLayer(layer)
  if (modifier) {
    for (const action of actions) {
      if (action.kind === 'alias') continue
      for (let slot = 0; slot < actionKeySlots(action).length; slot += 1) {
        if (slotModifier(action, slot) !== modifier) continue
        const raw = slotKey(action, slot)
        if (!raw || normalizeBindKey(raw) !== normalizedKey) continue
        claims.push({ source: 'action', actionId: action.id, slot })
      }
    }
  }
  for (const [rawKey, command] of Object.entries(layer.overrides)) {
    if (!command || isMirroredValue(command, actions, rawKey)) continue
    if (normalizeBindKey(rawKey) !== normalizedKey) continue
    claims.push({ source: 'layerOverride', command })
  }
  return claims
}

function sameClaim(a: TidyUpBindClaim, b: TidyUpBindClaim): boolean {
  if (a.source === 'action' && b.source === 'action') {
    return a.actionId === b.actionId && a.slot === b.slot
  }
  if (a.source === 'baseBind' && b.source === 'baseBind') return a.command === b.command
  if (a.source === 'layerOverride' && b.source === 'layerOverride') return a.command === b.command
  return false
}

/**
 * `removeShadowedBind`. Two preconditions, both required:
 *
 * 1. the named claim is still one of `normalizedKey`'s claimants in `scope`
 *    (which, for an `action` claim, also means the slot is still in *this*
 *    scope - a slot that gained or lost a modifier moved scope and is stale), and
 * 2. the key is still claimed by someone else there.
 *
 * (2) is the guard that matters: this op exists to resolve a duplicate, so once
 * the duplicate is gone the "fix" would just delete a key's only binding.
 */
function applyRemoveShadowedBind(
  profile: ConfigProfile,
  op: Extract<TidyUpOp, { kind: 'removeShadowedBind' }>,
): ConfigProfile | null {
  const scope = op.scope
  const claim = op.claim
  const normalizedKey = normalizeBindKey(op.key)
  const claims = bindClaimsFor(profile, scope, normalizedKey)
  if (claims.length < 2) return null
  if (!claims.some((candidate) => sameClaim(candidate, claim))) return null

  if (claim.source === 'baseBind') {
    if (scope !== 'base') return null
    return { ...profile, binds: withoutOneClaim(profile.binds, normalizedKey, claim.command) }
  }

  if (claim.source === 'layerOverride') {
    if (scope === 'base') return null
    const layers = (profile.layers ?? []).map((layer) =>
      layer.id === scope.layerId
        ? { ...layer, overrides: withoutOneClaim(layer.overrides, normalizedKey, claim.command) }
        : layer,
    )
    return { ...profile, layers }
  }

  const action = (profile.actions ?? []).find((candidate) => candidate.id === claim.actionId)
  // `bindClaimsFor` already found this claim, so the action exists - narrowing only.
  if (!action) return null
  const modifier = slotModifier(action, claim.slot)
  const mirrorValue = bindValueFor(action)

  // The whole slot is cleared as one unit, never leaving its modifier behind -
  // `releaseKey`/`applyModifierReplace` keep the same invariant, and a stranded
  // modifier would put the row in a state the editor has no way to render.
  //
  // Written **in place** (`withKeySlot` with an empty key, never `clearKeySlot`),
  // story-050 review finding 2 (third round): this is the one slot-clearing path
  // that still removed the array entry, and removing it shifts every later slot
  // down by one - which breaks *this* function's own contract on a batch. Every
  // op in an `applyTidyUpOps` batch is re-checked against the draft the previous
  // ops produced (`bindClaimsFor` + `sameClaim`), and an `action` claim is
  // identified by `(actionId, slot)` where `slot` is an array index. So with
  // "Fix all safe findings" queueing two ops against two slots of the *same*
  // action, the first removal renumbered the second op's slot and that op was
  // rejected as stale: one of two shadowed keys stayed bound, with the Care row
  // reporting a partial apply for no reason the user could see. Clearing in
  // place keeps every later slot's index, so each op in the batch still finds
  // the claim it was minted for. Empty-key slots are skipped by every reader
  // (`bindClaimsFor` above, `action-mirror.ts`'s mirror pass,
  // `render.ts#buildBindOwnerIndex`), which is the same reasoning
  // `bind-collision.ts#releaseKey` and `bind-slot-collision.ts`' replace paths
  // already record.
  const actions = (profile.actions ?? []).map((candidate) =>
    candidate.id !== action.id ? candidate : withKeySlot(candidate, claim.slot, { key: '' }),
  )

  // Clearing a slot leaves its generated mirror behind, and a stale mirror is
  // exactly as broken as the duplicate this op removes - the key would keep
  // firing an alias no row claims any more. Both mirrors are cleaned up, and
  // both only by *value*: an entry on the same key that is not this action's
  // mirror value is somebody else's claim (very possibly the one the analyzer
  // decided wins) and is never touched.
  //
  // A slot with no modifier mirrors into `binds`; a slot with one mirrors into
  // its modifier layer's `overrides` and never into `binds` at all (story 016
  // decision 17), so exactly one of the two below can find anything.
  const binds = modifier
    ? profile.binds
    : withoutMirrorEntries(profile.binds, normalizedKey, mirrorValue)
  const layers = (profile.layers ?? []).map((layer) => {
    if (!modifier || modifierForLayer(layer) !== modifier) return layer
    return { ...layer, overrides: withoutMirrorEntries(layer.overrides, normalizedKey, mirrorValue) }
  })

  return { ...profile, actions, binds, layers }
}

/**
 * `removeEmptyLayer`. "Empty" is not re-derived: the layer is handed to
 * `generateLayerAliases` and the check is whether it still raises its own
 * `layer.empty` issue, so this can never disagree with the generator about what
 * an override with a blank/whitespace-only command counts as.
 *
 * Nothing else needs cleaning up: an empty layer has no overrides, so no
 * action's modifier slot mirrors into it, and nothing outside it references it.
 */
function applyRemoveEmptyLayer(
  profile: ConfigProfile,
  op: Extract<TidyUpOp, { kind: 'removeEmptyLayer' }>,
): ConfigProfile | null {
  const layers = profile.layers ?? []
  const layer = layers.find((candidate) => candidate.id === op.layerId)
  if (!layer) return null
  const { issues } = generateLayerAliases(layer, profile.binds)
  if (!issues.some((issue) => issue.key === 'layer.empty')) return null
  return { ...profile, layers: layers.filter((candidate) => candidate.id !== op.layerId) }
}

/**
 * `removeUnreferencedAlias`. The precondition is `validateActions`' own
 * `aliasUnreferenced` finding still being raised for this action - matched on
 * the rendered alias name (`aliasNameFor`, the value that rule reports in
 * `params.name`), which is also the only name the reference scan ever looked
 * for. So an alias something started calling since the scan is rejected.
 *
 * Removal is the action row and nothing else: a `kind: 'alias'` entry is skipped
 * by both the `binds` and the `layers` mirror (`setActions`' rule), so it owns
 * no generated entry anywhere that would need stripping - and deliberately *not*
 * running the mirrors here is what keeps a user's hand-typed `bind r "+test"`
 * on that same name untouched.
 */
function applyRemoveUnreferencedAlias(
  profile: ConfigProfile,
  op: Extract<TidyUpOp, { kind: 'removeUnreferencedAlias' }>,
): ConfigProfile | null {
  const actions = profile.actions ?? []
  const action = actions.find((candidate) => candidate.id === op.actionId)
  if (!action || action.kind !== 'alias') return null

  const findings = validateActions(actions, PRECONDITION_ENGINE, {
    binds: profile.binds,
    layers: profile.layers,
  })
  const name = aliasNameFor(action)
  const stillUnreferenced = findings.some(
    (finding) =>
      finding.messageKey === `${ACTIONS_MESSAGE_PREFIX}aliasUnreferenced` &&
      finding.params?.['name'] === name,
  )
  if (!stillUnreferenced) return null

  return { ...profile, actions: actions.filter((candidate) => candidate.id !== op.actionId) }
}

/** Index of the `unrecognized` entry matching all three of `file`/`line`/`text`,
 * or `-1`. See `TidyUpOp`'s doc comment for why identity is all three. */
function preservedIndex(
  lines: UnrecognizedConfigLine[],
  ref: { file: string; line: number; text: string },
): number {
  return lines.findIndex(
    (candidate) =>
      candidate.file === ref.file && candidate.line === ref.line && candidate.text === ref.text,
  )
}

function withoutPreservedAt(
  lines: UnrecognizedConfigLine[],
  index: number,
): UnrecognizedConfigLine[] {
  return [...lines.slice(0, index), ...lines.slice(index + 1)]
}

function applyDropPreservedLine(
  profile: ConfigProfile,
  op: Extract<TidyUpOp, { kind: 'dropPreservedLine' }>,
): ConfigProfile | null {
  const lines = profile.unrecognized ?? []
  const index = preservedIndex(lines, op)
  if (index < 0) return null
  return { ...profile, unrecognized: withoutPreservedAt(lines, index) }
}

/** Does `categoryId` resolve to a category the UI can actually show the row
 * under - a built-in, or one this profile carries? An action filed under a
 * category that does not exist is invisible, which is not a tidy-up. */
function categoryExists(profile: ConfigProfile, categoryId: string): boolean {
  if (BUILT_IN_ACTION_CATEGORIES.some((category) => category.id === categoryId)) return true
  return (profile.categories ?? []).some((category) => category.id === categoryId)
}

/**
 * Would writing a claim on `key` collide with something that is already there?
 * `findBindCollision` answers it; a layer override is deliberately not a
 * blocker (decision 14: a layer legitimately coexists with the base bind it
 * temporarily overrides), so only a base-bind or another action's slot counts.
 * `allowedCommand`, when given, is the one base-bind value that is *not* a
 * collision - the identical entry, which makes the write a no-op instead of a
 * clobber and keeps a re-sent op idempotent rather than rejected.
 */
function baseKeyIsFree(
  profile: ConfigProfile,
  key: string,
  allowedCommand?: string,
): boolean {
  const collision = findBindCollision(profile, key)
  if (!collision || collision.kind === 'layerOverride') return true
  return collision.kind === 'baseBind' && collision.command === allowedCommand
}

/**
 * `reclassifyPreservedLine` - the one op that writes two fields in one result:
 * the line leaves `unrecognized` and its target field gains the entry. Both or
 * neither, which is the whole reason this is one op rather than a drop plus a
 * separate edit.
 *
 * Preconditions beyond the line still being there, all refusals rather than
 * overwrites - a tidy-up promotes a line the profile *lost*, it never edits
 * content the user already has:
 *
 * - `cvars`: the cvar must be unset, or already hold exactly this value.
 * - `binds`: the key must be free (`baseKeyIsFree`), or already hold exactly
 *   this command.
 * - `actions`: the id must be new, the category must exist, no slot may carry a
 *   modifier (that would need an `AltLayer` created and mirrored - not this
 *   module's job, and it has no id factory to create one with), and every key
 *   the action carries must be free.
 *
 * An action target rebuilds the `binds` mirror through `applyActionBindMirror`,
 * the exact function `setActions` uses, so a promoted keyed row lands with its
 * mirror already correct instead of waiting for the next save to notice.
 */
function applyReclassifyPreservedLine(
  profile: ConfigProfile,
  op: Extract<TidyUpOp, { kind: 'reclassifyPreservedLine' }>,
): ConfigProfile | null {
  const lines = profile.unrecognized ?? []
  const index = preservedIndex(lines, op)
  if (index < 0) return null
  const unrecognized = withoutPreservedAt(lines, index)
  const target = op.target

  if (target.field === 'cvars') {
    const existing = profile.cvars[target.name]
    if (existing !== undefined && existing !== target.value) return null
    return { ...profile, cvars: { ...profile.cvars, [target.name]: target.value }, unrecognized }
  }

  if (target.field === 'binds') {
    if (sanitizeCommand(target.command).length === 0) return null
    if (!baseKeyIsFree(profile, target.key, target.command)) return null
    const normalizedKey = normalizeBindKey(target.key)
    return {
      ...profile,
      binds: { ...withoutNormalizedKey(profile.binds, normalizedKey), [normalizedKey]: target.command },
      unrecognized,
    }
  }

  const action = target.action
  const actions = profile.actions ?? []
  if (actions.some((candidate) => candidate.id === action.id)) return null
  if (!categoryExists(profile, action.categoryId)) return null
  if (actionKeySlots(action).some((slot) => slot.modifier)) return null
  for (const slot of actionKeySlots(action)) {
    if (slot.key && !baseKeyIsFree(profile, slot.key)) return null
  }

  const nextActions = [...actions, action]
  return {
    ...profile,
    actions: nextActions,
    binds: applyActionBindMirror(profile.binds, nextActions, actions),
    unrecognized,
  }
}

/**
 * Apply `ops` to `profile`, re-checking each one against the profile as the
 * preceding ops left it (see the file doc comment). Never mutates `profile` and
 * never throws: an op whose precondition no longer holds changes nothing and
 * comes back in `rejected`.
 *
 * `updatedAt` is *not* bumped - the caller commits the returned profile once and
 * owns the single timestamp bump.
 */
export function applyTidyUpOps(profile: ConfigProfile, ops: TidyUpOp[]): TidyUpApplyOutcome {
  const applied: TidyUpOp[] = []
  const rejected: TidyUpOp[] = []
  let draft = profile

  for (const op of ops) {
    let next: ConfigProfile | null
    switch (op.kind) {
      case 'removeShadowedBind':
        next = applyRemoveShadowedBind(draft, op)
        break
      case 'removeEmptyLayer':
        next = applyRemoveEmptyLayer(draft, op)
        break
      case 'removeUnreferencedAlias':
        next = applyRemoveUnreferencedAlias(draft, op)
        break
      case 'dropPreservedLine':
        next = applyDropPreservedLine(draft, op)
        break
      case 'reclassifyPreservedLine':
        next = applyReclassifyPreservedLine(draft, op)
        break
    }

    if (next === null) {
      rejected.push(op)
      continue
    }
    draft = next
    applied.push(op)
  }

  return { profile: draft, applied, rejected }
}
