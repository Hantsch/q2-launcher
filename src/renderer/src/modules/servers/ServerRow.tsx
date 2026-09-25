import { useTranslation } from 'react-i18next'
import { Lock, Star, User } from 'lucide-react'
import type { ServerListRow } from '@shared/modules/servers'
import { isWaitingForOpponent } from '@shared/servers/row-markers'
import { cn } from '../../lib/cn'
import { Badge } from '../../components/ui/primitives'
import { displayName, formatOccupancy, formatPing, orDash } from './server-format'

export interface ServerRowProps {
  row: ServerListRow
  selected: boolean
  onSelect: (address: string) => void
}

/**
 * Story 118 D3: one row of the real servers list - name/address, mod, players/slots, map and ping,
 * plus a set of status markers (password/gamemode/favourite/stale/waiting/pending), each a visible
 * `Badge` with an icon and i18n text (status is never colour-only). Mirrors `MasterSourceRow.tsx`'s
 * component shape and the minimal inline row it replaces in `ServersView.tsx`.
 */
export function ServerRow({ row, selected, onSelect }: ServerRowProps) {
  const { t } = useTranslation()

  const name = displayName(row)
  const showAddressUnderName = row.name && row.name.length > 0

  return (
    <button
      type="button"
      onClick={() => onSelect(row.address)}
      aria-pressed={selected}
      data-testid={`servers-row-${row.address}`}
      data-selected={selected}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-sm border px-2 py-1.5 text-left text-xs text-ink-muted transition-colors',
        selected
          ? 'border-flame-600 bg-void/40'
          : 'border-transparent hover:border-line-strong hover:bg-void/25',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{name}</p>
        {showAddressUnderName && <p className="truncate text-xs text-ink-muted">{row.address}</p>}
      </div>

      <span className="w-24 shrink-0 truncate">{orDash(row.mod)}</span>
      <span className="w-16 shrink-0 truncate">{formatOccupancy(row)}</span>
      <span className="w-24 shrink-0 truncate">{orDash(row.map)}</span>
      <span className="w-16 shrink-0 truncate">{formatPing(row)}</span>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {row.needpass === true && (
          <Badge tone="warning" testId={`servers-row-password-${row.address}`}>
            <Lock className="size-3" aria-hidden="true" />
            {t('servers.row.password')}
          </Badge>
        )}
        {row.gamemode !== undefined && (
          <Badge tone="neutral" testId={`servers-row-gamemode-${row.address}`}>
            {t(`servers.gamemode.${row.gamemode}`)}
          </Badge>
        )}
        {row.favourite && (
          <Badge tone="flame" testId={`servers-row-favourite-${row.address}`}>
            <Star className="size-3" aria-hidden="true" />
            {t('servers.row.favourite')}
          </Badge>
        )}
        {row.status === 'stale' && (
          <Badge tone="warning" testId={`servers-row-stale-${row.address}`}>
            {t('servers.row.stale')}
          </Badge>
        )}
        {isWaitingForOpponent(row) && (
          <Badge tone="success" testId={`servers-row-waiting-${row.address}`}>
            <User className="size-3" aria-hidden="true" />
            {t('servers.row.waiting')}
          </Badge>
        )}
        {row.status === 'pending' && (
          <Badge tone="neutral" testId={`servers-row-pending-${row.address}`}>
            {t('servers.row.pending')}
          </Badge>
        )}
      </div>
    </button>
  )
}
