import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  closestCenter,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableZone, useSortableZoneState, type SortableDropMeta } from '../../../components/dnd'
import type { ControlsRowGroup } from '../lib/controls-row-groups'
import type { EntryDropTarget, MoveTargetPosition } from '../lib/entry-order'

/**
 * Story 054 D5: the one `DndContext` the whole Controls tab drags inside.
 *
 * D4 configured it inside `ControlsGrid`, which was enough while the only drop targets were the
 * grid's own rows. D5 makes the category rail's chips drop targets too, and there is exactly one
 * drag operation at a time - so there must be exactly one `DndContext`, spanning both the rail and
 * the grid. `SortableZone` renders no DOM of its own, so hoisting it here costs nothing structural:
 * `ControlsTab` wraps its rail *and* its grid in this component, `ControlsGrid` keeps rendering the
 * rows as `SortableItem`s and reads the live drag state through `useSortableZoneState()` instead of
 * a render callback.
 *
 * What a drop means stays split the way D4 already had it: this component turns one dnd-kit drop
 * into a profile-level *description* of the move (`EntryDropTarget`, or "onto that category"), and
 * `ControlsTab` applies it to `actions` with `lib/entry-order.ts`'s pure helpers and persists.
 */

/** How long the pointer has to rest on a foreign category chip before its grid is swapped in
 * underneath the drag (the story's "~600 ms"). Exported so a test can wait exactly this long
 * instead of hard-coding the same number twice. */
export const SPRING_LOAD_MS = 600

const CATEGORY_DROP_PREFIX = 'category-drop:'

/** The droppable id of a category chip. Namespaced so it can never collide with a row's droppable
 * id, which is a `ConfigAction.id`, and so `SortableZone` can tell "dropped on a chip" from
 * "dropped on a row" by the id alone. */
export function categoryDropId(categoryId: string): string {
  return `${CATEGORY_DROP_PREFIX}${categoryId}`
}

function categoryIdFromDropId(id: UniqueIdentifier): string | undefined {
  const value = String(id)
  return value.startsWith(CATEGORY_DROP_PREFIX)
    ? value.slice(CATEGORY_DROP_PREFIX.length)
    : undefined
}

const SUBCATEGORY_DRAG_PREFIX = 'subcategory-drag:'

/**
 * The sortable id of a sub-category header's drag handle (story 054 D6). Namespaced like
 * `categoryDropId` so it can never collide with a row's droppable id (a `ConfigAction.id`) or a
 * category chip's - `controlsCollisionDetection` and this zone's `onDropOutside` both tell "a
 * header was dropped on another header" apart from every other kind of drop by the id alone.
 * Exported so `ControlsGrid` can give its header's `SortableItem` the same id this zone resolves a
 * drop of it by.
 */
export function subcategoryDragId(subcategoryId: string): string {
  return `${SUBCATEGORY_DRAG_PREFIX}${subcategoryId}`
}

function subcategoryIdFromDragId(id: UniqueIdentifier): string | undefined {
  const value = String(id)
  return value.startsWith(SUBCATEGORY_DRAG_PREFIX)
    ? value.slice(SUBCATEGORY_DRAG_PREFIX.length)
    : undefined
}

const CATEGORY_DRAG_PREFIX = 'category-drag:'

/**
 * The sortable id of a category chip's own drag handle (story 054 D7) - distinct from
 * `categoryDropId`, which names the *same chip* as a drop target for a row (D5). A chip is both at
 * once: reordering the rail drags this id among the other chips' drag ids; dropping a row moves it
 * by dropping onto `categoryDropId`. Namespaced like `subcategoryDragId` so neither collides with a
 * row's droppable id (a `ConfigAction.id`) or the other chip id.
 */
export function categoryDragId(categoryId: string): string {
  return `${CATEGORY_DRAG_PREFIX}${categoryId}`
}

function categoryIdFromDragId(id: UniqueIdentifier): string | undefined {
  const value = String(id)
  return value.startsWith(CATEGORY_DRAG_PREFIX) ? value.slice(CATEGORY_DRAG_PREFIX.length) : undefined
}

