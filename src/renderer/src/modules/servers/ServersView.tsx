import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  type ScanBlockedReason,
  type ScanSnapshot,
  type ServerListRow,
  type ServersScanState,
  type WatchlistMatch,
} from '@shared/modules/servers'
import {
  EMPTY_SERVER_LIST_FILTER,
  filterOptions,
  filterServers,
  type ServerListFilter,
} from '@shared/servers/list-filter'
import {
  nextSort,
  sortServerRows,
  type ServerListSort,
  type ServerSortColumn,
} from '@shared/servers/list-sort'
import { RefreshCw, Star } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useFeatureUnlocked } from '../../components/features/FeatureGate'
import { StatusDot } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { ROUTE_SETTINGS, useLauncher } from '../../store/useLauncher'
import {
  getListSort,
  listMasterSources,
  onScanChanged,
  onScanServer,
  readScan,
  setListSort,
  setScanViewActive,
  startScan,
} from './client'
import { deriveListState } from './list-state'
import { JoinServerButton } from './join/JoinServerButton'
import { ServerDetailView } from './ServerDetailView'
import { ServerListFilterBar } from './ServerListFilterBar'
import { ServerListHeader } from './ServerListHeader'
import { ServerRow } from './ServerRow'
import { ServersListStatus } from './ServersListStatus'
import { ServersTabStrip, type ServersTab } from './ServersTabStrip'
import { WatchlistPanel } from './watchlist/WatchlistPanel'

/** Story 116 D5: the visible reason for each `ScanBlockedReason` - a lookup table of one entry
 * today, future-proof if a later story adds another blocked reason (mirrors `write-guard.ts`'s
 * `WAITING_REASON_GAME_RUNNING` -> `jobs.waiting.gameRunning` single-entry convention). */
const BLOCKED_REASON_KEYS: Record<ScanBlockedReason, string> = {
  'game-running': SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
}

/**
 * Story 117 D5: the same i18n key `ScanService` (`main/modules/servers/scan-service.ts`,
 * `SCAN_ALREADY_RUNNING_REASON_KEY`) already uses for a refused `scan.start` - that file is
 * main-only and cannot be imported here (electron-arch), so the literal key is reused directly
 * rather than inventing a second string with the same meaning.
 */
const SCAN_BUSY_REASON_KEY = 'servers.scan.error.already-running'

/** A scan that has never run and nothing known yet - `scan.read`'s own shape for a fresh
 * `ServersState` (mirrors `main/modules/servers/scan-runner.ts`'s initial state), used here only
 * as the pre-`readScan()` placeholder so the status readout always has something to render. */
const IDLE_SCAN_STATE: ServersScanState = {
  running: false,
  phase: 'idle',
  stage1Done: 0,
  stage1Total: 0,
  stage2Done: 0,
  stage2Total: 0,
  sourceFailures: [],
  startedAt: null,
  finishedAt: null,
  blockedReason: null,
  scope: null,
}

