import { useTranslation } from 'react-i18next'
import type { Job } from '@shared/types'
import type { DownloadFailure } from '@shared/modules/downloads'
import { formatBytes, formatPercent } from '../../../lib/format'
import { ProgressBar } from '../../../components/ui/ProgressBar'
import { Badge } from '../../../components/ui/primitives'
import { FailureCauseDetail } from '../components/FailureCauseDetail'

/**
 * Story 074 D6, step 4: the D4 job's live progress, read from the store's `jobs` slice - no new
 * plumbing, `jobs:changed` already keeps that array current. Deliberately a small summary, not the
 * action bar's full readout (bytes/speed/ETA belong to the action bar, which is still visible once
 * this dialog closes).
 *
 * Story 078 D7 (AC4): `failure` is the `DownloadFailure` entry `BootstrapWizard` matched to this
 * job (fetched once when the job turns `failed` - see that file). Mounting the same
 * `FailureCauseDetail` here as `FailureLogEntry` mounts in the Downloads tab means a failed
 * bootstrap reads its cause without switching tabs. `FailureCauseDetail` itself renders `null`
 * without diagnostics, so an undefined/diagnostics-less `failure` leaves today's single error line
 * unchanged - no extra branching needed here.
 */
export function RunningStep({
  job,
  failure,
}: {
  job: Job | undefined
  failure?: DownloadFailure
}) {
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

      <FailureCauseDetail diagnostics={failure?.diagnostics} />
    </div>
  )
}
