import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { FolderRef } from '@shared/replays/demo-folders'

/** What a demo row hands to dnd-kit as its draggable data. */
export interface DemoDragData {
  fileName: string
}

/** What a folder row or crumb hands to dnd-kit as its droppable data. */
export interface FolderDropData {
  ref: FolderRef
}

export interface DemoDragZoneProps {
  children: ReactNode
  /** One demo dropped on one folder; refusals are the caller's to show. */
  onMove: (demoId: string, target: FolderRef) => void
}

/** Ctrl+Space picks a demo up: the row's own Enter/Space select it, so dnd-kit's default Space
 * activator would turn selecting into dragging. */
class ChordKeyboardSensor extends KeyboardSensor {
  static override activators = [
    {
      eventName: 'onKeyDown' as const,
      handler: (
        { nativeEvent: event }: { nativeEvent: KeyboardEvent },
        { onActivation }: { onActivation?: (e: { event: KeyboardEvent }) => void },
      ): boolean => {
        if (event.code !== 'Space' || !event.ctrlKey || event.altKey || event.metaKey) return false
        event.preventDefault()
        onActivation?.({ event })
        return true
      },
    },
  ]
}

/** A keyboard drag has no pointer, so it resolves the target by the dragged rect's nearest folder
 * row or crumb instead. */
const collisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates !== null ? pointerWithin(args) : closestCenter(args)

/** The one `DndContext` for dragging a demo onto a folder row or crumb; the drop targets sit in
 * different subtrees (breadcrumb, virtual list), so the context wraps both. Same 8px activation
 * distance as `SortableList`, so a plain click or double-click never starts a drag. */
export function DemoDragZone({ children, onMove }: DemoDragZoneProps) {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(ChordKeyboardSensor),
  )

  const handleStart = (event: DragStartEvent): void => {
    const data = event.active.data.current as DemoDragData | undefined
    setDragging(data?.fileName ?? null)
  }

  const handleEnd = (event: DragEndEvent): void => {
    setDragging(null)
    const target = event.over?.data.current as FolderDropData | undefined
    if (target !== undefined) onMove(String(event.active.id), target.ref)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ screenReaderInstructions: { draggable: t('replays.folder.dragHint') } }}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setDragging(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {dragging !== null && (
          <div
            data-testid="replays-drag-overlay"
            className="max-w-xs truncate rounded border border-flame-500 bg-raised px-3 py-1.5 text-xs text-ink shadow-lg"
          >
            {dragging}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
