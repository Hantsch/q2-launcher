import type { ConfigAction, ConfigActionCategory } from '@shared/modules/config'
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
export function swapEntries(actions: ConfigAction[], id: string, targetId: string): ConfigAction[] {
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

/**
 * Story 054 D2: where a dragged/moved entry lands - immediately before another entry named by
 * id, or at the end of whatever list it is being moved within/into. `string | 'end'` rather than
 * `string | undefined` so "append" is a value the caller states, not the absence of one (an
 * unrecognised id is a no-op below, which would otherwise be indistinguishable from "append").
 */
export type MoveTargetPosition = string | 'end'

/** Index of `target` within `list`, or `list.length` for `'end'`; `undefined` when `target`
 * names an id `list` does not contain, so a stale drop target is a no-op rather than a silent
 * append. */
function resolveInsertIndex(
  list: readonly { id: string }[],
  target: MoveTargetPosition,
): number | undefined {
  if (target === 'end') return list.length
  const index = list.findIndex((item) => item.id === target)
  return index === -1 ? undefined : index
}

/**
 * Story 054 D2: move `id` to sit immediately before `target` (or to the end), within the same
 * `actions` array - no `categoryId`/`subcategoryId` change. Mirrors `swapEntries`'s pure,
 * no-op-on-unknown-id contract: an unknown `id` or a `target` that names nothing in the array
 * (after `id` is removed - so "before itself" also resolves to unknown) returns the original
 * array unchanged.
 */
export function moveEntryToPosition(
  actions: ConfigAction[],
  id: string,
  target: MoveTargetPosition,
): ConfigAction[] {
  const index = actions.findIndex((action) => action.id === id)
  if (index === -1) return actions

  const without = actions.filter((action) => action.id !== id)
  const insertAt = resolveInsertIndex(without, target)
  if (insertAt === undefined) return actions

  const moved = actions[index]!
  const next = [...without]
  next.splice(insertAt, 0, moved)
  return next
}

/**
 * Story 054 D2: move `id` into a different sub-category of the same category (or the ungrouped
 * bucket, when the caller passes a `targetSubcategoryId` that matches nothing - same "no id is
 * special" rule the model already gives `subcategoryId`), landing before `target` or at the end.
 * No-op on an unknown `id` or an unresolvable `target`, same as `moveEntryToPosition`.
 *
 * Story 054 D4: `undefined` is the explicit "the ungrouped run" target and *removes* the entry's
 * `subcategoryId` rather than storing a value that matches nothing - a row dropped above the first
 * sub-category header has to become genuinely ungrouped, the way `moveEntryToCategory` already
 * drops the field when an entry leaves its category. Storing `''` instead would render identically
 * today but leave a dangling id in the profile and in the rendered file's `[q2l sub=…]` bookkeeping.
 */
export function moveEntryToSubcategory(
  actions: ConfigAction[],
  id: string,
  targetSubcategoryId: string | undefined,
  target: MoveTargetPosition,
): ConfigAction[] {
  const index = actions.findIndex((action) => action.id === id)
  if (index === -1) return actions

  const without = actions.filter((action) => action.id !== id)
  const insertAt = resolveInsertIndex(without, target)
  if (insertAt === undefined) return actions

  const { subcategoryId: _previousSubcategoryId, ...rest } = actions[index]!
  const moved: ConfigAction =
    targetSubcategoryId === undefined ? rest : { ...rest, subcategoryId: targetSubcategoryId }
  const next = [...without]
  next.splice(insertAt, 0, moved)
  return next
}

/**
 * Story 054 D4: where a dragged Controls row was dropped, in the grid's own terms - which row it
 * landed in front of, and which sub-category run it landed in. Produced by `ControlsGrid` (the only
 * place that knows the rendered grouping) and applied here, so the index math stays in this pure,
 * tested module instead of being spelled out again inside a drag handler.
 */
export interface EntryDropTarget {
  /** The dragged entry's action id. */
  id: string
  /** The sub-category run it was dragged out of - `undefined` for the ungrouped run. */
  fromSubcategoryId: string | undefined
  /** The sub-category run it was dropped into - `undefined` for the ungrouped run. */
  toSubcategoryId: string | undefined
  /** The entry it lands immediately before, or `'end'` to append.
   *
   * `'end'` appends to the end of the whole `actions` array, which is exactly "last row of its
   * sub-category" on screen and in the rendered file: both the grid (`groupControlsRowEntries`) and
   * the writer (`render.ts`'s `groupByCategory`/`withSubcategoryBuckets`) bucket by category and
   * then by sub-category while keeping each bucket's members in array order, so an entry that is
   * last in the array is last in whatever bucket it belongs to. */
  before: MoveTargetPosition
}

/**
 * Applies one drop: a position change inside the same sub-category run, or a position change that
 * also re-homes the entry into a sibling run. Pure; returns the original array unchanged when
 * nothing resolves (unknown ids), so a stale drop target can never corrupt the order.
 */
export function moveEntryToDropTarget(
  actions: ConfigAction[],
  drop: EntryDropTarget,
): ConfigAction[] {
  return drop.fromSubcategoryId === drop.toSubcategoryId
    ? moveEntryToPosition(actions, drop.id, drop.before)
    : moveEntryToSubcategory(actions, drop.id, drop.toSubcategoryId, drop.before)
}

/**
 * Story 054 D2: move `id` to a different top-level category, appended at the end of that
 * category's run in the array. The entry's old `subcategoryId` (if any) belonged to its old
 * category, so it is dropped rather than carried over as a value the new category may not even
 * recognise - the moved entry lands ungrouped in its new category, same as a freshly created one
 * would. No-op on an unknown `id`.
 */
export function moveEntryToCategory(
  actions: ConfigAction[],
  id: string,
  categoryId: string,
): ConfigAction[] {
  const index = actions.findIndex((action) => action.id === id)
  if (index === -1) return actions

  const without = actions.filter((action) => action.id !== id)
  const { subcategoryId: _droppedSubcategoryId, ...rest } = actions[index]!
  const moved: ConfigAction = { ...rest, categoryId }

  let lastIndexOfCategory = -1
  without.forEach((action, i) => {
    if (action.categoryId === categoryId) lastIndexOfCategory = i
  })
  const insertAt = lastIndexOfCategory === -1 ? without.length : lastIndexOfCategory + 1

  const next = [...without]
  next.splice(insertAt, 0, moved)
  return next
}

/** Reorders `list` so the item named `id` sits at `toIndex` (clamped to the list's bounds once
 * that item is removed), leaving every other item's relative order untouched. Shared by
 * `moveCategory` and `moveSubcategory` - both are "reorder a flat id-keyed array by index", the
 * only difference being which array. No-op on an unknown `id`. */
function moveByIndex<T extends { id: string }>(list: T[], id: string, toIndex: number): T[] {
  const index = list.findIndex((item) => item.id === id)
  if (index === -1) return list

  const without = list.filter((item) => item.id !== id)
  const moved = list[index]!
  const clampedIndex = Math.max(0, Math.min(toIndex, without.length))
  const next = [...without]
  next.splice(clampedIndex, 0, moved)
  return next
}

/** One selectable target for the row menu's "Move to…" picker (story 054 D8): a category's own
 * run, then each of its sub-categories, in profile order - mirrors `cvar-sections.ts`'s
 * `CvarPlacementOption`/`cvarPlacementOptions` almost verbatim, one level of nesting shallower. */
export interface EntryPlacementOption {
  categoryId: string
  subcategoryId?: string
  label: string
}

/**
 * Flattens `categories` into every placement a row can be moved to by picking one item: each
 * category, then each of its sub-categories (labelled "Category / Sub-category"), in the order the
 * rail and grid already render them. Pure and read-only - applying the pick is
 * `moveEntryToCategory`/`moveEntryToSubcategory`, composed by the caller.
 */
export function entryPlacementOptions(
  categories: readonly ConfigActionCategory[],
  categoryLabel: (category: ConfigActionCategory) => string,
): EntryPlacementOption[] {
  const options: EntryPlacementOption[] = []
  for (const category of categories) {
    const label = categoryLabel(category)
    options.push({ categoryId: category.id, label })
    for (const subcategory of category.subcategories ?? []) {
      options.push({
        categoryId: category.id,
        subcategoryId: subcategory.id,
        label: `${label} / ${subcategory.name}`,
      })
    }
  }
  return options
}

/**
 * Story 054 D2: reorder the top-level `categories` array by index (the category rail). No-op on
 * an unknown `id`.
 */
export function moveCategory(
  categories: ConfigActionCategory[],
  id: string,
  toIndex: number,
): ConfigActionCategory[] {
  return moveByIndex(categories, id, toIndex)
}

/**
 * Story 054 D2: reorder one category's `subcategories` array by index. Returns a new category
 * object (never mutates `category`); a category with no `subcategories` (or an unknown `id`) is
 * returned unchanged.
 */
export function moveSubcategory(
  category: ConfigActionCategory,
  id: string,
  toIndex: number,
): ConfigActionCategory {
  if (!category.subcategories) return category

  const next = moveByIndex(category.subcategories, id, toIndex)
  if (next === category.subcategories) return category
  return { ...category, subcategories: next }
}
