/**
 * Story 015 D7: the two pure pieces of collision handling that `BindSlot` and
 * its two host panels (`DualBindPanel`, `DropBindPanel`) share - naming the
 * current owner of a key, and computing the actions array a Replace has to
 * persist.
 *
 * Both live here rather than inline in the panels' JSX for the same two
 * reasons: they are needed four times (Primary/Secondary x two panels), and
 * `applyReplace` carries the one invariant of this deliverable that is easy to
 * break by accident and pointless to re-derive per call site (see its own
 * doc comment).
 *
 * Pure, hook-free and DOM-free like `catalog-binds.ts`, so a vitest file can
 * import it without a DOM environment.
 *
 * Story 016 D4 adds `findModifierSlotCollision` alongside `findSlotCollision`
 * (same file, same "does something already own this?" shape) rather than
 * folding it into `findBindCollision`/`BindCollision` itself: that type and
 * its `findBindCollision`/`releaseKey` pair are purpose-built for "who owns
 * this key on the base layer" and are matched exhaustively by `kind` in three
 * places (`releaseKey`, `ownerLabel`, `BindSlot`'s `BLOCKING_MESSAGE_KEY`) -
 * widening the union for a check that has nothing to release and no base-bind
 * angle at all would force three unrelated call sites to grow a branch they
 * can never take. `BindSlot` still renders it with the exact same banner
 * markup and the same Cancel/Replace button pair as `pending` below, which is
 * what AC 6 ("the same way") is actually asking for.
 */

import {
  findBindCollision,
  releaseKey,
  type BindCollision,
  type BindCollisionIgnore,
  type BindSlot,
} from '@shared/config/bind-collision'
import { actionKeySlots, withKeySlot } from '@shared/config/action-slots'
import { isMirroredValue } from '@shared/config/action-mirror'
import { MODIFIER_LAYER_NAME, type ModifierTrigger } from '@shared/config/modifier-layers'
import { normalizeBindKey } from '@shared/config/key-names'
import type { AltLayer } from '@shared/config/alt-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { applySlot } from './catalog-binds'

/**
 * A collision plus the single label the UI shows for whoever currently owns
 * the key. Resolving the owner here (rather than branching on `kind` inside
 * `BindSlot`) keeps the three-way branch in exactly one place, so the base
 * banner and the layer warning can never drift into naming the same thing two
 * different ways.
 */
export interface SlotCollision {
  collision: BindCollision
  owner: string
}

/**
 * What the user sees as "the thing that already has this key":
 *
 * - `baseBind`: the bound command itself (`+forward`), since a hand-written
 *   bind has no other identity.
 * - `action`: the colliding action's `name`. For a catalogue-materialised
 *   action that is D3's `nameForRow`, i.e. the row's own raw command text -
 *   not its translated catalogue label. Reverse-resolving a label from a
 *   `catalogId` is deliberately out of scope (D7).
 * - `layerOverride`: the layer's `name`, looked up in the same profile the
 *   collision was found in. `layerId` is the fallback and can only be reached
 *   if a layer disappeared between the two reads - a degraded but still
 *   distinguishable value, never a generic "Unknown".
 */
function ownerLabel(profile: ConfigProfile, collision: BindCollision): string {
  switch (collision.kind) {
    case 'baseBind':
      return collision.command
    case 'action':
      return collision.name
    case 'layerOverride': {
      const layer = profile.layers?.find((candidate) => candidate.id === collision.layerId)
      return layer?.name ?? collision.layerId
    }
  }
}

/**
 * The layer name a row's Options cell shows for a modifier-bound slot (story 020 D6): the real
 * name of the `AltLayer` whose `triggerKey` matches `modifier`, when one exists yet, or the
 * generic name a fresh layer would get otherwise. Mirrors `ownerLabel`'s `layerOverride` case
 * ("prefer the real layer name, fall back to the generic one") but looks the layer up by
 * `triggerKey`, not by id - the same lookup `findModifierSlotCollision` already does, because a
 * layer is matched by its normalized `triggerKey`, never by id or name (see
 * `modifier-layers.ts`'s module doc comment).
 */
