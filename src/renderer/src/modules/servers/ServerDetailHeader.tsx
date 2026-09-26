import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BookMarked, Copy, Lock, RefreshCw, Star } from 'lucide-react'
import type { ServerDetail } from '@shared/modules/servers'
import { deriveEngine, deriveProtocol } from '@shared/servers/server-engine'
import { invoke } from '../../lib/bridge'
import { IconButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { AddToAddressBookDialog } from './AddToAddressBookDialog'
import { addFavourite, removeFavourite } from './client'
import { JoinServerButton } from './join/JoinServerButton'
import { displayName, formatOccupancy, formatPing, orDash } from './server-format'

export interface ServerDetailHeaderProps {
  detail: ServerDetail
  /** Scoped "refresh this server" scan, owned by `ServersView` (it holds the scan state). */
  onRefresh: () => void
  refreshDisabled: boolean
  refreshing: boolean
  /** Called once a favourite toggle has persisted, so the owners can re-read their rows. */
  onFavouriteChanged: () => void
}

/** One cell of the stat grid: stencil label over a value. `testId` lands on the value so the
 * existing `servers-detail-field-<name>` assertions keep reading exactly the value text. */
function StatCell({
  label,
  testId,
  children,
  className,
}: {
  label: string
  testId: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 bg-panel px-2.5 py-2', className)}>
      <div className="stencil mb-1">{label}</div>
      <div className="min-w-0 truncate text-sm text-ink" data-testid={testId} data-selectable>
        {children}
      </div>
    </div>
  )
}

/**
 * Story 122 D3: the detail pane's header section - name, address, then a compact stat grid of
 * mod, map, gamemode, occupancy, ping, password and the engine/protocol derived from the last-known
 * `serverinfo` (story 122 D2's `deriveEngine`/`deriveProtocol`). Every value is routed through
 * `server-format.ts`'s helpers so one malformed field (e.g. an unparseable `protocol`) renders `—`
 * without breaking the rest.
 *
 * Story 125 D5: the same `JoinServerButton` the watchlist uses sits here, wrapped under
 * `servers-detail-join` and rendered `prominent` (the action bar's Play look) - it is this pane's
 * primary action. Spectate was dropped: on most mods it behaved exactly like Join.
 *
 * Story 127 D2: a third action, wrapped under `servers-detail-address-book-open`, opens
 * `AddToAddressBookDialog` for this server's address. Its open flag is local state, same as every
 * dialog on this pane.
 *
 * Beside it: "refresh this server" (moved here from the list toolbar - it only ever meant the
 * selected server, which is exactly what this pane shows), a favourite toggle, whose pressed
 * state is the row's own `favourite` flag - no local copy, the owners re-read after a toggle -
 * and a copy-address action, same size/prominence as the address book button next to it.
 */
export function ServerDetailHeader({
  detail,
  onRefresh,
  refreshDisabled,
  refreshing,
  onFavouriteChanged,
}: ServerDetailHeaderProps) {
  const { t } = useTranslation()
  const { row, serverinfo } = detail
  const pushToast = useLauncher((state) => state.pushToast)
  const [addressBookOpen, setAddressBookOpen] = useState(false)
  // Bumped on every open so the dialog remounts - a reused instance paints its previous slots for a
  // frame before its own on-open reset effect runs, showing a stale (e.g. pre-write) address book.
  const [addressBookKey, setAddressBookKey] = useState(0)
  const [favouriteBusy, setFavouriteBusy] = useState(false)

  const handleCopyAddress = (): void => {
    void invoke('app:copyText', row.address).then((result) => {
      pushToast(
        result.ok
          ? { level: 'success', messageKey: 'servers.detail.copyAddressSuccess', timeoutMs: 4000 }
          : { level: 'error', messageKey: 'servers.detail.copyAddressError', timeoutMs: 0 },
      )
    })
  }

  const handleToggleFavourite = (): void => {
    setFavouriteBusy(true)
    const toggle = row.favourite ? removeFavourite : addFavourite
    void toggle(row.address).then((result) => {
      setFavouriteBusy(false)
      if (result.ok) onFavouriteChanged()
    })
  }

  const protocol = deriveProtocol(serverinfo)
  const engine = deriveEngine(protocol)
  const mod = row.mod ?? serverinfo?.gamedir ?? serverinfo?.game

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <h2
          className="truncate font-display text-lg tracking-wide text-ink uppercase"
          data-testid="servers-detail-field-name"
        >
          {orDash(displayName(row))}
        </h2>
        <p className="numeric text-xs text-ink-muted" data-selectable>
          <span data-testid="servers-detail-field-address">{orDash(row.address)}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div data-testid="servers-detail-join">
          <JoinServerButton row={row} prominent />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <IconButton
            label={t('module.servers.view.refreshSelected')}
            variant="neutral"
            size="lg"
            onClick={onRefresh}
            disabled={refreshDisabled}
            data-testid="servers-refresh-selected"
          >
            <RefreshCw className={cn('size-5', refreshing && 'animate-spin')} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t(
              row.favourite ? 'servers.detail.favourite.remove' : 'servers.detail.favourite.add',
            )}
            variant="neutral"
            size="lg"
            aria-pressed={row.favourite}
            onClick={handleToggleFavourite}
            disabled={favouriteBusy}
            data-testid="servers-detail-favourite"
            className={cn(row.favourite && 'border-flame-600 text-flame-400')}
          >
            <Star className={cn('size-5', row.favourite && 'fill-current')} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t('servers.detail.copyAddress')}
            variant="neutral"
            size="lg"
            onClick={handleCopyAddress}
            data-testid="servers-detail-copy-address"
          >
            <Copy className="size-5" aria-hidden="true" />
          </IconButton>
          <div data-testid="servers-detail-address-book-open">
            <IconButton
              label={t('servers.addressBook.action')}
              variant="neutral"
              size="lg"
              onClick={() => {
                setAddressBookKey((key) => key + 1)
                setAddressBookOpen(true)
              }}
            >
              <BookMarked className="size-5" aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </div>
      <AddToAddressBookDialog
        key={addressBookKey}
        open={addressBookOpen}
        address={row.address}
        onClose={() => setAddressBookOpen(false)}
      />

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-line bg-line">
        <StatCell
          label={t('servers.detail.field.occupancy')}
          testId="servers-detail-field-occupancy"
        >
          <span className="numeric">{formatOccupancy(row)}</span>
        </StatCell>
        <StatCell label={t('servers.detail.field.ping')} testId="servers-detail-field-ping">
          <span className="numeric">{formatPing(row)}</span>
        </StatCell>
        <StatCell label={t('servers.detail.field.map')} testId="servers-detail-field-map">
          <span className="numeric">{orDash(row.map)}</span>
        </StatCell>
        <StatCell label={t('servers.detail.field.mod')} testId="servers-detail-field-mod">
          {orDash(mod)}
        </StatCell>
        <StatCell label={t('servers.detail.field.gamemode')} testId="servers-detail-field-gamemode">
          {row.gamemode !== undefined ? t(`servers.gamemode.${row.gamemode}`) : '—'}
        </StatCell>
        <StatCell label={t('servers.detail.field.password')} testId="servers-detail-field-password">
          {row.needpass === true ? (
            <Badge tone="warning">
              <Lock className="size-3" aria-hidden="true" />
              {t('servers.row.password')}
            </Badge>
          ) : (
            '—'
          )}
        </StatCell>
        <StatCell
          label={t('servers.detail.field.engine')}
          testId="servers-detail-field-engine"
          className="col-span-2"
        >
          {engine !== undefined ? t(`servers.engine.${engine}`) : '—'}
        </StatCell>
        <StatCell label={t('servers.detail.field.protocol')} testId="servers-detail-field-protocol">
          <span className="numeric">{orDash(protocol)}</span>
        </StatCell>
      </div>
    </div>
  )
}
