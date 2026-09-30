/**
 * Story 158/159 D4: the pure windowing math behind `VirtualDemoList` - given a scroll position,
 * viewport size and row height, which row indices need a real DOM node right now. Kept separate
 * from the component so it's testable without React/jsdom and without a real `ResizeObserver`.
 *
 * `overscan` pads the window on both sides by that many rows, so a small scroll delta doesn't pop
 * a fresh row in at the very edge of the viewport. The result is always clamped to `[0, count]` -
 * a `start`/`end` a caller can slice a `T[]` with directly, never out of bounds.
 */
export interface VisibleRangeInput {
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  count: number
  overscan?: number
}

export interface VisibleRange {
  start: number
  end: number
}

export function visibleRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  count,
  overscan = 0,
}: VisibleRangeInput): VisibleRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 }

  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const visibleRowCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight)

  const start = Math.min(count, Math.max(0, firstVisible - overscan))
  const end = Math.min(count, firstVisible + visibleRowCount + overscan)

  return { start, end: Math.max(start, end) }
}
