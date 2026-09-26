import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Star, User } from 'lucide-react'
import type { ServerListRow, WatchlistMatch } from '@shared/modules/servers'
import { formatRelativeTime } from '../../../lib/format'
import { cn } from '../../../lib/cn'
import { Badge } from '../../../components/ui/primitives'
import { OccupancyPips } from '../ServerRow'
import { formatOccupancy, formatPing, orDash } from '../server-format'

export interface WatchlistMatchRowProps {
  entryId: string
  match: WatchlistMatch
  /** The server list's live row for `match.address` - absent when the list doesn't (yet) know the
   * server, in which case every server stat renders `—`. */
  server: ServerListRow | undefined
  /** This match's server is the one open in the watchlist's detail pane. */
  selected: boolean
  actions: ReactNode
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-panel px-3 py-1.5">
      <div className="stencil mb-0.5">{label}</div>
      <div className="numeric min-w-0 truncate text-xs text-ink">{children}</div>
    </div>
  )
}

/**
 * One watchlist match, laid out like a server-list row: the server's name, address and markers,
 * its mod/map/players/ping stats, then the matched player's own name, score, ping and seen-time.
 * Never mentions "spectate"/"spectating"/"playing" (story 132 AC4) - `actions` is the only place a
 * join affordance can appear.
 */
export function WatchlistMatchRow({ entryId, match, server, selected, actions }: WatchlistMatchRowProps) {
  const { t } = useTranslation()
  const name = server?.name || match.serverName || match.address
  const playerPing = Number.isFinite(match.ping) && match.ping >= 0 ? `${match.ping} ms` : '—'

  return (
    <li
      data-testid={`servers-watchlist-match-${entryId}-${match.address}`}
      data-selected={selected}
      className={cn(
        'overflow-hidden rounded-sm border border-l-2 border-line bg-void/40',
        selected ? 'border-l-flame-500 bg-flame-900/20' : 'border-l-transparent',
      )}
    >
      <div className="flex items-start gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
            {server?.favourite && (
              <Star className="size-3.5 shrink-0 fill-flame-500 text-flame-500" aria-hidden="true" />
            )}
            <span className="truncate">{name}</span>
          </span>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="numeric truncate text-[11px] text-ink-muted">{match.address}</span>
            {server?.gamemode !== undefined && (
              <Badge tone="neutral">{t(`servers.gamemode.${server.gamemode}`)}</Badge>
            )}
            {server?.needpass === true && (
              <Badge tone="warning">
                <Lock className="size-3" aria-hidden="true" />
                {t('servers.row.password')}
              </Badge>
            )}
          </div>
        </div>
        {actions}
      </div>

      <div className="grid grid-cols-4 gap-px border-y border-line/60 bg-line/60">
        <Stat label={t('servers.list.column.mod')}>{orDash(server?.mod)}</Stat>
        <Stat label={t('servers.list.column.map')}>{orDash(server?.map)}</Stat>
        <Stat label={t('servers.list.column.players')}>
          <span className="flex items-center gap-2">
            {server ? formatOccupancy(server) : '—'}
            {server && <OccupancyPips row={server} />}
          </span>
        </Stat>
        <Stat label={t('servers.list.column.ping')}>{server ? formatPing(server) : '—'}</Stat>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs text-ink-dim">
        <span className="flex min-w-0 items-center gap-1.5 text-ink">
          <User className="size-3.5 shrink-0 text-strogg-500" aria-hidden="true" />
          <span className="truncate font-medium" data-selectable>
            {match.playerName}
          </span>
        </span>
        <span>
          {t('servers.watchlist.match.score')}{' '}
          <span className="numeric text-ink">{match.score}</span>
        </span>
        <span>
          {t('servers.watchlist.match.ping')} <span className="numeric text-ink">{playerPing}</span>
        </span>
        <span className="ml-auto text-ink-muted">
          {t('servers.watchlist.match.seen', { rel: formatRelativeTime(match.seenAt) })}
        </span>
      </div>
    </li>
  )
}
