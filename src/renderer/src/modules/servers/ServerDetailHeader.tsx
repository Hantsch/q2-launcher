import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import type { ServerDetail } from '@shared/modules/servers'
import { deriveEngine, deriveProtocol } from '@shared/servers/server-engine'
import { Badge, KeyValue } from '../../components/ui/primitives'
import { JoinServerButton } from './join/JoinServerButton'
import { displayName, formatOccupancy, formatPing, orDash } from './server-format'

export interface ServerDetailHeaderProps {
  detail: ServerDetail
}

/**
 * Story 122 D3: the detail pane's header section - name, address, mod, map, gamemode, occupancy,
 * ping, password and the engine/protocol derived from the last-known `serverinfo` (story 122 D2's
 * `deriveEngine`/`deriveProtocol`). Every value is routed through `server-format.ts`'s helpers so one
 * malformed field (e.g. an unparseable `protocol`) renders `—` without breaking the rest.
 *
 * Story 125 D5: the same `JoinServerButton` the list's selected-row toolbar already renders
 * (`ServersView.tsx`) sits here too, wrapped under `servers-detail-join` so a user who opened the
 * detail pane never has to go back to the list to join.
 */
export function ServerDetailHeader({ detail }: ServerDetailHeaderProps) {
  const { t } = useTranslation()
  const { row, serverinfo } = detail

  const protocol = deriveProtocol(serverinfo)
  const engine = deriveEngine(protocol)
  const mod = row.mod ?? serverinfo?.gamedir ?? serverinfo?.game

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2
          className="font-display text-lg tracking-wide text-ink uppercase"
          data-testid="servers-detail-field-name"
        >
          {orDash(displayName(row))}
        </h2>
        <div data-testid="servers-detail-join">
          <JoinServerButton row={row} />
        </div>
      </div>

      <div className="space-y-1.5">
        <KeyValue label={t('servers.detail.field.address')}>
          <span data-testid="servers-detail-field-address">{orDash(row.address)}</span>
        </KeyValue>
        <KeyValue label={t('servers.detail.field.mod')}>
          <span data-testid="servers-detail-field-mod">{orDash(mod)}</span>
        </KeyValue>
        <KeyValue label={t('servers.detail.field.map')}>
          <span data-testid="servers-detail-field-map">{orDash(row.map)}</span>
        </KeyValue>
        <KeyValue label={t('servers.detail.field.gamemode')}>
          <span data-testid="servers-detail-field-gamemode">
            {row.gamemode !== undefined ? t(`servers.gamemode.${row.gamemode}`) : '—'}
          </span>
        </KeyValue>
        <KeyValue label={t('servers.detail.field.occupancy')}>
          <span data-testid="servers-detail-field-occupancy">{formatOccupancy(row)}</span>
        </KeyValue>
        <KeyValue label={t('servers.detail.field.ping')}>
          <span data-testid="servers-detail-field-ping">{formatPing(row)}</span>
        </KeyValue>
        <KeyValue label={t('servers.detail.field.password')}>
          <span data-testid="servers-detail-field-password">
            {row.needpass === true ? (
              <Badge tone="warning">
                <Lock className="size-3" aria-hidden="true" />
                {t('servers.row.password')}
              </Badge>
            ) : (
              '—'
            )}
          </span>
        </KeyValue>
        <KeyValue label={t('servers.detail.field.engine')}>
          <span data-testid="servers-detail-field-engine">
            {engine !== undefined ? t(`servers.engine.${engine}`) : '—'}
          </span>
        </KeyValue>
        <KeyValue label={t('servers.detail.field.protocol')}>
          <span data-testid="servers-detail-field-protocol">{orDash(protocol)}</span>
        </KeyValue>
      </div>
    </div>
  )
}
