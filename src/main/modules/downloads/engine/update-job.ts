import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  DownloadsErrorKey,
  EngineBackupInfo,
  EngineUpdateChannel,
  ManifestPackage,
  StartEngineUpdateInput,
} from '@shared/modules/downloads'
import {
  fail,
  ok,
  type EngineKind,
  type Installation,
  type InstallationStatus,
  type Outcome,
} from '@shared/types'
import { moveFile, plannedDestination, resolveRelaxed } from '../../../lib/fs-utils'
import { clamp01 } from '../../../lib/math'
import type { JobContext, JobOutcome, JobRunnerHost, StartedJob } from '../../ports'
import { buildAssemblePlan, type AssembleFileEntry } from '../bootstrap/assemble'
import {
  INSTALLATION_NOT_FOUND,
  LOCAL_FAILURE,
  NOT_PLAYABLE,
  PACKAGE_INCOMPLETE,
  PACKAGE_UNAVAILABLE,
} from '../bootstrap/errors'
import { toPackageSource } from '../bootstrap/job'
import type { BootstrapLog, Extractor, ManifestSource } from '../bootstrap/ports'
import type { FetchImpl } from '../../../lib/net/fetcher'
import { isSafeDownloadFileName } from '../../../lib/net/download-cache-paths'
import {
  getExtractDir,
  stagePackage,
  type StageDownloadFn,
} from '../../../services/package-staging'
import {
  BleedingEdgeProbeFailedError,
  BleedingEdgeUnsupportedError,
  probeBleedingEdge as realProbeBleedingEdge,
  type BleedingEdgeProbe,
} from './bleeding-edge'
import { readEngineState, type InstallationEngineState } from '../../../services/engine-state'
import { computeEngineUpdateStatus } from './update-status'

