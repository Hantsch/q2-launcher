import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BookMarked, Lock } from 'lucide-react'
import type { ServerDetail } from '@shared/modules/servers'
import { deriveEngine, deriveProtocol } from '@shared/servers/server-engine'
import { IconButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/primitives'
import { cn } from '../../lib/cn'
import { AddToAddressBookDialog } from './AddToAddressBookDialog'
import { JoinServerButton } from './join/JoinServerButton'
import { displayName, formatOccupancy, formatPing, orDash } from './server-format'

export interface ServerDetailHeaderProps {
  detail: ServerDetail
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
 * Story 125 D5 / 126 D3: the same `JoinServerButton` (join and spectate modes) the list already
 * uses sits here, wrapped under `servers-detail-join`/`servers-detail-spectate`, so a user who
 * opened the detail pane never has to go back to the list to join.
 *
 * Story 127 D2: a third action, wrapped under `servers-detail-address-book-open`, opens
 * `AddToAddressBookDialog` for this server's address. Its open flag is local state, same as every
 * dialog on this pane.
 */
export function ServerDetailHeader({ detail }: ServerDetailHeaderProps) {
  const { t } = useTranslation()
  const { row, serverinfo } = detail
  const [addressBookOpen, setAddressBookOpen] = useState(false)

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
          <JoinServerButton row={row} />
        </div>
        <div data-testid="servers-detail-spectate">
          <JoinServerButton row={row} mode="spectate" />
        </div>
        <div data-testid="servers-detail-address-book-open" className="ml-auto">
          <IconButton
            label={t('servers.addressBook.action')}
            variant="neutral"
            onClick={() => setAddressBookOpen(true)}
          >
            <BookMarked className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <AddToAddressBookDialog
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