/**
 * Rows and chips cannot share one collision strategy.
 *
 * Rows keep D4's `closestCenter`, which is what makes a drop resolve to the row the dragged copy
 * overlaps most - the behaviour `verticalListSortingStrategy` previews while the pointer is held.
 * A chip is small and sits far outside that column, so `closestCenter` would either never pick it
 * or pick the wrong one; a chip is therefore only ever a target while the pointer is literally
 * inside it (`pointerWithin`), which is also exactly the gesture spring-loading is defined by.
 *
 * A keyboard drag has no pointer at all, so `pointerWithin` returns nothing and the rail is
 * unreachable by keyboard - deliberately: D8's row menu ("Move to…") is the keyboard path for a
 * cross-category move, per the story's own AC 5 coverage.
 *
 * Story 054 D6: a sub-category header is a second, distinct sortable axis from rows - dragging one
 * may only ever resolve against another header, never a row or a category chip (moving a whole
 * group of rows into another category, or interleaving a header among rows, is not a gesture this
 * story defines). A header drag is therefore filtered to header-only candidates before either of
 * the row/chip strategies below ever run.
 *
 * Story 054 D7: a category chip is now a third, distinct sortable axis, for the same reason a
 * header is - reordering the rail may only ever resolve against another chip's *drag* id
 * (`categoryDragId`), never a row or the chip's own *drop* id (`categoryDropId`, D5's "a row was
 * dropped on this chip"). This is what disambiguates "a chip being dragged over another chip"
 * (reorder-the-rail) from "a row being dragged over a chip" (D5's spring-load/append): the two
 * gestures start with a different `active.id` namespace, so this first check is the only place the
 * distinction has to be made - once a category-drag id is picked out, only other category-drag ids
 * are ever considered, so a chip drag can never resolve to a row or to `categoryDropId`.
 */
export const controlsCollisionDetection: CollisionDetection = (args) => {
  if (subcategoryIdFromDragId(args.active.id) !== undefined) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => subcategoryIdFromDragId(container.id) !== undefined,
      ),
    })
  }

  if (categoryIdFromDragId(args.active.id) !== undefined) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => categoryIdFromDragId(container.id) !== undefined,
      ),
    })
  }

  const chipHit = pointerWithin(args).find(
    (collision) => categoryIdFromDropId(collision.id) !== undefined,
  )
  if (chipHit) return [chipHit]
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) =>
        categoryIdFromDropId(container.id) === undefined &&
        subcategoryIdFromDragId(container.id) === undefined &&
        categoryIdFromDragId(container.id) === undefined,
    ),
  })
}

export interface CategoryDropTargetProps {
  categoryId: string
  /** The category's display name - announced to screen readers as the drop target's name, since
   * "position 3 of 12" means nothing for a target that is not part of the sorted list. */
  label: string
  className?: string
  /** Story 054 D7: the chip's own `useSortable` transform (`SortableItemRenderState.style`), so a
   * chip being reordered actually moves under the pointer. Composed onto the droppable's element,
   * the same one dnd-kit's `useSortable` ref (also composed via `elementRef`) is attached to - one
   * DOM node serves as both the drop target (D5) and the sortable item (D7). */
  style?: CSSProperties
  /** Composed with the droppable's own ref, for a caller that already keeps the chip element
   * (`ControlsTab`'s `categoryChipRefs` scroll-into-view map) or a sortable item's own ref (D7). */
  elementRef?: (element: HTMLElement | null) => void
  /** Called once the pointer has rested here for `SPRING_LOAD_MS` during a row drag. Omitted, or
   * `springLoadDisabled`, means this chip can still be dropped *on* - it just never swaps the grid. */
  onSpringLoad?: (categoryId: string) => void
  /** True for the category already on screen: there is nothing to spring-load to. */
  springLoadDisabled?: boolean
  children: ReactNode
}

/**
 * One category chip, as a drop target for a dragged row.
 *
 * The spring-load timer lives here rather than in the zone because "the pointer is resting on *this*
 * chip" is exactly `isOver`, and React's effect cleanup then gives the "moved away again before
 * 600 ms" case for free: leaving clears the timer, so no switch happens.
 */