/**
 * Story 092 D5 (AC2/AC6/AC7/AC8): the engine-update job - "replace this already-playable
 * installation's engine files with the build it should be on, and keep the ones it had".
 *
 * Shaped after `bootstrap/job.ts`'s download/verify/extract path, run on the shared `JobRunner`
 * (admission, cancellation, the write guard, the revalidation after a write). What makes this the risky deliverable of the story is none of that
 * scaffolding: it is the *order* of the file moves, because this is the first job in the launcher
 * that overwrites files a user's working installation is already made of.
 *
 * ## The order is the acceptance criterion (AC8)
 *
 * 1. **Resolve the installation and the target build.** Both are reads, both happen before
 *    `jobs.create`, so every refusal (`installations.error.notFound`,
 *    `downloads.error.packageUnavailable`, `downloads.error.engineUpdateUnavailable`, the two
 *    bleeding-edge keys) leaves no job, no progress bar and nothing on disk. "Is there an update?"
 *    is decided by D3's `computeEngineUpdateStatus`, not by a second comparison of this file's own.
 * 2. **Download** into `userData/cache/downloads/`, **verify** it - size + SHA256 against the
 *    manifest's pin (INST-V1-V3) for `channel: 'pinned'`, size-only against what the probe reported
 *    for `'bleeding-edge'` (Decisions (Sprint): "no SHA256, since there is no pinned hash for a
 *    moving nightly target").
 * 3. **Extract** into `userData/cache/downloads/extract/<jobId>` - a staging directory *outside* the
 *    installation. Nothing inside the installation has been touched at this point, and nothing will
 *    be until step 4 has passed: a failed download, a failed verification or a failed extraction
 *    ends the job with every engine file exactly as it was (AC8's first half).
 * 4. **Completeness check** against the engine allowlist: every *required* `role: 'engine'` entry of
 *    `buildAssemblePlan({ engine })` has to be present in that staging tree, or the run fails here -
 *    still before the first move.
 * 5. **Back up, inside `ctx.write`** (AC6): the current engine files - the same
 *    allowlist, resolved case-insensitively against the installation as it really is - are `rename`d
 *    into `<root>/.q2launcher-engine-backup/`, the single slot (Decisions (Sprint)).
 * 6. **Copy** the new files out of staging onto those same paths.
 * 7. **Record** the new version and the backup pointer (`setEngineState`, D2) - AC7.
 * 8. **`installations.validate()`**, outside the guard: the status is re-derived by the inspector,
 *    never hand-set, which is why `EngineUpdateInstallationsHost` has no `update` (the same
 *    reasoning as `RetailUpgradeInstallationsHost`).
 *
 * **A failure anywhere in 5-7 restores** (`restoreBackup` below): every file that was moved into the
 * backup goes back to where it came from, and every file this run *created* where the installation
 * had none is removed again. The user is left with the complete previous engine, never a mix
 * (AC8's second half). The restore is best-effort *per file* and deliberately does not stop at the
 * first failure: getting eight of nine files back is strictly better than getting one. It stops
 * being best-effort at exactly one point - the backup slot is only deleted once *every* file made
 * it back; otherwise it is kept, because for the files that did not, the backup is the only copy
 * left of them.
 *
 * ## Two deliberate refinements of the written order
 *
 * - **The backup set is the copy set.** Steps 5 and 6 act on the engine entries that were actually
 *   *found in staging*, not on the full allowlist. `buildAssemblePlan` marks `baseq2/q2pro.menu`
 *   `required: false`; backing up an optional file the new package does not carry would move it out
 *   of the installation and never put anything back, i.e. an update would silently *delete* a file
 *   it cannot replace. Required entries missing from staging still fail the whole run at step 4.
 * - **The previous backup is deleted before the new one is taken**, and the recorded pointer
 *   (`setEngineState({ backup: undefined })`) is cleared *before that deletion*, not after the new
 *   slot is finished. One slot means one slot: overwriting file by file into a slot that may hold a
 *   *different* file set would leave a backup that is half one version and half another - a
 *   rollback target worse than none. And the record must never outlive what it describes: were the
 *   pointer left to lag until step 7, a crash in between would leave it naming a version the slot
 *   no longer holds, and a later rollback would restore a half-written slot *as* that version. The
 *   new pointer is written only once the new slot is fully populated (step 7), so the record either
 *   names a backup that really is there or says there is none. The cost is that a failed update
 *   also costs the older rollback point, which is why the restore is what it is.
 */

/** `Job.kind` for this job - the discriminator the Downloads tab and the diagnostics registry key on. */
export const ENGINE_UPDATE_JOB_KIND = 'engine-update'

/** i18n key for the job's label; `{{name}}` is the installation being updated. */
export const ENGINE_UPDATE_JOB_LABEL_KEY = 'downloads.job.engineUpdate'

/**
 * The single backup slot, relative to the installation root (Decisions (Sprint)). Also a member of
 * `NON_GAME_DIRS` (`@shared/constants`, story 092 D2), so it can never surface as a selectable game
 * directory - the literal is repeated there because that list is a plain shared constant and this
 * module may not be imported from the shared layer.
 */
export const ENGINE_BACKUP_DIR_NAME = '.q2launcher-engine-backup'

/** `downloads.error.engineUpdateUnavailable` - there is nothing to update this installation to. */
export const ENGINE_UPDATE_UNAVAILABLE: DownloadsErrorKey =
  'downloads.error.engineUpdateUnavailable'

/**
 * `downloads.error.engineReplaceFailed` - the *write phase* failed: a backup move, a copy, or the
 * record that follows them. Every one of those exits has already restored the installation (or
 * tried its best to); the key says "the swap did not happen", never "you now have half an engine".
 */
export const ENGINE_REPLACE_FAILED: DownloadsErrorKey = 'downloads.error.engineReplaceFailed'

/** `downloads.error.bleedingEdgeSizeMismatch` - the nightly asset was not the size the probe said. */
const BLEEDING_EDGE_SIZE_MISMATCH: DownloadsErrorKey = 'downloads.error.bleedingEdgeSizeMismatch'

