/**
 * Key-collision detection and release for the dual-bind editor (story 015).
 *
 * The editor lets a capture land on any key, but a key can already be spoken
 * for in three different, independent places:
 *
 * - the base layer's `profile.binds` map (a hand-written or imported bind),
 * - another action's `key`/`secondaryKey` slot (the alias that
 *   `renderActionAlias`/`setActions` bind that key to),
 * - an alt-layer's `overrides` map (a key that only does something while
 *   that layer is active — see `alt-layers.ts`).
 *
 * The first two are the *base* level (decision 13): a real conflict, blocking
 * until the user picks Cancel or Replace (that dialog is D7, not here).
 * The third is the *layer* level (decision 14): layers legitimately coexist
 * with the base bind they temporarily override, so it is a non-blocking
 * warning and never something `releaseKey` acts on.
 *
 * `setActions` (`src/main/modules/config/profiles.ts`) mirrors every action's
 * `key`/`secondaryKey` onto `profile.binds[normalizeBindKey(key)] =
 * aliasNameFor(action)`. That mirror means an action's own current key always
 * shows up in `profile.binds` too — without accounting for that, re-capturing
 * a slot to the key it already holds would collide with itself. The `ignore`
 * parameter and the `aliasNameFor` comparison below exist solely to make that
 * self-reassignment a no-op instead of a false positive.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*`, no DOM,
 * no electron — same rule `alt-layers.ts` follows, mirrored here.
 */

import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { aliasNameFor } from '@shared/config/alias-render'
import { normalizeBindKey } from '@shared/config/key-names'

/** Which of an action's two bindable slots a key was found in, or is being captured for. */
export type BindSlot = 'primary' | 'secondary'

/**
 * The action/slot currently being (re-)captured. When it names the exact
 * owner of a match, that match is not a collision — see the file doc comment.
 */
export interface BindCollisionIgnore {
  actionId: string
  slot: BindSlot
}

export type BindCollision =
  | { kind: 'baseBind'; key: string; command: string }
  | { kind: 'action'; key: string; actionId: string; name: string; slot: BindSlot }
  | { kind: 'layerOverride'; key: string; layerId: string; command: string }

/**
 * A slot's key, but only when it is actually a base-layer claim. Story 016: a slot that carries a
 * `keyModifier`/`secondaryKeyModifier` is never mirrored onto `profile.binds` at all (AC 4) - its
 * key lives only inside that modifier's layer override - so such a slot must be invisible here,
 * exactly as invisible as it is to the real base-bind mirror `setActions` writes. Without this
 * check, an action on `Alt+R` would falsely appear to own the *plain* key `r`, blocking (and, via
 * `releaseKey`, destroying) a legitimate plain-`r` capture on a different action.
 */
function slotValue(action: ConfigAction, slot: BindSlot): string | undefined {
  const modifier = slot === 'primary' ? action.keyModifier : action.secondaryKeyModifier
  if (modifier) return undefined
  return slot === 'primary' ? action.key : action.secondaryKey
}

/** The command bound to `normalizedKey` in `binds`, matched by normalized key. */
function commandForNormalizedKey(
  binds: Record<string, string>,
  normalizedKey: string,
): string | undefined {
  for (const [rawKey, command] of Object.entries(binds)) {
    if (normalizeBindKey(rawKey) === normalizedKey) return command
  }
  return undefined
}

/**
 * New `binds` with the entry for `normalizedKey` removed, matched by
 * normalized key rather than direct index — same reasoning as the lookup
 * side: a stored key can be spelled differently (`f9` vs `F9`) and must still
 * be found.
 */
function withoutNormalizedKey(
  binds: Record<string, string>,
  normalizedKey: string,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [rawKey, command] of Object.entries(binds)) {
    if (normalizeBindKey(rawKey) !== normalizedKey) next[rawKey] = command
  }
  return next
}

/**
 * Find what, if anything, already owns `key` in `profile`. Checks base binds,
 * then other actions' slots, then layer overrides — the order the story's
 * two-tier model implies: base-level conflicts (which block) are found before
 * the layer-level one (which does not).
 *
 * `key` is normalized before any comparison (`normalizeBindKey`, the same
 * convention `setActions` uses), so `f9` and `F9` are recognized as the same
 * key regardless of how the caller or the stored data spelled it.
 *
 * `ignore` names the action/slot being re-captured, so that action's own
 * existing claim on `key` — whether as another slot's value or as the
 * `profile.binds` mirror `setActions` writes for it — is not reported as a
 * collision against itself.
 *
 * Returns `null` when nothing collides.
 */