export function CategoryDropTarget({
  categoryId,
  label,
  className,
  style,
  elementRef,
  onSpringLoad,
  springLoadDisabled = false,
  children,
}: CategoryDropTargetProps) {
  const { setNodeRef, isOver } = useDroppable({ id: categoryDropId(categoryId), data: { label } })
  const { activeId } = useSortableZoneState()
  const dragging = activeId !== null

  useEffect(() => {
    if (!dragging || !isOver || springLoadDisabled || !onSpringLoad) return
    const timer = setTimeout(() => onSpringLoad(categoryId), SPRING_LOAD_MS)
    return () => clearTimeout(timer)
  }, [dragging, isOver, springLoadDisabled, onSpringLoad, categoryId])

  return (
    <div
      ref={(element) => {
        setNodeRef(element)
        elementRef?.(element)
      }}
      style={style}
      data-drop-category={categoryId}
      className={[className, dragging && isOver && 'ctrl-chip-drop-over']
        .filter((part): part is string => Boolean(part))
        .join(' ')}
    >
      {children}
    </div>
  )
}

export interface ControlsDragZoneProps {
  /** The rows exactly as the grid renders them, in rendered order - the same `groups` handed to
   * `ControlsGrid`, since dnd-kit maps a drop position back to an index in this list. */
  groups: ControlsRowGroup[]
  /** Story 054's decision: dragging is off while the Controls filter narrows the list. */
  disabled?: boolean
  /** A row was dropped at a position among the rendered rows. */
  onReorderRow?: (drop: EntryDropTarget) => void
  /** A row was dropped straight onto a category chip - "move it there, appended at the end". */
  onDropOnCategory?: (actionId: string, categoryId: string) => void
  /** Story 054 D6: a sub-category header was dropped onto another header's position. `toIndex` is
   * where it lands among the category's `subcategories` array - the over header's own index before
   * the move, the same "arrayMove" semantics `onReorderRow`'s `before` already uses for rows. */
  onReorderSubcategory?: (subcategoryId: string, toIndex: number) => void
  /** Story 054 D7: the rail's real category order, as rendered - what a chip drop's "over" id
   * resolves to an index within, mirroring `subcategoryOrder`'s role for header drops. Passed in
   * (rather than derived from `groups`, which only ever covers the *visible* category's own
   * sub-categories) since the rail always shows every category, not just the one on screen. */
  categoryOrder?: string[]
  /** A category chip was dropped onto another chip's position - reorder the rail. `toIndex` is the
   * over chip's own index in `categoryOrder` before the move, the same semantics
   * `onReorderSubcategory`'s `toIndex` already has for headers. */
  onReorderCategory?: (categoryId: string, toIndex: number) => void
  onDragStarted?: (actionId: string) => void
  /** Every way a drag can end, after the outcome above (if any) - see `SortableZone`. */
  onDragFinished?: () => void
  children: ReactNode
}

