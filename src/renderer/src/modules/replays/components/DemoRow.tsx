import { useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, FileWarning, Star, StickyNote, TriangleAlert } from 'lucide-react'
import type { DemoRow as DemoRowData } from '@shared/modules/replays'
import type { GamemodeSource } from '@shared/demos/gamemode'
import { describeGamemode } from '@shared/demos/gamemode'
import { formatDemoDuration } from '@shared/demos/duration-format'
import { cn } from '../../../lib/cn'
import { Badge } from '../../../components/ui/primitives'
import { IconButton } from '../../../components/ui/Button'
import { DEMO_LIST_GRID } from '../list-grid'
import { formatDemoDate, formatLabel, sidesText } from '../row-format'
import { useDemoEditorStore, type RowPatcher } from '../demo-editor-store'

export interface DemoRowProps {
  row: DemoRowData
  selected: boolean
  onSelect: (id: string) => void
  /** Patches this row's `sidecar` part in the view's list after a quick edit - same patcher the
   * detail panel's own save uses (`ReplaysView`'s `handleRowPatched`). */
  onRowPatched?: RowPatcher
}

const RATING_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1)

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
export function DemoRow({ row, selected, onSelect, onRowPatched }: DemoRowProps) {
  const { t, i18n } = useTranslation()
  const archiveMarkerId = `replays-marker-archive-${row.id}`
  const archiveReadonlyRowId = `replays-archive-readonly-row-${row.id}`

  // Regression fix (155 broke 154's `replays-date-filter` keyboard-Tab-order flow): the quick
  // favourite/rating controls used to always carry `tabIndex={0}`, so every rendered row added two
  // permanent stops to the document's Tab sequence - a Tab press that only means to pass the whole
  // list (to reach a control beyond it, e.g. the date filter's trigger) had to step through every
  // row's own favourite button and rating select on the way, an unbounded cost as the list grows.
  // They now sit outside the Tab sequence entirely (`tabIndex={-1}`) and are reached from the row's
  // own `role="button"` cell with ArrowRight/ArrowLeft instead - still fully keyboard-operable (one
  // extra keystroke each way, same row), just never a stop a passing-through Tab has to visit.
  // Mirrors the roving-tabindex idiom for a repeated row's own action cluster (WAI-ARIA APG's
  // grid/toolbar pattern), scoped down to "two extra stops, entered by arrow key, never by Tab".
  const favouriteRef = useRef<HTMLButtonElement>(null)
  const ratingRef = useRef<HTMLSelectElement>(null)
  const selectableRowRef = useRef<HTMLDivElement>(null)

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
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      favouriteRef.current?.focus()
    }
  }

  function handleFavouriteKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      ratingRef.current?.focus()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      selectableRowRef.current?.focus()
    }
  }

  function handleRatingKeyDown(event: KeyboardEvent<HTMLSelectElement>): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      favouriteRef.current?.focus()
    }
  }

  return (
    // The favourite IconButton and rating select must not sit inside the row's own
    // `role="button"` (axe `nested-interactive`), so the outer div owns the grid, the row's
    // look and the plain click-to-select, and the selectable row is a full-width subgrid inside
    // it - the quick controls (and the identity/status cells they used to share a flex row with)
    // are its sibling, laid over the row's last column (the inner subgrid leaves that column an
    // empty placeholder so the column count still lines up with `DemoListHeader`). Both controls
    // already stop propagation, so clicking them never selects the row. Mirrors
    // `../../servers/ServerRow.tsx`'s copy-address button.
    <div
      onClick={() => onSelect(row.id)}
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
      <div
        ref={selectableRowRef}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-pressed={selected}
        className="col-span-full row-start-1 grid grid-cols-subgrid items-center"
      >
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
            <span className="min-w-0 flex-1 truncate" data-testid="replays-demo-name">
              {name !== null ? name : <UnknownValue />}
            </span>
          </p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="truncate text-[11px] text-ink-muted"
              data-testid="replays-demo-gamemode"
            >
              {gamemodeDescription.labelKey !== undefined
                ? t(gamemodeDescription.labelKey)
                : gamemodeDescription.text}
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
                id={archiveMarkerId}
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
        <span
          className="numeric truncate text-right text-[11px]"
          data-testid="replays-demo-duration"
        >
          {duration.kind === 'known' ? duration.text : <UnknownValue />}
        </span>
        {/* This column's real content (badges + quick controls) is the outer div's sibling below -
          this placeholder just keeps the subgrid's column count lined up with the header. */}
        <span aria-hidden="true" />
      </div>

      <span className="col-start-7 row-start-1 flex items-center justify-end gap-1.5">
        {favourite && (
          <span
            data-testid="replays-demo-favourite"
            role="img"
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
        <IconButton
          ref={favouriteRef}
          label={t('replays.row.quick.favouriteAriaLabel', { name: name ?? row.fileName })}
          size="sm"
          aria-pressed={favourite}
          disabled={row.archiveEntry !== null}
          aria-describedby={row.archiveEntry !== null ? archiveReadonlyRowId : undefined}
          tabIndex={-1}
          data-testid="replays-row-favourite"
          onClick={(event: MouseEvent) => {
            event.stopPropagation()
            void useDemoEditorStore
              .getState()
              .quickEdit(row.id, { favourite: !favourite }, onRowPatched ?? (() => {}))
          }}
          onKeyDown={handleFavouriteKeyDown}
        >
          <Star
            className={cn(
              'size-3.5',
              favourite ? 'fill-flame-500 text-flame-500' : 'text-ink-muted',
            )}
            aria-hidden="true"
          />
        </IconButton>
        <select
          ref={ratingRef}
          aria-label={t('replays.row.quick.ratingAriaLabel', { name: name ?? row.fileName })}
          disabled={row.archiveEntry !== null}
          aria-describedby={row.archiveEntry !== null ? archiveReadonlyRowId : undefined}
          tabIndex={-1}
          data-testid="replays-row-rating"
          value={rating !== undefined ? String(rating) : ''}
          className="h-6 rounded-sm border border-line-strong bg-void/60 px-1 text-[11px] text-ink disabled:opacity-45"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleRatingKeyDown}
          onChange={(event) => {
            event.stopPropagation()
            const value = event.target.value
            void useDemoEditorStore
              .getState()
              .quickEdit(
                row.id,
                { rating: value === '' ? null : Number(value) },
                onRowPatched ?? (() => {}),
              )
          }}
        >
          <option value="">{t('replays.row.quick.noRating')}</option>
          {RATING_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {row.archiveEntry !== null && (
          <span
            id={archiveReadonlyRowId}
            data-testid="replays-archive-readonly-row"
            className="text-[10px] text-ink-muted"
          >
            {t('replays.archive.readOnly.row')}
          </span>
        )}
      </span>
    </div>
  )
}
