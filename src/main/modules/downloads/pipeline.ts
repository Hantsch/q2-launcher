import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DOWNLOADS_ERROR_KEYS,
  type DownloadsErrorKey,
  type PackageSource,
} from '@shared/modules/downloads'
import type { Job, JobProgress } from '@shared/types'
import type { CreateJobInput } from '../../services/jobs'
import {
  extractArchive,
  markVerified,
  type ExtractArchiveInput,
  type ExtractorHandle,
} from './extractor'
import {
  downloadPackage,
  type DownloadPackageOptions,
  type DownloadPackageResult,
  type FetchImpl,
} from './fetcher'
import { getDownloadsCacheDir } from './paths'
import { createDownloadQueue, type DownloadQueue } from './queue'

/**
 * Story 071 D4, AC1/AC2/AC6: one download is one `Job`, run through the module's own queue.
 *
 * This is the first real producer of the shell's `JobsService`, so the whole lifecycle of a
 * download lives here and *only* here: create the job, let the queue decide when it may start,
 * report progress across both phases, and end it exactly once. There is deliberately no status
 * of its own anywhere in this file (AC1, "no parallel progress mechanism") - `JobsService` is the
 * single source of truth for what a download is doing, and the object `start()` returns carries a
 * one-shot promise, not a readable status field, so no other code (and certainly nothing in the
 * renderer) can end up reading a second, disagreeing answer.
 *
 * ## The cancel state machine
 *
 * `JobsService.cancel()` calls the `onCancel` registered here and *then* finishes the job as
 * `cancelled` itself. So this file's job on cancel is only to stop the work and clean up - never
 * to report a status - and it has to be correct at four different moments:
 *
 * 1. **Still `queued`** (never admitted): `queue.drop()` removes the pending entry, so the work
 *    function is never called at all. Nothing was started, so there is nothing to clean up, and -
 *    importantly - nothing is left behind that would keep the job `queued` forever.
 * 2. **Downloading**: the `AbortController` created per job (this file owns it) aborts the
 *    in-flight request. The `.part` file is removed by the fetcher itself on its abort path -
 *    `downloadPackage` calls `removePart()` for every result that is not `verified`, after
 *    closing the file descriptor (Windows will not unlink an open file) - so this file must not
 *    race it by deleting the same path a second time.
 * 3. **Between the finished download and the started extraction**: checked explicitly after every
 *    `await` on that path. A verified archive that has already been promoted into the cache is
 *    *kept* (Decisions (Sprint), "Paths": AC6 says *partial*, and the cache is the point) - but
 *    nothing may be extracted from it any more, so the extractor is never spawned.
 * 4. **Extracting**: `ExtractorHandle.kill()`. A kill that loses the race against the process's
 *    own exit is harmless (`ChildProcess.kill()` on an exited child is a no-op, and the handle's
 *    `result` never rejects), but the *outcome* of that race must not decide the job's fate: the
 *    cancel flag is checked before the extractor's `Outcome` is looked at, so a 7za that happened
 *    to finish successfully one tick before the kill still leaves a cancelled job and a deleted
 *    extract directory rather than a `succeeded` job full of files nobody asked for.
 *
 * A cancel also has to stop *progress reporting*, not just the work: `JobsService.progress()`
 * unconditionally sets `status: 'running'`, so a single late progress callback from an aborting
 * download would resurrect a job the user just cancelled and leave it running forever. Every
 * progress call in this file therefore goes through `report()`, which drops everything once the
 * job has been cancelled.
 */

/** The `JobsService` surface this pipeline uses. `JobsService` satisfies it structurally. */
export interface JobsHost {
  create(input: CreateJobInput): Job
  progress(id: string, progress: JobProgress): void
  finish(
    id: string,
    outcome: { status: 'succeeded' | 'failed' | 'cancelled'; error?: Job['error'] },
  ): void
}

/** `Job.kind` for a download+extract job; a module-defined discriminator (`@shared/types`). */
export const DOWNLOAD_JOB_KIND = 'download-package'

/** `Job.labelKey`; resolved in the renderer with `{ name }` (never prose across the seam). */
export const DOWNLOAD_JOB_LABEL_KEY = 'downloads.job.download'

/** Directory segment under the downloads cache that holds one directory per job. */
export const EXTRACT_SEGMENT = 'extract'

/** Job ids are `randomUUID()`s from main; the guard keeps a future caller-supplied id out of the
 * path anyway - the same "refuse, do not sanitise" stance `paths.ts` takes for a file name. */
