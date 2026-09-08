import { useTranslation } from 'react-i18next'
import { RotateCcw, X } from 'lucide-react'
import { DOWNLOADS_ERROR_KEYS, type DownloadFailure } from '@shared/modules/downloads'
import { useInstallationById } from '../../../store/useLauncher'
import { formatRelativeTime } from '../../../lib/format'
import { IconButton } from '../../../components/ui/Button'
import { Badge, Panel } from '../../../components/ui/primitives'

/**
 * Story 073 D4 (AC2): one entry in the Downloads tab's failure log - either an always-visible
 * undismissed entry (with a Dismiss action) or one shown inside the collapsed "dismissed"
 * disclosure (with a Restore action instead). Mirrors `JobRow`'s layout and primitive
 * conventions (`Panel`, `Badge`, `IconButton`) so the two lists read as one system.
 */
export interface FailureLogEntryProps {
  failure: DownloadFailure
  /** True when rendered inside the collapsed "dismissed" disclosure - flips the action to Restore. */
  dismissed: boolean
  onDismiss: (id: string) => void
  onRestore: (id: string) => void
}

const KNOWN_ERROR_KEYS = new Set<string>(DOWNLOADS_ERROR_KEYS)

export function FailureLogEntry({ failure, dismissed, onDismiss, onRestore }: FailureLogEntryProps) {
  const { t } = useTranslation()
  const installation = useInstallationById(failure.installationId ?? null)
  const errorKey = KNOWN_ERROR_KEYS.has(failure.error.key) ? failure.error.key : 'downloads.error.unknown'
  const timestamp = formatRelativeTime(new Date(failure.createdAt).toISOString())

  return (
    <Panel className="space-y-2 p-3" data-testid={`downloads-failure-${failure.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-sm tracking-[0.04em] text-ink">
              {t(failure.labelKey, failure.labelParams ?? {})}
            </span>
            <Badge tone="danger">{t('jobs.status.failed')}</Badge>
          </div>
          <p className="text-xs text-ink-dim">{t(errorKey, failure.error.params ?? {})}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            {installation && (
              <span>{t('downloads.failures.installation', { name: installation.name })}</span>
            )}
            {timestamp && <span>{timestamp}</span>}
          </div>
        </div>

        {dismissed ? (
          <IconButton
            label={t('downloads.failures.restore')}
            size="sm"
            onClick={() => onRestore(failure.id)}
            data-testid={`downloads-failure-restore-${failure.id}`}
          >
            <RotateCcw className="size-3.5" />
          </IconButton>
        ) : (
          <IconButton
            label={t('downloads.failures.dismiss')}
            size="sm"
            onClick={() => onDismiss(failure.id)}
            data-testid={`downloads-failure-dismiss-${failure.id}`}
          >
            <X className="size-3.5" />
          </IconButton>
        )}
      </div>
    </Panel>
  )
}