export function layerNameForModifier(layers: AltLayer[], modifier: ModifierTrigger): string {
  const layer = layers.find((candidate) => normalizeBindKey(candidate.triggerKey ?? '') === modifier)
  return layer?.name ?? MODIFIER_LAYER_NAME[modifier]
}

/**
 * `findBindCollision` plus the owner label. `profile` must be the in-progress
 * draft, not the last-saved snapshot: `draft.binds`/`draft.layers` are always
 * the freshest server-confirmed values while `draft.actions` may run ahead of
 * the server, so it is the only source that sees both an imported base bind
 * and an assignment made two clicks ago.
 */
export function findSlotCollision(
  profile: ConfigProfile,
  key: string,
  ignore?: BindCollisionIgnore,
): SlotCollision | null {
  const collision = findBindCollision(profile, key, ignore)
  if (!collision) return null
  return { collision, owner: ownerLabel(profile, collision) }
}

export interface ReplaceInput {
  /** The full draft actions array, same one `applySlot` is given elsewhere. */
  actions: ConfigAction[]
  /** `draft.binds` - only read, never returned (see the doc comment below). */
  binds: Record<string, string>
  collision: BindCollision
  /** The entry being assigned. Story 052 D8: an id, not a `CatalogRow` - a catalogue row is an
   * ordinary entry now, so there is one Replace path instead of a catalogue and a plain one. */
  actionId: string
  /** Which of the entry's key slots the capture was for - story 056: an index into the compacted
   * slot list `deriveRowState` renders, the same one `applySlot` writes against. */
  slotIndex: number
  key: string
}

/**
 * The whole Replace path (decision 13): the previous owner loses the key and
 * the new slot gets it, as **one** actions array that goes through **one**
 * `updateProfileActions` save. That single-call shape is the point of this
 * function and the reason it is not inlined per call site:
 *
 * - `releaseKey`'s `binds` return value is deliberately discarded. `setActions`
 *   (main) rebuilds the entire `q2l_a_*` bind mirror from `actions` on every
 *   call and lets an action's key overwrite a same-key hand-written bind, so
 *   the `baseBind` case needs nothing beyond submitting the new key, and the
 *   `action` case needs nothing beyond the cleared slot below.
 * - The previous owner's slot is therefore actually cleared in the array
 *   (`releaseKey`), not left to `setActions`' "later action in the array wins"
 *   tie-break. Relying on array order would look right until a reload, at
 *   which point whichever owner happened to sort later would keep the key.
 * - Because both mutations are in one array, there is no window in which the
 *   profile is half-applied. Splitting this into an `updateProfileActions` plus
 *   an `updateProfileBinds` call (or into two action saves) would reintroduce
 *   exactly that window - please do not "simplify" it that way.
 *
 * Story 052 D8: the previous owner is released and *kept*. It used to be pruned when losing the
 * key left a catalogue-materialised action with nothing assigned (decision 4) - the mirror image of
 * the lazy creation this story removes. A row is one of `profile.actions` now, so deleting the
 * entry would delete the row from the Controls tab: the user would take a key away from "Drop
 * shotgun" and watch that row disappear. An entry with nothing assigned is an unbound row, a shape
 * both the profile and the file (D2/D3's unbound line) carry.
 */
export function applyReplace({
  actions,
  binds,
  collision,
  actionId,
  slotIndex,
  key,
}: ReplaceInput): ConfigAction[] {
  const released = releaseKey(actions, binds, collision).actions
  return applySlot(released, actionId, slotIndex, key)
}

/** What a modifier capture is about to overwrite, if anything (story 016 D4/D10, AC 6). */
export interface ModifierSlotCollision {
  modifier: ModifierTrigger
  key: string
  layerId: string
  /** Shown as "the layer" in the confirm banner. */
  layerName: string
  /**
   * Shown as "the thing that already has this override": another action's `name` when one of that
   * action's key slots occupies `(modifier, key)` with its own `modifier` (mirroring
   * `ownerLabel`'s `'action'` case above), or the raw command text when a hand-made override
   * occupies it instead (mirroring `ownerLabel`'s `baseBind` case - a hand-written override
   * carries no action id to resolve a friendlier name from).
   */
  owner: string
  /**
   * Set only when `owner` names an action (never for a hand-made override) - which action, and
   * which of its key slots (story 050: any index, not just 0/1 - see the file's `findModifierSlotCollision`
   * doc comment), a Replace has to clear before writing the new one (`applyModifierReplace`).
   */
  actionId?: string
  actionSlot?: BindSlot
}

