import type { CSSProperties, ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'

/**
 * Story 054 D1: the one place a vertical drag-and-drop list configures dnd-kit, so no consuming
 * surface (Controls rows, sub-category headers, category chips, Settings sections/cvars - D3-D10)
 * has to set up sensors, a collision strategy or screen-reader announcements itself.
 *
 * Chosen modifier package: `@dnd-kit/modifiers`'s `restrictToVerticalAxis` (a peer of the
 * story-named `@dnd-kit/core`/`@dnd-kit/sortable`/`@dnd-kit/utilities`, per the story's Decisions)
 * rather than a hand-rolled equivalent - it is the library's own, already exercised implementation.
 *
 * `renderItem`/the overlay content receive `setNodeRef`/`style`/`attributes`/`listeners` instead of
 * SortableList rendering its own wrapper element per item: a later consumer (D3) needs the sortable
 * ref on its *own* single root element (a `role="rowgroup"`, a header, a chip), not on an extra
 * `<div>` this primitive would otherwise have to insert around it.
 *
 * Story 054 D4 split the one component into two layers without changing its configuration:
 * `SortableZone` (the configured `DndContext`/`SortableContext`/`DragOverlay`, rendering *no* DOM
 * of its own) plus `SortableItem` (one `useSortable` call), and `SortableList` on top of them for
 * the plain "a list of items in one container" case. The Controls grid needs that split because its
 * sortable rows are not one contiguous run of siblings: sub-category dividers (`role="row"`, story
 * 053 D5) sit *between* groups of rows inside the same `role="table"` element, so the consumer has
 * to own the container and the interleaving, while the sensors, collision strategy, auto-scroll and
 * announcements stay configured exactly once, here.
 */

export interface SortableItemRenderState {
  setNodeRef: (node: HTMLElement | null) => void
  style: CSSProperties
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
  isDragging: boolean
}

/**
 * What a drop actually was, handed to `onReorder` next to the already-reordered array. The plain
 * list case only needs the array; a consumer whose items are grouped (the Controls grid's
 * sub-categories) needs to know *which* item was dropped on which, and from which direction, since
 * "the gap after the last row of group A" and "the gap before the first row of group B" are the
 * same gap in one flat sortable list and only the hovered item tells them apart.
 */
export interface SortableDropMeta {
  activeId: string
  overId: string
  /** Index of the dragged item in the list as it was rendered before the drop. */
  oldIndex: number
  /** Index it was dropped at - `> oldIndex` means it travelled towards the end of the list. */
  newIndex: number
}

/** Live drag state, published to a zone's children so they can mark the current drop position
 * (`.ctrl-drop-indicator*`) without subscribing to dnd-kit themselves. */
export interface SortableZoneState {
  activeId: string | null
  overId: string | null
  /** `true` while the dragged item is being carried towards the end of the list. */
  movingDown: boolean
}

const IDLE_ZONE_STATE: SortableZoneState = { activeId: null, overId: null, movingDown: false }

interface SortableZoneContextValue {
  registerNode: (id: string, node: HTMLElement | null) => void
  disabled: boolean
  state: SortableZoneState
}

const SortableZoneContext = createContext<SortableZoneContextValue>({
  registerNode: () => {},
  disabled: false,
  state: IDLE_ZONE_STATE,
})

/**
 * The enclosing zone's live drag state, for a component that is not the zone's own `children`
 * render callback and would otherwise have to have it threaded down as a prop (story 054 D5:
 * `ControlsGrid` renders the rows, but the zone moved up to `ControlsTab` so the category rail can
 * be a drop target inside the *same* `DndContext`). Outside a zone this reports "no drag", so a
 * component that renders standalone in a test stays inert rather than crashing.
 */
export function useSortableZoneState(): SortableZoneState {
  return useContext(SortableZoneContext).state
}

export interface SortableZoneProps<T> {
  /** Every sortable item of this zone, in rendered order - the order `children` must also render
   * them in, since dnd-kit's collision detection maps a position back to an index in this array. */
  items: T[]
  /** Stable string id for an item - the array-position identity dnd-kit tracks. */
  getItemId: (item: T) => string
  /** Called once a drag ends on a different position, with the reordered array and what the drop
   * was. Never called for a drop back onto the same position, an Escape cancel, or a drop outside
   * any droppable. */
  onReorder: (nextItems: T[], meta: SortableDropMeta) => void
  /** Renders the zone's own DOM - the container, the items (as `SortableItem`s) and anything
   * non-sortable interleaved between them. Receives the live drag state. */
  children: (state: SortableZoneState) => ReactNode
  /** The floating copy that follows the pointer. Omitted = no `DragOverlay` at all; the item
   * itself moves instead. The copy is rendered at the dragged element's measured height, so the
   * list never jumps (AC 4). */
  renderOverlay?: (item: T, state: SortableZoneState) => ReactNode
  /** Disables dragging for every item (e.g. story 054's decision: off while the Controls filter is
   * active) while leaving the list itself rendered normally. */
  disabled?: boolean
  /**
   * Story 054 D5: a drag ended over a droppable that is *not* one of `items` - a category chip in
   * the Controls rail, registered with `useDroppable` inside this same zone. There is nothing to
   * reorder in that case, so `onReorder` is not called; the consumer decides what dropping onto
   * that target means.
   */
  onDropOutside?: (activeId: string, overId: string) => void
  /** A drag was picked up. */
  onDragStarted?: (activeId: string) => void
  /**
   * Always called exactly once when a drag is over, whatever ended it - a reorder, a drop on an
   * outside target, a release over nothing, or an Escape cancel - and always *after* the callback
   * for that outcome. Where a consumer drops whatever transient state it kept for the duration of
   * the drag (story 054 D5's provisional spring-loaded category), so cancelling can never leave a
   * side effect behind.
   */
  onDragFinished?: () => void
  /** Defaults to `closestCenter`. Overridden where a zone mixes sortable rows with droppables of a
   * different kind (story 054 D5) and one strategy cannot serve both. */
  collisionDetection?: CollisionDetection
  /** Modifiers for the floating copy. Defaults to vertical-only, which is right for a plain
   * vertical list; a zone whose drop targets are not all in one column (story 054 D5's category
   * rail sits *above* the grid) passes `[]` so the copy can follow the pointer sideways too. */
  overlayModifiers?: Modifier[]
}

export interface SortableItemProps {
  id: string
  /** Defaults to the enclosing zone's `disabled`. */
  disabled?: boolean
  /** Forwarded to dnd-kit's `useSortable` - a friendly name for the screen-reader announcement of
   * a drop that lands outside the zone's own sorted `items` (`outsideTargetLabel`, story 054 D5's
   * category chip, D6's sub-category header dropped on another header). Omitted for a plain list
   * item, which is never such a target. */
  data?: Record<string, unknown>
  children: (state: SortableItemRenderState) => ReactNode
}

/** One sortable item. Renders no DOM of its own: the consumer attaches `setNodeRef`/`style` to
 * whatever single element *is* the item (a `role="rowgroup"`, a header, a chip). */
export function SortableItem({ id, disabled, data, children }: SortableItemProps): ReactNode {
  const zone = useContext(SortableZoneContext)
  const isDisabled = disabled ?? zone.disabled
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: isDisabled,
    data,
  })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  }

  return children({
    setNodeRef: (node) => {
      setNodeRef(node)
      zone.registerNode(id, node)
    },
    style,
    attributes,
    listeners,
    isDragging,
  })
}

