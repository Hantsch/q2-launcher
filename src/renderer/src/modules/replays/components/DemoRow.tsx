import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, FileWarning, Star, StickyNote, TriangleAlert } from 'lucide-react'
import type { DemoRow as DemoRowData } from '@shared/modules/replays'
import type { GamemodeSource } from '@shared/demos/gamemode'
import { describeGamemode } from '@shared/demos/gamemode'
import { formatDemoDuration } from '@shared/demos/duration-format'
import { cn } from '../../../lib/cn'
import { Badge } from '../../../components/ui/primitives'
import { DEMO_LIST_GRID } from '../list-grid'
import { formatDemoDate, formatLabel, sidesText } from '../row-format'

export interface DemoRowProps {
  row: DemoRowData
  selected: boolean
  onSelect: (id: string) => void
}

/** The basename of an archive path, split on either separator - a demo may have been discovered on
 * either platform, so its stored path can carry either separator regardless of the host OS. */
function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

/** Renders an unknown field as a visible `–` (never `0`/blank), with the real "unknown" meaning
 * only available to assistive tech - mirrors `orDash` (`../servers/server-format.ts`) but as a
 * component, since a dash-only cell still needs an accessible label here. */
function UnknownValue() {
  const { t } = useTranslation()
  return (
    <span>
      <span aria-hidden="true">–</span>
      <span className="sr-only">{t('replays.row.unknown')}</span>
    </span>
  )
}

/**
 * D3: one row of the demos list - identity (name, gamemode, format, source) on the shared
 * `DEMO_LIST_GRID` template (so every cell lines up under `DemoListHeader`'s labels), plus a set of
 * status markers (sidecar/sidecar-error/archive/unreadable), each a visible icon with an accessible
 * name - status is never colour-only. Mirrors `../../servers/ServerRow.tsx`'s shape and
 * conventions.
 */
export function DemoRow({ row, selected, onSelect }: DemoRowProps) {
  const { t, i18n } = useTranslation()

  const name = row.effective.name.value
  const gamemode = row.effective.gamemode
  const gamemodeDescription = describeGamemode({
    value: gamemode.value,
    source: (gamemode.source ?? 'none') as GamemodeSource,
  })

  const baseSource =
    row.source.kind === 'installation'
      ? t('replays.list.source', {
          installation: row.source.installationName,
          gameDir: row.source.gameDir,
        })
      : t('replays.source.extraFolder', { path: row.source.path })
  const sourceText = row.archiveEntry
    ? t('replays.list.archiveSource', {
        base: baseSource,
        archive: basename(row.archiveEntry.archivePath),
        entry: row.archiveEntry.entryPath,
      })
    : baseSource

  const sides = sidesText(row.effective.sides.value ?? [], (count) =>
    t('replays.row.morePlayers', { count }),
  )
  const date = formatDemoDate(row.effective.date.value, i18n.language)
  const duration = formatDemoDuration(row.durationMs)

  const favourite = row.sidecar.values.favourite === true
  const rating = row.sidecar.values.rating

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(row.id)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(row.id)}
      onKeyDown={handleKeyDown}
      aria-pressed={selected}
      data-testid="replays-demo-row"
      data-demo-id={row.id}
      {...(row.archiveEntry !== null ? { 'data-archive-entry': 'true' } : {})}
      className={cn(
        DEMO_LIST_GRID,
        'w-full cursor-default border-b border-b-line/60 py-1.5 text-xs text-ink-dim transition-colors duration-[--dur-fast]',
        selected ? 'border-l-flame-500 bg-flame-900/20' : 'border-l-transparent hover:bg-hover',
      )}
      style={{ minHeight: 56 }}
    >
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
          <span className="min-w-0 flex-1 truncate" data-testid="replays-demo-name">
            {name !== null ? name : <UnknownValue />}
          </span>
        </p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[11px] text-ink-muted" data-testid="replays-demo-gamemode">
            {gamemodeDescription.labelKey !== undefined
              ? t(gamemodeDescription.labelKey)
              : gamemodeDescription.text}
            {gamemodeDescription.guessedKey !== undefined && (
              <span className="ml-1 text-ink-muted">({t(gamemodeDescription.guessedKey)})</span>
            )}
          </span>
          <Badge tone="neutral" testId="replays-demo-format">
            {formatLabel(row.format, row.gzip, t)}
          </Badge>
          <span className="truncate text-[11px] text-ink-muted" data-testid="replays-demo-source">
            {sourceText}
          </span>

          {row.sidecar.state !== 'none' && (
            <span
              data-testid="replays-marker-sidecar"
              className="inline-flex items-center gap-1 text-ink-muted"
            >
              <StickyNote className="size-3" aria-hidden="true" />
              <span className="sr-only">{t('replays.marker.sidecar')}</span>
            </span>
          )}
          {row.sidecar.state === 'error' && (
            <Badge tone="danger" testId="replays-marker-sidecar-error">
              <TriangleAlert className="size-3" aria-hidden="true" />
              {t('replays.marker.sidecarError')}
            </Badge>
          )}
          {row.archiveEntry !== null && (
            <span
              data-testid="replays-marker-archive"
              className="inline-flex items-center gap-1 text-ink-muted"
            >
              <Archive className="size-3" aria-hidden="true" />
              <span className="sr-only">{t('replays.marker.archive')}</span>
            </span>
          )}
          {!row.readable && (
            <Badge tone="warning" testId="replays-marker-unreadable">
              <FileWarning className="size-3" aria-hidden="true" />
              {t('replays.unreadable.marker')}
            </Badge>
          )}
        </div>
      </div>

      <span className="numeric truncate text-right text-[11px]" data-testid="replays-demo-map">
        {row.effective.map.value !== null ? row.effective.map.value : <UnknownValue />}
      </span>
      <span className="truncate text-right" data-testid="replays-demo-mod">
        {row.effective.mod.value !== null ? row.effective.mod.value : <UnknownValue />}
      </span>
      <span className="truncate text-right" data-testid="replays-demo-sides">
        {sides !== '' ? sides : <UnknownValue />}
      </span>
      <span className="numeric truncate text-right text-[11px]" data-testid="replays-demo-date">
        {date !== null ? date : <UnknownValue />}
      </span>
      <span className="numeric truncate text-right text-[11px]" data-testid="replays-demo-duration">
        {duration.kind === 'known' ? duration.text : <UnknownValue />}
      </span>
      <span className="flex items-center justify-end gap-1.5">
        {favourite && (
          <span
            data-testid="replays-demo-favourite"
            aria-label={t('replays.row.favourite')}
            className="inline-flex items-center"
          >
            <Star className="size-3.5 fill-flame-500 text-flame-500" aria-hidden="true" />
          </span>
        )}
        {rating !== undefined && (
          <span className="numeric text-ink-dim" data-testid="replays-demo-rating">
            {t('replays.row.ratingValue', { rating })}
          </span>
        )}
      </span>
    </div>
  )
}
