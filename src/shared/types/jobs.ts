import type { ModuleId } from './module'

/**
 * A unit of long-running work owned by a module: downloading the game, applying
 * an asset pack, verifying files, installing a mod.
 *
 * Step 1 ships the registry, the IPC surface and the UI that renders it, but no
 * module produces real jobs yet. This is deliberate: the action bar's progress
 * readout (the Guild Wars 2 style `DOWNLOADING ... / FILES REMAINING ...`) is
 * driven entirely by this type, so the download module only has to emit jobs.
 */
export type JobStatus = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled'

export interface JobProgress {
  /** 0..1, or null when the total is not known yet (indeterminate bar). */
  ratio: number | null
  bytesDone?: number
  bytesTotal?: number
  bytesPerSecond?: number
  filesRemaining?: number
  etaSeconds?: number
}

export interface Job {
  id: string
  moduleId: ModuleId
  /** Module-defined discriminator, e.g. `download-game`, `apply-pack`. */
  kind: string
  /** i18n key describing the job, resolved in the renderer. */
  labelKey: string
  labelParams?: Record<string, string | number>
  /** The installation this job acts on, when it is installation-scoped. */
  installationId?: string
  status: JobStatus
  progress: JobProgress
  /**
   * Ratio at which the game becomes playable while the job continues in the
   * background - drives the `PLAYABLE` marker on the progress bar.
   */
  playableAtRatio?: number
  cancellable: boolean
  error?: { key: string; params?: Record<string, string | number> }
  startedAt: string
  finishedAt?: string
}

export function isJobActive(job: Job): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'paused'
}
