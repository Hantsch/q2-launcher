import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { Job } from '@shared/types'
import { formatBytes, formatDuration, formatSpeed } from '../../../lib/format'
import { IconButton } from '../../../components/ui/Button'
import { ProgressBar } from '../../../components/ui/ProgressBar'
import { Badge, Panel } from '../../../components/ui/primitives'

/**
 * Story 073 D3 (AC1): one row in the Downloads tab's live job list.
 *
 * A `queued` job has no meaningful progress figures yet (nothing has started moving), so it
 * renders only its label and status badge - the bytes/speed/ETA line and the progress bar are
 * `running`-only, per the deliverable's own acceptance test name ("a queued job renders without
 * progress figures"). A `paused`/`succeeded`/`failed`/`cancelled` job also skips the figures for
 * the same reason: none of them describe motion happening right now.
 */
export interface JobRowProps {
  job: Job
  /** True while a `succeeded` job is fading out of the list (`DownloadsView`'s own timer). */
  fading?: boolean
  onCancel: (jobId: string) => void
}

export function JobRow({ job, fading = false, onCancel }: JobRowProps) {
  const { t } = useTranslation()
  const { ratio, bytesDone, bytesTotal, bytesPerSecond, etaSeconds } = job.progress
  const running = job.status === 'running'

  return (
    <Panel
      className="space-y-2 p-3 transition-opacity duration-[--dur-base]"
      data-testid={`downloads-job-${job.id}`}
      data-status={job.status}
      style={fading ? { opacity: 0 } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-sm tracking-[0.04em] text-ink">
              {t(job.labelKey, job.labelParams ?? {})}
            </span>
            <Badge tone={statusTone(job.status)}>{t(`jobs.status.${job.status}`)}</Badge>
          </div>
        </div>

        {job.cancellable && (
          <IconButton
            label={t('downloads.job.cancel')}
            size="sm"
            onClick={() => onCancel(job.id)}
            data-testid={`downloads-job-cancel-${job.id}`}
          >
            <X className="size-3.5" />
          </IconButton>
        )}
      </div>

      {running && (
        <>
          <ProgressBar
            ratio={ratio}
            active
            label={t(job.labelKey, job.labelParams ?? {})}
            {...(job.playableAtRatio !== undefined ? { playableAtRatio: job.playableAtRatio } : {})}
          />
          <div className="numeric flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            <span>
              {bytesTotal
                ? `${formatBytes(bytesDone)} / ${formatBytes(bytesTotal)}`
                : formatBytes(bytesDone)}
            </span>
            {bytesPerSecond !== undefined && <span>{formatSpeed(bytesPerSecond)}</span>}
            {etaSeconds !== undefined && (
              <span>{t('actionbar.eta', { time: formatDuration(etaSeconds) })}</span>
            )}
          </div>
        </>
      )}
    </Panel>
  )
}

function statusTone(status: Job['status']): 'neutral' | 'flame' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'running':
      return 'flame'
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'danger'
    case 'paused':
      return 'warning'
    default:
      return 'neutral'
  }
}
