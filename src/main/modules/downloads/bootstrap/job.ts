import { existsSync } from 'node:fs'
import { mkdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_GAME_DIR } from '@shared/constants'
import {
  DEFAULT_BOOTSTRAP_INSTALLATION_NAME,
  type BootstrapSummary,
  type BootstrapSummaryPackage,
  type DownloadsErrorKey,
  type ManifestPackage,
  type PackageSource,
  type StartBootstrapInput,
} from '@shared/modules/downloads'
import {
  fail,
  ok,
  type CreateInstallationInput,
  type EngineKind,
  type Installation,
  type InstallationIcon,
  type InstallationStatus,
  type Job,
  type JobProgress,
  type Outcome,
  type RemoveInstallationInput,
  type UpdateInstallationInput,
} from '@shared/types'
import type { CreateJobInput } from '../../../services/jobs'
import { markVerified, type ExtractorHandle } from '../extractor'
import type { FetchImpl } from '../fetcher'
import { isSafeDownloadFileName } from '../paths'
import { getExtractDir } from '../pipeline'
import { assembleInstallation } from './assemble'
import { asExtractionErrorKey, LOCAL_FAILURE, NOT_PLAYABLE, PACKAGE_UNAVAILABLE } from './errors'
import type { BootstrapLog, Extractor, ManifestSource, PackageFetcher } from './ports'
import { computeTargetVerdict } from './target'

/**
 * Story 074 D4: the bootstrap job - "download Q2PRO plus the free demo data plus the 3.20 point
 * release, verify them, extract them, and assemble one playable `baseq2` installation".
 *
 * ## One job, three packages
 *
 * This deliberately does not go through `pipeline.ts`. That file's unit of work is "one package =
 * one `Job`", and this story's acceptance is about *the* job, singular: one progress bar, one
 * cancel button, one `playableAtRatio` transition across three downloads, two assemble passes and
 * two revalidations. So this file creates its own `Job` and calls the same lower-level pieces
 * `pipeline.ts` composes (`downloadPackage`, `extractArchive`), reached through the ports in
 * `ports.ts`. What it *does* borrow from `pipeline.ts` is the discipline: a `report()` that goes
 * silent once cancelled (because `JobsService.progress()` unconditionally sets `status: 'running'`
 * and would otherwise resurrect a cancelled job), a `failed()` helper that ends the job exactly
 * once, and an explicit cancel check after every `await` that could span one.
 *
 * ## The order is the acceptance criterion
 *
 * Nothing here is arbitrary, and the sequence is the part worth reviewing:
 *
 * 1. **Re-verify the target.** The path came from the renderer, so it is re-run through
 *    `computeTargetVerdict` even though the wizard's target step already showed a verdict - "paths
 *    from the renderer are never trusted" (CLAUDE.md). A `blocked` verdict stops everything before
 *    a single byte or directory exists. The canonical path from the verdict is what gets used.
 * 2. **Resolve all three packages** (pinned engine build, `role: 'demo'`, `role: 'point-release'`).
 *    Missing any one of them fails *before* anything is created, on disk or in the library.
 * 3. **Register the installation** (`InstallationsService.create()`), whose status comes from
 *    `inspectInstallation` reading the freshly created, still empty skeleton - so the library shows
 *    a real entry with a real verdict from the very first moment (Decisions (Sprint)).
 * 4. **Only now create the `Job`.** Before this point there is nothing to cancel and no job to
 *    cancel it with, which is why steps 1-3 answer a plain failed `Outcome` instead.
 * 5. Per package, in order: download (verified by the fetcher) then extract, each into its own
 *    `<cache>/extract/<jobId>/<packageId>` directory - one per package, since a single job now
 *    holds three archives.
 * 6. **Assemble core** - `assembleInstallation({ includeVideoAndPlayers: false })`, D3's allowlist.
 * 7. **Revalidate** through `InstallationsService.validate()`, and record `playableAtRatio` the
 *    first time that verdict is neither `invalid` nor `missing` (AC6). The *trigger* is the real
 *    inspector verdict; only the ratio value itself is this file's (see `PLAYABLE_AT_RATIO`).
 * 8. **Assemble auxiliary** (`video/*`, `players/*`) when the user asked for it - after the
 *    installation is already playable, which is the whole point of the marker in step 7.
 * 9. **Revalidate again** and finish. The installation's status is never hand-set anywhere in this
 *    file: `create()` and `validate()` are the only two writers of it, and both derive it from
 *    `inspectInstallation`.
 *
 * ## Cancel and failure leave nothing behind
 *
 * Both paths run the same cleanup, in this order: **the copied files first, the library entry
 * second.** A crash between the two then leaves at worst an orphaned folder (which the user can
 * delete, and which the wizard will happily install into again) rather than a registered
 * installation pointing at files that are gone - the confusing failure of the two.
 *
 * The cleanup removes exactly the files this job copied plus the directories it created, and
 * **never** `rm -rf`s the target root: D2's verdict treats a non-empty target as a *warning*, not a
 * blocker, so the user may well have pointed the wizard at a folder that already held something of
 * theirs. `rmdir` (not `rm -r`) on the directories we may have created succeeds only while they are
 * empty, which is precisely the "we made it, so we may remove it" test.
 *
 * Verified archives stay in the download cache on purpose (`fetcher.ts` promoted them there):
 * AC6's "no partial files" is about partial ones, and the cache is what makes a retry cheap. The
 * extracted trees do not - they have either been copied into the installation or abandoned.
 */

