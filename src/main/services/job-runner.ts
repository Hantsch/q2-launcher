import {
  fail,
  isJobActive,
  ok,
  type Installation,
  type JobProgress,
  type ModuleId,
  type Outcome,
} from '@shared/types'
import { scopedLogger } from '../lib/logger'
import type { JobsService } from './jobs'
import { isWriteCancelled, type InstallationWriteGuard } from './write-guard'

const log = scopedLogger('job-runner')

/** What a job body that throws ends as - the one failure every job shares. */
export const JOB_LOCAL_FAILURE = 'downloads.error.diskWrite'
export type JobLocalFailureKey = typeof JOB_LOCAL_FAILURE

/** The refusal an `exclusive` job gets while another job targets its installation. */
export const JOB_INSTALLATION_BUSY = 'jobs.error.installationBusy'

export type JobOutcome<K extends string = string, S extends object = Record<never, never>> =
  | ({ status: 'succeeded' } & S)
  | { status: 'failed'; key: K; params?: Record<string, string | number> }
  | { status: 'cancelled' }

/** Anything a body can stop on cancel - an archive extraction's handle satisfies it. */
export interface KillableHandle {
  kill(): void
}

interface RunJobSpecBase {
  moduleId: ModuleId
  kind: string
  labelKey: string
  labelParams?: Record<string, string | number>
  playableAtRatio?: number
  cancellable?: boolean
}

/** `exclusive` needs the installation it is exclusive on, so the two come together. */
export type RunJobSpec = RunJobSpecBase &
  (
    | { exclusive: 'installation'; installationId: string }
    | { exclusive?: undefined; installationId?: string }
  )

export interface JobContext<K extends string = string, S extends object = Record<never, never>> {
  jobId: string
  /** Aborted by the job's cancel; also what a deferred write waits on. */
  signal: AbortSignal
  /** A no-op once cancelled, so a late report cannot turn a cancelled job back into `running`. */
  report(progress: JobProgress): void
  /** Logs `reason` and returns the failed outcome; the runner finishes the job from it. */
  fail(key: K, reason: string, params?: Record<string, string | number>): JobOutcome<K, S>
  cancelled(): JobOutcome<K, S>
  /**
   * Runs `fn` through the installation write guard. `'cancelled'` when the job was cancelled
   * before or during the write; any other error is rethrown.
   */
  write(installationId: string, fn: () => Promise<void>): Promise<'done' | 'cancelled'>
  /** Registers the handle the job's cancel kills; one registered after a cancel is killed at once. */
  setExtractor(handle: KillableHandle): void
  markPlayable(ratio: number): void
  /** Re-inspects the installation; it then counts as revalidated after the writes before it. */
  revalidate(installationId: string): Promise<Outcome<Installation>>
}

export interface StartedJob<K extends string, S extends object> {
  jobId: string
  /** Resolves once the job is terminal. Never rejects. */
  settled: Promise<JobOutcome<K | JobLocalFailureKey, S>>
}

export interface JobRunnerDeps {
  jobs: Pick<JobsService, 'create' | 'list' | 'progress' | 'finish' | 'markPlayable'>
  writeGuard: Pick<InstallationWriteGuard, 'runWrite'>
  installations: { validate(id: string): Promise<Outcome<Installation>> }
  /**
   * Flushes the debounced state file. A job that wrote into an installation has changed state a
   * user can already see once it finishes (a mod's record, an engine's state), so the runner makes
   * it durable first: "finished" never runs ahead of what survives a crash.
   */
  state?: { settle(): Promise<{ ok: boolean }> }
}

/**
 * One lifecycle for every module job: admission, cancellation, progress, the write
 * guard, the revalidation after a write and the single `finish`.
 *
 * Invariants:
 *  - an `exclusive` admission check and `jobs.create` run in the same synchronous turn, so two
 *    starts cannot both pass the check;
 *  - `jobs.finish` is called at most once, and never on a job `jobs.cancel` already finished -
 *    the user's `cancelled` is not overwritten by whatever the body returns afterwards;
 *  - every installation the job actually wrote into is revalidated before the job finishes, even
 *    when the write or the body failed, because files may have changed either way.
 */
export class JobRunner {
  private readonly deps: JobRunnerDeps
  /**
   * Jobs this runner started whose body, revalidation and finish are not all done yet
   * (jobId -> installationId). `jobs.cancel` ends a job at once, but its body may still be writing.
   */
  private readonly inFlight = new Map<string, string>()

  constructor(deps: JobRunnerDeps) {
    this.deps = deps
  }

  /** True while any module's active job, or a job of this runner still running, targets this installation. */
  isInstallationBusy(installationId: string): boolean {
    for (const target of this.inFlight.values()) if (target === installationId) return true
    return this.deps.jobs
      .list()
      .some((job) => job.installationId === installationId && isJobActive(job))
  }