const BLEEDING_EDGE_UNSUPPORTED: DownloadsErrorKey = 'downloads.error.bleedingEdgeUnsupported'

const BLEEDING_EDGE_PROBE_FAILED: DownloadsErrorKey = 'downloads.error.bleedingEdgeProbeFailed'

/**
 * What a backup records as the version it holds when the installation had no recorded engine
 * version at all ("an installation with no recorded engine version counts as differs", Decisions
 * (Sprint)). `EngineBackupInfo.version` is required, and an honest "unknown" is better than a
 * fabricated version number the rollback dialog would then state as fact.
 */
export const UNKNOWN_BACKUP_VERSION = 'unknown'

/**
 * File-name prefix the bleeding-edge asset is cached under. It shares its *URL* with the pinned
 * package (D4 derives the probe from that very URL), but not its bytes - so it must not land on the
 * pinned archive's cache entry, where a later pinned run would find a file whose name promises the
 * pinned build and whose contents are a nightly.
 */
const BLEEDING_EDGE_FILE_PREFIX = 'nightly-'

/** Progress coordinate once the archive is downloaded; the remainder is extract + swap. */
const DOWNLOAD_RATIO = 0.8

/** Progress coordinate once the archive is extracted into staging. */
const EXTRACT_RATIO = 0.9

/** Progress coordinate once the files are swapped and only the revalidation is left. */
const SWAP_DONE_RATIO = 0.98

interface UpdateSuccess {
  version: string
  installationStatus: InstallationStatus
}

/** What became of one update. A one-shot value, never a second status source next to the job. */
export type EngineUpdateOutcome = JobOutcome<DownloadsErrorKey, UpdateSuccess>

export type StartedEngineUpdate = StartedJob<DownloadsErrorKey, UpdateSuccess>

/**
 * The `InstallationsService` surface this job uses. Deliberately no `update`, for the same reason
 * `RetailUpgradeInstallationsHost` has none: the installation's *status* is re-derived by the
 * inspector, never hand-set, and this type is what makes that checkable by reading the type rather
 * than the whole flow. `setEngineState` is the one thing this job writes that the retail upgrade
 * does not - AC7's record of what is actually on disk (story 092 D2).
 */
export interface EngineUpdateInstallationsHost {
  find(id: string): Installation | undefined
  validate(id: string): Promise<Outcome<Installation>>
  setEngineState(id: string, patch: Partial<InstallationEngineState>): Outcome<Installation>
}

/** Where the target build comes from, and what it must weigh to be believed. */
export interface EngineUpdateTarget {
  channel: EngineUpdateChannel
  version: string
  /** The `ManifestPackage.id` for a pinned build; absent for a nightly, which is not a package. */
  packageId?: string
  /** The name the archive is cached under (`download-cache-paths.ts` refuses anything that is not a plain name). */
  fileName: string
  url: string
  mirrors: string[]
  sizeBytes: number
  /** Absent for `'bleeding-edge'` - a moving nightly has no pinned digest (Decisions (Sprint)). */
  sha256?: string
}

export interface EngineUpdateDeps {
  runner: JobRunnerHost
  installations: EngineUpdateInstallationsHost
  /** The manifest, through `bootstrap/ports.ts`'s existing port - the pinned build, and the URL
   * D4's bleeding-edge probe derives itself from (INST-M1: no download URL in launcher code). */
  manifest: ManifestSource
  extractor: Extractor
  /** `app.getPath('userData')`; the download cache and the staging directory are built from it. */
  userDataPath: string
  /** `resolveExtractorPath(...)` (`7za-path.ts`), called per extraction like the pipeline does. */
  resolveExtractor: () => { path: string; exists: boolean }
  /**
   * The real `downloadPackage` unless a test substitutes one. Optional where `writeGuard`
   * above is required, and the difference is the one `BootstrapDeps` already draws: the default
   * below *is* the production implementation, so there is no wiring in which this goes unchecked.
   */
  download?: StageDownloadFn
  /** D4's `probeBleedingEdge` unless a test substitutes one - same reasoning as `download`. */
  probeBleedingEdge?: (
    engine: EngineKind,
    pinnedPackage: ManifestPackage | undefined,
  ) => Promise<BleedingEdgeProbe>
  /** Handed to the downloader; the real Electron client unless overridden. */
  fetchImpl?: FetchImpl
  log?: BootstrapLog
}