/**
 * Would capturing `(modifier, key)` for the row currently being edited (`ignoreActionId` - always
 * a real entry id since story 052 D8, though the parameter stays optional for callers with no row
 * of their own to exclude) replace a *different* assignment already sitting there?
 *
 * Story 016 D10: reads `actions` directly rather than the layer's stored override text, because
 * the actions array is what actually decides who owns a `(modifier, key)` pair since D7's
 * `applyActionLayerMirror` - a layer's `overrides` map is only ever a generated mirror of it, one
 * `setActions`/`setLayers` call behind. Naming the occupant from `layer.overrides` (this
 * function's original D4 shape) could therefore only ever show the raw alias token
 * (`q2l_a_...`) the mirror wrote, never a friendly action name.
 *
 * `null` when nothing at `(modifier, key)` is occupied, by another action or by a hand-made
 * override.
 *
 * Checked in this order: another action's slot first (the common case now that a modifier
 * binding lives on the action itself, D6-D9), then a hand-made override - a value at `key` that
 * `applyActionLayerMirror` never wrote (`isMirroredValue`, story 034: recognised by value against
 * every action, since a continuous catalogue row mirrors as its own `+command` rather than as an
 * alias token). The row's own current occupancy of `(modifier, key)`, if any, shows up as case one
 * (an action match) whenever it is not the ignored row itself; for the ignored row the value check
 * is what keeps its own mirror from being reported as a hand-made override.
 *
 * The action scan (case one) runs regardless of whether `modifier`'s layer object exists yet in
 * `layers` - `actions` is the authority on occupancy since D7's mirror, one save ahead of
 * `layers` catching up, so gating this on the layer already existing would miss a real collision
 * in the narrow window between two actions independently claiming the same combo before either
 * save's mirror pass has run. Only the hand-made-override fallback (case two) genuinely needs the
 * layer object, since a hand-made override has nowhere else to live; `layerName` for case one
 * falls back to the name a fresh layer would get (`MODIFIER_LAYER_NAME`) when no layer object
 * exists yet - purely cosmetic, since the confirm banner only ever reads `layerName`.
 *
 * `layers` should be the in-progress draft's layers, same freshness requirement `findSlotCollision`
 * documents for `profile`.
 *
 * Story 050: every key slot of a candidate action is checked (`actionKeySlots`), not just the two
 * the Controls tab edits - a hand-added third slot must be found and released exactly like slot 0
 * or 1 would be, even though nothing in the UI can ever *create* a third slot itself.
 */
export function findModifierSlotCollision(
  actions: ConfigAction[],
  layers: AltLayer[],
  modifier: ModifierTrigger,
  key: string,
  ignoreActionId?: string,
): ModifierSlotCollision | null {
  const normalizedKey = normalizeBindKey(key)
  const layer = layers.find((candidate) => normalizeBindKey(candidate.triggerKey ?? '') === modifier)
  const layerId = layer?.id ?? ''
  const layerName = layer?.name ?? MODIFIER_LAYER_NAME[modifier]

  for (const action of actions) {
    if (action.id === ignoreActionId) continue
    // An alias entry is never bound (story 019) - skip it even if it still carries stale
    // key/modifier data from before it became an alias (review fix, Finding 4).
    if (action.kind === 'alias') continue
    const slots = actionKeySlots(action)
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex]!
      if (slot.modifier === modifier && slot.key && normalizeBindKey(slot.key) === normalizedKey) {
        return {
          modifier,
          key,
          layerId,
          layerName,
          owner: action.name,
          actionId: action.id,
          actionSlot: slotIndex,
        }
      }
    }
  }

  const rawOverride = layer?.overrides[normalizedKey]
  if (rawOverride && !isMirroredValue(rawOverride, actions, key)) {
    return { modifier, key, layerId, layerName, owner: rawOverride }
  }

  return null
}

