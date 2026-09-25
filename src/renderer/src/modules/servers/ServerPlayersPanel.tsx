import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServerListRow } from '@shared/modules/servers'
import {
  DEFAULT_PLAYER_SORT,
  naturalDir,
  sortPlayers,
  type PlayerSortKey,
} from '@shared/servers/player-sort'
import { EmptyState } from '../../components/ui/primitives'
import { orDash } from './server-format'

export interface ServerPlayersPanelProps {
  row: ServerListRow
}

const COLUMNS: PlayerSortKey[] = ['name', 'score', 'ping']

function ariaSort(active: boolean, dir: 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none'
  return dir === 'asc' ? 'ascending' : 'descending'
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
  const [sort, setSort] = useState<{ key: PlayerSortKey; dir: 'asc' | 'desc' }>(
    DEFAULT_PLAYER_SORT,
  )

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
        <table className="w-full text-left text-xs text-ink-muted">
          <thead>
            <tr>
              {COLUMNS.map((key) => {
                const active = sort.key === key
                return (
                  <th key={key} scope="col" aria-sort={ariaSort(active, sort.dir)}>
                    <button
                      type="button"
                      className="min-h-11 text-left text-xs text-ink-muted"
                      data-testid={`servers-detail-players-sort-${key}`}
                      onClick={() => handleSort(key)}
                    >
                      {t(`servers.detail.players.column.${key}`)}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((player, index) => (
              <tr key={index} data-testid="servers-detail-player-row">
                <td>{orDash(player.name)}</td>
                <td>{orDash(player.score)}</td>
                <td>{orDash(player.ping)}</td>
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
        <div data-testid="servers-detail-players-empty">
          <EmptyState title={t('servers.detail.players.empty')} />
        </div>
      </div>
    )
  }

  if (typeof players === 'number' && players > 0) {
    return (
      <div data-testid="servers-detail-players">
        <p className="text-xs text-ink-muted">
          {t('servers.detail.players.notFetched', { count: players })}
        </p>
      </div>
    )
  }

  return (
    <div data-testid="servers-detail-players">
      <p className="text-xs text-ink-muted">{t('servers.detail.players.unknown')}</p>
    </div>
  )
}
