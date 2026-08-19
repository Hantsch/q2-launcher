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
} from '@shared/config/bind-collision'
import { findModifierOverrideOwner, type ModifierTrigger } from '@shared/config/modifier-layers'
import type { AltLayer } from '@shared/config/alt-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { applySlot, type CatalogRow } from './catalog-binds'

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

/**
 * Mirrors `catalog-binds.ts`'s own (non-exported) `isEmptyAction` rule
 * (decision 4): a catalogue row's action with no key in either slot and no
 * non-empty team message is "nothing assigned" and must not be persisted -
 * its `drop`/`+move` commands can never fire, so it would only add a dead
 * alias to the generated file.
 *
 * Gated on `catalogId` on purpose: a pre-015 free-form action ("Other
 * actions", decision 5) that loses its key must stay in the list. The user
 * created it by hand and can re-bind it; deleting it would be data loss.
 */
function isEmptyCatalogAction(action: ConfigAction): boolean {
  if (!action.catalogId) return false
  const hasKey = Boolean(action.key?.trim())
  const hasSecondary = Boolean(action.secondaryKey?.trim())
  const hasMessage = action.commands.some(
    (command) =>
      command.kind === 'message' &&
      command.channel === 'say_team' &&
      command.text.trim().length > 0,
  )
  return !hasKey && !hasSecondary && !hasMessage
}

export interface ReplaceInput {
  /** The full draft actions array, same one `applySlot` is given elsewhere. */
  actions: ConfigAction[]
  /** `draft.binds` - only read, never returned (see the doc comment below). */
  binds: Record<string, string>
  collision: BindCollision
  row: CatalogRow
  slot: 'primary' | 'secondary'
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
 * The trailing prune handles the owner that just became empty: `releaseKey` is
 * shared and pure and knows nothing about catalogue rows, so it cannot apply
 * decision 4's rule itself. Running it after `applySlot` means an owner that is
 * the very action being re-assigned (both slots of one row on one key) is
 * already non-empty again and is correctly left alone.
 */
export function applyReplace({
  actions,
  binds,
  collision,
  row,
  slot,
  key,
}: ReplaceInput): ConfigAction[] {
  const released = releaseKey(actions, binds, collision).actions
  const applied = applySlot(released, row, slot, key)
  if (collision.kind !== 'action') return applied
  return applied.filter(
    (action) => !(action.id === collision.actionId && isEmptyCatalogAction(action)),
  )
}

/** What a modifier capture is about to overwrite, if anything (story 016 D4, AC 6). */
export interface ModifierSlotCollision {
  modifier: ModifierTrigger
  key: string
  layerId: string
  /** Shown as "the layer" in the confirm banner. */
  layerName: string
  /** Shown as "the occupying action" - the raw command the override currently holds,
   * same convention `ownerLabel`'s `baseBind` case uses (the command text itself, since a
   * layer override carries no action id to resolve a friendlier name from). */
  owner: string
}

/**
 * Would writing `command` to `(modifier, key)` replace a *different*
 * assignment already sitting there? `null` when the override is empty, or
 * when it already holds this exact command (re-capturing the same row's own
 * combo is a no-op, not a collision).
 *
 * `layers` should be the in-progress draft's layers, same freshness
 * requirement `findSlotCollision` documents for `profile`.
 */
export function findModifierSlotCollision(
  layers: AltLayer[],
  modifier: ModifierTrigger,
  key: string,
  command: string,
): ModifierSlotCollision | null {
  const found = findModifierOverrideOwner(layers, modifier, key)
  if (!found || found.command === command) return null
  return {
    modifier,
    key,
    layerId: found.layerId,
    layerName: found.layerName,
    owner: found.command,
  }
}
