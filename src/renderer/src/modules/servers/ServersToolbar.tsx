import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, RefreshCw, Star } from 'lucide-react'
import {
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  type ScanBlockedReason,
  type ScanSnapshot,
  type ServersBrowseMode,
  type ServersScanState,
} from '@shared/modules/servers'
import { Button } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { ServersModeToggle } from './ServersModeToggle'

const BLOCKED_REASON_KEYS: Record<ScanBlockedReason, string> = {
  'game-running': SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
}

/** The key main's `ScanService` refuses a concurrent `scan.start` with; main-only, so not importable. */
const SCAN_BUSY_REASON_KEY = 'servers.scan.error.already-running'

export interface ServersToolbarProps {
  scanState: ServersScanState
  mode: ServersBrowseMode
  lan: ScanSnapshot['lan']
  entryCount: number
  sortCaption: string
  onModeChange: (next: ServersBrowseMode) => void
  /** A list filter narrows the rows: the primary button then refreshes just those. */
  filterActive: boolean
  shownCount: number
  /** Scans everything - "Scan now" without a filter, "Scan all" in the options menu with one. */
  onRefresh: () => void
  onRefreshShown: () => void
  onRefreshFavourites: () => void
}

/**
 * Title + live status line on the left, the scoped refresh controls on the right, and every
 * disabled control's visible reason underneath. The controls are disabled while a scan runs or the
 * game blocks it - convenience only, main refuses `scan.start` either way.
 */
export function ServersToolbar({
  scanState,
  mode,
  lan,
  entryCount,
  sortCaption,
  onModeChange,
  filterActive,
  shownCount,
  onRefresh,
  onRefreshShown,
  onRefreshFavourites,
}: ServersToolbarProps) {
  const { t } = useTranslation()
  const isBlocked = scanState.blockedReason !== null
  const isBusy = scanState.running
  const isRefreshDisabled = isBlocked || isBusy
  const noneShown = filterActive && shownCount === 0
  const isLan = mode === 'lan'
  const stateLabel = t(isBusy ? 'common.action.scanning' : 'module.servers.view.status.idle')

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
      <div className="min-w-0 space-y-1">
        <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
          {t('common.label.servers')}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          <StatusDot className={isBusy ? 'bg-strogg-500' : 'bg-ink-faint'} pulse={isBusy} />
          <span
            data-testid="servers-scan-status"
            // Test-observability attributes: a flow has nothing else non-racy to wait on for "a
            // scan visibly ran" when a scan against one dead loopback target finishes instantly.
            data-running={scanState.running}
            data-finished-at={scanState.finishedAt ?? ''}
          >
            {t('module.servers.view.status.line', { state: stateLabel, count: entryCount })}
          </span>
          <span aria-hidden="true">·</span>
          <span data-testid="servers-sort-current">{sortCaption}</span>
        </p>
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ServersModeToggle mode={mode} onChange={onModeChange} />
          {lan.failureKey !== null && isLan && (
            <p
              className="flex items-center gap-1.5 text-xs text-warning"
              data-testid="servers-lan-failure"
            >
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{t(lan.failureKey)}</span>
            </p>
          )}
          <Button
            variant="neutral"
            size="sm"
            icon={
              <RefreshCw className={cn('size-3.5', isBusy && 'animate-spin')} aria-hidden="true" />
            }
            onClick={filterActive ? onRefreshShown : onRefresh}
            disabled={isRefreshDisabled || noneShown}
            data-testid="servers-refresh"
          >
            {filterActive
              ? t('module.servers.view.refreshShown', { count: shownCount })
              : t('module.servers.view.refresh')}
          </Button>
          {filterActive && (
            <Menu
              side="below"
              label={t('module.servers.view.scanOptions')}
              items={[
                {
                  id: 'scan-all',
                  label: t('module.servers.view.scanAll'),
                  onSelect: onRefresh,
                },
              ]}
            >
              {({ open, toggle }) => (
                <Button
                  variant="neutral"
                  size="sm"
                  icon={<ChevronDown className="size-3.5" aria-hidden="true" />}
                  onClick={toggle}
                  disabled={isRefreshDisabled}
                  aria-label={t('module.servers.view.scanOptions')}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  data-testid="servers-refresh-options"
                />
              )}
            </Menu>
          )}
          <Button
            variant="neutral"
            size="sm"
            icon={<Star className="size-3.5" aria-hidden="true" />}
            onClick={onRefreshFavourites}
            disabled={isRefreshDisabled || isLan}
            data-testid="servers-refresh-favourites"
          >
            {t('module.servers.view.refreshFavourites')}
          </Button>
        </div>
        {isLan && (
          <p className="text-xs text-ink-muted" data-testid="servers-lan-favourites-reason">
            {t('servers.lan.favouritesNotInLan')}
          </p>
        )}
        {noneShown && (
          <p className="text-xs text-ink-muted" data-testid="servers-refresh-none">
            {t('module.servers.view.refreshShownNone')}
          </p>
        )}
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
}