/**
 * Story 115 D5: a deliberately minimal stand-in for the Servers view - just enough surface for
 * AC3 ("manual scan is available regardless of the auto settings"). The real server list, its
 * sorting/filtering and favourites-in-list are [[118]]/[[121]]'s job, not this one (Decisions) -
 * this view exists solely to give the manual refresh control somewhere real to live.
 *
 * Mounts -> `setScanViewActive(true)` (D3's cadence signal that the view is open) and a one-shot
 * `readScan()` for the current snapshot; unmounts -> `setScanViewActive(false)`. Everything after
 * the initial read arrives through `onScanChanged` - nothing here polls (mirrors `client.ts`'s own
 * "AC5: nothing in the renderer polls for progress" discipline). `onScanServer`'s pushes carry a
 * per-reply-attempt row, not a merged `ServerListEntry`, so they cannot update `entries`
 * incrementally - instead, a `scan.changed` push whose `finishedAt` just advanced (a completed
 * round - the same moment story 116 D4's stale-flip runs) triggers exactly one `readScan()` to
 * refresh the list; this is still push-driven, not polling.
 *
 * Story 116 D5: the refresh button is also disabled - and its testid renamed from
 * `servers-manual-refresh` to `servers-refresh` - while `scanState.blockedReason` is non-null (the
 * game is running), with the reason rendered as real text above it (`servers-scan-blocked`,
 * mirrors `JobRow.tsx`'s waiting-reason line). Main stays authoritative regardless (D-H): this
 * disabled state is convenience only, `scan.start` refuses the call either way. Otherwise the
 * button is always enabled, even mid-scan (`scan.start` refuses a concurrent start harmlessly -
 * D-L - so re-clicking is safe) and never gated by `autoScanOnOpen`/`autoRefreshEnabled`.
 *
 * A minimal row list (address, player count if known, and a `servers.row.stale` label for
 * `status: 'stale'` rows) renders below the status line - deliberately bare per D-K, just enough
 * to make AC3's stale indication provable on a real surface; the "real" server-list design is a
 * later story's job.
 *
 * Story 117 D5: three scoped refresh controls replace the single always-on refresh button.
 * `servers-refresh` keeps its identity (testid, `{kind:'all'}`) - `scripts/flows/
 * servers-no-scan-while-playing.mjs` depends on it existing - and gains two siblings:
 * `servers-refresh-favourites` (`{kind:'favourites'}`) and `servers-refresh-selected`
 * (`{kind:'server', address}`), the latter only meaningful once a row is clicked to select it
 * (`selectedAddress`, purely local - no selection concept existed before this D). All three are
 * now disabled while `scanState.running` too, not just while blocked (a deliberate reversal of
 * 115/116's "re-clicking is safe" - this story's own Decisions: a refresh requested while any scan
 * runs is refused, not queued, and the controls render disabled with that reason rather than
 * silently dropping the click), each with its own visible reason line rather than a silent no-op.
 *
 * Story 121 D1: a `ServersListStatus` panel now sits between the controls and the row list,
 * driven by `deriveListState`/`describeScanProgress` (`list-state.ts`, pure and unit-tested on
 * their own) - loading progress, an empty state with a link into the source-settings section, an
 * idle "never scanned" state, and per-source scan failures (independent of the other three,
 * rendered whenever `scanState.sourceFailures` is non-empty). `onScanServer` is now also
 * subscribed here: each push schedules a coalesced `readScan()` (at most one read in flight, plus
 * one trailing read if more pushes land while a read is outstanding) so the row list streams in
 * live during a scan rather than waiting for the round-end re-read alone - that existing
 * round-end re-read (D4 above) is unchanged. `sourceLabels` (source id -> its address) is read via
 * `listMasterSources()` on mount and again whenever a new, not-yet-labelled source id shows up in
 * `sourceFailures`, so a failure is always named by its human-readable address, never a raw id.
 *
 * `servers-refresh-selected` and the address-book action now live in the detail pane
 * (`ServerDetailHeader`) - both only ever meant the selected server, which is what that pane shows.
 */