const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`). */
export interface PipelineLog {
  info(message: string): void
  warn(message: string): void
  debug(message: string): void
}

export type DownloadFn = (
  source: PackageSource,
  options: DownloadPackageOptions,
) => Promise<DownloadPackageResult>

export type ExtractFn = (input: ExtractArchiveInput) => ExtractorHandle

export interface DownloadPipelineDeps {
  /**
   * The shell's `JobsService`. A getter rather than the service itself so the module's `setup()`
   * can build the pipeline without dereferencing anything on `AppContext` at construction time.
   */
  getJobs: () => JobsHost
  /** `app.getPath('userData')`. Resolved per download, for the same reason. */
  getUserDataPath: () => string
  /** Live `DownloadsSettings.concurrentJobs` - see `queue.ts`, property 1. */
  getConcurrency: () => number
  /** `resolveExtractorPath(...)` (`7za-path.ts`); called per extraction, so the existence check
   * reflects the disk now rather than at startup. */
  resolveExtractor: () => { path: string; exists: boolean }
  /** Test seam: the real `downloadPackage` unless overridden. */
  download?: DownloadFn
  /** Test seam: the real `extractArchive` unless overridden - which needs a vendored `7za.exe`. */
  extract?: ExtractFn
  /** Handed to `downloadPackage`; the real client (`electronNetFetch`) unless overridden. */
  fetchImpl?: FetchImpl
  log?: PipelineLog
}

/**
 * What became of one download. Handed to the *main-process caller* ([[074]]) as a one-shot
 * promise value - not stored, not queryable, and never a second status source next to the job
 * (AC1). `extractDir` is what the caller needs on success: the files it is about to copy into an
 * installation.
 */
export type DownloadJobOutcome =
  | { status: 'succeeded'; archivePath: string; extractDir: string }
  | { status: 'failed'; key: DownloadsErrorKey }
  | { status: 'cancelled' }

export interface StartedDownload {
  /** The `Job.id` - what `JobsService.cancel()` takes, and what the UI renders. */
  jobId: string
  /** Resolves once the job has reached a terminal state. Never rejects. */
  settled: Promise<DownloadJobOutcome>
}

export interface DownloadPipeline {
  /** Creates the job (`queued`) and queues the work; returns immediately. */
  start(source: PackageSource): StartedDownload
  /** The admission queue, exposed for diagnostics and tests - job depth, never job status. */
  queue: DownloadQueue
}

/** `userData/cache/downloads/extract/<jobId>` (Decisions (Sprint), "Paths"). */
export function getExtractDir(userDataPath: string, jobId: string): string {
  if (!SAFE_JOB_ID.test(jobId)) throw new Error(`refused job id ${JSON.stringify(jobId)}`)
  return join(getDownloadsCacheDir(userDataPath), EXTRACT_SEGMENT, jobId)
}

/** The extractor's `Outcome` carries a plain string; only the fixed key set may reach a job. */
function asErrorKey(key: string): DownloadsErrorKey {
  return (DOWNLOADS_ERROR_KEYS as readonly string[]).includes(key)
    ? (key as DownloadsErrorKey)
    : 'downloads.error.extractionFailed'
}

/** Best-effort: an extract directory that cannot be removed must not also fail the job. */
async function removeDir(dir: string, log?: PipelineLog): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch (error) {
    log?.warn(`the extract directory ${dir} could not be removed: ${String(error)}`)
  }
}

export function createDownloadPipeline(deps: DownloadPipelineDeps): DownloadPipeline {
  const log = deps.log
  const download = deps.download ?? downloadPackage
  const extract = deps.extract ?? extractArchive
  const queue = createDownloadQueue({
    getConcurrency: deps.getConcurrency,
    ...(log ? { log } : {}),
  })

  const start = (source: PackageSource): StartedDownload => {
    const jobs = deps.getJobs()
    const controller = new AbortController()
    let cancelled = false
    let extractor: ExtractorHandle | undefined
    let jobId = ''

    const job = jobs.create({
      moduleId: 'downloads',
      kind: DOWNLOAD_JOB_KIND,
      labelKey: DOWNLOAD_JOB_LABEL_KEY,
      labelParams: { name: source.fileName },
      cancellable: true,
      // All four cancel moments in one callback - see the module comment. Each of the three
      // actions is a no-op in the states it does not apply to, so there is no state to branch on
      // and therefore no state this can get wrong.
      onCancel: () => {
        cancelled = true
        queue.drop(jobId)
        controller.abort()
        extractor?.kill()
      },
    })
    jobId = job.id

    /** Every progress report in this file. Silent once cancelled - see the module comment. */
    const report = (progress: JobProgress): void => {
      if (cancelled) return
      jobs.progress(jobId, progress)
    }

    /** The job is already `cancelled` in `JobsService`; only the leftovers are ours. */
    const cleanUpCancelled = async (extractDir: string): Promise<DownloadJobOutcome> => {
      await removeDir(extractDir, log)
      log?.info(`download of ${source.fileName} cancelled (job ${jobId})`)
      return { status: 'cancelled' }
    }

    const fail = (key: DownloadsErrorKey, reason: string): DownloadJobOutcome => {
      // The reason is prose and stays in the log: `Job.error` carries an i18n key (plus params),
      // and CLAUDE.md's "main sends i18n keys, never prose" rules out shipping it to the renderer.
      log?.warn(`download of ${source.fileName} failed with ${key}: ${reason}`)
      jobs.finish(jobId, { status: 'failed', error: { key } })
      return { status: 'failed', key }
    }

    const run = async (): Promise<DownloadJobOutcome> => {
      const userDataPath = deps.getUserDataPath()
      const extractDir = getExtractDir(userDataPath, jobId)

      const fetched = await download(source, {
        userDataPath,
        signal: controller.signal,
        onProgress: ({ receivedBytes, totalBytes }) =>
          report({
            // `null` is the indeterminate bar: a server that declares no `content-length` gives
            // us bytes but no total, and inventing one would only make the bar lie.
            ratio:
              totalBytes !== null && totalBytes > 0
                ? Math.min(1, receivedBytes / totalBytes)
                : null,
            bytesDone: receivedBytes,
            ...(totalBytes !== null ? { bytesTotal: totalBytes } : {}),
          }),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(log ? { log } : {}),
      })

      if (!fetched.ok) {
        // A cancel is not a failure needing a reason, and the fixed key set has no member for
        // "the user changed their mind" - so it never surfaces `fetched.key`.
        if (fetched.cancelled || cancelled) return cleanUpCancelled(extractDir)
        return fail(fetched.key, fetched.reason)
      }

      if (cancelled) return cleanUpCancelled(extractDir)

      const extractorPath = deps.resolveExtractor()

      // 7za is spawned with `cwd: extractDir`, so the directory has to exist *before* the spawn -
      // `-o<dir>` would not save a spawn that cannot chdir into its working directory.
      try {
        await mkdir(extractDir, { recursive: true })
      } catch (error) {
        return fail('downloads.error.diskWrite', `mkdir ${extractDir} failed: ${String(error)}`)
      }

      if (cancelled) return cleanUpCancelled(extractDir)

      // No `await` between the check above and the assignment below, so a cancel can never land
      // in a gap where the extractor is running but `onCancel` cannot see it yet.
      extractor = extract({
        archive: markVerified(fetched.path),
        extractDir,
        extractorPath: extractorPath.path,
        extractorExists: extractorPath.exists,
        onProgress: (ratio) => report({ ratio: ratio ?? null }),
      })

      const extracted = await extractor.result

      // Before `extracted.ok`, on purpose: a kill that lost the race against 7za's own clean exit
      // must not turn a cancelled job into a succeeded one (see the module comment, moment 4).
      if (cancelled) return cleanUpCancelled(extractDir)

      if (!extracted.ok) {
        // Half-extracted output is useless to anyone, so it goes the same way a cancelled job's
        // output does. The verified archive stays in the cache.
        await removeDir(extractDir, log)
        return fail(asErrorKey(extracted.error.key), `extraction of ${fetched.path} failed`)
      }

      log?.info(`extracted ${source.fileName} into ${extractDir} (job ${jobId})`)
      jobs.finish(jobId, { status: 'succeeded' })
      return { status: 'succeeded', archivePath: fetched.path, extractDir }
    }

    const work = async (): Promise<DownloadJobOutcome> => {
      try {
        // Admission is the *only* thing that moves a downloads job out of `queued` (AC2), and it
        // happens before the first byte, so an admitted job never still reads as waiting.
        report({ ratio: null })
        return await run()
      } catch (error) {
        // Nothing in `run()` is expected to throw; if something does (a refused path, a spawn
        // that blew up in an unforeseen way), the job must still end - a `running` job nobody
        // finishes is worse than a wrong-ish key. `diskWrite` is the closest member of the fixed
        // key set, and the one `fetcher.ts` already uses for a refused local path.
        if (cancelled) return { status: 'cancelled' }
        return fail('downloads.error.diskWrite', `unexpected pipeline error: ${String(error)}`)
      }
    }

    const settled = queue
      .enqueue(jobId, work)
      // `{ ran: false }` means the job was dropped from the queue by a cancel and never started.
      .then((result): DownloadJobOutcome => (result.ran ? result.value : { status: 'cancelled' }))

    return { jobId, settled }
  }

  return { start, queue }
}