/** `Job.kind` for a bootstrap job; a module-defined discriminator (`@shared/types`). */
export const BOOTSTRAP_JOB_KIND = 'bootstrap-install'

/** `Job.labelKey`; resolved in the renderer with `{ name }` (never prose across the seam). */
export const BOOTSTRAP_JOB_LABEL_KEY = 'downloads.job.bootstrap'

/**
 * The failure key for a target the wizard may not install into. Not a member of
 * `DOWNLOADS_ERROR_KEYS`: it is answered by `bootstrap.start` itself, before any job exists, so it
 * never reaches a `Job.error` - the same reason `downloads.error.manifestUnavailable` is not a
 * member either.
 */
export const TARGET_BLOCKED_KEY = 'downloads.error.bootstrapTargetBlocked'

/**
 * The share of the job's progress bar the three download+extract phases occupy. The remainder is
 * the two assemble passes and the two revalidations - real work (a few hundred MB of file copies),
 * so it gets real room rather than being squeezed into the last percent.
 */
const PACKAGES_RATIO = 0.85

/** Of one package's own slice, how much is the download; the rest is its extraction. */
const DOWNLOAD_SHARE = 0.8

/** Reported once the core assemble pass has finished. */
export const ASSEMBLE_CORE_RATIO = 0.9

/**
 * The ratio recorded as `playableAtRatio` (AC6). It is the job's own progress coordinate at the
 * moment the core assemble pass is done, which is exactly where the first non-`invalid` verdict can
 * occur - the point of the marker is to tell the user "from here the game is playable while the
 * rest continues", and that is a position on this job's bar, not a second opinion about the
 * installation's health. Whether the marker is recorded at all is decided solely by
 * `InstallationsService.validate()`'s returned status.
 */
export const PLAYABLE_AT_RATIO = ASSEMBLE_CORE_RATIO

/** Reported once the optional `video/*`/`players/*` pass has finished. */
const ASSEMBLE_AUX_RATIO = 0.97

/**
 * A single, boring path segment - the shape `paths.ts` demands of a download file name, applied
 * here to the directory segments built from a job id (a `randomUUID()`) and a `ManifestPackage.id`
 * (foreign content, straight out of a manifest fetched off the internet). Refused, never
 * sanitised.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/** Directories the job may have created inside the target, deepest first - see the cleanup note. */
const PRUNABLE_TARGET_DIRS = [join(BASE_GAME_DIR, 'video'), 'players', BASE_GAME_DIR]