/** A write-phase step that failed; thrown inside the write so the body can end the job with its reason. */
class SwapFailed extends Error {}

/** One engine file this run is about to replace, resolved on both sides. */
interface PlannedSwap {
  /** Installation-relative path, as the allowlist spells it (`baseq2/gamex86_64.dll`). */
  relative: string
  /** Absolute path in the staging tree the new bytes come from. */
  from: string
  /** Absolute path in the installation the new bytes go to - the *existing* file's own spelling
   * where there is one, so a `BASEQ2` installation is not given a second, lowercase `baseq2`. */
  dest: string
  /** Absolute path inside the backup slot. */
  backupPath: string
  /** Whether `dest` existed and was moved into the backup (step 5). */
  backedUp: boolean
  /** Whether the new file was copied onto `dest` (step 6). */
  copied: boolean
}

/**
 * "The engine files" (Decisions (Sprint)): the `role: 'engine'` entries of
 * `buildAssemblePlan({ engine })` - the same allowlist that put them there, and the only definition
 * of engine ownership the repo has. Nothing here ever recursively replaces a folder.
 *
 * Answers an empty list for an engine `buildAssemblePlan` refuses (it throws for anything outside
 * Q2PRO/R1Q2), which is exactly "this launcher cannot say what this installation's engine files
 * are" - and therefore must not go replacing any.
 */
export function engineAllowlistFor(engine: EngineKind): AssembleFileEntry[] {
  try {
    return buildAssemblePlan({ engine, scope: 'core' }).filter((entry) => entry.role === 'engine')
  } catch {
    return []
  }
}

/** The last path segment of a URL, when it is usable as a download file name. */
function downloadFileNameFor(url: string, prefix = ''): string | undefined {
  let name: string
  try {
    name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  } catch {
    return undefined
  }
  const prefixed = `${prefix}${name}`
  return isSafeDownloadFileName(prefixed) ? prefixed : undefined
}

/**
 * Which build this installation would be updated to, and where its bytes come from - the manifest's
 * pin, or D4's bleeding-edge probe when the installation has opted in. Reads only.
 */
async function resolveEngineTarget(
  deps: EngineUpdateDeps,
  engine: EngineKind,
  recorded: InstallationEngineState,
): Promise<Outcome<EngineUpdateTarget>> {
  const pinned = await deps.manifest.resolveEnginePackage(engine)

  if (!recorded.bleedingEdge) {
    if (pinned === undefined) return fail(PACKAGE_UNAVAILABLE, { role: 'engine' })
    const source = toPackageSource(pinned)
    if (source === undefined) return fail(PACKAGE_UNAVAILABLE, { role: 'engine' })
    return ok({
      channel: 'pinned',
      version: pinned.version,
      packageId: pinned.id,
      fileName: source.fileName,
      url: source.url,
      mirrors: source.mirrors,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
    })
  }

  const probe = deps.probeBleedingEdge ?? realProbeBleedingEdge
  let probed: BleedingEdgeProbe
  try {
    probed = await probe(engine, pinned)
  } catch (error) {
    if (error instanceof BleedingEdgeUnsupportedError) return fail(BLEEDING_EDGE_UNSUPPORTED)
    if (error instanceof BleedingEdgeProbeFailedError) return fail(BLEEDING_EDGE_PROBE_FAILED)
    throw error
  }

  const fileName = downloadFileNameFor(probed.url, BLEEDING_EDGE_FILE_PREFIX)
  if (fileName === undefined) return fail(BLEEDING_EDGE_PROBE_FAILED)
  return ok({
    channel: 'bleeding-edge',
    version: probed.version,
    fileName,
    url: probed.url,
    mirrors: [],
    sizeBytes: probed.sizeBytes,
  })
}

