import { useTranslation } from 'react-i18next'
import { Eye, Users } from 'lucide-react'
import type { DemoDetail } from '@shared/replays/demo-detail'

export interface DemoPlayersPanelProps {
  groups: DemoDetail['playerGroups']
}

type Player = DemoDetail['playerGroups']['spectators'][number]

function PlayerName({ player }: { player: Player }) {
  const { t } = useTranslation()
  return (
    <>
      <span data-selectable>{player.name}</span>
      {player.pov && (
        <span
          className="ml-2 inline-flex items-center gap-1 text-ink-dim"
          data-testid="replays-detail-player-pov"
        >
          <Eye className="size-3" aria-hidden="true" />
          {t('replays.detail.players.pov')}
        </span>
      )}
    </>
  )
}

/** The detail's roster: players grouped by side (team names are game data, never translated),
 * spectators tucked into a closed disclosure. A single team-less side renders without a heading. */
export function DemoPlayersPanel({ groups }: DemoPlayersPanelProps) {
  const { t } = useTranslation()
  const playerCount = groups.groups.reduce((sum, group) => sum + group.players.length, 0)

  return (
    <div className="space-y-3">
      <h3 className="stencil mb-2 flex items-center gap-1.5">
        <Users className="size-3.5" aria-hidden="true" />
        {t('common.label.players')}
        <span className="numeric text-ink-dim">{playerCount}</span>
      </h3>
      {playerCount > 0 && (
        <table className="w-full border-collapse text-left text-xs text-ink-dim">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="stencil py-1 pr-2">
                {t('common.label.name')}
              </th>
            </tr>
          </thead>
          {groups.groups.map((group, groupIndex) => (
            <tbody key={groupIndex}>
              {group.heading !== null && (
                <tr data-testid="replays-detail-team" className="border-b border-line/60">
                  <th scope="rowgroup" className="py-1.5 pr-2 font-medium text-ink">
                    {group.heading.team !== undefined || group.heading.result !== undefined
                      ? [group.heading.team, group.heading.result].filter(Boolean).join(' · ')
                      : t('replays.detail.players.side', { n: group.heading.index })}
                  </th>
                </tr>
              )}
              {group.players.map((player, index) => (
                <tr
                  key={index}
                  data-testid="replays-detail-player-row"
                  className="border-b border-line/60 last:border-b-0"
                >
                  <td className="truncate py-1.5 pr-2 text-ink">
                    <PlayerName player={player} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      )}
      {groups.spectators.length > 0 && (
        <details className="rounded-md border border-line" data-testid="replays-detail-spectators">
          <summary className="stencil cursor-pointer list-none px-3 py-2 select-none">
            {t('replays.detail.players.spectators', { count: groups.spectators.length })}
          </summary>
          <ul className="space-y-1 p-3 pt-0 text-xs text-ink">
            {groups.spectators.map((player, index) => (
              <li key={index}>
                <PlayerName player={player} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