/**
 * Story 074 finding fix (Decisions (Sprint): "default (existing) icon assigned automatically").
 * One of the shipped icon ids under `src/renderer/src/assets/installations/`
 * (`installation-icons.ts`'s `SHIPPED_ICONS`) - the Q2PRO logo, since that is the engine this
 * bootstrap installs. Not a new asset (CLAUDE.md's "no image assets" rule): this only references
 * an icon that already ships.
 */
const DEFAULT_BOOTSTRAP_ICON_ID = 'q2pro-logo'

/** What became of one bootstrap. A one-shot value, never a second status source next to the job. */
export type BootstrapOutcome =
  | { status: 'succeeded'; installationId: string; installationStatus: InstallationStatus }
  | { status: 'failed'; key: DownloadsErrorKey }
  | { status: 'cancelled' }

export interface StartedBootstrap {
  /** The `Job.id` - what `jobs:cancel` takes, and what the UI renders. */
  jobId: string
  /** The installation registered in step 3; already in `InstallationsService.list()`. */
  installationId: string
  /** Resolves once the job has reached a terminal state. Never rejects. */
  settled: Promise<BootstrapOutcome>
}

/** The `JobsService` surface this job uses. `JobsService` satisfies it structurally. */
export interface BootstrapJobsHost {
  create(input: CreateJobInput): Job
  progress(id: string, progress: JobProgress): void
  /** Story 074 D4's additive `JobsService` method - see its doc comment there. */
  markPlayable(id: string, ratio: number): void
  finish(
    id: string,
    outcome: { status: 'succeeded' | 'failed' | 'cancelled'; error?: Job['error'] },
  ): void
}

/**
 * The `InstallationsService` surface this job uses. Narrow on purpose: these three methods are the
 * *only* way this file is allowed to touch the library, which is what makes "the status always
 * comes from `inspectInstallation`" checkable by reading the type rather than the whole flow.
 */
export interface BootstrapInstallationsHost {
  create(input: CreateInstallationInput): Promise<Outcome<Installation>>
  validate(id: string): Promise<Outcome<Installation>>
  remove(input: RemoveInstallationInput): Promise<Outcome<null>>
  /**
   * Story 074 finding fix: the only path that ever writes `Installation.writeDirPath` - reused
   * here, right after `create()`, for AC2's Program-Files remedy so this file never invents a
   * second way to persist that field. Mirrors `ChecksList.tsx`'s existing `set-write-dir` remedy.
   */
  update(input: UpdateInstallationInput): Promise<Outcome<Installation>>
  /**
   * Story 074 finding fix: assigns the sprint's default shipped icon to a freshly bootstrapped
   * installation (Decisions (Sprint): "default (existing) icon assigned automatically").
   * Synchronous, mirroring `InstallationsService.setIcon`'s own signature.
   */
  setIcon(id: string, icon: InstallationIcon | null): Outcome<Installation>
}

export interface BootstrapDeps {
  jobs: BootstrapJobsHost
  installations: BootstrapInstallationsHost
  manifest: ManifestSource
  fetcher: PackageFetcher
  extractor: Extractor
  /** `app.getPath('userData')`; the download cache and the extract directories are built from it. */
  userDataPath: string
  /** `resolveExtractorPath(...)` (`7za-path.ts`); called per extraction, like the pipeline does. */
  resolveExtractor: () => { path: string; exists: boolean }
  /** Handed to the fetcher; the real client unless overridden. */
  fetchImpl?: FetchImpl
  log?: BootstrapLog
}

/** One resolved package plus what it contributes to the installation. */
interface BootstrapPackage {
  role: BootstrapSummaryPackage['role']
  pkg: ManifestPackage
  source: PackageSource
}

/** `userData/cache/downloads/extract/<jobId>` - the job's own directory, one level up from D1's. */
export function getBootstrapExtractRoot(userDataPath: string, jobId: string): string {
  return getExtractDir(userDataPath, jobId)
}