  run<K extends string, S extends object = Record<never, never>>(
    spec: RunJobSpec,
    body: (ctx: JobContext<K, S>) => Promise<JobOutcome<K, S>>,
  ): Outcome<StartedJob<K, S>> {
    const { jobs, writeGuard, installations, state } = this.deps
    // No `await` may sit between this check and `jobs.create` below.
    if (spec.exclusive === 'installation' && this.isInstallationBusy(spec.installationId)) {
      return fail(JOB_INSTALLATION_BUSY)
    }

    const cancellation = new AbortController()
    const signal = cancellation.signal
    let extractor: KillableHandle | undefined
    const job = jobs.create({
      moduleId: spec.moduleId,
      kind: spec.kind,
      labelKey: spec.labelKey,
      ...(spec.labelParams ? { labelParams: spec.labelParams } : {}),
      ...(spec.installationId ? { installationId: spec.installationId } : {}),
      ...(spec.playableAtRatio !== undefined ? { playableAtRatio: spec.playableAtRatio } : {}),
      cancellable: spec.cancellable ?? true,
      onCancel: () => {
        cancellation.abort()
        extractor?.kill()
      },
    })
    const jobId = job.id
    const label = `${spec.moduleId}/${spec.kind} job ${jobId}`
    if (spec.installationId) this.inFlight.set(jobId, spec.installationId)

    // Installations written since their last revalidation. Added both when a write's `fn` starts
    // and when it ends, so a revalidation that overlapped a write does not count for it.
    const unrevalidated = new Set<string>()
    let wrote = false

    const ctx: JobContext<K, S> = {
      jobId,
      signal,
      report: (progress) => {
        if (!signal.aborted) jobs.progress(jobId, progress)
      },
      fail: (key, reason, params) => {
        log.warn(`${label} failed with ${key}: ${reason}`)
        return { status: 'failed', key, ...(params ? { params } : {}) }
      },
      cancelled: () => ({ status: 'cancelled' }),
      write: async (installationId, fn) => {
        try {
          await writeGuard.runWrite(installationId, jobId, signal, async () => {
            unrevalidated.add(installationId)
            wrote = true
            try {
              await fn()
            } finally {
              unrevalidated.add(installationId)
            }
          })
        } catch (error) {
          if (isWriteCancelled(error) || signal.aborted) return 'cancelled'
          throw error
        }
        // An `fn` that noticed the cancel and returned early did not complete the write.
        return signal.aborted ? 'cancelled' : 'done'
      },
      setExtractor: (handle) => {
        extractor = handle
        if (signal.aborted) handle.kill()
      },
      markPlayable: (ratio) => jobs.markPlayable(jobId, ratio),
      revalidate: (installationId) => {
        unrevalidated.delete(installationId)
        return installations.validate(installationId)
      },
    }

    const lifecycle = async (): Promise<JobOutcome<K | JobLocalFailureKey, S>> => {
      let outcome: JobOutcome<K | JobLocalFailureKey, S>
      try {
        outcome = await body(ctx)
      } catch (error) {
        log.warn(`${label} threw: ${String(error)}`)
        outcome = { status: 'failed', key: JOB_LOCAL_FAILURE }
      }

      for (const installationId of [...unrevalidated]) {
        try {
          const revalidated = await installations.validate(installationId)
          if (!revalidated.ok) {
            log.warn(`${label}: revalidating ${installationId} failed: ${revalidated.error.key}`)
          }
        } catch (error) {
          log.warn(`${label}: revalidating ${installationId} threw: ${String(error)}`)
        }
      }

      // A job `jobs.cancel` already ended is not held back by the flush.
      const stillActive = jobs
        .list()
        .some((candidate) => candidate.id === jobId && isJobActive(candidate))
      if (wrote && stillActive) {
        try {
          await state?.settle()
        } catch (error) {
          log.warn(`${label}: flushing the state threw: ${String(error)}`)
        }
      }

      // Only `jobs.cancel` ends a job before the runner does, so an inactive job here was
      // cancelled by the user - which is also what the caller is told.
      const current = jobs.list().find((candidate) => candidate.id === jobId)
      if (!current || !isJobActive(current)) return { status: 'cancelled' }

      try {
        if (outcome.status === 'failed') {
          const { key, params } = outcome
          jobs.finish(jobId, { status: 'failed', error: { key, ...(params ? { params } : {}) } })
        } else {
          jobs.finish(jobId, { status: outcome.status })
        }
      } catch (error) {
        log.error(`${label}: finishing threw: ${String(error)}`)
      }
      return outcome
    }

    const settled = (async (): Promise<JobOutcome<K | JobLocalFailureKey, S>> => {
      try {
        return await lifecycle()
      } finally {
        this.inFlight.delete(jobId)
      }
    })()

    return ok({ jobId, settled })
  }
}
