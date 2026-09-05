import type { ConfigAction } from '@shared/modules/config'
import type { ControlsRowGroup } from './controls-row-groups'

/**
 * Story 019 D3: order is array position, not an explicit `order` field
 * (Decisions (Sprint)). Reordering therefore means swapping two elements of
 * the one flat `actions` array, mirroring `ActionEditor.tsx`'s `moveCommand`
 * idiom (splice-out, splice-in).
 *
 * Story 052 review (finding 4): which two elements is no longer derived here.
 * This used to be `moveEntryWithinCategory(actions, id, direction)`, which
 * walked the array for the nearest entry sharing the moved one's `categoryId`
 * - but the grid does not render a category as one flat run any more. It
 * renders `groupControlsRowEntries`' catalogue groups (`controls-row-groups.ts`),
 * which re-bucket a category's entries by their `catalogId` prefix, so
 * "nearest same-category entry" could very well be a row rendered inside a
 * *different* group: the swap happened, the profile went dirty, and nothing
 * the user could see moved. The neighbour is therefore picked from the rendered
 * groups (`buildMoveTargets` below) and handed to this function by id, so the
 * pair that swaps in the array is exactly the pair that swaps on screen.
 *
 * Pure: returns a new array, never mutates `actions`, matching every other
 * helper in this `lib/` directory. Returns the original array when either id is
 * missing, so a stale target can never corrupt the order.
 */
export function swapEntries(
  actions: ConfigAction[],
  id: string,
  targetId: string,
): ConfigAction[] {
  if (id === targetId) return actions
  const index = actions.findIndex((action) => action.id === id)
  const targetIndex = actions.findIndex((action) => action.id === targetId)
  if (index === -1 || targetIndex === -1) return actions

  const next = [...actions]
  const moved = next[index]!
  next[index] = next[targetIndex]!
  next[targetIndex] = moved
  return next
}

/** Which entry a row's move-up / move-down button swaps with, or `undefined` when that row is
 * already first / last in the group it is rendered in - the state its button is disabled on. */
export interface EntryMoveTarget {
  up?: string
  down?: string
}

/**
 * The move target per row, read off the grid's *rendered* structure (story 052 review, finding 4).
 *
 * `groups` is what `ControlsGrid` actually draws: one category's entries, filtered, bucketed into
 * catalogue groups, each group keeping its entries' relative order. Taking both the neighbour and
 * the enabled/disabled state from that one source is what makes a move visible by construction -
 * two entries of the same group swap their array positions, so they swap places within that group
 * (entries of other groups sitting between them in the array do not move, and neither does any
 * group's first-seen position, so the group order on screen is untouched).
 *
 * A row that is alone in its group therefore has neither target and both buttons disabled: within
 * the grouping the grid shows, there is nowhere for it to go. That is a real limit of a
 * catalogue-derived grouping over a flat entry list, not a silent failure - story 053 turns these
 * groups into real sub-categories, at which point a row can be moved across one.
 */
export function buildMoveTargets(
  groups: readonly ControlsRowGroup[],
): ReadonlyMap<string, EntryMoveTarget> {
  const targets = new Map<string, EntryMoveTarget>()
  for (const group of groups) {
    group.entries.forEach((entry, index) => {
      targets.set(entry.action.id, {
        up: group.entries[index - 1]?.action.id,
        down: group.entries[index + 1]?.action.id,
      })
    })
  }
  return targets
}
