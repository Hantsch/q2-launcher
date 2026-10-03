import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow as DemoRowData } from '@shared/modules/replays'
import type { DemoListSort, DemoSortColumn } from '@shared/replays/list-sort'
import { DEMO_ROW_HEIGHT } from '../list-grid'
import { visibleRange } from '../visible-range'
import type { RowPatcher } from '../demo-editor-store'
import { DemoListHeader } from './DemoListHeader'
import { DemoRow } from './DemoRow'

export interface VirtualDemoListProps {
  rows: DemoRowData[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Story 155: forwarded straight to each `DemoRow` for its favourite/rating quick edit. */
  onRowPatched?: RowPatcher
  /** The demos list's current column sort (story 152), or `null` for the default
   * favourites-first order - forwarded straight through to `DemoListHeader`. */
  sort: DemoListSort | null
  onSort: (column: DemoSortColumn) => void
  /** How many rows to render on each side of the visible window, so a small scroll delta doesn't
   * pop a fresh row in right at the viewport's edge. */
  overscan?: number
  /** Seeds the viewport height before the `ResizeObserver` has ever fired - without it jsdom (which
   * has no real layout, so the scroll container reports a 0 height) would render an empty window on
   * every test render. A real `ResizeObserver` push always wins once it arrives. */
  initialViewportHeight?: number
}

/**
 * Story 158/159: the demos list's virtualised, selectable body - one scroll container holding a
 * sticky `DemoListHeader` and a full-height spacer, with only the rows the current scroll position
 * and viewport can actually show ever mounted as `DemoRow`s. Mirrors the windowing shape used by
 * other dense lists in this codebase, but built directly on `visibleRange` (kept pure and separately
 * tested) rather than a third-party virtualizer - this list's row height is fixed, so the math is
 * simple enough not to need one.
 */
export function VirtualDemoList({
  rows,
  selectedId,
  onSelect,
  onRowPatched,
  sort,
  onSort,
  overscan = 4,
  initialViewportHeight = 600,
}: VirtualDemoListProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(initialViewportHeight)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setViewportHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { start, end } = visibleRange({
    scrollTop,
    viewportHeight,
    rowHeight: DEMO_ROW_HEIGHT,
    count: rows.length,
    overscan,
  })
  const visibleRows = rows.slice(start, end)

  return (
    <div
      ref={scrollRef}
      data-testid="replays-demo-scroll"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <DemoListHeader sort={sort} onSort={onSort} />
      <div style={{ position: 'relative', height: rows.length * DEMO_ROW_HEIGHT }}>
        <ul
          data-testid="replays-demo-list"
          aria-label={t('common.label.demos')}
          style={{ position: 'absolute', top: start * DEMO_ROW_HEIGHT, left: 0, right: 0 }}
        >
          {visibleRows.map((row, index) => (
            <li key={row.id} aria-setsize={rows.length} aria-posinset={start + index + 1}>
              <DemoRow
                row={row}
                selected={row.id === selectedId}
                onSelect={onSelect}
                onRowPatched={onRowPatched}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
