import { useTranslation } from 'react-i18next'
import type { Job } from '@shared/types'
import { formatBytes, formatPercent } from '../../../lib/format'
import { ProgressBar } from '../../../components/ui/ProgressBar'
import { Badge } from '../../../components/ui/primitives'

/**
 * Story 074 D6, step 4: the D4 job's live progress, read from the store's `jobs` slice - no new
 * plumbing, `jobs:changed` already keeps that array current. Deliberately a small summary, not the
 * action bar's full readout (bytes/speed/ETA belong to the action bar, which is still visible once
 * this dialog closes).
 */
export function RunningStep({ job }: { job: Job | undefined }) {
  const { t } = useTranslation()

  if (!job) {
    return <p className="text-xs text-ink-muted">{t('bootstrapWizard.running.gone')}</p>
  }

  const { ratio, bytesDone, bytesTotal } = job.progress

  return (
    <div className="space-y-3" data-testid="bootstrap-running-step" data-status={job.status}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-sm tracking-[0.04em] text-ink uppercase">
          {t(job.labelKey, job.labelParams ?? {})}
        </span>
        <Badge tone={job.status === 'failed' ? 'danger' : job.status === 'succeeded' ? 'success' : 'flame'}>
          {t(`jobs.status.${job.status}`)}
        </Badge>
      </div>

      <ProgressBar ratio={ratio} active={job.status === 'running'} label={t(job.labelKey, job.labelParams ?? {})} />

      <p className="numeric text-xs text-ink-muted">
        {ratio !== null
          ? formatPercent(ratio)
          : bytesTotal
            ? `${formatBytes(bytesDone)} / ${formatBytes(bytesTotal)}`
            : formatBytes(bytesDone)}
      </p>

      {job.error && (
        <p className="text-xs text-danger">{t(job.error.key, job.error.params ?? {})}</p>
      )}
    </div>
  )
}
