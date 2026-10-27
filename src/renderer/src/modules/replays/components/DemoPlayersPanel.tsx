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

type Group = DemoDetail['playerGroups']['groups'][number]
type Side = 1 | 2
type Layout = 'single' | 'split' | 'stacked'

// Full class strings: Tailwind only emits classes it can read statically.
const SIDE_CLASSES: Record<Side, { border: string; heading: string }> = {
  1: { border: 'border-l-2 border-side-1', heading: 'text-side-1' },
  2: { border: 'border-l-2 border-side-2', heading: 'text-side-2' },
}

function layoutOf(teamCount: number): Layout {
  if (teamCount === 0) return 'single'
  return teamCount === 2 ? 'split' : 'stacked'
}

function PlayerRows({ group }: { group: Group }) {
  return group.players.map((player, index) => (
    <tr
      key={index}
      data-testid="replays-detail-player-row"
      className="border-b border-line/60 last:border-b-0"
    >
      <td className="truncate py-1.5 pr-2 pl-2 text-ink">
        <PlayerName player={player} />
      </td>
    </tr>
  ))
}

function TeamBlock({ group, side }: { group: Group; side: Side | null }) {
  const { t } = useTranslation()
  const { heading } = group
  const classes = side === null ? null : SIDE_CLASSES[side]
  return (
    <table
      className={`w-full min-w-0 table-fixed border-collapse text-left text-xs text-ink-dim ${classes?.border ?? ''}`}
      data-side={side ?? undefined}
    >
      <tbody>
        {heading !== null && (
          <tr data-testid="replays-detail-team" className="border-b border-line/60">
            <th
              scope="rowgroup"
              className={`truncate py-1.5 pr-2 pl-2 font-medium ${classes?.heading ?? ''}`}
            >
              {heading.team !== undefined || heading.result !== undefined
                ? [heading.team, heading.result].filter(Boolean).join(' · ')
                : t('replays.detail.players.side', { n: heading.index })}
            </th>
          </tr>
        )}
        <PlayerRows group={group} />
      </tbody>
    </table>
  )
}

/** The detail's roster: players grouped by side (team names are game data, never translated),
 * spectators tucked into a closed disclosure. Two teams sit side by side, any other team count
 * stacks, and a single team-less side renders without a heading. */
export function DemoPlayersPanel({ groups }: DemoPlayersPanelProps) {
  const { t } = useTranslation()
  const playerCount = groups.groups.reduce((sum, group) => sum + group.players.length, 0)
  const layout = layoutOf(groups.groups.filter((group) => group.heading !== null).length)
  // Teams alternate between the two side colours, so a split is always 1 then 2.
  const sideAt = (position: number): Side | null =>
    layout === 'single' ? null : position % 2 === 0 ? 1 : 2

  return (
    <div className="space-y-3">
      <h3 className="stencil mb-2 flex items-center gap-1.5">
        <Users className="size-3.5" aria-hidden="true" />
        {t('common.label.players')}
        <span className="numeric text-ink-dim">{playerCount}</span>
      </h3>
      {playerCount > 0 && (
        <div
          data-testid="replays-detail-teams"
          data-layout={layout}
          className={layout === 'split' ? 'grid grid-cols-2 gap-3' : 'space-y-3'}
        >
          {groups.groups.map((group, groupIndex) => (
            <TeamBlock key={groupIndex} group={group} side={sideAt(groupIndex)} />
          ))}
        </div>
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