/** `userData/cache/downloads/extract/<jobId>/<packageId>` - one per package. Throws on an unsafe id. */
export function getBootstrapExtractDir(
  userDataPath: string,
  jobId: string,
  packageId: string,
): string {
  if (!SAFE_PATH_SEGMENT.test(packageId)) {
    throw new Error(`refused package id ${JSON.stringify(packageId)}`)
  }
  return join(getBootstrapExtractRoot(userDataPath, jobId), packageId)
}

/**
 * The `PackageSource` (`fetcher.ts`'s own minimal input type) for a manifest package. The file name
 * is the URL's last path segment, and it is *refused* rather than sanitised when it is not a single
 * safe segment - `paths.ts` would refuse it a moment later anyway, and refusing here means the
 * refusal happens before anything is created.
 */
export function toPackageSource(pkg: ManifestPackage): PackageSource | undefined {
  let fileName: string
  try {
    fileName = decodeURIComponent(new URL(pkg.url).pathname.split('/').pop() ?? '')
  } catch {
    return undefined
  }
  if (!isSafeDownloadFileName(fileName)) return undefined

  return {
    fileName,
    url: pkg.url,
    mirrors: pkg.mirrors,
    sizeBytes: pkg.sizeBytes,
    sha256: pkg.sha256,
  }
}

/**
 * The three packages a bootstrap installs, in download (and `sourceDirs`) order: the engine build
 * first, then the demo data, then the point release. That order is also the order
 * `assembleInstallation` searches for each allowlisted file, so it decides who wins for a file two
 * archives both contain - the engine build for its own payload, the demo for `baseq2/pak0.pak`, and
 * the point release only for what neither of the first two brought.
 */
async function resolvePackages(
  manifest: ManifestSource,
  engine: EngineKind,
): Promise<Outcome<BootstrapPackage[]>> {
  const resolved: BootstrapPackage[] = []

  const entries: Array<{ role: BootstrapSummaryPackage['role']; pkg: ManifestPackage | undefined }> =
    [
      { role: 'engine', pkg: await manifest.resolveEnginePackage(engine) },
      { role: 'demo', pkg: await manifest.resolveGameDataPackage('demo') },
      { role: 'point-release', pkg: await manifest.resolveGameDataPackage('point-release') },
    ]

  for (const entry of entries) {
    if (entry.pkg === undefined) return fail(PACKAGE_UNAVAILABLE, { role: entry.role })

    const source = toPackageSource(entry.pkg)
    // An unusable id or URL is the same problem to the user as a package that is not listed at
    // all: this manifest cannot produce a bootstrap. Both are logged with their real reason.
    if (source === undefined || !SAFE_PATH_SEGMENT.test(entry.pkg.id)) {
      return fail(PACKAGE_UNAVAILABLE, { role: entry.role })
    }
    resolved.push({ role: entry.role, pkg: entry.pkg, source })
  }

  return ok(resolved)
}

export interface BuildBootstrapSummaryInput {
  engine: EngineKind
  /** Echoed into the summary; the confirm step shows the path the target step already resolved. */
  targetPath: string
  includeVideoAndPlayers: boolean
}

/**
 * Story 074 AC4: what the wizard's confirm step states before anything is downloaded - the three
 * packages and their summed size. Resolves through the same `ManifestSource` port and the same
 * `resolvePackages` the job itself uses, so the confirm step can never name a different set of
 * packages (or a different total) than the job goes on to fetch.
 */
export async function buildBootstrapSummary(
  deps: { manifest: ManifestSource },
  input: BuildBootstrapSummaryInput,
): Promise<Outcome<BootstrapSummary>> {
  const resolved = await resolvePackages(deps.manifest, input.engine)
  if (!resolved.ok) return resolved

  const packages: BootstrapSummaryPackage[] = resolved.value.map(({ role, pkg }) => ({
    id: pkg.id,
    version: pkg.version,
    sizeBytes: pkg.sizeBytes,
    role,
  }))

  return ok({
    targetPath: input.targetPath,
    engine: input.engine,
    packages,
    totalSizeBytes: packages.reduce((total, pkg) => total + pkg.sizeBytes, 0),
    includeVideoAndPlayers: input.includeVideoAndPlayers,
  })
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Best-effort: a directory that cannot be removed must not also fail (or un-fail) the job. */
async function removeDir(dir: string, log?: BootstrapLog): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch (error) {
    log?.warn(`the directory ${dir} could not be removed: ${String(error)}`)
  }
}