export function ServersView() {
  const { t } = useTranslation()
  const setRoute = useLauncher((state) => state.setRoute)
  const [scanState, setScanState] = useState<ServersScanState>(IDLE_SCAN_STATE)
  const [entries, setEntries] = useState<ServerListRow[]>([])
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const [sort, setSort] = useState<ServerListSort | undefined>(undefined)
  // Story 120 D2: purely local, not persisted anywhere - a fresh mount always starts unfiltered.
  const [filter, setFilter] = useState<ServerListFilter>(EMPTY_SERVER_LIST_FILTER)
  // Story 121 D1: source id -> its human-readable address, for naming a `sourceFailures` entry.
  const [sourceLabels, setSourceLabels] = useState<Record<string, string>>({})
  // Story 132 D3: purely local, like `selectedAddress` above - a fresh mount always starts on the
  // list tab. The tab strip itself only renders (and can only switch this away from 'list') once
  // the `watchlist` feature is unlocked - see `ServersTabStrip`.
  const [activeTab, setActiveTab] = useState<ServersTab>('list')
  // Story 132 clean-code fix: gate the panel body with the plain boolean instead of a second
  // `<FeatureGate>` - `ServersTabStrip` already renders the one `ExperimentalBadge` next to the
  // tab label, so a second `FeatureGate` here would render a second, unanchored badge.
  const isWatchlistUnlocked = useFeatureUnlocked('watchlist')
  // Tracks the last-seen `finishedAt` so a `scan.changed` push is only treated as "a round just
  // finished" (and triggers the one extra `readScan()` below) once, not on every progress-only
  // push during stage1/stage2 - a ref because it must not itself trigger a re-render.
  const lastFinishedAtRef = useRef<string | null>(null)
  // Story 121 D1: coalesces `onScanServer` pushes into at most one `readScan()` in flight, plus one
  // trailing read scheduled if more pushes arrive while a read is outstanding - streams the row
  // list live during a scan without ever letting reads pile up.
  const readInFlightRef = useRef(false)
  const readPendingRef = useRef(false)
  // Mirrors `sourceLabels` for the effect below to read without depending on it directly - a
  // dependency on the state value itself would re-fire every time `setSourceLabels` produces a new
  // object (including an unchanged empty `{}`), looping forever.
  const sourceLabelsRef = useRef<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    const requestCoalescedRead = (): void => {
      if (cancelled) return
      if (readInFlightRef.current) {
        readPendingRef.current = true
        return
      }
      readInFlightRef.current = true
      void readScan().then((result) => {
        readInFlightRef.current = false
        if (!cancelled && result.ok) setEntries(result.value.entries)
        if (readPendingRef.current) {
          readPendingRef.current = false
          requestCoalescedRead()
        }
      })
    }

    void setScanViewActive(true)

    void readScan().then((result) => {
      if (cancelled || !result.ok) return
      const snapshot: ScanSnapshot = result.value
      setScanState(snapshot.state)
      setEntries(snapshot.entries)
      lastFinishedAtRef.current = snapshot.state.finishedAt
    })

    const unsubscribeChanged = onScanChanged((state) => {
      if (cancelled) return
      setScanState(state)

      // AC3/D4: a completed round is the moment stale flips - react to it here with a single
      // reactive re-read (still push-driven, not polling: one extra read per finished round, same
      // discipline `client.ts`'s own AC5 doc comment commits to), not on every progress push.
      if (!state.running && state.finishedAt !== lastFinishedAtRef.current) {
        lastFinishedAtRef.current = state.finishedAt
        void readScan().then((result) => {
          if (!cancelled && result.ok) setEntries(result.value.entries)
        })
      }
    })

    // Story 121 D1: each resolved row streams the list live, coalesced so a burst of pushes never
    // queues more than one extra `readScan()`.
    const unsubscribeServer = onScanServer(() => {
      requestCoalescedRead()
    })

    return () => {
      cancelled = true
      unsubscribeChanged()
      unsubscribeServer()
      void setScanViewActive(false)
    }
  }, [])

  // Story 121 D1: resolves the current master sources into an id -> address label map, once on
  // mount and again whenever a source failure names an id not yet in the map (a source added after
  // mount, or added to `sourceFailures` before the initial list resolved).
  useEffect(() => {
    const missing = scanState.sourceFailures.some(
      (failure) => !(failure.sourceId in sourceLabelsRef.current),
    )
    if (Object.keys(sourceLabelsRef.current).length > 0 && !missing) return

    let cancelled = false
    void listMasterSources().then((result) => {
      if (cancelled || !result.ok) return
      const labels: Record<string, string> = {}
      for (const source of result.value) labels[source.id] = source.address
      sourceLabelsRef.current = labels
      setSourceLabels(labels)
    })
    return () => {
      cancelled = true
    }
  }, [scanState.sourceFailures])

  // Story 119 D3: loads the persisted list sort once on mount - `null` (no sort persisted, or the
  // read failed) maps to `undefined`, the same "default order" value `sortServerRows` expects.
  useEffect(() => {
    let cancelled = false
    void getListSort().then((result) => {
      if (cancelled) return
      setSort(result.ok && result.value !== null ? result.value : undefined)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSort = (column: ServerSortColumn): void => {
    const next = nextSort(sort, column)
    setSort(next)
    void setListSort(next ?? null).then((result) => {
      setSort(result.ok && result.value !== null ? result.value : undefined)
    })
  }

  const handleRefresh = (): void => {
    // Review fix (story 117): a full scan still carries 114 AC2's own "currently selected server"
    // concept - this view is the first to actually have a selection (`selectedAddress`, added by
    // this story's D5) - so the server the user has highlighted still gets a stage-2 `status`
    // query even if stage 1 reports it empty, exactly as 114 always intended for a full sweep.
    // `undefined` when nothing is selected is the same as today's unchanged behavior.
    void startScan({ kind: 'all' }, selectedAddress ?? undefined)
  }

  const handleRefreshFavourites = (): void => {
    void startScan({ kind: 'favourites' })
  }

  const handleRefreshSelected = (): void => {
    if (selectedAddress === null) return
    void startScan({ kind: 'server', address: selectedAddress })
  }

  // A favourite toggled in the detail pane - re-read so the row's star/badge follows.
  const handleFavouriteChanged = (): void => {
    void readScan().then((result) => {
      if (result.ok) setEntries(result.value.entries)
    })
  }

  const handleToggleRowSelected = (address: string): void => {
    setSelectedAddress((current) => (current === address ? null : address))
  }

  // Story 121 D1: mirrors `UpdatePopover.tsx`'s `goToAbout` - the route change lands on the next
  // render commit, so two rAFs (one for the commit, one for the browser's next paint) is the
  // smallest wait that reliably sees `settings-section-servers` in the DOM before scrolling.
  const handleOpenSourceSettings = (): void => {
    setRoute(ROUTE_SETTINGS)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .querySelector('[data-testid="settings-section-servers"]')
          ?.scrollIntoView({ block: 'start' })
      })
    })
  }

  // Story 132 D3: the watchlist panel's own actions column, wired to this view's real
  // Join (never reimplemented - AC3/AC4) and its own selection/tab state. A match with no
  // live row (a race between the watchlist's own scan and this view's `entries`) renders nothing -
  // never a fallback Join for a server the view doesn't currently know about.
  const renderMatchActions = (match: WatchlistMatch): ReactNode => {
    const row = entries.find((entry) => entry.address === match.address)
    if (!row) return null
    return (
      <div className="flex items-center gap-2">
        <JoinServerButton row={row} />
        <Button
          variant="ghost"
          onClick={() => {
            setActiveTab('list')
            setSelectedAddress(match.address)
          }}
          data-testid={`servers-watchlist-open-detail-${match.address}`}
        >
          {t('servers.detail.title')}
        </Button>
      </div>
    )
  }

  const sortedRows = sortServerRows(entries, sort)
  const visible = filterServers(sortedRows, filter)

  // Story 120 D2: a row that filters out from under the current selection is deselected - a
  // selection referring to a row that isn't even shown would silently keep driving "Refresh this
  // server" against an address the user can no longer see or pick again.
  useEffect(() => {
    if (selectedAddress !== null && !visible.some((row) => row.address === selectedAddress)) {
      setSelectedAddress(null)
    }
  }, [selectedAddress, visible])

  const stateLabel = t(
    scanState.running ? 'module.servers.view.status.scanning' : 'module.servers.view.status.idle',
  )
  const sortCaption =
    sort === undefined
      ? t('servers.sort.current.default')
      : t('servers.sort.current.column', {
          column: t(`servers.sort.column.${sort.column}`),
          direction: t(`servers.sort.direction.${sort.direction}`),
        })
  const isBlocked = scanState.blockedReason !== null
  const isBusy = scanState.running
  const isRefreshDisabled = isBlocked || isBusy

  // The toolbar: title + live status line on the left, the scoped refresh controls on the right,
  // every disabled control's visible reason underneath.
  const toolbar = (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
      <div className="min-w-0 space-y-1">
        <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
          {t('module.servers.title')}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          <StatusDot className={isBusy ? 'bg-strogg-500' : 'bg-ink-faint'} pulse={isBusy} />
          <span
            data-testid="servers-scan-status"
            // `data-running`/`data-finished-at` are test-observability attributes, not
            // user-facing text (the visible label is the i18n-driven one) - a flow that clicks the
            // refresh button has nothing else to poll for "a scan visibly ran" that isn't racy
            // against how fast a scan against a single dead loopback target finishes.
            data-running={scanState.running}
            data-finished-at={scanState.finishedAt ?? ''}
          >
            {t('module.servers.view.status.line', {
              state: stateLabel,
              count: entries.length,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="servers-sort-current">{sortCaption}</span>
        </p>
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="neutral"
            size="sm"
            icon={
              <RefreshCw className={cn('size-3.5', isBusy && 'animate-spin')} aria-hidden="true" />
            }
            onClick={handleRefresh}
            disabled={isRefreshDisabled}
            data-testid="servers-refresh"
          >
            {t('module.servers.view.refresh')}
          </Button>
          <Button
            variant="neutral"
            size="sm"
            icon={<Star className="size-3.5" aria-hidden="true" />}
            onClick={handleRefreshFavourites}
            disabled={isRefreshDisabled}
            data-testid="servers-refresh-favourites"
          >
            {t('module.servers.view.refreshFavourites')}
          </Button>
        </div>
        {isBlocked && scanState.blockedReason && (
          <p className="text-xs text-warning" data-testid="servers-scan-blocked">
            {t(BLOCKED_REASON_KEYS[scanState.blockedReason])}
          </p>
        )}
        {isBusy && !isBlocked && (
          <p className="text-xs text-warning" data-testid="servers-scan-busy">
            {t(SCAN_BUSY_REASON_KEY)}
          </p>
        )}
      </div>
    </header>
  )

  const table =
    visible.length === 0 && entries.length > 0 ? (
      <div
        className="flex flex-col items-center gap-3 px-6 py-12 text-center"
        data-testid="servers-filter-no-match"
      >
        <p className="text-xs text-ink-muted">{t('servers.filter.noMatch')}</p>
        <Button
          variant="neutral"
          size="sm"
          onClick={() => setFilter(EMPTY_SERVER_LIST_FILTER)}
          data-testid="servers-filter-no-match-clear"
        >
          {t('servers.filter.clear')}
        </Button>
      </div>
    ) : (
      <>
        <ServerListHeader sort={sort} onSort={handleSort} />
        {visible.map((entry) => (
          <ServerRow
            key={entry.address}
            row={entry}
            selected={entry.address === selectedAddress}
            onSelect={handleToggleRowSelected}
          />
        ))}
        {visible.length > 0 && selectedAddress === null && (
          <p className="px-5 py-3 text-xs text-ink-muted">{t('servers.list.selectedHint')}</p>
        )}
      </>
    )

  // Story 122 D3: selecting a row opens the detail pane beside the list, each scrolling
  // independently (`min-h-0 overflow-y-auto` on both). The outer structure (this same grid, the
  // list always in the first slot) never swaps out - only the class list and whether the second
  // slot is present change - so an already-selected row's DOM node (and every existing test that
  // holds a reference to it, e.g. across a click-then-assert pair) survives a selection change
  // instead of being unmounted and recreated as a stale node. Below the `@4xl` container width
  // (the 940px minimum window) the pane stacks under the list instead of squeezing it.
  //
  // Story 132 D3: this whole block is only one of two tabs.
  const listAndDetail = (
    <div className="flex h-full min-h-0">
      <aside
        className="w-56 shrink-0 overflow-y-auto border-r border-line bg-panel/60 p-4"
        aria-label={t('servers.filter.title')}
      >
        <ServerListFilterBar
          filter={filter}
          onChange={setFilter}
          options={filterOptions(entries)}
          shown={visible.length}
          total={entries.length}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {toolbar}
        <div className="@container min-h-0 flex-1">
          <div
            className={cn(
              'grid h-full',
              selectedAddress === null
                ? 'grid-rows-1'
                : 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @4xl:grid-cols-[minmax(0,1fr)_28rem] @4xl:grid-rows-1',
            )}
          >
            <div className="flex min-h-0 flex-col">
              <ServersListStatus
                listState={deriveListState(scanState, entries.length)}
                scanState={scanState}
                sourceLabels={sourceLabels}
                onOpenSourceSettings={handleOpenSourceSettings}
              />
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable">{table}</div>
            </div>
            {selectedAddress !== null && (
              <div className="min-h-0 overflow-y-auto border-t border-line bg-panel/40 @4xl:border-t-0 @4xl:border-l">
                <ServerDetailView
                  address={selectedAddress}
                  onClose={() => setSelectedAddress(null)}
                  onRefresh={handleRefreshSelected}
                  refreshDisabled={isRefreshDisabled}
                  refreshing={isBusy}
                  onFavouriteChanged={handleFavouriteChanged}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <ServersTabStrip activeTab={activeTab} onChange={setActiveTab} />
      <div className="min-h-0 flex-1">
        {activeTab === 'watchlist'
          ? isWatchlistUnlocked && (
              <div className="mx-auto w-full max-w-3xl overflow-y-auto p-6">
                <WatchlistPanel renderMatchActions={renderMatchActions} />
              </div>
            )
          : listAndDetail}
      </div>
    </div>
  )
}
