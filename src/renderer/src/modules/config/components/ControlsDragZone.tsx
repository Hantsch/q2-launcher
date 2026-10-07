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
 * The one `DndContext` the whole Controls tab drags inside: there is one drag operation at a time
 * and the category rail's chips are drop targets as well as the grid's rows, so a single context
 * spans both. `SortableZone` renders no DOM, so `ControlsTab` wraps its rail *and* grid in this
 * component; `ControlsGrid` renders rows as `SortableItem`s and reads the live drag state through
 * `useSortableZoneState()`.
 *
 * This component turns one dnd-kit drop into a profile-level *description* of the move
 * (`EntryDropTarget`, or "onto that category"); `ControlsTab` applies it to `actions` with
 * `lib/entry-order.ts`'s pure helpers and persists.
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
 * The sortable id of a sub-category header's drag handle. Namespaced like
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
 * The sortable id of a category chip's own drag handle - distinct from
 * `categoryDropId`, which names the *same chip* as a drop target for a row. A chip is both at
 * once: reordering the rail drags this id among the other chips' drag ids; dropping a row moves it
 * by dropping onto `categoryDropId`. Namespaced like `subcategoryDragId` so neither collides with a
 * row's droppable id (a `ConfigAction.id`) or the other chip id.
 */
export function categoryDragId(categoryId: string): string {
  return `${CATEGORY_DRAG_PREFIX}${categoryId}`
}

function categoryIdFromDragId(id: UniqueIdentifier): string | undefined {
  const value = String(id)
  return value.startsWith(CATEGORY_DRAG_PREFIX)
    ? value.slice(CATEGORY_DRAG_PREFIX.length)
    : undefined
}

/**
 * Rows and chips cannot share one collision strategy.
 *
 * Rows use `closestCenter`: a drop resolves to the row the dragged copy overlaps most, matching the
 * `verticalListSortingStrategy` preview. A chip is small and far outside that column, so it is a
 * target only while the pointer is literally inside it (`pointerWithin`), the gesture spring-loading
 * is defined by. A keyboard drag has no pointer, so the rail is unreachable by keyboard on purpose:
 * the row menu ("Move to…") is the keyboard path for a cross-category move.
 *
 * A sub-category header and a category chip's drag handle are each their own sortable axis: a
 * header drag resolves only against other headers, and a chip drag only against other chips' *drag*
 * ids (`categoryDragId`), never a row, a header or a chip's *drop* id (`categoryDropId`). Both are
 * picked out first, by `active.id` namespace, before the row/chip strategies below run.
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
  /** the chip's own `useSortable` transform (`SortableItemRenderState.style`), so a
   * chip being reordered actually moves under the pointer. Composed onto the droppable's element,
   * the same one dnd-kit's `useSortable` ref (also composed via `elementRef`) is attached to - one
   * DOM node serves as both the drop target and the sortable item. */
  style?: CSSProperties
  /** Composed with the droppable's own ref, for a caller that already keeps the chip element
   * (`ControlsTab`'s `categoryChipRefs` scroll-into-view map) or a sortable item's own ref. */
  elementRef?: (element: HTMLElement | null) => void
  /** Called once the pointer has rested here for `SPRING_LOAD_MS` during a row drag. Omitted, or
   * `springLoadDisabled`, means this chip can still be dropped *on* - it just never swaps the grid. */
  onSpringLoad?: (categoryId: string) => void
  /** True for the category already on screen: there is nothing to spring-load to. */
  springLoadDisabled?: boolean
  /** the chip is one visual level, and this node - the one that already carries the
   * drop target, the sortable item and the scroll-into-view ref - is the
   * level that owns it. So the selected state is reported *here*, as `data-selected="true"`, and
   * the label button below stays a borderless ghost that only keeps `aria-pressed`. */
  selected?: boolean
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
  selected = false,
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
      // stable handles for the unit tests and the `ui:flow` rail-order assertion,
      // so neither has to walk "the first <button> inside the chip <div>", which breaks whenever the
      // chip's button order changes. `data-drop-category` stays what it was - dnd-kit's own
      // bookkeeping (and the drag suites') handle - rather than being reused for two jobs.
      data-category-id={categoryId}
      data-category-name={label}
      data-selected={selected ? 'true' : undefined}
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
  /** Decision: dragging is off while the Controls filter narrows the list. */
  disabled?: boolean
  /** A row was dropped at a position among the rendered rows. */
  onReorderRow?: (drop: EntryDropTarget) => void
  /** A row was dropped straight onto a category chip - "move it there, appended at the end". */
  onDropOnCategory?: (actionId: string, categoryId: string) => void
  /** a sub-category header was dropped onto another header's position. `toIndex` is
   * where it lands among the category's `subcategories` array - the over header's own index before
   * the move, the same "arrayMove" semantics `onReorderRow`'s `before` already uses for rows. */
  onReorderSubcategory?: (subcategoryId: string, toIndex: number) => void
  /** the rail's real category order, as rendered - what a chip drop's "over" id
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

  // the category's real sub-categories, in the same order `ControlsGrid` renders
  // their headers in (`groupControlsRowEntries` keeps `subcategories`' own array order) - what a
  // header drop's "over" id resolves to an index within.
  const subcategoryOrder = groups
    .map((group) => group.subcategory?.id)
    .filter((id): id is string => id !== undefined)

  /**
   * Turns one dnd-kit drop into the profile-level move it means
   * `ControlsGrid` with the hoist).
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
   * a sub-category header was dropped on another header. Resolves to "move it to
   * this index" - the over header's position in the category's own `subcategories` order, computed
   * before the move (same remove-then-insert semantics `moveSubcategory` applies), exactly how
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
   * a category chip was dropped on another chip - resolved to "move it to this
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
      // Not vertical-only any more: a row now has to be carried sideways and upwards
      // to reach a category chip in the rail, so a copy pinned to its own column would sit far away
      // from the target the pointer is actually on.
      overlayModifiers={[]}
      // A deliberately lightweight floating copy rather than a second live `ControlsRow`: the real
      // row carries capture-able key slots, icon buttons and the caller's `rowRef` registration
      // , and a duplicate of all that under the pointer would put a
      // second set of the same accessible names in the tree and re-register the row's ref against
      // the floating element. The copy is rendered at the dragged rowgroup's measured height, so
      // nothing jumps when it lifts off.
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