export function ControlsDragZone({
  groups,
  disabled = false,
  onReorderRow,
  onDropOnCategory,
  onReorderSubcategory,
  categoryOrder = [],
  onReorderCategory,
  onDragStarted,
  onDragFinished,
  children,
}: ControlsDragZoneProps) {
  const { t } = useTranslation()

  // The sortable items, in exactly the order the rows render in - `flatMap` over the groups is that
  // order by construction, which is what makes dnd-kit's index-to-item mapping match the screen.
  const rowEntries = groups.flatMap((group) => group.entries)
  const groupIndexByRowId = new Map<string, number>()
  groups.forEach((group, groupIndex) => {
    for (const entry of group.entries) groupIndexByRowId.set(entry.action.id, groupIndex)
  })

  // Story 054 D6: the category's real sub-categories, in the same order `ControlsGrid` renders
  // their headers in (`groupControlsRowEntries` keeps `subcategories`' own array order) - what a
  // header drop's "over" id resolves to an index within.
  const subcategoryOrder = groups
    .map((group) => group.subcategory?.id)
    .filter((id): id is string => id !== undefined)

  /**
   * Turns one dnd-kit drop into the profile-level move it means (story 054 D4, moved here from
   * `ControlsGrid` with D5's hoist).
   *
   * The hovered row (`overId`) names the sub-category run the drop lands in; the direction says on
   * which side of that row - dragging *down* onto a row lands after it, dragging *up* lands before
   * it, which is exactly the preview `verticalListSortingStrategy` shows while the pointer is held.
   * "After the hovered row" is resolved against the run with the dragged row already taken out of
   * it, mirroring what `moveEntryToPosition` does to the array, so dragging a row past its own
   * neighbour cannot resolve to "before itself".
   */
  function handleDrop(meta: SortableDropMeta): void {
    if (!onReorderRow) return
    const fromGroup = groups[groupIndexByRowId.get(meta.activeId) ?? -1]
    const toGroup = groups[groupIndexByRowId.get(meta.overId) ?? -1]
    if (!fromGroup || !toGroup) return

    const rest = toGroup.entries.filter((entry) => entry.action.id !== meta.activeId)
    const overIndex = rest.findIndex((entry) => entry.action.id === meta.overId)
    if (overIndex === -1) return

    const movingDown = meta.newIndex > meta.oldIndex
    const before: MoveTargetPosition = movingDown
      ? (rest[overIndex + 1]?.action.id ?? 'end')
      : rest[overIndex]!.action.id

    onReorderRow({
      id: meta.activeId,
      fromSubcategoryId: fromGroup.subcategory?.id,
      toSubcategoryId: toGroup.subcategory?.id,
      before,
    })
  }

  /**
   * Story 054 D6: a sub-category header was dropped on another header. Resolves to "move it to
   * this index" - the over header's position in the category's own `subcategories` order, computed
   * before the move (same remove-then-insert semantics `moveSubcategory`/D2 applies), exactly how
   * `handleDrop` above resolves a row's new position from `meta.newIndex`.
   */
  function handleSubcategoryDrop(activeDragId: string, overDragId: string): void {
    if (!onReorderSubcategory) return
    const activeSubcategoryId = subcategoryIdFromDragId(activeDragId)
    const overSubcategoryId = subcategoryIdFromDragId(overDragId)
    if (!activeSubcategoryId || !overSubcategoryId) return
    const toIndex = subcategoryOrder.indexOf(overSubcategoryId)
    if (toIndex === -1) return
    onReorderSubcategory(activeSubcategoryId, toIndex)
  }

  /**
   * Story 054 D7: a category chip was dropped on another chip - resolved to "move it to this
   * index" the same way `handleSubcategoryDrop` resolves a header drop, against `categoryOrder`
   * (the rail's own order) rather than `subcategoryOrder` (scoped to the visible category alone).
   */
  function handleCategoryChipDrop(activeDragId: string, overDragId: string): void {
    if (!onReorderCategory) return
    const activeCategoryId = categoryIdFromDragId(activeDragId)
    const overCategoryId = categoryIdFromDragId(overDragId)
    if (!activeCategoryId || !overCategoryId) return
    const toIndex = categoryOrder.indexOf(overCategoryId)
    if (toIndex === -1) return
    onReorderCategory(activeCategoryId, toIndex)
  }

  return (
    <SortableZone
      items={rowEntries}
      getItemId={(entry) => entry.action.id}
      // No handler wired = nothing to persist a move with, so no drag may start (the grip still
      // renders, disabled or not, so the column looks the same either way).
      disabled={disabled || !onReorderRow}
      onReorder={(_next, meta) => handleDrop(meta)}
      onDropOutside={(activeId, overId) => {
        const categoryId = categoryIdFromDropId(overId)
        if (categoryId) {
          onDropOnCategory?.(activeId, categoryId)
          return
        }
        if (categoryIdFromDragId(activeId) !== undefined) {
          handleCategoryChipDrop(activeId, overId)
          return
        }
        handleSubcategoryDrop(activeId, overId)
      }}
      onDragStarted={onDragStarted}
      onDragFinished={onDragFinished}
      collisionDetection={controlsCollisionDetection}
      // Not vertical-only any more (D1's default): a row now has to be carried sideways and upwards
      // to reach a category chip in the rail, so a copy pinned to its own column would sit far away
      // from the target the pointer is actually on.
      overlayModifiers={[]}
      // A deliberately lightweight floating copy rather than a second live `ControlsRow`: the real
      // row carries capture-able key slots, icon buttons and the caller's `rowRef` registration
      // (story 044's deep-link focus map), and a duplicate of all that under the pointer would put a
      // second set of the same accessible names in the tree and re-register the row's ref against
      // the floating element. The copy is rendered at the dragged rowgroup's measured height, so
      // nothing jumps when it lifts off (AC 4).
      renderOverlay={(entry) => (
        <div className="ctrl-row ctrl-drag-preview" aria-hidden="true">
          <span className="ctrl-grip" />
          <span className="ctrl-label truncate">
            {entry.kind === 'catalog' ? t(entry.labelKey) : entry.action.name}
          </span>
        </div>
      )}
    >
      {() => children}
    </SortableZone>
  )
}
