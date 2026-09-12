import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { DownloadsErrorKey } from '@shared/modules/downloads'
import {
  fail,
  ok,
  type Installation,
  type InstallationStatus,
  type Job,
  type JobProgress,
  type Outcome,
} from '@shared/types'
import { resolveRelaxed } from '../../../lib/fs-utils'
import type { CreateJobInput } from '../../../services/jobs'
import { isWriteCancelled } from '../../../services/write-guard'
import { INSTALLATION_NOT_FOUND, LOCAL_FAILURE } from '../bootstrap/errors'
import type { BootstrapLog } from '../bootstrap/ports'
import {
  ENGINE_BACKUP_DIR_NAME,
  ENGINE_REPLACE_FAILED,
  moveFile,
  plannedDestination,
} from './update-job'
import { readEngineState, type InstallationEngineState } from './installation-state'

/**
 * Story 092 D6 (AC3/AC6/AC7): the engine-rollback job - "put the single backed-up build back over
 * whatever this installation is currently running, and forget the backup". Mirrors D5's
 * `update-job.ts` scaffold (job creation, `report`/`failed`/`cancelledOutcome`, the write-guard
 * integration, `EXDEV`-safe `moveFile`), but is far smaller: there is no network, no manifest and
 * no extraction here, because the bytes this job moves are already on disk.
 *
 * ## What "the backup's file list" means
 *
 * `EngineBackupInfo` (D1/D2) records only *what version* the slot holds, not *which files* -
 * `<root>/.q2launcher-engine-backup/` itself is the file list, because the backup only ever
 * contains what an update actually moved into it (`update-job.ts`'s "the backup set is the copy
 * set"). Restoring therefore walks that directory rather than re-deriving one from
 * `buildAssemblePlan({ engine })`: an allowlist enumeration could ask for a file the backup never
 * held (e.g. one the current engine added that the backed-up version never had), and there would be
 * nothing to answer with.
 *
 * ## The order
 *
 * 1. **Resolve the installation** and its recorded engine state (D2). No `backup` on record fails
 *    outright with `downloads.error.engineNoBackup` - **before** `jobs.create`, so a rollback with
 *    nothing to roll back to leaves no job and no progress bar, exactly like `startEngineUpdate`'s
 *    own pre-flight refusals.
 * 2. **Inside `deps.writeGuard.runWrite`** (AC6, deferred for as long as this installation's own
 *    game is running): every file under the backup slot is moved onto the installation path it came
 *    from - resolved case-insensitively against the installation as it stands today
 *    (`resolveRelaxed`), the same way `update-job.ts` resolves the *current* engine file before
 *    backing it up, falling back to the canonical spelling (`plannedDestination`) for a path the
 *    installation no longer has (the rolled-back build restores a file a later update had removed).
 * 3. **Drop the backup pointer and record the restored version** (`setEngineState`) - AC7: "current"
 *    is whatever is now actually on disk, which after a rollback is the backed-up build.
 * 4. **Delete the now-consumed backup directory.**
 * 5. **`installations.validate()`**, outside the guard - the status is re-derived by the inspector,
 *    never hand-set, same as `update-job.ts`.
 *
 * A failure partway through the restore-copy itself ends the job `downloads.error.engineReplaceFailed`
 * and stops right there: there is no second backup to fall back to, so - unlike `update-job.ts`'s
 * own copy failure - this does not attempt a restore of its own. The installation may be left with a
 * mix of old and new engine files; the failure is logged plainly so that is visible, not hidden
 * behind a further, riskier repair attempt.
 */

/** `Job.kind` for this job - the discriminator the Downloads tab and the diagnostics registry key on. */
export const ENGINE_ROLLBACK_JOB_KIND = 'engine-rollback'

/** i18n key for the job's label; `{{name}}` is the installation being rolled back. */
export const ENGINE_ROLLBACK_JOB_LABEL_KEY = 'downloads.job.engineRollback'

/** `downloads.error.engineNoBackup` - `engineRollbackStart` was asked for with no backup on record. */
export const ENGINE_NO_BACKUP: DownloadsErrorKey = 'downloads.error.engineNoBackup'

/** What became of one rollback. A one-shot value, never a second status source next to the job. */
export type EngineRollbackOutcome =
  | { status: 'succeeded'; version: string; installationStatus: InstallationStatus }
  | { status: 'failed'; key: DownloadsErrorKey }
  | { status: 'cancelled' }

export interface StartedEngineRollback {
  /** The `Job.id` - what `jobs:cancel` takes, and what the UI renders. */
  jobId: string
  /** Resolves once the job has reached a terminal state. Never rejects. */
  settled: Promise<EngineRollbackOutcome>
}

/** The `JobsService` surface this job uses. `JobsService` satisfies it structurally. */
export interface EngineRollbackJobsHost {
  create(input: CreateJobInput): Job
  progress(id: string, progress: JobProgress): void
  finish(
    id: string,
    outcome: { status: 'succeeded' | 'failed' | 'cancelled'; error?: Job['error'] },
  ): void
}