export interface ModifierReplaceInput {
  /** The full draft actions array, same one `applySlot` is given elsewhere. */
  actions: ConfigAction[]
  /** The entry being assigned - an id, not a `CatalogRow` (story 052 D8, see `ReplaceInput`). */
  actionId: string
  /**
   * `findModifierSlotCollision`'s result for this exact `(modifier, key)`, or `null` when
   * nothing occupies it. Deliberately accepted as `null` (rather than requiring the caller to
   * branch) so `onAssignModifier` - the single call site that handles both the immediate-assign
   * path and the confirmed-Replace path, since `BindSlot`'s Replace button calls it with the same
   * `{modifier, key}` shape as the collision-free path - can always route through this function
   * without knowing which path it is on; it is a plain `applySlot` passthrough when `null`.
   */
  collision: ModifierSlotCollision | null
  /** Which of the entry's key slots the capture was for - see `ReplaceInput.slotIndex`. */
  slotIndex: number
  key: string
  modifier: ModifierTrigger
}

/**
 * `applySlot`'s modifier-aware counterpart to `applyReplace`: writing the new `(modifier, key)`
 * for `row`'s `slot` and, if `collision` names a *different* action already occupying that same
 * pair, releasing that action's matching slot first - both in the one array this function
 * returns, so one save has no split-brain window (same invariant `applyReplace`'s doc comment
 * spells out for the base-layer case; see it before changing this wiring).
 *
 * Without this release step, confirming Replace over an action B that currently holds
 * `(ALT, R)` would leave the B slot that holds it (whichever index of `B.keys` that is) stale:
 * `applySlot` only ever touches the row being edited, so B would still claim `(ALT, R)`
 * after the save, and `applyActionLayerMirror`'s "later action in the array wins" tie-break would
 * silently decide whose alias the override actually points at - correct immediately after this
 * save, wrong (or at least undiscoverable without a reload) the moment array order changes, and
 * B's own row would keep showing `Alt+R` in the UI even though the override no longer honours it.
 *
 * A hand-made override (`collision.actionId` unset) needs no release: there is nothing on the
 * actions side to clear, and `applyActionLayerMirror` overwrites that raw value with the new
 * alias on the very next mirror pass regardless.
 *
 * Story 052 D8: the released occupant is kept, never pruned - same reasoning `applyReplace`'s doc
 * comment spells out (a pruned entry is a row that vanishes from the Controls tab).
 */
export function applyModifierReplace({
  actions,
  collision,
  actionId,
  slotIndex,
  key,
  modifier,
}: ModifierReplaceInput): ConfigAction[] {
  if (!collision?.actionId) return applySlot(actions, actionId, slotIndex, key, modifier)

  // Blanks the exact slot `findModifierSlotCollision` named (`{ key: '' }` via `withKeySlot`, never
  // `clearKeySlot`), and story 056 deliberately keeps it that way even though a user-initiated
  // clear now compacts:
  //
  // - `collision.actionSlot` is a *raw* `action.keys` index (the scan above walks the array), not
  //   the compacted index the Controls tab passes as `slotIndex`. Removing at a raw index is the
  //   one operation here that could shift a slot the scan had already accounted for.
  // - This is the same "release so something else can take the key" step as the shared
  //   `releaseKey` (`applyReplace`'s path, `@shared/config/bind-collision`), which blanks in place
  //   and cannot be changed from here (`src/shared/**` is out of this story's scope). Compacting in
  //   one of the two release paths and not the other is exactly the split that story 050's review
  //   finding 5 was about.
  //
  // The released row is still correct: `deriveRowState` filters an empty-key slot out, so it never
  // renders as a phantom key, and `applySlot`/`appendKeySlot` drop it on that row's next write.
  const released = actions.map((action) => {
    if (action.id !== collision.actionId) return action
    return withKeySlot(action, collision.actionSlot!, { key: '' })
  })

  return applySlot(released, actionId, slotIndex, key, modifier)
}
