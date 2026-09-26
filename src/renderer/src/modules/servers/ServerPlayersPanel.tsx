import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Users } from 'lucide-react'
import type { ServerListRow } from '@shared/modules/servers'
import {
  DEFAULT_PLAYER_SORT,
  naturalDir,
  sortPlayers,
  type PlayerSortKey,
} from '@shared/servers/player-sort'
import { cn } from '../../lib/cn'
import { orDash } from './server-format'

export interface ServerPlayersPanelProps {
  row: ServerListRow
}

const COLUMNS: PlayerSortKey[] = ['name', 'score', 'ping']

function ariaSort(active: boolean, dir: 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none'
  return dir === 'asc' ? 'ascending' : 'descending'
}

function PanelTitle({ count }: { count?: number }) {
  const { t } = useTranslation()
  return (
    <h3 className="stencil mb-2 flex items-center gap-1.5">
      <Users className="size-3.5" aria-hidden="true" />
      {t('servers.detail.players.title')}
      {count !== undefined && <span className="numeric text-ink-dim">{count}</span>}
    </h3>
  )
}

/**
 * Story 122 D4: the detail pane's players section. `row.players` carries four distinct shapes -
 * a real roster (sortable table), a known-empty server (`0` or `[]`), a bare count with no roster
 * yet (a number > 0), or `undefined` (nothing fetched at all) - and each renders its own state.
 *
 * The roster table makes no spectator claim (AC4): every `<tr>` gets identical markup regardless
 * of a player's score/ping value, so a score-0 or ping-0 row can never be told apart from any other
 * by its markup, only by its text - and `orDash` keeps one malformed cell from breaking the row.
 */
export function ServerPlayersPanel({ row }: ServerPlayersPanelProps) {
  const { t } = useTranslation()
  const [sort, setSort] = useState<{ key: PlayerSortKey; dir: 'asc' | 'desc' }>(DEFAULT_PLAYER_SORT)

  const { players } = row

  if (Array.isArray(players) && players.length > 0) {
    const sorted = sortPlayers(players, sort.key, sort.dir)

    const handleSort = (key: PlayerSortKey) => {
      setSort((current) =>
        current.key === key
          ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: naturalDir(key) },
      )
    }

    return (
      <div data-testid="servers-detail-players">
        <PanelTitle count={players.length} />
        <table className="w-full border-collapse text-left text-xs text-ink-dim">
          <thead>
            <tr className="border-b border-line">
              {COLUMNS.map((key, index) => {
                const active = sort.key === key
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={ariaSort(active, sort.dir)}
                    className={cn('py-1', index === 0 ? 'pr-2' : 'w-16 pl-2 text-right')}
                  >
                    <button
                      type="button"
                      className={cn(
                        'stencil inline-flex min-h-7 items-center gap-1 hover:text-ink',
                        active && 'text-flame-300',
                      )}
                      data-testid={`servers-detail-players-sort-${key}`}
                      onClick={() => handleSort(key)}
                    >
                      {t(`servers.detail.players.column.${key}`)}
                      {active &&
                        (sort.dir === 'asc' ? (
                          <ArrowUp className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden="true" />
                        ))}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((player, index) => (
              <tr
                key={index}
                data-testid="servers-detail-player-row"
                className="border-b border-line/60 last:border-b-0"
              >
                <td className="truncate py-1.5 pr-2 text-ink" data-selectable>
                  {orDash(player.name)}
                </td>
                <td className="numeric py-1.5 pl-2 text-right">{orDash(player.score)}</td>
                <td className="numeric py-1.5 pl-2 text-right">{orDash(player.ping)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (players === 0 || (Array.isArray(players) && players.length === 0)) {
    return (
      <div data-testid="servers-detail-players">
        <PanelTitle count={0} />
        <p className="text-xs text-ink-muted" data-testid="servers-detail-players-empty">
          {t('servers.detail.players.empty')}
        </p>
      </div>
    )
  }

  if (typeof players === 'number' && players > 0) {
    return (
      <div data-testid="servers-detail-players">
        <PanelTitle count={players} />
        <p className="text-xs text-ink-muted">
          {t('servers.detail.players.notFetched', { count: players })}
        </p>
      </div>
    )
  }

  return (
    <div data-testid="servers-detail-players">
      <PanelTitle />
      <p className="text-xs text-ink-muted">{t('servers.detail.players.unknown')}</p>
    </div>
  )
}
