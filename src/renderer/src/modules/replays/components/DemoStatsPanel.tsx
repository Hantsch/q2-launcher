import { useTranslation } from 'react-i18next'
import { Crosshair } from 'lucide-react'
import type {
  DemoStats,
  DemoStatsItem,
  DemoStatsTotal,
  DemoStatValue,
} from '@shared/demos/dm2-stats'

export interface DemoStatsPanelProps {
  stats: DemoStats
}

type ItemColumn = Exclude<keyof DemoStatsItem, 'item'>
type TotalField = keyof DemoStatsTotal

// Spelled out so each i18n key stays a static string the extractor can read. A total that reads
// the same as its column shares the column's key, so one value has one key.
const ITEM_COLUMNS: { id: ItemColumn; labelKey: string }[] = [
  { id: 'accuracy', labelKey: 'replays.detail.stats.col.accuracy' },
  { id: 'kills', labelKey: 'replays.detail.stats.col.kills' },
  { id: 'deaths', labelKey: 'replays.detail.stats.col.deaths' },
  { id: 'dealt', labelKey: 'replays.detail.stats.col.dealt' },
  { id: 'received', labelKey: 'replays.detail.stats.col.received' },
  { id: 'pickups', labelKey: 'replays.detail.stats.col.pickups' },
  { id: 'missed', labelKey: 'replays.detail.stats.col.missed' },
]

const TOTAL_FIELDS: { id: TotalField; labelKey: string }[] = [
  { id: 'kills', labelKey: 'replays.detail.stats.col.kills' },
  { id: 'deaths', labelKey: 'replays.detail.stats.col.deaths' },
  { id: 'suicides', labelKey: 'replays.detail.stats.total.suicides' },
  { id: 'teamKills', labelKey: 'replays.detail.stats.total.teamKills' },
  { id: 'telefrags', labelKey: 'replays.detail.stats.total.telefrags' },
  { id: 'dealt', labelKey: 'replays.detail.stats.col.dealt' },
  { id: 'received', labelKey: 'replays.detail.stats.total.received' },
  { id: 'teamDealt', labelKey: 'replays.detail.stats.total.teamDealt' },
  { id: 'teamReceived', labelKey: 'replays.detail.stats.total.teamReceived' },
]

/** `null` is the game's own "not applicable" cell, so it reads as a dash rather than a 0. */
function cellText(value: DemoStatValue, suffix = ''): string {
  return value === null ? '-' : `${value}${suffix}`
}

/** The recording player's end-of-match OpenTDM stats: one row per item, then the totals when the
 * demo carried them. Item and player names are game data, never translated. */
export function DemoStatsPanel({ stats }: DemoStatsPanelProps) {
  const { t } = useTranslation()
  const { total } = stats
  return (
    <div className="space-y-3" data-testid="replays-detail-stats">
      <h3
        className="stencil mb-2 flex items-center gap-1.5"
        data-testid="replays-detail-stats-title"
      >
        <Crosshair className="size-3.5" aria-hidden="true" />
        {t('replays.detail.stats.title', { name: stats.player })}
      </h3>
      <div className="overflow-x-auto">
        <table className="table w-full border-collapse text-left text-xs text-ink-dim">
          <thead>
            <tr className="border-b border-line/60">
              <th scope="col" className="stencil py-1.5 pr-2 pl-2 font-medium">
                {t('replays.detail.stats.col.item')}
              </th>
              {ITEM_COLUMNS.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className="stencil py-1.5 pr-2 pl-2 text-right font-medium"
                >
                  {t(column.labelKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.items.map((item, index) => (
              <tr
                key={index}
                data-testid="replays-detail-stats-row"
                className="border-b border-line/60 last:border-b-0"
              >
                <th scope="row" className="py-1.5 pr-2 pl-2 font-medium whitespace-nowrap text-ink">
                  <span data-selectable>{item.item}</span>
                </th>
                {ITEM_COLUMNS.map((column) => (
                  <td key={column.id} className="numeric py-1.5 pr-2 pl-2 text-right">
                    {cellText(item[column.id], column.id === 'accuracy' ? '%' : '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total !== null && (
        <div>
          <h4 className="stencil mb-1">{t('replays.detail.stats.total.title')}</h4>
          <dl
            className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-3 gap-y-1 text-xs"
            data-testid="replays-detail-stats-total"
          >
            {TOTAL_FIELDS.map((field) => (
              <div key={field.id} className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-muted">{t(field.labelKey)}</dt>
                <dd className="numeric text-ink">{cellText(total[field.id])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