/**
 * Undoes this job's own writes inside the target: every file it copied, then the directories it
 * may have created - via `rmdir`, so a directory that still holds anything (the user's own files,
 * in a target that was merely *warned* about for being non-empty) is left exactly as it was. See
 * the module comment's cleanup note for why this is not an `rm -rf`.
 */
async function removeAssembled(
  targetRoot: string,
  copiedFiles: Iterable<string>,
  removeRoot: boolean,
  log?: BootstrapLog,
): Promise<void> {
  for (const relative of copiedFiles) {
    await removeDir(join(targetRoot, relative), log)
  }
  for (const dir of PRUNABLE_TARGET_DIRS) {
    await rmdir(join(targetRoot, dir)).catch(() => {})
  }
  // Only when the job itself is responsible for this directory's existence - a folder the user
  // already had (even an empty one) must survive a cancel/failure untouched.
  if (removeRoot) {
    await rmdir(targetRoot).catch(() => {})
  }
}

/**
 * Starts a bootstrap install. Answers a failed `Outcome` for everything that goes wrong *before*
 * the job exists (a blocked target, an unresolvable package, an installation that could not be
 * registered) and `ok({ jobId, installationId, settled })` once the job is running - the job itself
 * is the progress and status surface from then on, and awaiting `settled` is optional.
 */