/**
 * The `InstallationsService` surface this job uses - `find`/`validate`/`setEngineState`, mirroring
 * `EngineUpdateInstallationsHost` exactly (no `update`, for the same "status is the inspector's"
 * reason).
 */
export interface EngineRollbackInstallationsHost {
  find(id: string): Installation | undefined
  validate(id: string): Promise<Outcome<Installation>>
  setEngineState(id: string, patch: Partial<InstallationEngineState>): Outcome<Installation>
}

/**
 * The `InstallationWriteGuard` surface this job uses (story 091 D4) - `runWrite` only, mirroring
 * `EngineUpdateWriteGuardHost`.
 */
export interface EngineRollbackWriteGuardHost {
  runWrite(
    installationId: string,
    jobId: string,
    signal: AbortSignal,
    fn: () => Promise<void>,
  ): Promise<void>
}

export interface EngineRollbackDeps {
  jobs: EngineRollbackJobsHost
  installations: EngineRollbackInstallationsHost
  /** Story 091's write guard. Required, never optional - a wiring that forgot it would replace the
   * binaries of a running game, same reasoning as `EngineUpdateDeps.writeGuard`. */
  writeGuard: EngineRollbackWriteGuardHost
  log?: BootstrapLog
}

export interface StartEngineRollbackInput {
  installationId: string
}

/**
 * Starts the rollback and answers as soon as the job exists (or as soon as the pre-flight
 * `engineNoBackup` check has refused it) - it never waits for the restore itself, mirroring
 * `startEngineUpdate`.
 */
export async function startEngineRollback(
  deps: EngineRollbackDeps,
  input: StartEngineRollbackInput,
): Promise<Outcome<StartedEngineRollback>> {
  const log = deps.log

  const installation = deps.installations.find(input.installationId)
  if (!installation) return fail(INSTALLATION_NOT_FOUND)

  const recorded = readEngineState(installation.moduleData)
  if (!recorded.backup) {
    log?.warn(`refusing to roll back the engine of ${installation.name}: no backup recorded`)
    return fail(ENGINE_NO_BACKUP)
  }
  const backup = recorded.backup

  // From here on there is work to cancel, so from here on there is a job - same discipline as
  // `startEngineUpdate`. There is no extractor to kill here, only the guard's own wait to abort.
  const cancellation = new AbortController()
  const job = deps.jobs.create({
    moduleId: 'downloads',
    kind: ENGINE_ROLLBACK_JOB_KIND,
    labelKey: ENGINE_ROLLBACK_JOB_LABEL_KEY,
    labelParams: { name: installation.name },
    installationId: installation.id,
    cancellable: true,
    onCancel: () => {
      cancellation.abort()
    },
  })

  const settled = (async (): Promise<EngineRollbackOutcome> => {
    try {
      return await runRollback({
        deps,
        job,
        installation,
        backupVersion: backup.version,
        backupPackageId: backup.packageId,
        signal: cancellation.signal,
      })
    } catch (error) {
      // Nothing in `runRollback` is expected to throw; if something does, the job must still end -
      // an unfinished job would sit in the Downloads tab forever.
      log?.warn(`the engine rollback of ${installation.name} threw: ${String(error)}`)
      deps.jobs.finish(job.id, { status: 'failed', error: { key: LOCAL_FAILURE } })
      return { status: 'failed', key: LOCAL_FAILURE }
    }
  })()

  return ok({ jobId: job.id, settled })
}

/** The job body, split out of `startEngineRollback` for the same reason `runUpdate` is split out of
 * `startEngineUpdate`: the pre-flight refusal (which can still answer the caller) and the job body
 * (which can only answer the `Job`) read as the two things they are. */
