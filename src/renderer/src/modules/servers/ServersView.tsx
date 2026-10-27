import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServerListRow, WatchlistMatch } from '@shared/modules/servers'
import {
  EMPTY_SERVER_LIST_FILTER,
  filterOptions,
  filterServers,
  isFilterActive,
  type ServerListFilter,
} from '@shared/servers/list-filter'
import { criteriaOf, type QuickFilter } from '@shared/servers/quick-filters'
import {
  nextSort,
  sortServerRows,
  type ServerListSort,
  type ServerSortColumn,
} from '@shared/servers/list-sort'
import { PanelRight } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useFeatureUnlocked } from '../../components/features/FeatureGate'
import { cn } from '../../lib/cn'
import { useListSort } from '../../lib/useListSort'
import { ROUTE_SETTINGS, useLauncher } from '../../store/useLauncher'
import { getListSort, setListSort } from './client'
import { deriveListState } from './list-state'
import { JoinServerButton } from './join/JoinServerButton'
import { ServerDetailView } from './ServerDetailView'
import { ServerListFilterBar } from './ServerListFilterBar'
import { QuickFilterChipMenu } from './QuickFilterChipMenu'
import { QuickFilterNameDialog } from './QuickFilterNameDialog'
import { ServerListHeader } from './ServerListHeader'
import { ServerRow } from './ServerRow'
import { scrollToSourceSettings } from './scrollToSourceSettings'
import { ServersListStatus } from './ServersListStatus'
import { TabPanel } from '../../components/ui/Tabs'
import { ServersTabStrip, type ServersTab } from './ServersTabStrip'
import { ServersToolbar } from './ServersToolbar'
import { useQuickFilters } from './useQuickFilters'
import { useRowNavigation } from './useRowNavigation'
import { useServerJoin } from './useServerJoin'
import { useServerScan } from './useServerScan'
import { WatchlistPanel } from './watchlist/WatchlistPanel'

/** The list-beside-detail grid both tabs share: one slot until a server is open (the list tab is
 * always open), then the detail pane sits beside the first slot (a fixed 32rem) or, below the `@4xl`
 * container width, under it. */
function detailSplit(detailOpen: boolean): string {
  return cn(
    'grid h-full',
    detailOpen
      ? 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @4xl:grid-cols-[minmax(0,1fr)_32rem] @4xl:grid-rows-1'
      : 'grid-rows-1',
  )
}

/** The detail pane scrolls, so it is focusable: a keyboard-only user can reach and scroll it
 * (axe's scrollable-region-focusable). The server detail inside is the named landmark. */
function DetailPane({ children }: { children: ReactNode }) {
  return (
    <div
      tabIndex={0}
      className="min-h-0 overflow-y-auto border-t border-line bg-panel/40 @4xl:border-t-0 @4xl:border-l"
    >
      {children}
    </div>
  )
}

/**
 * The Servers module view: the server list (filter rail, toolbar, status panel, sortable rows and
 * the selected server's detail pane) and, once unlocked, the watchlist tab with its own detail
 * pane. The scan itself - mount announce, pushes, streamed rows, mode - is `useServerScan`'s.
 * Selection, filter and tab are local and never persisted: a fresh mount starts on an unfiltered
 * Online list. The action bar's primary button joins the server in view.
 */
