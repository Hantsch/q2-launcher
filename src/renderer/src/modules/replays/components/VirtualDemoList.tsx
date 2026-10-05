import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow as DemoRowData } from '@shared/modules/replays'
import type { FolderEntry } from '@shared/replays/demo-folders'
import type { DemoListSort, DemoSortColumn } from '@shared/replays/list-sort'
import { DEMO_ROW_HEIGHT } from '../list-grid'
import { visibleRange } from '../visible-range'
import type { MenuPoint } from '../row-menu'
import type { RowPatcher } from '../demo-editor-store'
import { DemoListHeader } from './DemoListHeader'
import { DemoRow } from './DemoRow'
import { DemoFolderRow } from './DemoFolderRow'

/** What the list renders: folders first, then demos, one fixed row height for both. */
export type DemoListItem =
  | { kind: 'folder'; folder: FolderEntry }
  | { kind: 'demo'; row: DemoRowData; folderText?: string }
  | { kind: 'heading'; labelKey: string; testId: string }

export interface VirtualDemoListProps {
  items: DemoListItem[]
  onOpenFolder: (folder: FolderEntry) => void
  onRenameFolder: (folder: FolderEntry) => void
  /** A row asked for its context menu: the pointer's point, or the focused row's for the keyboard. */
  onDemoMenu: (id: string, at: MenuPoint) => void
  onFolderMenu: (folder: FolderEntry, at: MenuPoint) => void
  selectedIds: readonly string[]
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  /** Shift-click: `visibleOrder` is every demo of the current view, in list order. */
  onRange: (id: string, visibleOrder: readonly string[]) => void
  onSelectAll: (visibleOrder: readonly string[]) => void
  /** Escape: also dismisses a shown bulk outcome, so it runs when nothing is selected. */
  onClearSelection: () => void
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
  items,
  onOpenFolder,
  onRenameFolder,
  onDemoMenu,
  onFolderMenu,
  selectedIds,
  onSelect,
  onToggle,
  onRange,
  onSelectAll,
  onClearSelection,
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
    count: items.length,
    overscan,
  })
  const visibleItems = items.slice(start, end)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // Every demo of the view (not just the rendered window), in list order; folders and headings
  // are never part of a selection.
  const visibleOrder = useMemo(
    () => items.flatMap((item) => (item.kind === 'demo' ? [item.row.id] : [])),
    [items],
  )

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // React events bubble through portals: a dialog opened from a row must not drive the list.
    const target = event.target as HTMLElement
    if (!event.currentTarget.contains(target)) return
    // The row checkbox keeps focus after a click, so it must not swallow the list's chords.
    const field = target.closest('input, textarea, select, [contenteditable="true"]')
    if (field !== null && field.getAttribute('data-testid') !== 'replays-row-select') return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      onSelectAll(visibleOrder)
    } else if (event.key === 'Escape') {
      onClearSelection()
    }
  }

  return (
    <div
      ref={scrollRef}
      data-testid="replays-demo-scroll"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={handleKeyDown}
    >
      <DemoListHeader sort={sort} onSort={onSort} />
      <div style={{ position: 'relative', height: items.length * DEMO_ROW_HEIGHT }}>
        <ul
          data-testid="replays-demo-list"
          aria-label={t('common.label.demos')}
          style={{ position: 'absolute', top: start * DEMO_ROW_HEIGHT, left: 0, right: 0 }}
        >
          {visibleItems.map((item, index) => (
            <li
              key={
                item.kind === 'folder'
                  ? `folder:${item.folder.ref.sourceKey}:${item.folder.ref.path.join('/')}`
                  : item.kind === 'heading'
                    ? `heading:${item.testId}`
                    : item.row.id
              }
              aria-setsize={items.length}
              aria-posinset={start + index + 1}
            >
              {item.kind === 'heading' ? (
                <div
                  className="flex items-end px-3 pb-1 text-xs font-medium tracking-wide text-ink-muted uppercase"
                  style={{ height: DEMO_ROW_HEIGHT }}
                  data-testid={item.testId}
                >
                  {t(item.labelKey)}
                </div>
              ) : item.kind === 'folder' ? (
                <DemoFolderRow
                  folder={item.folder}
                  onOpen={onOpenFolder}
                  onRename={onRenameFolder}
                  onContextMenu={onFolderMenu}
                />
              ) : (
                <DemoRow
                  row={item.row}
                  folderText={item.folderText}
                  selected={selectedSet.has(item.row.id)}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onRange={(id) => onRange(id, visibleOrder)}
                  onRowPatched={onRowPatched}
                  onContextMenu={onDemoMenu}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
