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
  private readonly onChange: (jobs: Job[]) => void

  constructor(onChange: (jobs: Job[]) => void) {
    this.onChange = onChange
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

  private emit(): void {
    this.onChange(this.list())
  }
}
