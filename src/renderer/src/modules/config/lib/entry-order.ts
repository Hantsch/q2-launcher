import type { ConfigAction } from '@shared/modules/config'

/**
 * Story 019 D3: order is array position, not an explicit `order` field
 * (Decisions (Sprint)). Reordering therefore means swapping two elements of
 * the one flat `actions` array, mirroring `ActionEditor.tsx`'s `moveCommand`
 * idiom (splice-out, splice-in) but scoped to entries sharing a category
 * rather than to a whole sub-list.
 *
 * "Nearest neighbour of the same category" is taken literally: this walks
 * the array from the moved entry's index in `direction`, skips every entry
 * whose `categoryId` differs, and swaps with the *first* one that matches -
 * whatever its distance. Two same-category entries end up exchanging array
 * positions, not necessarily becoming adjacent, and no foreign-category
 * entry between them ever moves. If no such neighbour exists (the entry is
 * already first/last within its category) or `id` is not found, the
 * original array is returned unchanged.
 *
 * Pure: returns a new array, never mutates `actions`, matching every other
 * helper in this `lib/` directory.
 */
export function moveEntryWithinCategory(
  actions: ConfigAction[],
  id: string,
  direction: 'up' | 'down',
): ConfigAction[] {
  const index = actions.findIndex((action) => action.id === id)
  if (index === -1) return actions

  const categoryId = actions[index]!.categoryId
  const step = direction === 'up' ? -1 : 1

  let neighbourIndex = index + step
  while (neighbourIndex >= 0 && neighbourIndex < actions.length) {
    if (actions[neighbourIndex]!.categoryId === categoryId) break
    neighbourIndex += step
  }
  if (neighbourIndex < 0 || neighbourIndex >= actions.length) return actions

  const next = [...actions]
  const moved = next[index]!
  next[index] = next[neighbourIndex]!
  next[neighbourIndex] = moved
  return next
}
