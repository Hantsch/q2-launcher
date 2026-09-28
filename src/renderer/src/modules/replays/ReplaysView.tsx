import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { DemoRow, ReplaysScanProgress } from '@shared/modules/replays'
import {
  nextSort,
  sortDemoRows,
  type DemoListSort,
  type DemoSortColumn,
  type DemoSortFields,
} from '@shared/replays/list-sort'
import { Button, IconButton } from '../../components/ui/Button'
import { ROUTE_SETTINGS, useLauncher } from '../../store/useLauncher'
import { VirtualDemoList } from './components/VirtualDemoList'
import { getListSort, indexRead, onScanProgress, scanStart, setListSort } from './client'
import { deriveReplaysListState } from './list-state'
import { sidesText } from './row-format'
import { ReplaysListStatus } from './ReplaysListStatus'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sort, setSort] = useState<DemoListSort | null>(null)
  const cancelledRef = useRef(false)

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

  const handleSort = (column: DemoSortColumn): void => {
    const next = nextSort(sort, column)
    setSort(next)
    void setListSort(next).then((result) => {
      setSort(result.ok ? result.value : null)
    })
  }

  useEffect(() => {
    cancelledRef.current = false

    function applyDemos(next: DemoRow[]): void {
      setDemos(next)
      setSelectedId((current) => {
        if (current === null) return current
        return next.some((demo) => demo.id === current) ? current : null
      })
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

  const rowCount = demos?.length ?? 0
  const listState = deriveReplaysListState({ scanning, rowCount })
  const selected = demos?.find((demo) => demo.id === selectedId) ?? null
  const sortedDemos = useMemo(() => sortDemoRows(demos ?? [], sort, toSortFields), [demos, sort])
  const sortCaption =
    sort === null
      ? t('replays.sort.current.default')
      : t('replays.sort.current.column', {
          column: t(`replays.sort.column.${sort.column}`),
          direction: t(`replays.sort.direction.${sort.direction}`),
        })

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
      <p className="px-5 pt-2 text-xs text-ink-muted" data-testid="replays-sort-current">
        {sortCaption}
      </p>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-5">
          {rowCount > 0 && (
            <VirtualDemoList
              rows={sortedDemos}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              sort={sort}
              onSort={handleSort}
            />
          )}
        </div>

        {selected && (
          <aside
            data-testid="replays-demo-detail"
            className="flex w-80 shrink-0 flex-col border-l border-line p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                className="min-w-0 truncate text-sm font-medium text-ink"
                data-testid="replays-demo-detail-title"
              >
                {selected.effective.name.value ?? selected.fileName}
              </h2>
              <IconButton
                label={t('replays.detail.close')}
                onClick={() => setSelectedId(null)}
                data-testid="replays-demo-detail-close"
              >
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