export function findBindCollision(
  profile: ConfigProfile,
  key: string,
  ignore?: BindCollisionIgnore,
): BindCollision | null {
  const normalizedKey = normalizeBindKey(key)
  const actions = profile.actions ?? []
  const ignoredAction = ignore ? actions.find((action) => action.id === ignore.actionId) : undefined

  // 1. Another action's slot — checked *before* base binds (review finding,
  // story 015 D7: an action's own key is mirrored into `profile.binds` by
  // `setActions`, so if the base-bind check ran first it would catch that
  // mirror and report the collision as `baseBind` with the alias name as the
  // "command" - naming the wrong owner, and worse, `releaseKey`'s `baseBind`
  // case only drops the stale `binds` entry rather than clearing the actual
  // owning action's slot. Since `setActions` rebuilds the whole bind mirror
  // from `actions` on every save, that action would simply reclaim the key on
  // the very next save - correct until reload, wrong after. Checking actions
  // first means any key another action already holds is always reported as
  // `kind: 'action'`, which `releaseKey` clears correctly.
  //
  // Only the exact ignored action+slot is excluded — a different slot on the
  // very same action (an edge case: both slots pointing at one key) still
  // counts, since it was not the slot named by `ignore`.
  for (const action of actions) {
    for (const slot of ['primary', 'secondary'] as const) {
      if (ignore && ignore.actionId === action.id && ignore.slot === slot) continue
      const raw = slotValue(action, slot)
      if (!raw) continue
      if (normalizeBindKey(raw) === normalizedKey) {
        return { kind: 'action', key: normalizedKey, actionId: action.id, name: action.name, slot }
      }
    }
  }

  // 2. Base bind. By construction, if this loop finds anything, no action's
  // key/secondaryKey matched above - so the only way this entry could still
  // be an action's alias mirror is the ignored action's own (the one slot
  // deliberately excluded from the loop above). That is not a real collision
  // either, since it is exactly the key the caller is re-capturing to.
  for (const [rawKey, command] of Object.entries(profile.binds)) {
    if (!command) continue
    if (normalizeBindKey(rawKey) !== normalizedKey) continue
    const isOwnMirror = ignoredAction !== undefined && command === aliasNameFor(ignoredAction)
    if (!isOwnMirror) {
      return { kind: 'baseBind', key: normalizedKey, command }
    }
    break
  }

  // 3. Layer override — non-blocking (decision 14), so checked last.
  for (const layer of profile.layers ?? []) {
    for (const [rawKey, command] of Object.entries(layer.overrides)) {
      if (!command) continue
      if (normalizeBindKey(rawKey) === normalizedKey) {
        return { kind: 'layerOverride', key: normalizedKey, layerId: layer.id, command }
      }
    }
  }

  return null
}

/**
 * Clean up whatever `collision` identified as already owning a key, so the
 * capture that found it can proceed. Never mutates `actions` or `binds`.
 *
 * - `baseBind`: the offending entry is removed from `binds`. `actions` is
 *   returned unchanged — a base bind is never an action's slot.
 * - `action`: the offending action's matching slot (`key` or `secondaryKey`)
 *   is cleared. The same key is also dropped from `binds` if it still points
 *   at that action's own alias — `setActions` would otherwise be the only
 *   thing that eventually cleans up that stale mirror, and doing it here too
 *   keeps `actions` and `binds` consistent with each other immediately after
 *   one `releaseKey` call, which is what a caller checking either map right
 *   away needs. (The full persistence round-trip through `setActions` is
 *   D1's job, not this function's — this is just keeping the two in-memory
 *   maps from disagreeing in the meantime.)
 * - `layerOverride`: both maps are returned unchanged — decision 14 makes
 *   this a non-blocking warning, not something to act on, and layer writes
 *   go through a different IPC channel this story does not touch here.
 */
export function releaseKey(
  actions: ConfigAction[],
  binds: Record<string, string>,
  collision: BindCollision,
): { actions: ConfigAction[]; binds: Record<string, string> } {
  if (collision.kind === 'layerOverride') return { actions, binds }

  if (collision.kind === 'baseBind') {
    return { actions, binds: withoutNormalizedKey(binds, collision.key) }
  }

  const released = actions.find((action) => action.id === collision.actionId)
  const nextActions = actions.map((action) => {
    if (action.id !== collision.actionId) return action
    // Story 016: a slot's modifier is never left behind on its own - `slotValue` above already
    // keeps this branch from ever firing on a slot that actually carries one today, but clearing
    // both fields together (never just the key) keeps that invariant true regardless of how this
    // branch is reached, matching `applyModifierReplace`'s identical release step.
    return collision.slot === 'primary'
      ? { ...action, key: undefined, keyModifier: undefined }
      : { ...action, secondaryKey: undefined, secondaryKeyModifier: undefined }
  })

  const mirroredCommand = released ? commandForNormalizedKey(binds, collision.key) : undefined
  const nextBinds =
    released && mirroredCommand === aliasNameFor(released)
      ? withoutNormalizedKey(binds, collision.key)
      : binds

  return { actions: nextActions, binds: nextBinds }
}
