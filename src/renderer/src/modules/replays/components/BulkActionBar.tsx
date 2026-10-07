import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/Button'
import type { BulkKind, BulkOutcomeView } from '../useBulkActions'

const DONE_KEY: Record<BulkKind, string> = {
  delete: 'replays.bulk.summary.deleted',
  tag: 'replays.bulk.summary.tagged',
  move: 'replays.bulk.summary.moved',
}

export interface BulkActionBarProps {
  count: number
  /** Selected demos inside a zip: read-only, so every action skips them. */
  zipCount: number
  busy: BulkKind | null
  outcome: BulkOutcomeView | null
  onDelete: () => void
  onTag: () => void
  onMove: () => void
}

/** The actions over the selected demos, and after one ran, what it did to each demo it did not finish. */
export function BulkActionBar(props: BulkActionBarProps) {
  const { count, zipCount, busy, outcome, onDelete, onTag, onMove } = props
  const { t } = useTranslation()
  const actionable = count - zipCount > 0
  const summary =
    outcome === null
      ? null
      : [
          t(DONE_KEY[outcome.kind], { count: outcome.done }),
          ...(outcome.failed > 0
            ? [t('replays.bulk.summary.failed', { count: outcome.failed })]
            : []),
          ...(outcome.skipped > 0
            ? [t('replays.bulk.summary.skipped', { count: outcome.skipped })]
            : []),
        ].join(', ')

  return (
    <div
      className="mb-3 space-y-2 rounded border border-line bg-panel/60 px-3 py-2"
      data-testid="replays-bulk-bar"
      aria-busy={busy !== null}
    >
      <div className="flex flex-wrap items-center gap-2">
        {count > 0 && (
          <span className="mr-2 text-xs text-ink" data-testid="replays-bulk-count">
            {t('replays.multi.count', { count })}
          </span>
        )}
        <Button
          variant="danger"
          size="sm"
          disabled={busy !== null || !actionable}
          onClick={onDelete}
          data-testid="replays-bulk-delete"
        >
          {t('replays.bulk.action.delete')}
        </Button>
        <Button
          size="sm"
          disabled={busy !== null || !actionable}
          onClick={onTag}
          data-testid="replays-bulk-tag"
        >
          {t('replays.bulk.action.tag')}
        </Button>
        <Button
          size="sm"
          disabled={busy !== null || !actionable}
          onClick={onMove}
          data-testid="replays-bulk-move"
        >
          {t('common.action.move')}
        </Button>
        {busy !== null && (
          <span className="text-xs text-ink-muted" role="status" data-testid="replays-bulk-busy">
            {t('replays.bulk.busy')}
          </span>
        )}
      </div>
      {zipCount > 0 && (
        <p className="text-xs text-ink-muted" data-testid="replays-bulk-zip-skip">
          {t('replays.bulk.zipSkipped', { count: zipCount })}
        </p>
      )}
      {outcome !== null && summary !== null && (
        <div className="space-y-1" role="status" data-testid="replays-bulk-outcome">
          <p className="text-xs text-ink" data-testid="replays-bulk-summary">
            {summary}
          </p>
          {outcome.entries.length > 0 && (
            <ul className="space-y-0.5 text-xs text-ink-muted" data-testid="replays-bulk-entries">
              {outcome.entries.map((entry) => (
                <li key={entry.demoId} data-status={entry.status}>
                  <span className="text-ink">{entry.name}</span>
                  {' - '}
                  {entry.reasonKey === null ? '' : t(entry.reasonKey, entry.params)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