export async function startBootstrap(
  deps: BootstrapDeps,
  input: StartBootstrapInput,
): Promise<Outcome<StartedBootstrap>> {
  const log = deps.log

  // 1. The renderer's path, re-judged in main. `computeTargetVerdict` is the same function the
  // wizard's target step rendered, so main and the UI cannot disagree about this folder.
  const verdict = await computeTargetVerdict(input.targetPath)
  if (verdict.blocked) {
    log?.warn(`bootstrap refused ${input.targetPath}: ${verdict.blockedReason ?? 'blocked'}`)
    return fail(TARGET_BLOCKED_KEY, { reason: verdict.blockedReason ?? 'unsafePath' })
  }

  // 2. Nothing exists yet, so a missing package costs nothing to fail on.
  const resolved = await resolvePackages(deps.manifest, input.engine)
  if (!resolved.ok) {
    log?.warn(`bootstrap could not resolve its packages: ${JSON.stringify(resolved.error.params)}`)
    return resolved
  }
  const packages = resolved.value

  // Taken before `create()` runs: whether the target folder itself already existed on disk (the
  // user pointed the wizard at an existing, possibly-empty folder) as opposed to `create()`'s own
  // `mkdir(rootPath, { recursive: true })` chain having created it. Threaded into the cleanup path
  // below so a cancel/failure never removes a top-level directory this job did not itself make -
  // see the module comment's cleanup note.
  const targetPreexisted = existsSync(verdict.targetPath)

  // 3. The library entry, with a status `inspectInstallation` produced for the empty skeleton.
  const created = await deps.installations.create({
    rootPath: verdict.targetPath,
    name: input.name?.trim() || DEFAULT_BOOTSTRAP_INSTALLATION_NAME,
    engineKind: input.engine,
  })
  if (!created.ok) {
    // Carries the installations service's own key (`duplicate`, `alreadyContainsGame`,
    // `createFailed`) - already an i18n key, and more specific than any downloads key would be.
    log?.warn(`bootstrap could not register ${verdict.targetPath}: ${created.error.key}`)
    return created
  }
  const installation = created.value
  // The service canonicalised the path again on the way in; its copy is the authoritative one.
  const targetRoot = installation.rootPath

  // AC2's remedy, persisted the same way `ChecksList.tsx`'s existing `set-write-dir` remedy does -
  // best-effort: a failure here must not fail the whole bootstrap, since the installation is
  // already registered and playable regardless of this field.
  if (input.writeDirPath) {
    const updated = await deps.installations.update({
      id: installation.id,
      writeDirPath: input.writeDirPath,
    })
    if (!updated.ok) {
      log?.warn(`bootstrap could not set writeDirPath on ${installation.id}: ${updated.error.key}`)
    }
  }

  // Decisions (Sprint): "default (existing) icon assigned automatically".
  const iconResult = deps.installations.setIcon(installation.id, {
    kind: 'shipped',
    id: DEFAULT_BOOTSTRAP_ICON_ID,
  })
  if (!iconResult.ok) {
    log?.warn(`bootstrap could not set the default icon on ${installation.id}: ${iconResult.error.key}`)
  }

  // 4. From here on there is something to cancel, so from here on there is a job.
  const controller = new AbortController()
  let cancelled = false
  let extractor: ExtractorHandle | undefined
  let jobId = ''

  const job = deps.jobs.create({
    moduleId: 'downloads',
    kind: BOOTSTRAP_JOB_KIND,
    labelKey: BOOTSTRAP_JOB_LABEL_KEY,
    labelParams: { name: installation.name },
    installationId: installation.id,
    cancellable: true,
    // Every cancel moment in one callback; each action is a no-op in the states it does not apply
    // to, so there is no state to branch on and therefore no state this can get wrong.
    onCancel: () => {
      cancelled = true
      controller.abort()
      extractor?.kill()
    },
  })
  jobId = job.id

  const extractRoot = getBootstrapExtractRoot(deps.userDataPath, jobId)
  const totalBytes = packages.reduce((total, entry) => total + entry.pkg.sizeBytes, 0)
  /** Guards the ratio math against a manifest that (impossibly, per its schema) declares 0 bytes. */
  const safeTotal = Math.max(1, totalBytes)

  /** Target-relative paths this job copied, for the cleanup. A set: the auxiliary pass re-copies
   * the fixed allowlist (D3's `buildAssemblePlan` always includes it), and a path is removed once. */
  const copied = new Set<string>()
  let playableMarked = false

  /** Every progress report in this file. Silent once cancelled - see the module comment. */
  const report = (progress: JobProgress): void => {
    if (cancelled) return
    deps.jobs.progress(jobId, progress)
  }

  /** Maps "package `index` is `within` (0-1) through its own download+extract" onto the job's bar. */
  const packagesProgress = (bytesBefore: number, packageBytes: number, within: number): number =>
    clamp01(((bytesBefore + packageBytes * clamp01(within)) / safeTotal) * PACKAGES_RATIO)

  /**
   * AC6: the marker is recorded the first time a *real* verdict is neither `invalid` nor `missing`
   * - `'ok'` and `'warning'` both mean playable (a warning is "playable, but something is off",
   * `InstallationStatus`). Marked before the call, like `observeFailedJobs`'s seen-set discipline,
   * so nothing can fire it twice.
   */
  const markPlayableIfReady = (status: InstallationStatus): void => {
    if (playableMarked || cancelled) return
    if (status === 'invalid' || status === 'missing') return
    playableMarked = true
    deps.jobs.markPlayable(jobId, PLAYABLE_AT_RATIO)
  }

  /**
   * Files first, registration second - see the module comment. Best-effort throughout: cleanup
   * that fails must not turn a cancelled job into a failed one, or a failed one into a hang.
   */
  const cleanUp = async (): Promise<void> => {
    await removeAssembled(targetRoot, copied, !targetPreexisted, log)
    const removed = await deps.installations.remove({
      id: installation.id,
      deleteFromDisk: false,
    })
    if (!removed.ok) {
      log?.warn(
        `the half-built installation ${installation.id} could not be dropped: ${removed.error.key}`,
      )
    }
    await removeDir(extractRoot, log)
  }

  /** The job is already `cancelled` in `JobsService` (`cancel()` finishes it); the leftovers are ours. */
  const cancelledOutcome = async (): Promise<BootstrapOutcome> => {
    await cleanUp()
    log?.info(`bootstrap of ${installation.name} cancelled (job ${jobId})`)
    return { status: 'cancelled' }
  }

  const failed = async (key: DownloadsErrorKey, reason: string): Promise<BootstrapOutcome> => {
    // The reason is prose and stays in the log: `Job.error` carries an i18n key, and CLAUDE.md's
    // "main sends i18n keys, never prose" rules out shipping it to the renderer.
    log?.warn(`bootstrap of ${installation.name} failed with ${key}: ${reason}`)
    // Cleaned up *before* the status flips, so no observer can ever see a `failed` job next to a
    // still-registered half-built installation.
    await cleanUp()
    deps.jobs.finish(jobId, { status: 'failed', error: { key } })
    return { status: 'failed', key }
  }

  const run = async (): Promise<BootstrapOutcome> => {
    report({ ratio: 0, bytesDone: 0, bytesTotal: totalBytes, filesRemaining: packages.length })

    // 5. Sequentially, one package at a time: simpler to reason about than three concurrent
    // downloads sharing one cancel, one progress bar and one disk, and the wall-clock difference
    // is bounded by the mirror's bandwidth either way.
    const sourceDirs: string[] = []
    let doneBytes = 0

    for (const [index, entry] of packages.entries()) {
      if (cancelled) return cancelledOutcome()

      const packageBytes = entry.pkg.sizeBytes
      const filesRemaining = packages.length - index
      const extractDir = getBootstrapExtractDir(deps.userDataPath, jobId, entry.pkg.id)

      const fetched = await deps.fetcher.fetch(entry.source, {
        userDataPath: deps.userDataPath,
        signal: controller.signal,
        onProgress: ({ receivedBytes }) =>
          report({
            ratio: packagesProgress(
              doneBytes,
              packageBytes,
              DOWNLOAD_SHARE * (receivedBytes / Math.max(1, packageBytes)),
            ),
            bytesDone: doneBytes + receivedBytes,
            bytesTotal: totalBytes,
            filesRemaining,
          }),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(log ? { log } : {}),
      })

      if (!fetched.ok) {
        // A cancel is not a failure needing a reason, and the fixed key set has no member for
        // "the user changed their mind" - so it never surfaces `fetched.key`.
        if (fetched.cancelled || cancelled) return cancelledOutcome()
        return failed(fetched.key, `${entry.pkg.id}: ${fetched.reason}`)
      }

      if (cancelled) return cancelledOutcome()

      // 7za is spawned with `cwd: extractDir`, so the directory has to exist before the spawn.
      try {
        await mkdir(extractDir, { recursive: true })
      } catch (error) {
        return failed(LOCAL_FAILURE, `mkdir ${extractDir} failed: ${String(error)}`)
      }

      if (cancelled) return cancelledOutcome()

      const extractorPath = deps.resolveExtractor()
      // No `await` between the check above and the assignment below, so a cancel can never land in
      // a gap where the extractor is running but `onCancel` cannot see it yet.
      extractor = deps.extractor.extract({
        archive: markVerified(fetched.path),
        extractDir,
        extractorPath: extractorPath.path,
        extractorExists: extractorPath.exists,
        onProgress: (ratio) =>
          report({
            ratio: packagesProgress(
              doneBytes,
              packageBytes,
              DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) * (ratio ?? 0),
            ),
            bytesDone: doneBytes + packageBytes,
            bytesTotal: totalBytes,
            filesRemaining,
          }),
      })

      const extracted = await extractor.result

      // Before `extracted.ok`, on purpose: a kill that lost the race against 7za's own clean exit
      // must not turn a cancelled job into a succeeded one.
      if (cancelled) return cancelledOutcome()
      if (!extracted.ok) {
        return failed(asExtractionErrorKey(extracted.error.key), `extracting ${entry.pkg.id} failed`)
      }

      doneBytes += packageBytes
      sourceDirs.push(extractDir)
      report({
        ratio: packagesProgress(doneBytes, 0, 0),
        bytesDone: doneBytes,
        bytesTotal: totalBytes,
        filesRemaining: packages.length - index - 1,
      })
    }

    if (cancelled) return cancelledOutcome()

    // 6. Assemble core - the engine payload and the baseq2 paks, allowlisted by D3.
    try {
      const core = await assembleInstallation({
        sourceDirs,
        targetRoot,
        includeVideoAndPlayers: false,
      })
      for (const file of core.copiedFiles) copied.add(file)
    } catch (error) {
      return failed(LOCAL_FAILURE, `assembling ${targetRoot} failed: ${String(error)}`)
    }

    if (cancelled) return cancelledOutcome()
    report({ ratio: ASSEMBLE_CORE_RATIO, bytesDone: totalBytes, bytesTotal: totalBytes })

    // 7. Revalidate. `validate()` re-runs `inspectInstallation` and stores its verdict - this file
    // never inspects the folder itself and never writes a status.
    const afterCore = await deps.installations.validate(installation.id)
    if (!afterCore.ok) {
      return failed(LOCAL_FAILURE, `revalidating ${installation.id} failed: ${afterCore.error.key}`)
    }
    markPlayableIfReady(afterCore.value.status)

    // 8. The optional extras, only now - after the installation is already playable.
    if (input.includeVideoAndPlayers) {
      if (cancelled) return cancelledOutcome()
      try {
        const auxiliary = await assembleInstallation({
          sourceDirs,
          targetRoot,
          includeVideoAndPlayers: true,
        })
        for (const file of auxiliary.copiedFiles) copied.add(file)
      } catch (error) {
        return failed(
          LOCAL_FAILURE,
          `assembling the extras into ${targetRoot} failed: ${String(error)}`,
        )
      }
      if (cancelled) return cancelledOutcome()
      report({ ratio: ASSEMBLE_AUX_RATIO, bytesDone: totalBytes, bytesTotal: totalBytes })
    }

    // 9. The last word on the installation's status, again from `inspectInstallation`.
    const afterAll = await deps.installations.validate(installation.id)
    if (!afterAll.ok) {
      return failed(LOCAL_FAILURE, `revalidating ${installation.id} failed: ${afterAll.error.key}`)
    }
    markPlayableIfReady(afterAll.value.status)

    if (cancelled) return cancelledOutcome()

    if (afterAll.value.status === 'invalid' || afterAll.value.status === 'missing') {
      // Everything downloaded, verified and copied, and the inspector still says this is not a
      // usable installation. Succeeding here would hand the user a library entry that cannot
      // launch; failing runs the same cleanup every other failure does.
      return failed(NOT_PLAYABLE, `${targetRoot} is still ${afterAll.value.status} after assembly`)
    }

    report({ ratio: 1, bytesDone: totalBytes, bytesTotal: totalBytes, filesRemaining: 0 })
    // The extracted trees have served their purpose; the verified archives stay in the cache.
    await removeDir(extractRoot, log)
    deps.jobs.finish(jobId, { status: 'succeeded' })
    log?.info(`bootstrapped ${installation.name} into ${targetRoot} (job ${jobId})`)
    return {
      status: 'succeeded',
      installationId: installation.id,
      installationStatus: afterAll.value.status,
    }
  }

  const settled = (async (): Promise<BootstrapOutcome> => {
    try {
      return await run()
    } catch (error) {
      // Nothing in `run()` is expected to throw; if something does, the job must still end - a
      // `running` job nobody finishes is worse than a slightly wrong key.
      if (cancelled) return cancelledOutcome()
      return failed(LOCAL_FAILURE, `unexpected bootstrap error: ${String(error)}`)
    }
  })()

  return ok({ jobId, installationId: installation.id, settled })
}