/**
 * Starts the update and answers as soon as the job exists (or as soon as a pre-flight check has
 * refused it) - it never waits for the download, mirroring `startRetailUpgrade`/`startBootstrap`.
 */
export async function startEngineUpdate(
  deps: EngineUpdateDeps,
  input: StartEngineUpdateInput,
): Promise<Outcome<StartedEngineUpdate>> {
  const log = deps.log

  // 1. The installation. Everything below acts on *this* record's canonicalised `rootPath`.
  const installation = deps.installations.find(input.installationId)
  if (!installation) return fail(INSTALLATION_NOT_FOUND)

  const recorded = readEngineState(installation.moduleData)
  const resolved = await resolveEngineTarget(deps, installation.engineKind, recorded)
  if (!resolved.ok) {
    log?.warn(
      `refusing to update the engine of ${installation.name}: ${resolved.error.key} (${JSON.stringify(resolved.error.params ?? {})})`,
    )
    return resolved
  }
  const target = resolved.value

  // D3 owns "is there an update?" - asking it here rather than comparing versions again is what
  // keeps the dialog's answer (AC1) and the job's refusal from ever disagreeing.
  const status = computeEngineUpdateStatus(installation.id, installation.engineKind, recorded, {
    channel: target.channel,
    version: target.version,
  })
  if (!status.updateAvailable) {
    log?.info(`${installation.name} is already on engine version ${target.version}`)
    return fail(ENGINE_UPDATE_UNAVAILABLE)
  }

  // The allowlist has to exist *before* the job does: an engine whose files this launcher cannot
  // enumerate is one whose files it must not start moving.
  const allowlist = engineAllowlistFor(installation.engineKind)
  if (allowlist.length === 0) {
    log?.warn(
      `no engine file allowlist for ${installation.engineKind}; ${installation.name} cannot be updated`,
    )
    return fail(ENGINE_UPDATE_UNAVAILABLE)
  }

  // From here on there is work to cancel, so from here on there is a job.
  return deps.runner.run<DownloadsErrorKey, UpdateSuccess>(
    {
      moduleId: 'downloads',
      kind: ENGINE_UPDATE_JOB_KIND,
      labelKey: ENGINE_UPDATE_JOB_LABEL_KEY,
      labelParams: { name: installation.name },
      installationId: installation.id,
      exclusive: 'installation',
    },
    (ctx) => runUpdate(ctx, { deps, installation, recorded, target, allowlist }),
  )
}

/** Steps 2-8. Split out of `startEngineUpdate` so the pre-flight refusals (which can still answer
 * the caller) and the job body (which can only answer the `Job`) read as the two things they are. */