async function runRollback(args: {
  deps: EngineRollbackDeps
  job: Job
  installation: Installation
  backupVersion: string
  backupPackageId: string | undefined
  signal: AbortSignal
}): Promise<EngineRollbackOutcome> {
  const { deps, job, installation, backupVersion, backupPackageId, signal } = args
  const log = deps.log
  const jobId = job.id
  const root = installation.rootPath

  const isCancelled = (): boolean => signal.aborted

  /** Silent once cancelled: `JobsService.progress()` unconditionally sets `status: 'running'`. */
  const report = (progress: JobProgress): void => {
    if (isCancelled()) return
    deps.jobs.progress(jobId, progress)
  }

  /** The one failing exit: log the (prose) reason, end the job with the i18n key. */
  const failed = (key: DownloadsErrorKey, reason: string): EngineRollbackOutcome => {
    log?.warn(`the engine rollback of ${installation.name} failed with ${key}: ${reason}`)
    deps.jobs.finish(jobId, { status: 'failed', error: { key } })
    return { status: 'failed', key }
  }

  /** `jobs.cancel()` has already finished the job as cancelled; nothing more to report. */
  const cancelledOutcome = (): EngineRollbackOutcome => {
    log?.info(`the engine rollback of ${installation.name} was cancelled (job ${jobId})`)
    return { status: 'cancelled' }
  }

  report({ ratio: 0 })
  if (isCancelled()) return cancelledOutcome()

  /**
   * The restore itself, and the only code in this file that writes inside the installation. Answers
   * `null` for "keep going" and an `EngineRollbackOutcome` for "this run is over" - `runWrite` only
   * takes a `() => Promise<void>`, so its caller below carries the value back out through
   * `writePhase`, the same one-slot pattern `runUpdate` uses.
   */
  const restore = async (): Promise<EngineRollbackOutcome | null> => {
    const backupDir = join(root, ENGINE_BACKUP_DIR_NAME)

    let relatives: string[]
    try {
      relatives = await listFilesRecursive(backupDir)
    } catch (error) {
      return failed(ENGINE_REPLACE_FAILED, `reading the backup slot ${backupDir} failed: ${String(error)}`)
    }
    if (relatives.length === 0) {
      return failed(ENGINE_REPLACE_FAILED, `the backup slot ${backupDir} holds no files to restore`)
    }

    // Every file the backup holds, back onto the path it was taken from - resolved against the
    // installation as it stands today, same as `update-job.ts` resolves the file it is about to
    // back up.
    let done = 0
    for (const rel of relatives) {
      const dest = (await resolveRelaxed(root, rel)) ?? (await plannedDestination(root, rel))
      const backupPath = join(backupDir, rel)
      try {
        await mkdir(dirname(dest), { recursive: true })
        // A file already sits at `dest` (the build being rolled back from) - it is not itself
        // backed up further, since there is no second slot for it (Decisions (Sprint): one slot).
        await rm(dest, { force: true, maxRetries: 3, retryDelay: 50 })
        await moveFile(backupPath, dest)
      } catch (error) {
        return failed(
          ENGINE_REPLACE_FAILED,
          `restoring ${backupPath} onto ${dest} failed: ${String(error)}`,
        )
      }
      done += 1
      report({ ratio: (done / relatives.length) * 0.9 })
    }

    // The slot is consumed - drop it and its pointer together, so an empty directory is never
    // advertised as a rollback target.
    try {
      await rm(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error) {
      log?.warn(`removing the emptied ${backupDir} failed: ${String(error)}`)
    }

    // AC7: "current" is what is now actually on disk - the build this run just restored.
    const written = deps.installations.setEngineState(installation.id, {
      version: backupVersion,
      packageId: backupPackageId,
      backup: undefined,
    })
    if (!written.ok) {
      return failed(
        ENGINE_REPLACE_FAILED,
        `recording the restored engine version ${backupVersion} on ${installation.id} failed: ${written.error.key}`,
      )
    }

    report({ ratio: 0.95 })
    return null
  }

  /**
   * Story 091 D4: the write phase, and only the write phase, runs with the installation's write
   * lock held - deferred for as long as that installation's own game is running, resumed by the
   * guard when it exits (AC6). One-slot array rather than a `let`, for the same TypeScript
   * flow-analysis reason `update-job.ts`'s `writePhase` is.
   */
  const writePhase: EngineRollbackOutcome[] = []
  try {
    await deps.writeGuard.runWrite(installation.id, jobId, signal, async () => {
      const outcome = await restore()
      if (outcome) writePhase.push(outcome)
    })
  } catch (error) {
    if (isWriteCancelled(error) || isCancelled()) return cancelledOutcome()
    throw error
  }
  if (writePhase.length > 0) return writePhase[0]

  // The status is whatever `inspectInstallation` now makes of the folder - this file never writes
  // one, and `EngineRollbackInstallationsHost` gives it no way to.
  const revalidated = await deps.installations.validate(installation.id)
  if (!revalidated.ok) {
    return failed(LOCAL_FAILURE, `revalidating ${installation.id} failed: ${revalidated.error.key}`)
  }

  report({ ratio: 1 })
  deps.jobs.finish(jobId, { status: 'succeeded' })
  log?.info(
    `rolled back the engine of ${installation.name} to ${backupVersion} (job ${jobId})`,
  )
  return {
    status: 'succeeded',
    version: backupVersion,
    installationStatus: revalidated.value.status,
  }
}

/**
 * Every file under `dir`, as paths relative to it (`baseq2/gamex86_64.dll`-style, forward slashes
 * only regardless of platform, matching the allowlist's own spelling) - the backup directory's own
 * contents *are* the file list this job restores, see the module comment. Answers an empty array for
 * a directory that does not exist, rather than throwing: that is for the caller above to treat as
 * "nothing to restore", not as a filesystem error of its own.
 */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (current: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      out.push(relative(dir, full).replace(/\\/g, '/'))
    }
  }
  await walk(dir)
  return out
}
