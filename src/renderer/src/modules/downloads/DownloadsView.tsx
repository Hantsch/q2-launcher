import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import type { Job } from '@shared/types'
import type { DownloadFailure } from '@shared/modules/downloads'
import { useLauncher } from '../../store/useLauncher'
import { formatBytes } from '../../lib/format'
import { EmptyState, KeyValue, Panel, SectionLabel } from '../../components/ui/primitives'
import { dismissDownloadFailure, getArchiveCacheStatus, getDownloadFailures, restoreDownloadFailure } from './client'
import { JobRow } from './components/JobRow'
import { FailureLogEntry } from './components/FailureLogEntry'

/** How long a `succeeded` job stays visible, fading, before it is dropped from the list
 * (Decisions (Sprint): "a `succeeded` job stays visible ~2 s with a token-based fade"). */
const SUCCESS_FADE_MS = 2000

const LIVE_STATUSES = new Set<Job['status']>(['queued', 'running', 'paused'])

/**
 * Story 073 D3: the Downloads tab - the real view that replaces `PlannedModuleView` for the
 * `downloads` module (AC4).
 *
 * Renders the store's `jobs` slice (no dedicated IPC call - main already broadcasts the full
 * list over `jobs:changed`, Decisions (Sprint)) as a live job list, plus the archive cache's
 * current size fetched once through the module client.
 *
 * Story 073 D4 adds the failure log below the live list: undismissed entries are always
 * visible, dismissed ones collapse into a `<details>` disclosure with a restore action
 * (Decisions (Sprint)). There is no push channel for the log - it is refetched on mount and on
 * every `jobs:changed` (the `jobs` dependency below), and the dismiss/restore calls apply the
 * server's returned list directly instead of triggering a second round trip.
 */
export function DownloadsView() {
  const { t } = useTranslation()
  const jobs = useLauncher((state) => state.jobs)
  const cancelJob = useLauncher((state) => state.cancelJob)
  const [cacheStatus, setCacheStatus] = useState<{ totalBytes: number; itemCount: number } | null>(
    null,
  )
  const [fadingIds, setFadingIds] = useState<ReadonlySet<string>>(new Set())
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set())
  const [failures, setFailures] = useState<DownloadFailure[]>([])

  useEffect(() => {
    let cancelled = false
    void getArchiveCacheStatus().then((result) => {
      if (!cancelled && result.ok) setCacheStatus(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // D4: the failure log has no push channel - it is refetched on mount and whenever the `jobs`
  // store slice changes, since a failure always coincides with a `jobs:changed` broadcast
  // (Decisions (Sprint)).
  useEffect(() => {
    let cancelled = false
    void getDownloadFailures().then((result) => {
      if (!cancelled && result.ok) setFailures(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [jobs])

  function handleDismissFailure(id: string) {
    void dismissDownloadFailure(id).then((result) => {
      if (result.ok) setFailures(result.value)
    })
  }

  function handleRestoreFailure(id: string) {
    void restoreDownloadFailure(id).then((result) => {
      if (result.ok) setFailures(result.value)
    })
  }

  // A `succeeded` job is marked fading the moment it is first seen, then dropped from the
  // visible list ~2s later via its own timeout - renderer-only, never written to the failure
  // log (Decisions (Sprint)).
  //
  // `startedFadeIdsRef` remembers which job ids have already had their fade-out timer started,
  // independent of React state, so this effect only ever schedules ONE timer per job for the
  // job's entire fade lifecycle. Without this, the effect re-running on every `jobs` store
  // change (e.g. another job's progress tick, `concurrentJobs` default of 2 makes this common)
  // would see the job's id already present in `fadingIds` and just skip it - fine - but the
  // previous implementation instead returned a cleanup that cleared the in-flight timeout on
  // every re-run and never rescheduled it, leaving the row stuck at opacity:0 forever. Tracking
  // "already started" in a ref (not cleared by this effect's cleanup) lets a fade run to
  // completion untouched by unrelated `jobs` updates.
  const startedFadeIdsRef = useRef<Set<string>>(new Set())
  const fadeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const newlySucceeded = jobs
      .filter((job) => job.status === 'succeeded')
      .map((job) => job.id)
      .filter((id) => !startedFadeIdsRef.current.has(id))

    if (newlySucceeded.length === 0) return

    setFadingIds((prev) => new Set([...prev, ...newlySucceeded]))

    newlySucceeded.forEach((id) => {
      startedFadeIdsRef.current.add(id)
      const timer = setTimeout(() => {
        fadeTimersRef.current.delete(id)
        setHiddenIds((prev) => new Set([...prev, id]))
      }, SUCCESS_FADE_MS)
      fadeTimersRef.current.set(id, timer)
    })
  }, [jobs])

  // Timers are only ever cleared on unmount - a per-run cleanup here would reintroduce the bug
  // above (see comment on `startedFadeIdsRef`).
  useEffect(() => {
    const timers = fadeTimersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const visibleJobs = jobs.filter((job) => {
    if (hiddenIds.has(job.id)) return false
    if (job.status === 'succeeded') return true
    return LIVE_STATUSES.has(job.status)
  })

  const undismissedFailures = failures.filter((failure) => !failure.dismissedAt)
  const dismissedFailures = failures.filter((failure) => failure.dismissedAt)

  return (
    <div className="h-full overflow-y-auto scrollbar-gutter-stable">
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl tracking-[0.06em] text-ink uppercase">
            {t('module.downloads.title')}
          </h1>
          <p className="text-xs text-ink-muted">{t('module.downloads.description')}</p>
        </header>

        <Panel className="space-y-2 p-4">
          <SectionLabel>{t('downloads.cache.title')}</SectionLabel>
          <KeyValue label={t('downloads.cache.size')}>
            {cacheStatus
              ? t('module.downloads.settings.cacheSize.value', {
                  size: formatBytes(cacheStatus.totalBytes),
                  count: cacheStatus.itemCount,
                })
              : '-'}
          </KeyValue>
        </Panel>

        <div className="space-y-2">
          <SectionLabel>{t('downloads.jobs.title')}</SectionLabel>
          {visibleJobs.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Download className="size-6" />}
                title={t('downloads.jobs.empty.title')}
                body={t('downloads.jobs.empty.body')}
              />
            </Panel>
          ) : (
            <ul className="space-y-2">
              {visibleJobs.map((job) => (
                <li key={job.id}>
                  <JobRow
                    job={job}
                    fading={fadingIds.has(job.id)}
                    onCancel={(jobId) => void cancelJob(jobId)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {failures.length > 0 && (
          <div className="space-y-2">
            <SectionLabel>{t('downloads.failures.title')}</SectionLabel>
            {undismissedFailures.length > 0 && (
              <ul className="space-y-2">
                {undismissedFailures.map((failure) => (
                  <li key={failure.id}>
                    <FailureLogEntry
                      failure={failure}
                      dismissed={false}
                      onDismiss={handleDismissFailure}
                      onRestore={handleRestoreFailure}
                    />
                  </li>
                ))}
              </ul>
            )}
            {dismissedFailures.length > 0 && (
              <details className="group rounded-md border border-line">
                <summary className="stencil cursor-pointer list-none px-3 py-2 select-none">
                  {t('downloads.failures.dismissed.summary', { count: dismissedFailures.length })}
                </summary>
                <ul className="space-y-2 p-3 pt-0">
                  {dismissedFailures.map((failure) => (
                    <li key={failure.id}>
                      <FailureLogEntry
                        failure={failure}
                        dismissed
                        onDismiss={handleDismissFailure}
                        onRestore={handleRestoreFailure}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
