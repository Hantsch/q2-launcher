import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DownloadsErrorKey } from '@shared/modules/downloads'
import { fail, type Installation, type InstallationStatus, type Outcome } from '@shared/types'
import {
  listFilesRecursive,
  moveFile,
  plannedDestination,
  resolveRelaxed,
} from '../../../lib/fs-utils'
import type { JobContext, JobOutcome, JobRunnerHost, StartedJob } from '../../ports'
import { INSTALLATION_NOT_FOUND, LOCAL_FAILURE } from '../bootstrap/errors'
import type { BootstrapLog } from '../bootstrap/ports'
import { ENGINE_BACKUP_DIR_NAME, ENGINE_REPLACE_FAILED } from './update-job'
import { readEngineState, type InstallationEngineState } from '../../../services/engine-state'

/**
 * Story 092: the engine-rollback job - "put the single backed-up build back over
 * whatever this installation is currently running, and forget the backup". Far smaller than
 * `update-job.ts`: there is no network, no manifest and no extraction here, because the bytes this
 * job moves are already on disk.
 *
 * ## What "the backup's file list" means
 *
 * `EngineBackupInfo` records only *what version* the slot holds, not *which files* -
 * `<root>/.q2launcher-engine-backup/` itself is the file list, because the backup only ever
 * contains what an update actually moved into it (`update-job.ts`'s "the backup set is the copy
 * set"). Restoring therefore walks that directory rather than re-deriving one from
 * `buildAssemblePlan({ engine })`: an allowlist enumeration could ask for a file the backup never
 * held (e.g. one the current engine added that the backed-up version never had), and there would be
 * nothing to answer with.
 *
 * ## The order
 *
 * 1. **Resolve the installation** and its recorded engine state. No `backup` on record fails
 *    outright with `downloads.error.engineNoBackup` - **before** the job exists, so a rollback with
 *    nothing to roll back to leaves no job and no progress bar, exactly like `startEngineUpdate`'s
 *    own pre-flight refusals.
 * 2. **Inside the write guard** (deferred for as long as this installation's own game is
 *    running): every file under the backup slot is moved onto the installation path it came
 *    from - resolved case-insensitively against the installation as it stands today
 *    (`resolveRelaxed`), the same way `update-job.ts` resolves the *current* engine file before
 *    backing it up, falling back to the canonical spelling (`plannedDestination`) for a path the
 *    installation no longer has (the rolled-back build restores a file a later update had removed).
 * 3. **Drop the backup pointer and record the restored version** (`setEngineState`) - "current"
 *    is whatever is now actually on disk, which after a rollback is the backed-up build.
 * 4. **Delete the now-consumed backup directory.**
 * 5. **Revalidate**, outside the guard - the status is re-derived by the inspector, never
 *    hand-set, same as `update-job.ts`.
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

interface RollbackSuccess {
  version: string
  installationStatus: InstallationStatus
}

/** What became of one rollback. A one-shot value, never a second status source next to the job. */
export type EngineRollbackOutcome = JobOutcome<DownloadsErrorKey, RollbackSuccess>

export type StartedEngineRollback = StartedJob<DownloadsErrorKey, RollbackSuccess>

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

export interface EngineRollbackDeps {
  runner: JobRunnerHost
  installations: EngineRollbackInstallationsHost
  log?: BootstrapLog
}

export interface StartEngineRollbackInput {
  installationId: string
}

/** A restore step that failed; thrown inside the write so the body can end the job with its reason. */
class RestoreFailed extends Error {}

/**
 * Starts the rollback and answers as soon as the job exists (or as soon as a pre-flight refusal
 * has answered) - it never waits for the restore itself, mirroring `startEngineUpdate`.
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

  return deps.runner.run<DownloadsErrorKey, RollbackSuccess>(
    {
      moduleId: 'downloads',
      kind: ENGINE_ROLLBACK_JOB_KIND,
      labelKey: ENGINE_ROLLBACK_JOB_LABEL_KEY,
      labelParams: { name: installation.name },
      installationId: installation.id,
      exclusive: 'installation',
    },
    (ctx) =>
      runRollback(ctx, deps, installation, {
        version: backup.version,
        packageId: backup.packageId,
      }),
  )
}

async function runRollback(
  ctx: JobContext<DownloadsErrorKey, RollbackSuccess>,
  deps: EngineRollbackDeps,
  installation: Installation,
  backup: { version: string; packageId: string | undefined },
): Promise<EngineRollbackOutcome> {
  const log = deps.log
  const root = installation.rootPath

  ctx.report({ ratio: 0 })
  if (ctx.signal.aborted) return ctx.cancelled()

  /** The restore itself, and the only code in this file that writes inside the installation. */
  const restore = async (): Promise<void> => {
    const backupDir = join(root, ENGINE_BACKUP_DIR_NAME)

    const relatives = await listBackupFiles(backupDir)
    if (relatives.length === 0) {
      throw new RestoreFailed(`the backup slot ${backupDir} holds no files to restore`)
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
        throw new RestoreFailed(`restoring ${backupPath} onto ${dest} failed: ${String(error)}`)
      }
      done += 1
      ctx.report({ ratio: (done / relatives.length) * 0.9 })
    }

    // The slot is consumed - drop it and its pointer together, so an empty directory is never
    // advertised as a rollback target.
    try {
      await rm(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error) {
      log?.warn(`removing the emptied ${backupDir} failed: ${String(error)}`)
    }

    // "Current" is what is now actually on disk - the build this run just restored.
    const written = deps.installations.setEngineState(installation.id, {
      version: backup.version,
      packageId: backup.packageId,
      backup: undefined,
    })
    if (!written.ok) {
      throw new RestoreFailed(
        `recording the restored engine version ${backup.version} on ${installation.id} failed: ${written.error.key}`,
      )
    }

    ctx.report({ ratio: 0.95 })
  }

  let written: 'done' | 'cancelled'
  try {
    written = await ctx.write(installation.id, restore)
  } catch (error) {
    if (error instanceof RestoreFailed) return ctx.fail(ENGINE_REPLACE_FAILED, error.message)
    throw error
  }
  if (written === 'cancelled') return ctx.cancelled()

  // The status is whatever `inspectInstallation` now makes of the folder - this file never writes
  // one, and `EngineRollbackInstallationsHost` gives it no way to.
  const revalidated = await ctx.revalidate(installation.id)
  if (!revalidated.ok) {
    return ctx.fail(
      LOCAL_FAILURE,
      `revalidating ${installation.id} failed: ${revalidated.error.key}`,
    )
  }

  ctx.report({ ratio: 1 })
  log?.info(
    `rolled back the engine of ${installation.name} to ${backup.version} (job ${ctx.jobId})`,
  )
  return {
    status: 'succeeded',
    version: backup.version,
    installationStatus: revalidated.value.status,
  }
}

/**
 * Every file under `dir`, relative with forward slashes (the allowlist's own spelling) - the backup
 * directory's own contents *are* the file list this job restores. A directory that does not exist
 * (or cannot be read) answers an empty array: that is for the caller to treat as "nothing to
 * restore", not as a filesystem error of its own.
 */
async function listBackupFiles(dir: string): Promise<string[]> {
  try {
    return (await listFilesRecursive(dir)).map((entry) => entry.rel)
  } catch {
    return []
  }
}