export function ServersView() {
  const { t } = useTranslation()
  const setRoute = useLauncher((state) => state.setRoute)
  const scan = useServerScan()
  const { scanState, entries, mode, lan } = scan
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const { sort, setSort } = useListSort<ServerListSort>(getListSort, setListSort)
  const [filter, setFilter] = useState<ServerListFilter>(EMPTY_SERVER_LIST_FILTER)
  const quickFilters = useQuickFilters()
  const [savingQuickFilter, setSavingQuickFilter] = useState(false)
  const [renamingQuickFilter, setRenamingQuickFilter] = useState<QuickFilter | null>(null)
  // The tab strip can only leave 'list' once the `watchlist` feature is unlocked.
  const [activeTab, setActiveTab] = useState<ServersTab>('list')
  // Separate from `selectedAddress` so opening a match's details never disturbs the list tab's
  // selection (or its filter-driven deselect below).
  const [watchlistDetailAddress, setWatchlistDetailAddress] = useState<string | null>(null)
  const isWatchlistUnlocked = useFeatureUnlocked('watchlist')

  const handleSort = (column: ServerSortColumn): void => {
    setSort(nextSort(sort, column))
  }

  const handleModeChange: typeof scan.changeMode = (next) => {
    if (next === mode) return
    setSelectedAddress(null)
    scan.changeMode(next)
  }

  const handleRowSelected = (address: string): void => {
    setSelectedAddress(address)
  }

  const handleOpenSourceSettings = (): void => {
    setRoute(ROUTE_SETTINGS)
    scrollToSourceSettings()
  }

  const resolveServer = (address: string): ServerListRow | undefined =>
    entries.find((entry) => entry.address === address)

  const join = useServerJoin(
    resolveServer,
    activeTab === 'watchlist' ? watchlistDetailAddress : selectedAddress,
  )

  // The watchlist's actions column reuses this view's real Join. A match with no live row (the
  // watchlist's own scan raced this view's `entries`) renders nothing - never a fallback Join for a
  // server the view doesn't know about.
  const renderMatchActions = (match: WatchlistMatch): ReactNode => {
    const row = resolveServer(match.address)
    if (!row) return null
    const open = watchlistDetailAddress === match.address
    return (
      <div className="flex shrink-0 items-center gap-2">
        <JoinServerButton row={row} />
        <Button
          variant={open ? 'neutral' : 'ghost'}
          aria-pressed={open}
          icon={<PanelRight className="size-4" aria-hidden="true" />}
          onClick={() => setWatchlistDetailAddress(open ? null : match.address)}
          data-testid={`servers-watchlist-open-detail-${match.address}`}
        >
          {t('servers.detail.title')}
        </Button>
      </div>
    )
  }

  const sortedRows = useMemo(() => sortServerRows(entries, sort), [entries, sort])
  const visible = useMemo(() => filterServers(sortedRows, filter), [sortedRows, filter])

  const { tableRef, navigate: handleRowNavigate } = useRowNavigation(
    visible,
    selectedAddress,
    setSelectedAddress,
  )

  const sortCaption =
    sort === null
      ? t('servers.sort.current.default')
      : t('servers.sort.current.column', {
          column: t(`servers.sort.column.${sort.column}`),
          direction: t(`servers.sort.direction.${sort.direction}`),
        })
  const isBusy = scanState.running
  const isRefreshDisabled = scanState.blockedReason !== null || isBusy

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
          {t('common.action.clearFilters')}
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
            onSelect={handleRowSelected}
            onJoin={join.joinAddress}
            onNavigate={handleRowNavigate}
            onActivate={join.doubleClickJoins ? join.joinAddress : undefined}
          />
        ))}
      </>
    )

  // The grid never swaps out - the list tab always shows both slots - so a selected row's
  // DOM node survives a selection change instead of being recreated.
  const listAndDetail = (
    <div className="flex h-full min-h-0">
      <aside
        className="w-56 shrink-0 overflow-y-auto border-r border-line bg-panel/60 p-4"
        aria-label={t('common.label.filters')}
      >
        <ServerListFilterBar
          filter={filter}
          onChange={setFilter}
          options={filterOptions(entries)}
          rows={entries}
          shown={visible.length}
          total={entries.length}
          quickFilters={quickFilters.list}
          onSaveQuickFilter={() => setSavingQuickFilter(true)}
          renderQuickFilterActions={(qf) => (
            <QuickFilterChipMenu
              quickFilter={qf}
              onRename={setRenamingQuickFilter}
              onDelete={(target) => void quickFilters.remove(target.id)}
            />
          )}
        />
        {renamingQuickFilter && (
          <QuickFilterNameDialog
            key={renamingQuickFilter.id}
            list={quickFilters.list}
            renameId={renamingQuickFilter.id}
            initialName={renamingQuickFilter.name}
            onClose={() => setRenamingQuickFilter(null)}
            onSubmit={(name) => quickFilters.rename({ id: renamingQuickFilter.id, name })}
          />
        )}
        {savingQuickFilter && (
          <QuickFilterNameDialog
            list={quickFilters.list}
            onClose={() => setSavingQuickFilter(false)}
            onSubmit={(name, overwrite) =>
              quickFilters.save({ name, criteria: criteriaOf(filter), overwrite })
            }
          />
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <ServersToolbar
          scanState={scanState}
          mode={mode}
          lan={lan}
          entryCount={entries.length}
          sortCaption={sortCaption}
          onModeChange={handleModeChange}
          filterActive={isFilterActive(filter)}
          shownCount={visible.length}
          onRefresh={() => scan.refresh(selectedAddress ?? undefined)}
          onRefreshShown={() =>
            scan.refreshShown(
              visible.map((row) => row.address),
              selectedAddress ?? undefined,
            )
          }
          onRefreshFavourites={scan.refreshFavourites}
        />
        <div className="@container min-h-0 flex-1">
          <div className={detailSplit(true)}>
            <div className="flex min-h-0 flex-col" data-testid="servers-list-column">
              <ServersListStatus
                listState={deriveListState(scanState, entries.length, mode, lan.lastFinishedAt)}
                mode={mode}
                scanState={scanState}
                sourceLabels={scan.sourceLabels}
                onOpenSourceSettings={handleOpenSourceSettings}
              />
              <div
                ref={tableRef}
                className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable"
              >
                {table}
              </div>
            </div>
            <DetailPane>
              <ServerDetailView
                address={selectedAddress}
                onRefresh={() => {
                  if (selectedAddress !== null) scan.refreshServer(selectedAddress)
                }}
                refreshDisabled={isRefreshDisabled}
                refreshing={isBusy}
                onFavouriteChanged={scan.rereadEntries}
              />
            </DetailPane>
          </div>
        </div>
      </div>
    </div>
  )

  const watchlistAndDetail = (
    <div className="@container h-full">
      <div className={detailSplit(watchlistDetailAddress !== null)}>
        <div className="min-h-0 overflow-y-auto p-6 scrollbar-gutter-stable">
          <div className="mx-auto w-full max-w-3xl">
            <WatchlistPanel
              renderMatchActions={renderMatchActions}
              resolveServer={resolveServer}
              selectedAddress={watchlistDetailAddress}
            />
          </div>
        </div>
        {watchlistDetailAddress !== null && (
          <DetailPane>
            <ServerDetailView
              address={watchlistDetailAddress}
              onRefresh={() => scan.refreshServer(watchlistDetailAddress)}
              refreshDisabled={isRefreshDisabled}
              refreshing={isBusy}
              onFavouriteChanged={scan.rereadEntries}
            />
          </DetailPane>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      {join.dialogs}
      <ServersTabStrip activeTab={activeTab} onChange={setActiveTab} />
      <TabPanel idBase="servers" tabId={activeTab} className="min-h-0 flex-1">
        {activeTab === 'watchlist' ? isWatchlistUnlocked && watchlistAndDetail : listAndDetail}
      </TabPanel>
    </div>
  )
}
