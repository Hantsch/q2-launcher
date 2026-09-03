/**
 * Arbitrary key slots on a `ConfigAction` (story 050).
 *
 * Story 015 gave a bind two fixed slots (`key`/`secondaryKey`, each with its own modifier field);
 * story 050 removes the cap and replaces the four fixed fields with one array,
 * `ConfigAction.keys?: readonly ActionKeySlot[]`. Slot identity comes from the order entries appear
 * in that array, not from a stable id or field name - the same way a slot's identity in the
 * rendered `.cfg` comes from the order `bind`/layer-override lines appear in the file rather than
 * from a field. This module is the single access point for that array: nothing else in the
 * codebase reads or writes `action.keys` directly, the same discipline `press-release.ts` applies
 * to pairing `+x`/`-x` actions by `name`.
 *
 * All five functions are pure and treat `ConfigAction` as immutable - `withKeySlot`/`clearKeySlot`
 * return a new action with a new `keys` array rather than mutating the one handed in, so a caller
 * holding the original action (e.g. mid-render) never sees it change under it.
 */

import type { ActionKeySlot, ConfigAction } from '@shared/modules/config'

/** Every key slot on `action`, in slot order. `[]` (never `undefined`) when the action has none,
 * so callers can iterate without a null check. */
export function actionKeySlots(action: ConfigAction): readonly ActionKeySlot[] {
  return action.keys ?? []
}

/** The slot at `index`, or `undefined` if `action` has no such slot (including every index when
 * the action has no `keys` at all). */
export function keySlotAt(action: ConfigAction, index: number): ActionKeySlot | undefined {
  return action.keys?.[index]
}

/** How many key slots `action` currently has - `0` for an action with no `keys` field. */
export function keySlotCount(action: ConfigAction): number {
  return action.keys?.length ?? 0
}

/**
 * Returns a new action with `slot` set at `index`.
 *
 * `index` may name an existing slot (replaced in place), the next free index - i.e. `keySlotCount
 * (action)` - to append a new slot, or anything further out; a gap between the current end and
 * `index` is padded with slots holding an empty `key` (`{ key: '' }`) rather than left as a hole,
 * so `keys[i]` is always a real `ActionKeySlot` for every `i < keys.length` and callers never have
 * to guard against `undefined` holes. In practice every caller either replaces an existing index
 * or appends at `keySlotCount(action)`, so padding is only ever a defensive fallback.
 */
export function withKeySlot(action: ConfigAction, index: number, slot: ActionKeySlot): ConfigAction {
  if (index < 0) throw new RangeError(`withKeySlot: negative index ${index}`)

  const current = actionKeySlots(action)
  const next = current.slice()
  while (next.length < index) {
    next.push({ key: '' })
  }
  next[index] = slot

  return { ...action, keys: next }
}

/**
 * Returns a new action with the slot at `index` removed.
 *
 * Removing shifts every later slot down by one rather than blanking the slot in place: slot
 * identity comes from array order, not from a stable index (see this module's doc comment), so
 * there is no per-slot identity a "leave a hole" removal would need to preserve, and shrinking the
 * array keeps `keySlotCount` an accurate count of real slots with no trailing empties to filter
 * out later (in the file, in the UI, or at render time). Removing the last slot therefore also
 * shrinks the array to its natural length; if that empties it entirely, `keys` is dropped from the
 * result rather than kept as `[]`, matching `actionKeySlots`' "absent means none" reading.
 *
 * Out-of-range `index` (including on an action with no `keys` at all) is a no-op: `action` is
 * returned unchanged.
 */
export function clearKeySlot(action: ConfigAction, index: number): ConfigAction {
  const current = actionKeySlots(action)
  if (index < 0 || index >= current.length) return action

  const next = current.slice()
  next.splice(index, 1)

  if (next.length === 0) {
    const { keys: _keys, ...rest } = action
    return rest
  }

  return { ...action, keys: next }
}