export interface SortableListProps<T> {
  /** The ordered items to render. */
  items: T[]
  /** Stable string id for an item - the array-position identity dnd-kit tracks. */
  getItemId: (item: T) => string
  /** Called with the reordered array once a drag ends on a different position. Never called for a
   * drop back onto the same position, an Escape cancel, or a drop outside any droppable. */
  onReorder: (nextItems: T[]) => void
  /** Renders one item. Attach `setNodeRef` and `style` to the item's own single root element, and
   * spread `attributes`/`listeners` onto whichever part of it should start a drag (usually
   * `DragHandle`). */
  renderItem: (item: T, state: SortableItemRenderState) => ReactNode
  /** Disables dragging for every item (e.g. story 054's decision: off while the Controls filter is
   * active) while leaving the list itself rendered normally. */
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

const DEFAULT_OVERLAY_MODIFIERS: Modifier[] = [restrictToVerticalAxis]

/** No-op stand-ins for the overlay copy, which is not itself sortable and never receives a real
 * drag ref/handlers. */
const OVERLAY_ATTRIBUTES: DraggableAttributes = {
  role: 'button',
  tabIndex: -1,
  'aria-disabled': true,
  'aria-pressed': undefined,
  'aria-roledescription': 'sortable',
  'aria-describedby': '',
}

export function SortableZone<T>({
  items,
  getItemId,
  onReorder,
  children,
  renderOverlay,
  disabled = false,
  onDropOutside,
  onDragStarted,
  onDragFinished,
  collisionDetection = closestCenter,
  overlayModifiers = DEFAULT_OVERLAY_MODIFIERS,
}: SortableZoneProps<T>): ReactNode {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null)
  const [activeHeight, setActiveHeight] = useState<number | undefined>(undefined)
  const nodeRefs = useRef(new Map<string, HTMLElement>())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = useMemo(() => items.map(getItemId), [items, getItemId])
  const activeIndex = activeId != null ? ids.indexOf(String(activeId)) : -1
  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined
  const overIndex = overId != null ? ids.indexOf(String(overId)) : -1

  const state = useMemo<SortableZoneState>(
    () => ({
      activeId: activeId == null ? null : String(activeId),
      overId: overId == null ? null : String(overId),
      movingDown: activeIndex >= 0 && overIndex > activeIndex,
    }),
    [activeId, overId, activeIndex, overIndex],
  )