async function runUpdate(
  ctx: JobContext<DownloadsErrorKey, UpdateSuccess>,
  args: {
    deps: EngineUpdateDeps
    installation: Installation
    recorded: InstallationEngineState
    target: EngineUpdateTarget
    allowlist: AssembleFileEntry[]
  },
): Promise<EngineUpdateOutcome> {
  const { deps, installation, recorded, target, allowlist } = args
  const log = deps.log
  const jobId = ctx.jobId
  const root = installation.rootPath

  const bytesTotal = target.sizeBytes
  const stagingRoot = getExtractDir(deps.userDataPath, jobId)

  try {
    ctx.report({ ratio: 0, bytesDone: 0, bytesTotal, filesRemaining: allowlist.length })
    if (ctx.signal.aborted) return ctx.cancelled()

    // 2-3. Download + verify, then extract into a directory outside the installation - see the
    // module comment. Outside the write guard, always: reading and downloading are never gated,
    // only the mutation of the installation's own files is (AC6).
    const stagedArchive = await stagePackage({
      source: {
        fileName: target.fileName,
        url: target.url,
        mirrors: target.mirrors,
        sizeBytes: target.sizeBytes,
        ...(target.sha256 !== undefined ? { sha256: target.sha256 } : {}),
      },
      verify: target.sha256 ? 'sha256' : { sizeOnly: true },
      jobId,
      index: 0,
      extractDir: stagingRoot,
      userDataPath: deps.userDataPath,
      signal: ctx.signal,
      onProgress: (receivedBytes) =>
        ctx.report({
          ratio: clamp01((receivedBytes / Math.max(1, bytesTotal)) * DOWNLOAD_RATIO),
          bytesDone: Math.min(receivedBytes, bytesTotal),
          bytesTotal,
          filesRemaining: allowlist.length,
        }),
      onExtractProgress: (ratio) =>
        ctx.report({
          ratio:
            ratio === null
              ? DOWNLOAD_RATIO
              : clamp01(DOWNLOAD_RATIO + ratio * (EXTRACT_RATIO - DOWNLOAD_RATIO)),
          bytesDone: bytesTotal,
          bytesTotal,
        }),
      onExtractor: ctx.setExtractor,
      resolveExtractor: deps.resolveExtractor,
      ...(deps.download ? { download: deps.download } : {}),
      extract: deps.extractor.extract,
      options: {
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(log ? { log } : {}),
      },
    })

    // Before reading the result, on purpose: a kill that lost the race against 7za's own clean
    // exit must not turn a cancelled job into a succeeded one.
    if (ctx.signal.aborted || (!stagedArchive.ok && stagedArchive.cancelled)) return ctx.cancelled()
    if (!stagedArchive.ok) {
      // A nightly has no digest, so a mirror whose every attempt failed verification served a
      // wrong-sized file - the one failure the user is told about in those words.
      const sizeMismatch =
        !target.sha256 &&
        stagedArchive.stage === 'download' &&
        (stagedArchive.attempts?.length ?? 0) > 0 &&
        stagedArchive.attempts?.every((attempt) => attempt.outcome === 'verification-failed') ===
          true
      return ctx.fail(
        sizeMismatch ? BLEEDING_EDGE_SIZE_MISMATCH : stagedArchive.key,
        stagedArchive.stage === 'download'
          ? `downloading ${target.url} failed: ${stagedArchive.reason}`
          : stagedArchive.reason,
      )
    }
    ctx.report({ ratio: EXTRACT_RATIO, bytesDone: bytesTotal, bytesTotal })

    // 4. Completeness. Every *required* engine entry has to be in the staging tree; an optional one
    // that is absent is simply not part of this swap (see the module comment's second refinement).
    const staged: { relative: string; from: string }[] = []
    for (const entry of allowlist) {
      const from = await findStaged(stagingRoot, entry.from)
      if (from === null) {
        if (entry.required) {
          return ctx.fail(
            PACKAGE_INCOMPLETE,
            `the extracted ${target.version} archive holds none of ${entry.from.join(' | ')}`,
            { packageId: target.packageId ?? target.fileName },
          )
        }
        continue
      }
      staged.push({ relative: entry.to, from })
    }
    if (staged.length === 0) {
      return ctx.fail(
        PACKAGE_INCOMPLETE,
        `the extracted ${target.version} archive holds no engine`,
        {
          packageId: target.packageId ?? target.fileName,
        },
      )
    }

    if (ctx.signal.aborted) return ctx.cancelled()

    /**
     * Steps 5-7, and the only code in this file that writes inside the installation. A refusal is
     * thrown as `SwapFailed`, because `ctx.write` only carries "done" or "cancelled" back out.
     */
    const swap = async (): Promise<void> => {
      const backupDir = join(root, ENGINE_BACKUP_DIR_NAME)

      // The recorded pointer goes *before* the directory it describes, not after: from the moment
      // the old slot stops reliably existing, the record has to say so. Clearing it first means the
      // only window this leaves is the harmless direction - the record says "no backup" while the
      // old files are still physically there - never the dangerous one, where a pointer names a
      // version that a half-written slot no longer holds and `rollback-job.ts` would restore
      // whatever happens to be sitting in it under the old pointer's version (AC7/AC8).
      const dropped = deps.installations.setEngineState(installation.id, { backup: undefined })
      if (!dropped.ok) {
        throw new SwapFailed(
          `clearing the backup pointer of ${installation.id} failed: ${dropped.error.key}`,
        )
      }

      // The single slot, emptied before it is refilled - see the module comment on why this is not
      // an in-place overwrite. Nothing of the installation's own has moved yet at this point.
      try {
        await rm(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
        await mkdir(backupDir, { recursive: true })
      } catch (error) {
        throw new SwapFailed(`preparing ${backupDir} failed: ${String(error)}`)
      }

      const swaps: PlannedSwap[] = []

      /**
       * AC8. Puts back everything this run has moved or created, in the reverse sense of what it
       * did - and never stops at the first failure: each file returned is one less hole in the
       * engine the user is left with. Best-effort by construction, so it can be called from any of
       * the exits below without adding a failure mode of its own.
       *
       * The one thing it is *not* best-effort about is the deletion at the end: the slot is only
       * removed once every backed-up file is verifiably back where it came from. A move-back that
       * failed (`EPERM`/`EBUSY` on a just-written binary an antivirus still holds is the realistic
       * case) would otherwise cost the user that file twice over - missing from the installation
       * *and* deleted from the backup - which is strictly worse than the half-replaced state AC8
       * forbids. So the slot, with whatever is left in it, is kept for a later manual recovery.
       * The pointer stays cleared either way (it was cleared before the old slot was emptied): a
       * partial slot is not a rollback target, and `engineNoBackup` is the honest answer to a
       * rollback attempted against it.
       */
      const restore = async (): Promise<void> => {
        let unrestored = 0
        for (const planned of swaps) {
          if (planned.backedUp) {
            try {
              await moveFile(planned.backupPath, planned.dest)
            } catch (error) {
              unrestored += 1
              log?.warn(
                `restoring ${planned.backupPath} onto ${planned.dest} failed: ${String(error)}`,
              )
            }
            continue
          }
          if (planned.copied) {
            // There was no file at this path before this run, so "as it was" means none now.
            try {
              await rm(planned.dest, { force: true, maxRetries: 3, retryDelay: 50 })
            } catch (error) {
              log?.warn(`removing the half-installed ${planned.dest} failed: ${String(error)}`)
            }
          }
        }
        if (unrestored > 0) {
          log?.warn(
            `keeping ${backupDir}: ${unrestored} backed-up engine file(s) of ${installation.name} could not be restored, and the backup is the only copy left of them`,
          )
          return
        }
        // The slot is empty again - its contents went back into the installation, every one of
        // them - so the directory that held them goes too.
        try {
          await rm(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
        } catch (error) {
          log?.warn(`removing the emptied ${backupDir} failed: ${String(error)}`)
        }
      }

      // 5. The current engine files go into the slot, by `rename` (Decisions (Sprint)). Resolved
      // case-insensitively against the installation as it really is, so a `BASEQ2` install is
      // backed up and rewritten under its own spelling rather than beside it.
      for (const entry of staged) {
        const current = await resolveRelaxed(root, entry.relative)
        const planned: PlannedSwap = {
          relative: entry.relative,
          from: entry.from,
          dest: current ?? (await plannedDestination(root, entry.relative)),
          backupPath: join(backupDir, entry.relative),
          backedUp: false,
          copied: false,
        }
        swaps.push(planned)
        if (current === null) continue

        try {
          await mkdir(dirname(planned.backupPath), { recursive: true })
          await moveFile(current, planned.backupPath)
          planned.backedUp = true
        } catch (error) {
          await restore()
          throw new SwapFailed(
            `backing up ${current} into ${planned.backupPath} failed: ${String(error)}`,
          )
        }
      }

      // 6. The new files, onto the paths the old ones just left.
      for (const planned of swaps) {
        try {
          await mkdir(dirname(planned.dest), { recursive: true })
          await cp(planned.from, planned.dest, { dereference: true })
          planned.copied = true
        } catch (error) {
          await restore()
          throw new SwapFailed(
            `copying ${planned.from} onto ${planned.dest} failed: ${String(error)}`,
          )
        }
      }

      // 7. AC7: what is now actually on disk. `setEngineState` (D2) also mirrors the version into
      // `Installation.detectedVersion`, so this is the only write needed for the record.
      const backedUpAnything = swaps.some((planned) => planned.backedUp)
      if (!backedUpAnything) {
        // Nothing was replaced, only added - there is no previous engine to roll back to, and an
        // empty slot must not be advertised as one.
        await rm(backupDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
          () => {},
        )
      }
      const backup: EngineBackupInfo = {
        version: recorded.version ?? UNKNOWN_BACKUP_VERSION,
        ...(recorded.packageId ? { packageId: recorded.packageId } : {}),
        createdAt: Date.now(),
      }
      const written = deps.installations.setEngineState(installation.id, {
        version: target.version,
        // Cleared rather than left stale for a nightly: the build on disk is not a manifest package.
        packageId: target.packageId,
        backup: backedUpAnything ? backup : undefined,
      })
      if (!written.ok) {
        await restore()
        throw new SwapFailed(
          `recording engine version ${target.version} on ${installation.id} failed: ${written.error.key}`,
        )
      }

      ctx.report({ ratio: SWAP_DONE_RATIO, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })
    }

    let written: 'done' | 'cancelled'
    try {
      written = await ctx.write(installation.id, swap)
    } catch (error) {
      if (error instanceof SwapFailed) return ctx.fail(ENGINE_REPLACE_FAILED, error.message)
      throw error
    }
    if (written === 'cancelled') return ctx.cancelled()

    // 8. The status is whatever `inspectInstallation` now makes of the folder. This file never
    // writes one, and `EngineUpdateInstallationsHost` gives it no way to.
    const revalidated = await ctx.revalidate(installation.id)
    if (!revalidated.ok) {
      return ctx.fail(
        LOCAL_FAILURE,
        `revalidating ${installation.id} failed: ${revalidated.error.key}`,
      )
    }
    if (revalidated.value.status === 'invalid' || revalidated.value.status === 'missing') {
      // The new engine is in place and the inspector still says this is not a usable installation.
      // The files stay - rolling back is `engine.rollbackStart`'s job (D6), and the backup this run
      // just took is exactly what it needs; succeeding here would claim an update that did not work.
      return ctx.fail(
        NOT_PLAYABLE,
        `${root} is ${revalidated.value.status} after the engine update`,
      )
    }

    ctx.report({ ratio: 1, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })
    log?.info(
      `updated the engine of ${installation.name} to ${target.version} (${target.channel}, job ${jobId})`,
    )
    return {
      status: 'succeeded',
      version: target.version,
      installationStatus: revalidated.value.status,
    }
  } finally {
    // Best-effort, on every exit: the staging tree has either been copied into the installation or
    // abandoned, and is of no use to anyone either way.
    try {
      await rm(stagingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error) {
      log?.warn(`could not remove the staging directory ${stagingRoot}: ${String(error)}`)
    }
  }
}

/**
 * The first candidate of an allowlist entry that the staging tree actually holds. Case-sensitive
 * `join`, exactly like `assemble.ts` does for `role: 'engine'`: a staging tree is this launcher's
 * own extraction, whose layout is known, not a foreign folder that has to be resolved relaxed.
 */
async function findStaged(stagingRoot: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const absolute = join(stagingRoot, candidate)
    try {
      const info = await stat(absolute)
      if (info.isFile()) return absolute
    } catch {
      continue
    }
  }
  return null
}
