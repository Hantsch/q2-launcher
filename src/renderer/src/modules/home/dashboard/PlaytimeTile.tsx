import { useTranslation } from 'react-i18next'
import type { LibraryStats } from '@shared/modules/library'
import { engineLabel, type EngineKind } from '@shared/types/engine'
import { Button } from '../../../components/ui/Button'
import { Badge, KeyValue, SectionLabel } from '../../../components/ui/primitives'
import { cn } from '../../../lib/cn'
import { formatCount, formatDuration, formatRelativeTime } from '../../../lib/format'
import { useLauncher } from '../../../store/useLauncher'
import { getLibraryStats } from '../../library/client'
import { DashboardTileFrame } from '../components/DashboardTileFrame'
import { useTileData } from '../components/useTileData'

/** Unwraps `getLibraryStats()`'s `Outcome` for `useTileData` - a failed call throws so the hook's
 * `state` becomes `'error'`, per this hook's contract (see `useTileData.ts`). */
async function fetchPlaytimeStats(): Promise<LibraryStats> {
  const result = await getLibraryStats()
  if (!result.ok) throw new Error(result.error.key)
  return result.value
}

/**
 * Story 087 D3 (AC1): the dashboard's playtime & statistics tile. Composes `useTileData`'s
 * loading/error/success with its own "is this actually empty" check into `DashboardTileFrame`'s
 * four-way state (see that file's doc comment for the worked example this follows).
 */
export function PlaytimeTile() {
  const { t } = useTranslation()
  const openDialog = useLauncher((state) => state.openDialog)
  const { state, data, retry } = useTileData(fetchPlaytimeStats)
  const title = t('home.dashboard.tiles.playtime.title')

  if (state === 'loading') return <DashboardTileFrame title={title} state="loading" />
  if (state === 'error') return <DashboardTileFrame title={title} state="error" onRetry={retry} />

  // "Empty" means there is nothing to show at all - zero installations. A `LibraryStats` with
  // installations but no playtime yet, no favourites, or no last session is still meaningful
  // content (AC1 wants those facts rendered as real zeroes/omissions), so only `total === 0` -
  // no installations registered - triggers the frame's empty state.
  if (!data || data.total === 0) {
    return (
      <DashboardTileFrame
        title={title}
        state="empty"
        empty={{
          title: t('home.dashboard.tiles.playtime.empty.title'),
          body: t('home.dashboard.tiles.playtime.empty.body'),
          actions: (
            <Button
              variant="primary"
              size="sm"
              data-testid="playtime-tile-empty-action"
              onClick={() => openDialog({ kind: 'add-existing' })}
            >
              {t('home.dashboard.tiles.playtime.empty.action')}
            </Button>
          ),
        }}
      />
    )
  }

  const engineEntries = Object.entries(data.byEngine) as Array<[EngineKind, number]>
  const lastSession = data.lastSession
  const lastSessionWhen = lastSession ? formatRelativeTime(lastSession.at) : null

  return (
    <DashboardTileFrame title={title} state="filled">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" tabIndex={0}>
        <div className="grid grid-cols-4 gap-1.5" data-testid="playtime-tile-status">
          <StatBlock
            label={t('home.dashboard.tiles.playtime.status.total')}
            value={formatCount(data.total)}
          />
          <StatBlock
            label={t('home.dashboard.tiles.playtime.status.ok')}
            value={formatCount(data.ok)}
            tone="text-success"
          />
          <StatBlock
            label={t('home.dashboard.tiles.playtime.status.needsAttention')}
            value={formatCount(data.needsAttention)}
            tone={data.needsAttention > 0 ? 'text-warning' : undefined}
          />
          <StatBlock
            label={t('home.dashboard.tiles.playtime.status.missing')}
            value={formatCount(data.missing)}
            tone={data.missing > 0 ? 'text-danger' : undefined}
          />
        </div>

        {engineEntries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="playtime-tile-engines">
            <SectionLabel className="text-[9px]">
              {t('home.dashboard.tiles.playtime.engines.label')}
            </SectionLabel>
            {engineEntries.map(([engine, count]) => (
              <Badge key={engine} tone="neutral">
                {engineLabel(engine)} {formatCount(count)}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <KeyValue label={t('home.dashboard.tiles.playtime.favorites.label')} mono>
            {formatCount(data.favorites)}
          </KeyValue>
          <KeyValue label={t('home.dashboard.tiles.playtime.totalPlaytime.label')} mono>
            {formatDuration(data.totalPlaytimeSeconds)}
          </KeyValue>
          <KeyValue label={t('home.dashboard.tiles.playtime.lastSession.label')}>
            {lastSession
              ? t('home.dashboard.tiles.playtime.lastSession.value', {
                  name: lastSession.name,
                  when: lastSessionWhen ?? '',
                })
              : t('home.dashboard.tiles.playtime.lastSession.none')}
          </KeyValue>
        </div>
      </div>
    </DashboardTileFrame>
  )
}

function StatBlock({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-sm border border-line bg-panel px-1.5 py-1.5">
      <span className={cn('numeric text-base leading-none text-ink', tone)}>{value}</span>
      <span className="stencil text-center text-[9px] leading-tight">{label}</span>
    </div>
  )
}