  const registerNode = useCallback((id: string, node: HTMLElement | null): void => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }, [])

  const contextValue = useMemo<SortableZoneContextValue>(
    () => ({ registerNode, disabled, state }),
    [registerNode, disabled, state],
  )

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(event.active.id)
    setOverId(event.active.id)
    setActiveHeight(nodeRefs.current.get(String(event.active.id))?.getBoundingClientRect().height)
    onDragStarted?.(String(event.active.id))
  }

  function resetActive(): void {
    setActiveId(null)
    setOverId(null)
    setActiveHeight(undefined)
  }

  /** One exit for every way a drag can end, so `onDragFinished` cannot be skipped by an early
   * return - a consumer's provisional drag state (story 054 D5's spring-loaded category) has to be
   * dropped on *every* path, including the ones where nothing moved. */
  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event
    resetActive()
    reportDrop(String(active.id), over ? String(over.id) : null)
    onDragFinished?.()
  }

  function reportDrop(activeId: string, overId: string | null): void {
    if (overId === null || activeId === overId) return
    const oldIndex = ids.indexOf(activeId)
    const newIndex = ids.indexOf(overId)
    // A drop on something this zone does not sort - a category chip (story 054 D5). There is no
    // index to move to, so the consumer is told what was dropped on what and decides.
    if (newIndex === -1) {
      onDropOutside?.(activeId, overId)
      return
    }
    if (oldIndex === -1) return
    onReorder(arrayMove(items, oldIndex, newIndex), { activeId, overId, oldIndex, newIndex })
  }

  /** Story 054 D5: a zone can now also be dragged over a droppable that is not one of its sorted
   * items (a category chip). "Position 0 of 12" would be a lie there, so such a target announces
   * its own name instead - `useDroppable`'s `data.label`, or its raw id if it carries none. */
  function outsideTargetLabel(over: { id: UniqueIdentifier; data: { current?: unknown } }): string {
    const label = (over.data.current as { label?: unknown } | undefined)?.label
    return typeof label === 'string' ? label : String(over.id)
  }

  /** Story 054 review-fix (finding 2): an item's own `data.label` (Controls rows/headers, category
   * chips already pass this) reads far better in an announcement than its raw id, which is a UUID
   * for a Controls row. Falls back to the raw id for callers that carry no label. */
  function activeLabel(active: { id: UniqueIdentifier; data: { current?: unknown } }): string {
    const label = (active.data.current as { label?: unknown } | undefined)?.label
    return typeof label === 'string' ? label : String(active.id)
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      const index = ids.indexOf(String(active.id))
      return t('dnd.announcements.pickedUp', {
        id: activeLabel(active),
        position: index + 1,
        total: ids.length,
      })
    },
    onDragOver({ active, over }) {
      if (!over) return undefined
      const index = ids.indexOf(String(over.id))
      if (index === -1) {
        return t('dnd.announcements.movedOverTarget', {
          id: activeLabel(active),
          target: outsideTargetLabel(over),
        })
      }
      return t('dnd.announcements.movedOver', {
        id: activeLabel(active),
        position: index + 1,
        total: ids.length,
      })
    },
    onDragEnd({ active, over }) {
      if (over && ids.indexOf(String(over.id)) === -1) {
        return t('dnd.announcements.droppedOnTarget', {
          id: activeLabel(active),
          target: outsideTargetLabel(over),
        })
      }
      const index = ids.indexOf(String(over?.id ?? active.id))
      return t('dnd.announcements.dropped', {
        id: activeLabel(active),
        position: index + 1,
        total: ids.length,
      })
    },
    onDragCancel({ active }) {
      const index = ids.indexOf(String(active.id))
      return t('dnd.announcements.cancelled', {
        id: activeLabel(active),
        position: index + 1,
        total: ids.length,
      })
    },
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      autoScroll
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('dnd.instructions.draggable') },
      }}
      onDragStart={handleDragStart}
      onDragOver={(event: DragOverEvent) => setOverId(event.over?.id ?? null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        resetActive()
        onDragFinished?.()
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <SortableZoneContext.Provider value={contextValue}>
          {children(state)}
        </SortableZoneContext.Provider>
      </SortableContext>
      {renderOverlay && (
        <DragOverlay modifiers={overlayModifiers}>
          {activeItem ? (
            <div style={{ height: activeHeight }}>{renderOverlay(activeItem, state)}</div>
          ) : null}
        </DragOverlay>
      )}
    </DndContext>
  )
}

/** The plain case: one container element, every item a direct child of it, nothing interleaved.
 * A consumer that needs to interleave non-sortable content between items (the Controls grid's
 * sub-category dividers) uses `SortableZone`/`SortableItem` directly instead. */
export function SortableList<T>({
  items,
  getItemId,
  onReorder,
  renderItem,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: SortableListProps<T>): ReactNode {
  return (
    <SortableZone
      items={items}
      getItemId={getItemId}
      onReorder={(nextItems) => onReorder(nextItems)}
      disabled={disabled}
      renderOverlay={(item) =>
        renderItem(item, {
          setNodeRef: () => {},
          style: {},
          attributes: OVERLAY_ATTRIBUTES,
          listeners: undefined,
          isDragging: true,
        })
      }
    >
      {() => (
        <div className={className} aria-label={ariaLabel}>
          {items.map((item) => (
            <SortableItem key={getItemId(item)} id={getItemId(item)}>
              {(state) => renderItem(item, state)}
            </SortableItem>
          ))}
        </div>
      )}
    </SortableZone>
  )
}
