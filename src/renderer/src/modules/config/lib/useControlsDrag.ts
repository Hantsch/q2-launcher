import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseControlsDragOptions {
  /** Whether a dragged id is a row (as opposed to a sub-category header or a category chip, which
   * `ControlsDragZone` announces through the same pick-up callback). Read through a latest-ref, so
   * the returned callbacks never change identity when this does. */
  isRowId: (activeId: string) => boolean
}

export interface ControlsDrag {
  /** The id of the row being dragged; `null` for header/chip drags and between drags. */
  draggingRowId: string | null
  /** The category a spring-load switched the grid to provisionally, mid-drag. Dropped on every way
   * a drag can end, so a cancel leaves nothing behind. */
  springCategoryId: string | null
  onDragStarted: (activeId: string) => void
  onDragFinished: () => void
  onSpringLoad: (categoryId: string) => void
}

/**
 * Row-drag state for the Controls tab. All three callbacks are referentially stable for the hook's
 * lifetime: `CategoryDropTarget`'s timer effect depends on `onSpringLoad`, so a fresh identity on
 * a re-render caused by the drag would restart the hover delay and it would never elapse.
 */
export function useControlsDrag({ isRowId }: UseControlsDragOptions): ControlsDrag {
  const isRowIdRef = useRef(isRowId)
  useEffect(() => {
    isRowIdRef.current = isRowId
  })

  // The ref is what the stable spring-load callback reads; the state copy drives rendering.
  const draggingRowIdRef = useRef<string | null>(null)
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null)
  const [springCategoryId, setSpringCategoryId] = useState<string | null>(null)

  const onDragStarted = useCallback((activeId: string): void => {
    const rowId = isRowIdRef.current(activeId) ? activeId : null
    draggingRowIdRef.current = rowId
    setDraggingRowId(rowId)
  }, [])

  const onDragFinished = useCallback((): void => {
    draggingRowIdRef.current = null
    setDraggingRowId(null)
    setSpringCategoryId(null)
  }, [])

  const onSpringLoad = useCallback((categoryId: string): void => {
    if (!draggingRowIdRef.current) return
    setSpringCategoryId(categoryId)
  }, [])

  return { draggingRowId, springCategoryId, onDragStarted, onDragFinished, onSpringLoad }
}
