import { randomUUID } from 'node:crypto'
import { fail, ok, type Job, type JobProgress, type ModuleId, type Outcome } from '@shared/types'
import { scopedLogger } from '../lib/logger'

const log = scopedLogger('jobs')

export interface CreateJobInput {
  moduleId: ModuleId
  kind: string
  labelKey: string
  labelParams?: Record<string, string | number>
  installationId?: string
  playableAtRatio?: number
  cancellable?: boolean
  /** Invoked by `cancel()`; the module is responsible for stopping its work. */
  onCancel?: () => void
}

/**
 * Notified with the full, current job list every time anything about it changes.
 * Both the shell's own broadcast callback and every `onChange` observer use this
 * one shape, so an observer sees exactly what `jobs:changed` carries.
 */
export type JobsListener = (jobs: Job[]) => void

/**
 * Registry for long-running module work.
 *
 * The shell owns this so that every module gets progress reporting, cancellation
 * and the action-bar readout for free: a module creates a job, reports progress,
 * and the UI updates. No module produces jobs in step 1 - this is the seam the
 * download, mods and assets modules will plug into.
 */
export class JobsService {
  private readonly jobs = new Map<string, Job>()
  private readonly cancellers = new Map<string, () => void>()
  /**
   * The shell's own consumer, handed in at construction: `context.ts` wires it to
   * the `jobs:changed` broadcast, which every job surface in the UI depends on.
   * Deliberately separate from `listeners` below - it is not optional, not
   * removable, and its call is the first thing `emit()` does.
   */
  private readonly broadcast: JobsListener
  /** Story 073 D2's additive observers - see `onChange()`. */
  private readonly listeners = new Set<JobsListener>()

  constructor(broadcast: JobsListener) {
    this.broadcast = broadcast
  }

  /**
   * Story 073 D2: registers an additional observer of job changes, and returns its
   * unsubscribe function. The downloads module uses this to append a failure-log
   * entry for every `downloads` job that reaches `failed`.
   *
   * Additive by construction, which is the whole point of it being a second list:
   *
   *  - the constructor's `broadcast` is untouched by any of this - it is still
   *    called exactly once per change, with the same list, and *before* any
   *    listener, so no observer can delay, suppress or double the `jobs:changed`
   *    traffic the action bar and the Downloads tab read;
   *  - a listener that throws is logged and skipped; the remaining listeners and
   *    the already-delivered broadcast are unaffected.
   */
  onChange(listener: JobsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  create(input: CreateJobInput): Job {
    const job: Job = {
      id: randomUUID(),
      moduleId: input.moduleId,
      kind: input.kind,
      labelKey: input.labelKey,
      status: 'queued',
      progress: { ratio: null },
      cancellable: input.cancellable ?? true,
      startedAt: new Date().toISOString(),
      ...(input.labelParams ? { labelParams: input.labelParams } : {}),
      ...(input.installationId ? { installationId: input.installationId } : {}),
      ...(input.playableAtRatio !== undefined ? { playableAtRatio: input.playableAtRatio } : {}),
    }

    this.jobs.set(job.id, job)
    if (input.onCancel) this.cancellers.set(job.id, input.onCancel)
    this.emit()
    return job
  }

  progress(id: string, progress: JobProgress): void {
    const job = this.jobs.get(id)
    if (!job) return
    this.jobs.set(id, { ...job, status: 'running', progress })
    this.emit()
  }

  /**
   * Story 074 D4: records the ratio at which this job's installation became playable, once the
   * job already exists.
   *
   * `CreateJobInput.playableAtRatio` can only state that up front, at creation - which is fine
   * for a job that knows its own threshold in advance, and wrong for the bootstrap job, whose
   * threshold is "the moment `inspectInstallation` stops calling the target `invalid`". That is a
   * fact about the disk that nobody can predict before the files are there, so it has to be
   * settable mid-job (AC6).
   *
   * Deliberately not part of `progress()`: `progress()` sets `status: 'running'`, and this marker
   * is a property of the job's *plan*, not a progress report - a paused, finished or cancelled job
   * must not be resurrected by recording one. Nothing else about the job changes here.
   */
  markPlayable(id: string, ratio: number): void {
    const job = this.jobs.get(id)
    if (!job) return
    this.jobs.set(id, { ...job, playableAtRatio: ratio })
    this.emit()
  }

  finish(
    id: string,
    outcome: { status: 'succeeded' | 'failed' | 'cancelled'; error?: Job['error'] },
  ): void {
    const job = this.jobs.get(id)
    if (!job) return
    this.jobs.set(id, {
      ...job,
      status: outcome.status,
      finishedAt: new Date().toISOString(),
      ...(outcome.error ? { error: outcome.error } : {}),
    })
    this.cancellers.delete(id)
    this.emit()
  }

  cancel(id: string): Outcome<null> {
    const job = this.jobs.get(id)
    if (!job) return fail('jobs.error.notFound')
    if (!job.cancellable) return fail('jobs.error.notCancellable')

    const canceller = this.cancellers.get(id)
    if (canceller) {
      try {
        canceller()
      } catch (error) {
        log.error(`cancel handler for job ${id} threw`, error)
      }
    }
    this.finish(id, { status: 'cancelled' })
    return ok(null)
  }

  /** Drops finished jobs so the list does not grow forever. */
  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (job.status === 'succeeded' || job.status === 'cancelled') this.jobs.delete(id)
    }
    this.emit()
  }

  /**
   * One snapshot per change, delivered to the shell's broadcast first and to the
   * `onChange` listeners afterwards.
   *
   * The order is a guarantee, not an accident: the Downloads tab refetches its
   * failure log on `jobs:changed`, and the module that writes that log is one of
   * these listeners. Because the listener loop runs synchronously and the
   * broadcast only *queues* an IPC message, the log is already written by the time
   * the renderer can ask for it - while the broadcast itself still cannot be held
   * up by listener work.
   *
   * The listener set is copied before iterating, so a listener that unsubscribes
   * (or subscribes) during delivery cannot change the set mid-iteration.
   */
  private emit(): void {
    const snapshot = this.list()
    this.broadcast(snapshot)
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot)
      } catch (error) {
        log.error('a jobs onChange listener threw', error)
      }
    }
  }
}
