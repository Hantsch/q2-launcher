import { useTranslation } from 'react-i18next'
import { Lock, Star, User } from 'lucide-react'
import type { ServerListRow } from '@shared/modules/servers'
import { isWaitingForOpponent, knownPlayerCount } from '@shared/servers/row-markers'
import { cn } from '../../lib/cn'
import { Badge } from '../../components/ui/primitives'
import { SERVER_LIST_GRID } from './list-grid'
import { displayName, formatOccupancy, formatPing, orDash } from './server-format'

export interface ServerRowProps {
  row: ServerListRow
  selected: boolean
  onSelect: (address: string) => void
}

const PIP_COUNT = 5

/**
 * A five-pip occupancy meter under the `x/y` count - HUD-style, no inline styles, no colour-only
 * meaning (the count next to it carries the number). Empty when nothing is known, all-lit in the
 * warning tone when the server is full.
 */
function OccupancyPips({ row }: { row: ServerListRow }) {
  const count = knownPlayerCount(row)
  const max = row.maxclients
  if (count === undefined || max === undefined || max <= 0) return null
  const lit =
    count === 0 ? 0 : Math.max(1, Math.min(PIP_COUNT, Math.ceil((count / max) * PIP_COUNT)))
  const full = count >= max
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {Array.from({ length: PIP_COUNT }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-1 w-2 rounded-xs',
            index < lit ? (full ? 'bg-warning' : 'bg-strogg-500') : 'bg-line-strong',
          )}
        />
      ))}
    </span>
  )
}

/**
 * Story 118 D3: one row of the real servers list - name/address, mod, map, players and ping on the
 * shared `SERVER_LIST_GRID` template (so every cell lines up under `ServerListHeader`'s labels),
 * plus a set of status markers (password/gamemode/favourite/stale/waiting/pending) rendered on the
 * name cell's second line, each a visible `Badge` with an icon and i18n text (status is never
 * colour-only). A favourite carries a star before its name; a waiting-for-opponent row also lights
 * its left edge, the selected row lights it in flame.
 */
export function ServerRow({ row, selected, onSelect }: ServerRowProps) {
  const { t } = useTranslation()

  const name = displayName(row)
  const showAddressUnderName = row.name && row.name.length > 0
  const waiting = isWaitingForOpponent(row)

  return (
    <button
      type="button"
      onClick={() => onSelect(row.address)}
      aria-pressed={selected}
      data-testid={`servers-row-${row.address}`}
      data-selected={selected}
      className={cn(
        SERVER_LIST_GRID,
        'min-h-12 w-full border-b border-b-line/60 py-1.5 text-left text-xs text-ink-dim transition-colors duration-[--dur-fast]',
        selected
          ? 'border-l-flame-500 bg-flame-900/20'
          : cn(
              'hover:bg-hover',
              waiting ? 'border-l-strogg-700' : 'border-l-transparent',
              row.status === 'stale' && 'opacity-70',
            ),
      )}
    >
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
          {row.favourite && (
            <Star className="size-3.5 shrink-0 fill-flame-500 text-flame-500" aria-hidden="true" />
          )}
          <span className="truncate">{name}</span>
        </p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {showAddressUnderName && (
            <span className="numeric truncate text-[11px] text-ink-muted">{row.address}</span>
          )}
          {row.gamemode !== undefined && (
            <Badge tone="neutral" testId={`servers-row-gamemode-${row.address}`}>
              {t(`servers.gamemode.${row.gamemode}`)}
            </Badge>
          )}
          {row.needpass === true && (
            <Badge tone="warning" testId={`servers-row-password-${row.address}`}>
              <Lock className="size-3" aria-hidden="true" />
              {t('servers.row.password')}
            </Badge>
          )}
          {row.favourite && (
            <Badge tone="flame" testId={`servers-row-favourite-${row.address}`}>
              <Star className="size-3" aria-hidden="true" />
              {t('servers.row.favourite')}
            </Badge>
          )}
          {waiting && (
            <Badge tone="success" testId={`servers-row-waiting-${row.address}`}>
              <User className="size-3" aria-hidden="true" />
              {t('servers.row.waiting')}
            </Badge>
          )}
          {row.status === 'stale' && (
            <Badge tone="warning" testId={`servers-row-stale-${row.address}`}>
              {t('servers.row.stale')}
            </Badge>
          )}
          {row.status === 'pending' && (
            <Badge tone="neutral" testId={`servers-row-pending-${row.address}`}>
              {t('servers.row.pending')}
            </Badge>
          )}
        </div>
      </div>

      <span className="truncate text-right">{orDash(row.mod)}</span>
      <span className="flex flex-col items-end gap-1">
        <span className="numeric text-ink">{formatOccupancy(row)}</span>
        <OccupancyPips row={row} />
      </span>
      <span className="numeric truncate text-right text-[11px]">{orDash(row.map)}</span>
      <span className="numeric truncate text-right">{formatPing(row)}</span>
    </button>
  )
}
