import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow, ReplaysScanProgress } from '@shared/modules/replays'
import {
  nextSort,
  sortDemoRows,
  type DemoListSort,
  type DemoSortColumn,
  type DemoSortFields,
} from '@shared/replays/list-sort'
import {
  demoFilterOptions,
  demoFilterSubject,
  filterDemos,
  EMPTY_DEMO_LIST_FILTER,
  type DemoListFilter,
} from '@shared/replays/list-filter'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { usePrimaryActionContribution, type ContributedAction } from '../../lib/primary-action'
import { ROUTE_SETTINGS, useLauncher } from '../../store/useLauncher'
import { VirtualDemoList } from './components/VirtualDemoList'
import { DemoDetailPanel } from './components/DemoDetailPanel'
import { ConsoleCommandField } from './components/ConsoleCommandField'
import { DemoStage } from './components/DemoStage'
import { DemoTimeline } from './components/DemoTimeline'
import { usePlaybackStore } from './playback-store'
import { useDemoPlay } from './useDemoPlay'
import { DemoListFilterBar } from './DemoListFilterBar'
import { findRowReplaceId, useDemoEditorStore, type RowPatcher } from './demo-editor-store'
import { ReplaceSidecarDialog } from './components/ReplaceSidecarDialog'
import { ModMissingConfirmDialog } from './components/ModMissingConfirmDialog'
import { rowWithSidecar } from './row-patch'
import {
  getListFilter,
  getListSort,
  indexRead,
  onScanProgress,
  scanStart,
  setListFilter,
  setListSort,
} from './client'
import { deriveReplaysListState } from './list-state'
import { sidesText } from './row-format'
import { ReplaysListStatus } from './ReplaysListStatus'

/** The list-beside-detail grid, mirroring `ServersView.tsx`'s own `detailSplit`/`DETAIL_PANE`
 * (read there first before changing this) - one slot until a demo is selected, then a fixed
 * 32rem detail pane beside it (or, below the `@4xl` container width, under it). On the stage the
 * list is hidden and the grid holds the detail pane alone, docked right of the stage. */
function detailSplit(detailOpen: boolean, stageMode: boolean): string {
  return cn(
    'grid h-full',
    detailOpen && !stageMode
      ? 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @4xl:grid-cols-[minmax(0,1fr)_32rem] @4xl:grid-rows-1'
      : 'grid-rows-1',
  )
}

const DETAIL_PANE = 'min-h-0 overflow-y-auto border-line bg-panel/40'

/** How long a filter change waits, un-typed, before it is persisted (story 153 D5) - mirrors the
 * "debounce writes, flush on unmount" shape without pulling in a new dependency. */
const FILTER_PERSIST_DEBOUNCE_MS = 300

/** Story 152 D3: maps a `DemoRow` (150's row model) to the fields `sortDemoRows` needs - `players`
 * mirrors exactly what `DemoRow.tsx` shows for its sides cell (`sidesText`, no translated "+n"
 * suffix here since the sort only ever compares the text, never renders it). */
function toSortFields(row: DemoRow): DemoSortFields {
  return {
    id: row.id,
    favourite: row.sidecar.values.favourite === true,
    rating: row.sidecar.values.rating ?? null,
    map: row.effective.map.value,
    mod: row.effective.mod.value,
    players: sidesText(row.effective.sides.value ?? []) || null,
    date: row.effective.date.value,
    durationMs: row.durationMs,
  }
}

/** A scan that hasn't reported anything yet - the placeholder before the first `scan.progress`
 * push arrives, so `ReplaysListStatus` always has something to render while `scanning` starts
 * `true` on mount. */
const IDLE_SCAN_PROGRESS: ReplaysScanProgress = {
  running: false,
  sources: [],
  sourceErrors: [],
}

/**
 * Story 141 D4: a minimal Demos list view - just enough to make AC "every discovered demo across
 * every installation and mod is listed" provable on a real surface. Mirrors `ServersView`'s header
 * markup (the `h1`/status-line toolbar shape); everything else there (scan controls, sort, filter,
 * detail pane, tabs) is out of scope for this deliverable.
 *
 * Story 144 D4: the index is read once on mount (cache-first - whatever `index.read` already has,
 * rendered at once, even if it's a stale/previous-run snapshot) and a background scan is kicked off
 * right behind it. `onScanProgress` is subscribed for the component's lifetime; only once a push
 * reports `running: false` is the index re-read and the whole list swapped in one go - never a
 * partial/incremental patch, matching the story's "single swap on completion" design. The refresh
 * button re-triggers the same `scanStart()` and is disabled while the latest known progress says a
 * scan is running.
 *
 * Story 158/159 D4: the list itself is now `VirtualDemoList` (a virtualised, selectable body built
 * on the D3 row/header/grid pieces), and selecting a row opens a side detail panel - shell only,
 * a later story fills in its content. A row that vanishes on a re-read (its id no longer in the new
 * list) clears the selection rather than leaving it pointed at a row that no longer renders.
 */
export function ReplaysView() {
  const { t } = useTranslation()
  const setRoute = useLauncher((state) => state.setRoute)
  const [demos, setDemos] = useState<DemoRow[] | null>(null)
  // Story 151 D3: the view always calls `scanStart()` on mount, so it starts out assuming a scan
  // is under way - flipped back to `false` only if that call itself resolves `ok: false` (refused
  // outright, never even started). A real `scan.progress` push takes over from there.
  const [scanning, setScanning] = useState(true)
  const [progress, setProgress] = useState<ReplaysScanProgress>(IDLE_SCAN_PROGRESS)
  const stageMode = usePlaybackStore((state) => state.stageArmed || state.session !== null)
  const selectedId = useDemoEditorStore((state) => state.selectedId)
  const selectDemo = useDemoEditorStore((state) => state.select)
  const closeDemo = useDemoEditorStore((state) => state.close)
  const drafts = useDemoEditorStore((state) => state.drafts)
  const editingId = useDemoEditorStore((state) => state.editingId)
  const cancelReplace = useDemoEditorStore((state) => state.cancelReplace)
  const [sort, setSort] = useState<DemoListSort | null>(null)
  const [filter, setFilter] = useState<DemoListFilter>(EMPTY_DEMO_LIST_FILTER)
  // Story 153 D5: rows only render once both the index (`demos !== null`) and the persisted filter
  // have resolved - until then the view stays in 151's existing loading state.
  const [filterLoaded, setFilterLoaded] = useState(false)
  const cancelledRef = useRef(false)
  // Debounces `setListFilter` writes by 300ms - `filterDebounceRef` holds the pending timeout,
  // `pendingFilterRef` the latest not-yet-persisted value, so an unmount can flush it immediately
  // instead of losing the last, still-debounced change.
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFilterRef = useRef<DemoListFilter | null>(null)
  // Story 157 D4: a rename can move the very row the active filter was matching on (e.g. a
  // free-text search against the old file name) out from under itself. AC5 requires the renamed
  // row to keep its selection regardless, so its new id is pinned into `visibleDemos` below until
  // the user does something that supersedes the pin (picks a different filter, or another row).
  const pinnedRowIdRef = useRef<string | null>(null)

  // Story 152 D3: loads the persisted list sort once on mount - a failed read or no value
  // persisted both fall back to `null`, the default favourites-first order.
  useEffect(() => {
    let cancelled = false
    void getListSort().then((result) => {
      if (cancelled) return
      setSort(result.ok ? result.value : null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Story 153 D5: loads the persisted list filter once on mount, alongside the sort above - a
  // failed read falls back to `EMPTY_DEMO_LIST_FILTER`, same "nothing restricts the list" default
  // as `EMPTY_DEMO_LIST_FILTER` itself.
  useEffect(() => {
    let cancelled = false
    void getListFilter().then((result) => {
      if (cancelled) return
      setFilter(result.ok ? result.value : EMPTY_DEMO_LIST_FILTER)
      setFilterLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Story 153 D5: flushes a still-pending debounced write on unmount, so navigating away right
  // after a filter change never drops it.
  useEffect(() => {
    return () => {
      if (filterDebounceRef.current !== null) {
        clearTimeout(filterDebounceRef.current)
        filterDebounceRef.current = null
        if (pendingFilterRef.current !== null) {
          void setListFilter(pendingFilterRef.current)
          pendingFilterRef.current = null
        }
      }
    }
  }, [])

  const handleSort = (column: DemoSortColumn): void => {
    const next = nextSort(sort, column)
    setSort(next)
    void setListSort(next).then((result) => {
      setSort(result.ok ? result.value : null)
    })
  }

  const handleFilterChange = (next: DemoListFilter): void => {
    pinnedRowIdRef.current = null
    setFilter(next)
    pendingFilterRef.current = next
    if (filterDebounceRef.current !== null) clearTimeout(filterDebounceRef.current)
    filterDebounceRef.current = setTimeout(() => {
      filterDebounceRef.current = null
      const toPersist = pendingFilterRef.current
      pendingFilterRef.current = null
      if (toPersist === null) return
      void setListFilter(toPersist)
    }, FILTER_PERSIST_DEBOUNCE_MS)
  }

  useEffect(() => {
    cancelledRef.current = false

    function applyDemos(next: DemoRow[]): void {
      setDemos(next)
      useDemoEditorStore.getState().deselectIfMissing(next.map((demo) => demo.id))
    }

    void indexRead().then((result) => {
      if (cancelledRef.current) return
      applyDemos(result.ok ? result.value : [])
    })
    void scanStart().then((result) => {
      if (cancelledRef.current) return
      if (!result.ok) setScanning(false)
    })

    const unsubscribe = onScanProgress((next) => {
      if (cancelledRef.current) return
      setScanning(next.running)
      setProgress(next)
      if (!next.running) {
        void indexRead().then((result) => {
          if (cancelledRef.current) return
          applyDemos(result.ok ? result.value : [])
        })
      }
    })

    return () => {
      cancelledRef.current = true
      unsubscribe()
    }
  }, [])

  // Story 151 D3: mirrors `ServersView.tsx`'s `handleOpenSourceSettings` - the route change lands
  // on the next render commit, so two rAFs (one for the commit, one for the browser's next paint)
  // is the smallest wait that reliably sees `settings-section-replays` in the DOM before scrolling.
  const handleOpenSettings = (): void => {
    setRoute(ROUTE_SETTINGS)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .querySelector('[data-testid="settings-section-replays"]')
          ?.scrollIntoView({ block: 'start' })
      })
    })
  }

  // Story 155: a notes save patches just that one row from its fresh `sidecar.read` - no rescan,
  // no `index.read`, so the list keeps its place and no loading strip flashes.
  const handleRowPatched: RowPatcher = (demoId, sidecar) => {
    setDemos((current) =>
      current === null
        ? current
        : current.map((demo) => (demo.id === demoId ? rowWithSidecar(demo, sidecar) : demo)),
    )
  }

  // Story 157 D4: a rename swaps the row's id (and file name) out from under the selection - the
  // list is patched in place (old id -> the freshly composed row) and the selection follows the
  // new id, mirroring `handleRowPatched`'s "patch, never rescan" shape.
  const handleRenamed = (oldId: string, newRow: DemoRow): void => {
    setDemos((current) => (current === null ? current : current.map((d) => (d.id === oldId ? newRow : d))))
    pinnedRowIdRef.current = newRow.id
    selectDemo(newRow.id)
  }

  const rowCount = demos?.length ?? 0
  const listState = deriveReplaysListState({ scanning, rowCount })
  const selected = demos?.find((demo) => demo.id === selectedId) ?? null

  // Story 180 D2: the action bar's primary button on this tab is "View" - it plays the selected
  // demo. The published object must stay stable (the contribution effect republishes on every new
  // identity), so `run` never changes; it reads the latest `play` - the one rendered for the
  // currently selected row - through a ref, never a stale closure over an earlier selection.
  const { eligibility, busy: playBusy, error: playError, play } = useDemoPlay(selected)
  // Story 180 D3: a mod-missing refusal is a warning, not a wall - View stays enabled, the reason
  // stays as the readout note, and `run` asks first (the dialog below) instead of playing.
  const askFirst = eligibility !== null && !eligibility.ok && eligibility.acknowledgeable === true
  const [confirmingModMissing, setConfirmingModMissing] = useState(false)
  const playRef = useRef({ play, askFirst })
  useLayoutEffect(() => {
    playRef.current = { play, askFirst }
  })
  const runPlay = useCallback(() => {
    const latest = playRef.current
    if (latest.askFirst) setConfirmingModMissing(true)
    else void latest.play()
  }, [])
  const hasSelection = selected !== null
  const viewAction = useMemo<ContributedAction>(
    () => ({
      id: 'view',
      labelKey: 'installation.action.view',
      disabled: !hasSelection || eligibility === null || (!eligibility.ok && !askFirst) || playBusy,
      ...(hasSelection && eligibility !== null && !eligibility.ok ? { reason: eligibility.reason } : {}),
      ...(playError ? { error: playError } : {}),
      run: runPlay,
    }),
    [hasSelection, eligibility, askFirst, playBusy, playError, runPlay],
  )
  usePrimaryActionContribution('/replays', viewAction)
  const sortedDemos = useMemo(() => sortDemoRows(demos ?? [], sort, toSortFields), [demos, sort])
  // Story 153 D5: filtered AFTER sort, never touching sort state itself - filtering only narrows
  // the already-sorted list. Options are computed over the whole index, not the filtered subset.
  const filterOptions = useMemo(
    () => demoFilterOptions((demos ?? []).map(demoFilterSubject)),
    [demos],
  )
  // Story 155: every demo's own sidecar tags, for the notes editor's tag-suggestion input -
  // `suggestTags` excludes the current draft's own tags itself, so duplicates here are harmless.
  const otherDemosTags = useMemo(() => (demos ?? []).map((demo) => demo.sidecar.values.tags ?? []), [demos])
  const visibleDemos = useMemo(() => {
    const filtered = filterDemos(sortedDemos, filter, demoFilterSubject, Date.now())
    const pinnedId = pinnedRowIdRef.current
    if (pinnedId === null || filtered.some((demo) => demo.id === pinnedId)) return filtered
    const pinnedRow = sortedDemos.find((demo) => demo.id === pinnedId)
    if (pinnedRow === undefined) return filtered
    const visibleIds = new Set(filtered.map((demo) => demo.id))
    visibleIds.add(pinnedId)
    // Keep `sortedDemos`'s own order - the pinned row is inserted at its natural sorted position,
    // not tacked onto the end.
    return sortedDemos.filter((demo) => visibleIds.has(demo.id))
  }, [sortedDemos, filter])

  // A row filtered out from under the current selection is deselected - mirrors `ServersView`'s
  // own filter-driven deselect. Not before the index has loaded: a remount (module switch) starts
  // with no rows at all, and deselecting then would drop a demo left in edit mode (story 178).
  useEffect(() => {
    if (demos === null) return
    useDemoEditorStore.getState().deselectIfMissing(visibleDemos.map((demo) => demo.id))
  }, [demos, visibleDemos])

  // Story 155 D6: a quick edit from the row (favourite/rating) reuses the very same
  // `entry.replace`/`ReplaceSidecarDialog` mechanism the open editor's own Save uses - this only
  // renders it for a demo whose editor isn't the one already showing it (`DemoDetailEditor` renders
  // it itself while that demo is in edit mode, story 178).
  const rowReplaceId = findRowReplaceId(drafts, selectedId, editingId)
  const rowReplaceEntry = rowReplaceId !== undefined ? drafts[rowReplaceId] : undefined


  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
            {t('replays.view.title')}
          </h1>
        </div>
        <Button
          variant="neutral"
          onClick={() => void scanStart()}
          disabled={scanning}
          data-testid="replays-refresh"
        >
          {scanning ? t('replays.list.refreshing') : t('replays.list.refresh')}
        </Button>
      </header>

      <ReplaysListStatus listState={listState} progress={progress} onOpenSettings={handleOpenSettings} />

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'w-56 shrink-0 overflow-y-auto border-r border-line bg-panel/60 p-4',
            stageMode && 'hidden',
          )}
          aria-label={t('replays.filter.title')}
        >
          <DemoListFilterBar
            filter={filter}
            onChange={handleFilterChange}
            options={filterOptions}
            shown={visibleDemos.length}
            total={rowCount}
          />
        </aside>

        {stageMode && <DemoStage />}
        <div
          className={cn(
            '@container min-h-0 min-w-0',
            !stageMode ? 'flex-1' : selected ? 'w-[32rem] shrink-0' : 'hidden',
          )}
          data-testid="replays-list-detail"
        >
          <div className={detailSplit(selected !== null, stageMode)}>
            <div className={cn('flex min-h-0 flex-col p-5', stageMode && 'hidden')}>
              {demos !== null && filterLoaded && rowCount > 0 && visibleDemos.length === 0 && (
                <div
                  className="flex flex-col items-center gap-3 px-6 py-12 text-center"
                  data-testid="replays-filter-no-match"
                >
                  <p className="text-xs text-ink-muted">{t('replays.filter.noMatch')}</p>
                  <Button
                    variant="neutral"
                    size="sm"
                    onClick={() => handleFilterChange(EMPTY_DEMO_LIST_FILTER)}
                    data-testid="replays-filter-no-match-clear"
                  >
                    {t('replays.filter.clear')}
                  </Button>
                </div>
              )}
              {demos !== null && filterLoaded && rowCount > 0 && visibleDemos.length > 0 && (
                <VirtualDemoList
                  rows={visibleDemos}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    if (id !== pinnedRowIdRef.current) pinnedRowIdRef.current = null
                    selectDemo(id)
                  }}
                  onRowPatched={handleRowPatched}
                  sort={sort}
                  onSort={handleSort}
                />
              )}
            </div>

            {selected && (
              <div className={cn(DETAIL_PANE, stageMode ? 'border-l' : 'border-t @4xl:border-t-0 @4xl:border-l')}>
                <DemoDetailPanel
                  row={selected}
                  onClose={() => {
                    pinnedRowIdRef.current = null
                    closeDemo()
                  }}
                  onRowPatched={handleRowPatched}
                  onRenamed={handleRenamed}
                  otherDemosTags={otherDemosTags}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={cn(stageMode && 'h-32 shrink-0 overflow-hidden')} data-testid="replays-timeline-slot">
        <DemoTimeline />
      </div>
      {stageMode && <ConsoleCommandField />}

      {confirmingModMissing && askFirst && eligibility !== null && !eligibility.ok && (
        <ModMissingConfirmDialog
          gameDir={String(eligibility.reason.params?.gameDir ?? '')}
          onCancel={() => setConfirmingModMissing(false)}
          onConfirm={() => {
            setConfirmingModMissing(false)
            void play(true)
          }}
        />
      )}

      {rowReplaceId !== undefined && rowReplaceEntry?.replace !== undefined && (
        <ReplaceSidecarDialog
          fileName={rowReplaceEntry.replace.fileName}
          issues={rowReplaceEntry.replace.issues}
          onConfirm={() => void useDemoEditorStore.getState().confirmQuickEdit(rowReplaceId, handleRowPatched)}
          onCancel={() => cancelReplace(rowReplaceId)}
        />
      )}
    </div>
  )
}
