import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_GAME_DIR } from '@shared/constants'
import {
  DEFAULT_BOOTSTRAP_INSTALLATION_NAME,
  type BootstrapDataSource,
  type BootstrapSummary,
  type BootstrapSummaryCopySource,
  type BootstrapSummaryPackage,
  type DetectedRetailSource,
  type DownloadsErrorKey,
  type ManifestPackage,
  type PackageSource,
  type StartBootstrapInput,
} from '@shared/modules/downloads'
import {
  engineLabel,
  fail,
  ok,
  type CreateInstallationInput,
  type EngineKind,
  type Installation,
  type InstallationIcon,
  type InstallationLastFailure,
  type InstallationStatus,
  type Job,
  type JobProgress,
  type Outcome,
  type RemoveInstallationInput,
  type UpdateInstallationInput,
} from '@shared/types'
import { canonicalizePath, pathKey } from '../../../lib/fs-utils'
import type { CreateJobInput } from '../../../services/jobs'
import { EXTRACTION_LISTING_CAP } from '../diagnostics'
import { markVerified, type ExtractorHandle } from '../extractor'
import type { FetchImpl } from '../fetcher'
import { isSafeDownloadFileName } from '../paths'
import { getExtractDir } from '../pipeline'
import {
  assembleInstallation,
  type AssembleEntryResult,
  type AssembleInstallationResult,
  type AssembleSource,
} from './assemble'
import {
  asExtractionErrorKey,
  LOCAL_FAILURE,
  MISSING_RUNTIME,
  NOT_PLAYABLE,
  PACKAGE_INCOMPLETE,
  PACKAGE_UNAVAILABLE,
  RETAIL_COPY_INCOMPLETE,
  RETAIL_SOURCE_UNVERIFIED,
} from './errors'
import type {
  BootstrapDiagnosticsSource,
  BootstrapLog,
  Extractor,
  ManifestSource,
  PackageFetcher,
  R1q2SetupPort,
} from './ports'
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
 * 1b. **Re-verify the copy source** (story 088 D4, `store-copy` runs only). The wizard's *other*
 *    renderer-supplied path, re-judged the same way and for the same reason: main re-lists the
 *    detected retail sources itself (`deps.retailSources`, which re-inspects each one) and refuses
 *    the run with `downloads.error.retailSourceUnverified` unless the chosen path is among them and
 *    still verifies as retail. Placed here, before step 2, so a refusal registers nothing, creates
 *    no folder and leaves no half-built installation - and what is copied from afterwards is the
 *    `rootPath` off main's own list entry, never the string the renderer sent.
 * 2. **Resolve the packages**: the pinned engine build, plus - for a `free-download` run only -
 *    `role: 'demo'` and `role: 'point-release'`. Missing any one of them fails *before* anything is
 *    created, on disk or in the library. A `store-copy` run downloads the engine and nothing else
 *    (088 AC4): its game data is copied from the verified source instead.
 * 3. **Register the installation** (`InstallationsService.create()`), whose status comes from
 *    `inspectInstallation` reading the freshly created, still empty skeleton - so the library shows
 *    a real entry with a real verdict from the very first moment (Decisions (Sprint)). Story 077 D3:
 *    unless a *failed* installation of ours is already registered at that exact canonical path, in
 *    which case this run adopts it instead of creating a second one (AC7) - see the predicate at
 *    that call site, which is the whole safety of the change.
 * 4. **Only now create the `Job`.** Before this point there is nothing to cancel and no job to
 *    cancel it with, which is why steps 1-3 answer a plain failed `Outcome` instead.
 * 5. Per package, in order: download (verified by the fetcher) then extract, each into its own
 *    `<cache>/extract/<jobId>/<packageId>` directory - one per package, since a single job now
 *    holds three archives.
 * 6. **Assemble core** - `assembleInstallation({ includeVideoAndPlayers: false })`, D3's allowlist.
 *    Story 088 D4: a `store-copy` run adds the verified retail root to `sources` as a plain
 *    `AssembleSource` with `role: 'retail'` (Decisions (Sprint): "the retail install root is just
 *    another assemble source") and passes `dataSource: 'store-copy'`, so this one pass copies the
 *    engine payload out of the downloaded archive *and* pak0/pak1(+pak2) out of that root - in the
 *    very place the free-download path copies them out of the demo/point-release extractions, and
 *    therefore still strictly before step 7's first playability revalidation. `copyRetailGameData`
 *    (`retail-source.ts`) is that same call with the engine half omitted; the job needs both halves
 *    in one pass, or `missingRequired` and the assembly diagnostics would each see half a plan.
 *    Story 076 D3: if that pass reports a *required* entry no source dir could satisfy, the job
 *    fails here with `downloads.error.packageIncomplete` naming the package - before the first
 *    revalidation, so the report says which archive came up empty instead of only that the result
 *    is unplayable.
 * 7. **Revalidate** through `InstallationsService.validate()`, and record `playableAtRatio` the
 *    first time that verdict is neither `invalid` nor `missing` (AC6). The *trigger* is the real
 *    inspector verdict; only the ratio value itself is this file's (see `PLAYABLE_AT_RATIO`).
 * 8. **Assemble auxiliary** (`video/*`, `players/*`) when the user asked for it - after the
 *    installation is already playable, which is the whole point of the marker in step 7.
 * 9. **Revalidate again** and finish. The installation's status is never hand-set anywhere in this
 *    file: `create()` and `validate()` are the only two writers of it, and both derive it from
 *    `inspectInstallation`.
 *
 * ## Cancel and failure leave nothing behind - except, since story 077, the library entry
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
 * Story 077 D2 makes the two callers differ for the first time, through one `CleanUpMode`:
 *
 *  - **Cancel** is `{ unregister: !wasAdopted, removeRoot: !targetPreexisted }` (finding fix after
 *    D3 landed). The user said "never mind" about *this run*, so a freshly-created installation and
 *    the folder this job made go away exactly as in 074 - but a retry that adopted a pre-existing
 *    failed installation must not delete a registration that predates this job, or cancelling a
 *    retry would recreate the empty-library problem this story exists to fix. That same adopted
 *    case puts the `lastFailure` D3 cleared on adoption back (second finding fix), so a cancelled
 *    retry returns the installation to exactly the state it had before the user clicked retry.
 *  - **Failure** passes `{ unregister: false, removeRoot: false }`. The user's name, folder and
 *    engine were real decisions and a failed download is no reason to throw them away (077 AC1), so
 *    the registration survives and the target root stays on disk - which is what makes the surviving
 *    installation honestly `invalid` (an empty folder that exists) rather than `missing`. The
 *    assembled files and the extract cache still go: the retry re-downloads from scratch rather than
 *    building on a half-built folder (Decisions (Sprint), Q1).
 *
 * The invariant the old un-registration protected ("no observer sees a `failed` job next to a
 * still-registered half-built installation") is preserved in the only form still available once the
 * registration survives, by `failed()`'s fixed order: delete the files, record the failure, let
 * `InstallationsService.validate()` re-derive the status from the now-empty folder, and only then
 * flip the job to `failed`. By the time anything can look, the installation is registered *and*
 * says it is not playable. (Review considered reversing "record the failure" and "validate" to
 * close the still-narrower window between those two writes, but that order is required elsewhere:
 * `applyInspection`'s engine-preservation guard only preserves a known engine kind for an
 * installation that already carries a `lastFailure`, which for a *first* failure is only true once
 * this write has landed - see the comment at the call site.)
 *
 * ## What a failure leaves behind instead (story 075 D3)
 *
 * Nothing above changes, but the job now *tells* the optional diagnostics collector
 * (`../diagnostics.ts`, entering through `BootstrapDeps.diagnostics`) what it already knows as it
 * goes: per package the URL that actually served it, its size and whether it verified and
 * extracted; and, once the last revalidation has a verdict, the target path with that verdict and
 * its non-passing checks. Every one of those calls is synchronous bookkeeping placed *before* the
 * `failed()`/`cleanUp()` it describes, so what gets deleted and when is exactly what it was - the
 * collector observes this file, it never steers it. A job with no collector records nothing.
 *
 * Story 078 D3 adds the two records that were missing on 2026-09-08, when every package verified
 * and extracted and the target was still not playable: **what assembly looked for and what served
 * it** (`recordAssembly`, after each assemble pass) and **what each extraction actually produced**
 * (a bounded, top-level `readdir` on the success path of the package loop). Both follow the same
 * rule as everything above: bookkeeping placed after the step it describes and before any
 * `failed()`/`cleanUp()`, so the collector still only observes this file. The `readdir` is
 * best-effort and can only ever record less, never fail the job.
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

/**
 * Story 088 D4: the `AssembleSource.packageId` a `store-copy` run's retail root enters assembly
 * under. Not a `ManifestPackage.id` - nothing was downloaded for it - but the field is what the
 * assembly diagnostics attribute a copied file to, so it gets the same pseudo-id
 * `copyRetailGameData` (`retail-source.ts`) already uses for the identical source.
 */
const RETAIL_SOURCE_PACKAGE_ID = 'retail-source'

/** Directories the job may have created inside the target, deepest first - see the cleanup note. */
const PRUNABLE_TARGET_DIRS = [
  join(BASE_GAME_DIR, 'video'),
  join(BASE_GAME_DIR, 'players'),
  BASE_GAME_DIR,
]

/**
 * Story 074 finding fix (Decisions (Sprint): "default (existing) icon assigned automatically").
 * One of the shipped icon ids under `src/renderer/src/assets/installations/`
 * (`installation-icons.ts`'s `SHIPPED_ICONS`) - the Q2PRO logo, the fallback for every
 * bootstrap-supported engine that has no icon of its own. Story 080 D3: R1Q2 gets its own shipped
 * icon instead (`iconIdForEngine` below). Not a new asset (CLAUDE.md's "no image assets" rule):
 * this only references icons that already ship.
 */
const DEFAULT_BOOTSTRAP_ICON_ID = 'q2pro-logo'

/**
 * Story 080 D3 (AC6): which shipped icon a freshly-registered bootstrap installation gets, keyed
 * by the engine the wizard installed - `r1q2-logo` for R1Q2 (already shipped under
 * `src/renderer/src/assets/installations/`, discovered by `installation-icons.ts`'s glob),
 * `DEFAULT_BOOTSTRAP_ICON_ID` for everything else.
 */
function iconIdForEngine(engine: EngineKind): string {
  return engine === 'r1q2' ? 'r1q2-logo' : DEFAULT_BOOTSTRAP_ICON_ID
}

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
  /**
   * Story 077 D3 (AC7): the retry-adoption lookup. Deliberately the *same* comparison
   * `create()`'s duplicate check uses (canonicalize, then compare `pathKey`s), so "would `create()`
   * refuse this path as a duplicate?" and "did this lookup find something?" can never disagree -
   * which is what makes the adoption predicate below a narrowing of that guard rather than a second
   * opinion about what "the same folder" means.
   */
  findByRootPath(rootPath: string): Promise<Installation | undefined>
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
  /**
   * Story 077 D1/D2: records this job's failure on the installation that survives it (AC3).
   * Synchronous, mirroring `InstallationsService.setLastFailure`'s own signature - and the only
   * writer of that field in this file, which is what keeps the record and the `Job.error` the same
   * key.
   */
  setLastFailure(id: string, failure: InstallationLastFailure | null): Outcome<Installation>
}

export interface BootstrapDeps {
  jobs: BootstrapJobsHost
  installations: BootstrapInstallationsHost
  manifest: ManifestSource
  /**
   * Story 088 D4: main's own, freshly computed list of detected retail sources -
   * `listDetectedRetailSources` (`retail-source.ts`) in production, through the same resolution the
   * `bootstrap.retailSources` handler uses (`../index.ts`), so the wizard and the job can never be
   * looking at two different lists.
   *
   * Required, not optional: a `store-copy` run may only ever copy from a source main itself listed
   * *at that moment* (it re-inspects each one), so "the job has no way to check" must be a compile
   * error at the wiring rather than a run that quietly trusts the renderer. Called exactly once per
   * `store-copy` run, before anything is registered; a `free-download` run never calls it at all.
   */
  retailSources: () => Promise<DetectedRetailSource[]>
  fetcher: PackageFetcher
  extractor: Extractor
  /** `app.getPath('userData')`; the download cache and the extract directories are built from it. */
  userDataPath: string
  /** `resolveExtractorPath(...)` (`7za-path.ts`); called per extraction, like the pipeline does. */
  resolveExtractor: () => { path: string; exists: boolean }
  /** Handed to the fetcher; the real client unless overridden. */
  fetchImpl?: FetchImpl
  /**
   * Story 080 D3: R1Q2's own setup/runtime checks (`r1q2-setup.ts`) - the x86 VC++ runtime probe
   * (AC5), the `vid_ref "r1gl"` config seed (AC4) and the license-notice install (AC8). Reached
   * only through this port, never imported directly, so the job can be tested with fakes.
   */
  r1q2Setup: R1q2SetupPort
  /**
   * Story 080 finding fix: `resolveR1q2LicensePath(...)` (`r1q2-setup.ts`), called right before
   * `r1q2Setup.installR1q2Notices` - the same "resolved per call with the real `electron.app`, only
   * from `index.ts`'s wiring" shape as `resolveExtractor` above, and for the same reason: whether
   * the app is packaged and its `resourcesPath` can only be read once `electron` is available, so
   * this cannot be a precomputed value either.
   */
  resolveR1q2LicensePath: () => string
  /**
   * Story 075 D3: makes this job's diagnostics collector once the job id exists (`ports.ts`).
   * Absent means "record nothing" - every failure then behaves exactly as it did before 075.
   */
  diagnostics?: BootstrapDiagnosticsSource
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
 * The packages a bootstrap downloads, in download (and `sources`) order: the engine build first,
 * then - for a `free-download` run - the demo data and the point release. That order is also the
 * order `assembleInstallation` searches for each allowlisted file, so it decides who wins for a file
 * two archives both contain - the engine build for its own payload, the demo for `baseq2/pak0.pak`,
 * and the point release only for what neither of the first two brought.
 *
 * Story 088 D4 (AC4): a `store-copy` run resolves the **engine package only**. Its `baseq2` comes
 * out of a retail installation the user already owns, so resolving (let alone downloading) the demo
 * or the point release would be both pointless and a way for an unrelated manifest gap to fail a run
 * that needs nothing from it.
 */
async function resolvePackages(
  manifest: ManifestSource,
  engine: EngineKind,
  dataSource: BootstrapDataSource,
): Promise<Outcome<BootstrapPackage[]>> {
  const resolved: BootstrapPackage[] = []

  const entries: Array<{
    role: BootstrapSummaryPackage['role']
    pkg: ManifestPackage | undefined
  }> = [{ role: 'engine', pkg: await manifest.resolveEnginePackage(engine) }]

  if (dataSource === 'free-download') {
    entries.push(
      { role: 'demo', pkg: await manifest.resolveGameDataPackage('demo') },
      { role: 'point-release', pkg: await manifest.resolveGameDataPackage('point-release') },
    )
  }

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

/**
 * Story 088 D4: the one comparison "is this the folder main detected?" is ever decided by -
 * `canonicalizePath` + `pathKey` (`lib/fs-utils.ts`), the same pair `InstallationsService`'s
 * duplicate guard and `findByRootPath` use. So junction/symlink spellings, a trailing separator and
 * (on Windows/macOS) case cannot make a detected source look like a different folder, and cannot
 * make an undetected one look like a detected one either.
 */
async function findDetectedSource(
  detected: DetectedRetailSource[],
  copySourcePath: string,
): Promise<DetectedRetailSource | undefined> {
  const wanted = pathKey(await canonicalizePath(copySourcePath))
  for (const entry of detected) {
    if (pathKey(await canonicalizePath(entry.rootPath)) === wanted) return entry
  }
  return undefined
}

/**
 * Story 088 D4: re-resolves the renderer's chosen copy source against main's own, freshly listed
 * detected sources (Decisions (Sprint): "main re-lists the detected sources and re-inspects the path
 * before copying; a path that is not among them - or no longer verifies - fails with a
 * `downloads.error.*` key").
 *
 * Two conditions, both required and neither widened: the path is one main just listed, **and** that
 * entry's fresh `inspection.verified` is true. The list is produced by `listDetectedRetailSources`,
 * which re-runs `inspectRetailSource` per candidate, so "verified" here is a fact about the disk as
 * of this call and not a value the wizard carried over from its own earlier call.
 *
 * Answers the source main listed - callers copy from *that* `rootPath`, not from `copySourcePath`.
 */
async function verifyCopySource(
  deps: { retailSources: () => Promise<DetectedRetailSource[]> },
  copySourcePath: string | undefined,
): Promise<Outcome<DetectedRetailSource>> {
  // A `store-copy` run with no source at all: refused by `startBootstrapInputSchema` before it can
  // ever reach a handler, so this is the in-process caller's equivalent - never a silent fallback
  // to the free download, which would install demo data under a retail run's name.
  if (copySourcePath === undefined || copySourcePath.length === 0) {
    return fail(RETAIL_SOURCE_UNVERIFIED, { reason: 'pathMissing' })
  }

  const detected = await deps.retailSources()
  const match = await findDetectedSource(detected, copySourcePath)
  if (!match) return fail(RETAIL_SOURCE_UNVERIFIED, { reason: 'notDetected' })
  if (!match.inspection.verified) {
    return fail(RETAIL_SOURCE_UNVERIFIED, {
      reason: match.inspection.unverifiedReason ?? 'unverified',
    })
  }
  return ok(match)
}

export interface BuildBootstrapSummaryInput {
  engine: EngineKind
  /** Echoed into the summary; the confirm step shows the path the target step already resolved. */
  targetPath: string
  includeVideoAndPlayers: boolean
  /** Story 088 D4: see `StartBootstrapInput.dataSource` - same default, same meaning. */
  dataSource?: BootstrapDataSource
  /** Story 088 D4: see `StartBootstrapInput.copySourcePath`. */
  copySourcePath?: string
}

/**
 * Story 074 AC4: what the wizard's confirm step states before anything is downloaded - the
 * packages and their summed size. Resolves through the same `ManifestSource` port and the same
 * `resolvePackages` the job itself uses, so the confirm step can never name a different set of
 * packages (or a different total) than the job goes on to fetch.
 *
 * Story 088 D4 (AC5): for a `store-copy` run that is the engine package *alone* - the same thing
 * `resolvePackages` tells the job - plus the copy source it would read from. The store name is
 * looked up in main's own detected-source list rather than taken from the wizard; a path that list
 * no longer holds simply yields no store here, since refusing the run is `startBootstrap`'s job and
 * a summary that failed would leave the confirm step with nothing to explain.
 */
export async function buildBootstrapSummary(
  deps: {
    manifest: ManifestSource
    /** Story 088 D4: as on `BootstrapDeps`, but optional - a caller that only ever summarises
     * free-download runs has no list to consult and needs none. */
    retailSources?: () => Promise<DetectedRetailSource[]>
  },
  input: BuildBootstrapSummaryInput,
): Promise<Outcome<BootstrapSummary>> {
  const dataSource: BootstrapDataSource = input.dataSource ?? 'free-download'

  let copySource: BootstrapSummaryCopySource | undefined
  if (dataSource === 'store-copy') {
    if (input.copySourcePath === undefined || input.copySourcePath.length === 0) {
      return fail(RETAIL_SOURCE_UNVERIFIED, { reason: 'pathMissing' })
    }
    const detected = deps.retailSources ? await deps.retailSources() : []
    const match = await findDetectedSource(detected, input.copySourcePath)
    copySource = {
      // Main's own spelling of the folder when it knows it - the path the job would copy from.
      path: match?.rootPath ?? input.copySourcePath,
      ...(match ? { store: match.source } : {}),
    }
  }

  const resolved = await resolvePackages(deps.manifest, input.engine, dataSource)
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
    dataSource,
    ...(copySource ? { copySource } : {}),
  })
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Story 078 D3 (AC8): what one package's extraction actually produced, at its top level only -
 * names, sorted, capped at `EXTRACTION_LISTING_CAP`. Enough to see that a self-extracting installer
 * nested its payload under an `Install/` wrapper (the 2026-09-08 failure), and it never descends, so
 * it cannot become a file tree in `state.json`.
 *
 * Best-effort in the same sense `removeDir` is: a listing that cannot be produced is *no listing*
 * (`undefined`), never a new way for this job to fail. The extraction it describes has already
 * succeeded at this point, and a bug report missing one line is not a reason to delete a target the
 * user just downloaded 190 MB into.
 */
async function listExtraction(
  dir: string,
  log?: BootstrapLog,
): Promise<{ contents: string[]; contentsTruncated: boolean } | undefined> {
  try {
    const names = (await readdir(dir)).sort()
    return {
      contents: names.slice(0, EXTRACTION_LISTING_CAP),
      contentsTruncated: names.length > EXTRACTION_LISTING_CAP,
    }
  } catch (error) {
    log?.warn(`the extraction at ${dir} could not be listed: ${String(error)}`)
    return undefined
  }
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
 * Story 077 D2: how much of this job to undo. The copied files and the extract cache always go;
 * these two are what a cancel and a failure now disagree about (see the module comment).
 */
interface CleanUpMode {
  /**
   * Remove the library entry this job registered. Cancel: only when this job created the
   * installation rather than adopting a pre-existing one (finding fix). Failure: no (AC1).
   */
  unregister: boolean
  /** `rmdir` the target root itself, once emptied. Only ever true when this job created it. */
  removeRoot: boolean
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
  const dataSource: BootstrapDataSource = input.dataSource ?? 'free-download'

  // 1. The renderer's path, re-judged in main. `computeTargetVerdict` is the same function the
  // wizard's target step rendered, so main and the UI cannot disagree about this folder.
  const verdict = await computeTargetVerdict(input.targetPath)
  if (verdict.blocked) {
    log?.warn(`bootstrap refused ${input.targetPath}: ${verdict.blockedReason ?? 'blocked'}`)
    return fail(TARGET_BLOCKED_KEY, { reason: verdict.blockedReason ?? 'unsafePath' })
  }

  // 1b. Story 088 D4: the wizard's other renderer-supplied path, re-judged the same way - and
  // first, before a package is resolved, an installation is registered or a directory is created,
  // so a refusal leaves the library and the disk exactly as they were. Everything downstream uses
  // `copySource.rootPath` (main's own list entry), never `input.copySourcePath`.
  let copySource: DetectedRetailSource | undefined
  if (dataSource === 'store-copy') {
    const verified = await verifyCopySource(deps, input.copySourcePath)
    if (!verified.ok) {
      const reason = JSON.stringify(verified.error.params)
      log?.warn(`bootstrap refused the copy source ${input.copySourcePath ?? '(none)'}: ${reason}`)
      return verified
    }
    copySource = verified.value
  }

  // 2. Nothing exists yet, so a missing package costs nothing to fail on.
  const resolved = await resolvePackages(deps.manifest, input.engine, dataSource)
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

  /**
   * Story 088 D4 (Decisions (Sprint)): a `store-copy` run installs *retail* data, so
   * `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` ("Q2PRO Demo") would be a lie outliving the badge AC6
   * says the result must not carry. Its default is the engine's own product label (`engineLabel`,
   * `@shared/types/engine` - the same table the rest of the UI names engines from), never a second
   * hardcoded string. A name the user typed still wins, exactly as before.
   */
  const defaultName =
    dataSource === 'store-copy' ? engineLabel(input.engine) : DEFAULT_BOOTSTRAP_INSTALLATION_NAME
  const name = input.name?.trim() || defaultName

  /**
   * Story 077 D3 (AC7). The predicate that decides "this is my own leftover, safe to reuse", and
   * the only thing standing between a retry and `create()`'s duplicate guard - which exists to stop
   * this wizard from writing into an installation the user already owns. It is exactly two
   * conditions, both required, and neither is widened:
   *
   *  1. **the same canonical path**, decided by `findByRootPath` - literally the comparison
   *     `create()` would refuse the path with a moment later, so nothing can be adopted that
   *     `create()` would not have called a duplicate; and
   *  2. **`lastFailure` is set** - a field only this file's `failed()` ever writes (D2), and one the
   *     service clears again the moment any inspection finds the installation playable (D1's
   *     clear-on-playable rule). So a hit here is an installation *this launcher* marked as its own
   *     failed bootstrap and that was not playable as of its last verdict.
   *
   * Everything else - a working installation, one added by hand, one still downloading, one whose
   * failure has since been cleared - falls through to `create()` and keeps today's
   * `installations.error.duplicate` refusal. That asymmetry is the safety: the failure mode of too
   * *narrow* a match is a duplicate error the user can read, the failure mode of too wide a match is
   * silently overwriting someone's working game folder.
   */
  const registered = await deps.installations.findByRootPath(verdict.targetPath)
  const adoptable = registered && registered.lastFailure ? registered : undefined

  // 3. The library entry, with a status `inspectInstallation` produced for the empty skeleton -
  // unless this is a retry, in which case the entry the previous run left behind *is* the entry.
  //
  // Story 077 finding fix: whether *this* job brought the registration into being, threaded into
  // `cancelledOutcome()`'s `unregister` below so a cancelled retry cannot delete an installation
  // that already existed - the `removeRoot: !targetPreexisted` pattern this mirrors.
  let wasAdopted = false
  /**
   * Finding fix (F2): the `lastFailure` the adopted installation carried *before* this retry
   * cleared it. Only a cancel ever reads it - see `cancelledOutcome()`. `undefined` for a run that
   * created its installation, which is exactly the state such a run must be restored to.
   */
  let previousFailure: InstallationLastFailure | undefined
  let installation: Installation
  if (adoptable) {
    wasAdopted = true
    // The wizard's name is the only field adoption changes going in (Decisions (Refine): "Adoption
    // updates the name from the wizard, not the engine" - `UpdateInstallationInput` has no
    // `engineKind` path and the wizard offers Q2PRO only). The id, engine kind, icon and sortOrder
    // are what the user's library already shows, so the rail's position and any assignments survive.
    // Both writes are best-effort in the same sense the write-dir remedy below is: a rename or a
    // clear that fails is not a reason to refuse a retry the user is entitled to.
    let adopted = adoptable
    const renamed = await deps.installations.update({ id: adopted.id, name })
    if (renamed.ok) adopted = renamed.value
    else log?.warn(`bootstrap could not rename the adopted ${adopted.id}: ${renamed.error.key}`)

    // AC4: the previous failure goes as soon as the retry *starts*, not only if it succeeds - the
    // installation is being worked on again, so a red mark on it is already stale. A failure of this
    // run writes a fresh record through `failed()` below, on this same id. Kept in hand first
    // (finding fix F2): a *cancelled* retry has to put it back, or the installation is left
    // registered with no failure record - a state the adoption predicate above refuses, which would
    // dead-end every later retry on this folder at `installations.error.duplicate`.
    previousFailure = adoptable.lastFailure
    const cleared = deps.installations.setLastFailure(adopted.id, null)
    if (cleared.ok) adopted = cleared.value
    else {
      log?.warn(`bootstrap could not clear the failure on ${adopted.id}: ${cleared.error.key}`)
    }

    installation = adopted
    log?.info(`bootstrap adopted the failed installation ${adopted.id} at ${adopted.rootPath}`)
  } else {
    const created = await deps.installations.create({
      rootPath: verdict.targetPath,
      name,
      engineKind: input.engine,
    })
    if (!created.ok) {
      // Carries the installations service's own key (`duplicate`, `alreadyContainsGame`,
      // `createFailed`) - already an i18n key, and more specific than any downloads key would be.
      log?.warn(`bootstrap could not register ${verdict.targetPath}: ${created.error.key}`)
      return created
    }
    installation = created.value

    // Decisions (Sprint): "default (existing) icon assigned automatically". Only for an
    // installation this job registered - an adopted one keeps whatever icon its owner already has.
    const iconResult = deps.installations.setIcon(installation.id, {
      kind: 'shipped',
      id: iconIdForEngine(input.engine),
    })
    if (!iconResult.ok) {
      log?.warn(
        `bootstrap could not set the default icon on ${installation.id}: ${iconResult.error.key}`,
      )
    }
  }
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

  /**
   * Story 075 D3: this job's diagnostics collector - created here because the registry is keyed by
   * the job id, which exists only now, and the job's log teed into it: every line written from
   * this point on still reaches `deps.log` exactly as before *and* lands (redacted) in the
   * diagnostics ring (Decisions (Refine)).
   *
   * Everything above this point ran before the job existed, so there is no record to capture it
   * into and those lines keep using `log` directly. `jobLog` is `undefined` for exactly the same
   * inputs `log` is, so no call site's "log if there is a logger" shape changes.
   */
  const diagnostics = deps.diagnostics?.(jobId, BOOTSTRAP_JOB_KIND)
  const jobLog = diagnostics && log ? diagnostics.tee(log) : log

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
   *
   * Story 077 D2: the two callers no longer want the same thing, so both halves that are *not*
   * "undo this job's own file writes" are passed in rather than assumed. The extracted trees go
   * either way - they are this job's scratch space and are of no use to anyone afterwards.
   */
  const cleanUp = async (mode: CleanUpMode): Promise<void> => {
    await removeAssembled(targetRoot, copied, mode.removeRoot, jobLog)
    if (mode.unregister) {
      const removed = await deps.installations.remove({
        id: installation.id,
        deleteFromDisk: false,
      })
      if (!removed.ok) {
        jobLog?.warn(
          `the half-built installation ${installation.id} could not be dropped: ${removed.error.key}`,
        )
      }
    }
    await removeDir(extractRoot, jobLog)
  }

  /**
   * The job is already `cancelled` in `JobsService` (`cancel()` finishes it); the leftovers are
   * ours. Story 077 D2 (AC2): unchanged from 074 for a freshly-created installation - the user's
   * explicit "never mind" takes the library entry with it, and takes the target root too when this
   * job is the reason it exists.
   *
   * Finding fix: `unregister` now mirrors `removeRoot`'s own "did this job bring it into being?"
   * test rather than firing unconditionally. A cancelled retry that *adopted* a pre-existing failed
   * installation (D3) must not delete a registration that predates this job - that would put the
   * user back at the empty-library problem story 077 exists to fix.
   *
   * Second finding fix (F2): the adopted case also *restores* the `lastFailure` D3 cleared when the
   * retry started. A cancel is the user's own "never mind" about this run, so the installation goes
   * back to exactly the state it was in before they clicked retry - same badge, same sentence -
   * rather than being left registered with no failure on record. That in-between state is the one
   * the adoption predicate above refuses, so leaving it would dead-end every later retry on this
   * folder at `installations.error.duplicate`: the empty-library problem again, one door along. No
   * *new* failure is ever written here - a cancel is not a recorded failure - and a run that created
   * its own installation has no `previousFailure` and is unregistered outright anyway.
   *
   * `validate()` runs after the restore (so a - here impossible - playable verdict would retire the
   * record it just put back, per D1's clear-on-playable rule) and only for the adopted case: the
   * non-adopted branch unregisters the installation outright, so there is nothing left to revalidate.
   */
  const cancelledOutcome = async (): Promise<BootstrapOutcome> => {
    await cleanUp({ unregister: !wasAdopted, removeRoot: !targetPreexisted })
    if (wasAdopted) {
      if (previousFailure) {
        const restored = deps.installations.setLastFailure(installation.id, previousFailure)
        if (!restored.ok) {
          jobLog?.warn(
            `the previous failure of ${installation.id} could not be restored after cancel: ${restored.error.key}`,
          )
        }
      }
      const revalidated = await deps.installations.validate(installation.id)
      if (!revalidated.ok) {
        jobLog?.warn(
          `the adopted installation ${installation.id} could not be revalidated after cancel: ${revalidated.error.key}`,
        )
      }
    }
    jobLog?.info(`bootstrap of ${installation.name} cancelled (job ${jobId})`)
    return { status: 'cancelled' }
  }

  /**
   * `params` (story 076 D3) is the *data* half of a failure - a manifest package id, not prose -
   * and is the only thing besides the key that crosses to the renderer, where `en.json`'s sentence
   * interpolates it. Optional and last, so every existing call site keeps its two-argument shape,
   * and attached only when present so a plain failure's `Job.error` stays exactly `{ key }`.
   */
  const failed = async (
    key: DownloadsErrorKey,
    reason: string,
    params?: Record<string, string | number>,
  ): Promise<BootstrapOutcome> => {
    // The reason is prose and stays in the log: `Job.error` carries an i18n key, and CLAUDE.md's
    // "main sends i18n keys, never prose" rules out shipping it to the renderer. Story 075: the
    // same line is teed into the diagnostics ring, which is developer-facing by design and where
    // the reason is exactly what a bug report needs.
    jobLog?.warn(`bootstrap of ${installation.name} failed with ${key}: ${reason}`)
    // Story 077 D2. The four steps below are one atom, and their order is the acceptance criterion:
    //
    // 1. The files this job wrote go - but not the registration and not the target root (AC1, and
    //    Decisions (Sprint) Q1: an honest empty folder beats a half-built one).
    // 2. The failure is recorded on the surviving installation (AC3) with the *same* key the
    //    `Job.error` below carries, so the library and the Downloads tab can never disagree. This
    //    has to precede step 3, not follow it (review fix): `applyInspection`'s engine-preservation
    //    guard is scoped to "does this installation already carry a `lastFailure`" so it cannot
    //    touch an ordinary, never-failed installation (AC8) - for a first failure that is only true
    //    once this write lands, and step 3 is what reads it.
    // 3. `validate()` re-derives `status`/`checks` from the folder as it now is - nothing in this
    //    file ever writes a status. It cannot see a playable folder here (its files were just
    //    deleted), but if it somehow did, D1's clear-on-playable rule would drop the record it just
    //    wrote, which is the right answer rather than a stale red mark (AC4).
    // 4. Only then does the job flip to `failed`. That is what still guarantees "no observer sees a
    //    `failed` job next to a half-built installation" now that the installation survives. A
    //    renderer subscribed between steps 2 and 3 can observe the failure record next to a
    //    not-yet-revalidated status for one commit; accepted as a narrower window than the one this
    //    ordering closes, and still bounded by step 4 - the *job* never reports `failed` early.
    await cleanUp({ unregister: false, removeRoot: false })
    // Finding fix: the *same* `params` object this exit hands `jobs.finish` below, not a second
    // one computed here - `downloads.error.packageIncomplete`'s sentence reads `{{packageId}}`, and
    // the library card and the Downloads tab render that same sentence. Attached only when present,
    // so a plain failure's record stays exactly `{ errorKey, at, jobId }`.
    //
    // Deliberately *before* `validate()` below, even though that briefly lets a renderer observe
    // the record next to a not-yet-revalidated status: `applyInspection`'s engine-preservation guard
    // (review fix, installations.ts) is scoped to "does this installation already carry a
    // `lastFailure`" so it never touches an installation that isn't a bootstrap failure (AC8) - and
    // for a *first* failure that is only true once this write has landed. Recording first is what
    // lets the very `validate()` call below preserve the wizard's engine choice instead of resetting
    // it to `unknown` when the emptied folder inspects with no detectable engine.
    const recorded = deps.installations.setLastFailure(installation.id, {
      errorKey: key,
      at: Date.now(),
      jobId,
      ...(params ? { params } : {}),
    })
    if (!recorded.ok) {
      jobLog?.warn(`the failure of ${installation.id} could not be recorded: ${recorded.error.key}`)
    }
    // Best-effort like every other step of this cleanup: a revalidation that fails leaves the
    // stored status stale, which is a worse status - not a reason to leave the job running.
    const revalidated = await deps.installations.validate(installation.id)
    if (!revalidated.ok) {
      jobLog?.warn(
        `the failed installation ${installation.id} could not be revalidated: ${revalidated.error.key}`,
      )
    }
    deps.jobs.finish(jobId, { status: 'failed', error: { key, ...(params ? { params } : {}) } })
    return { status: 'failed', key }
  }

  const run = async (): Promise<BootstrapOutcome> => {
    report({ ratio: 0, bytesDone: 0, bytesTotal: totalBytes, filesRemaining: packages.length })

    // 5. Sequentially, one package at a time: simpler to reason about than three concurrent
    // downloads sharing one cancel, one progress bar and one disk, and the wall-clock difference
    // is bounded by the mirror's bandwidth either way.
    //
    // Story 078 D2/D3: each extraction is carried with the id of the package that produced it, so
    // the assembly record can say *which archive* served a file rather than only that some source
    // did. The order is unchanged (engine, demo, point release) and it is still the order
    // `assembleInstallation` searches in, so who wins a file two archives both contain is exactly
    // what it was.
    const sources: AssembleSource[] = []
    let doneBytes = 0

    /**
     * Story 078 D3 (AC7): both assemble passes' entries, concatenated in call order, so the copied
     * report reads as one table. Handed over after each pass rather than once at the end because a
     * run can *fail between them* - `missingRequired` below is the 2026-09-08 failure's own exit,
     * and it is precisely the run whose assembly record has to survive. `recordAssembly` replaces
     * rather than appends (see its doc comment), so the collector ends up with one record either
     * way, and it re-derives each package's `contributed` from it (AC1).
     *
     * Pure bookkeeping over values already in hand: it is never awaited and never sits between a
     * failure and its `cleanUp()`.
     *
     * The auxiliary pass re-plans the fixed allowlist as well as the two glob dirs (that is what
     * `buildAssemblePlan` returns), so a run with the extras on records those entries twice - once
     * per pass, in the order they were tried. Deduplicating would hide which pass saw what, and the
     * cleanup set (`copied`, a `Set`) already handles the repetition where it matters.
     */
    const assembled: AssembleEntryResult[] = []
    const recordAssembly = (entries: AssembleEntryResult[]): void => {
      assembled.push(...entries)
      diagnostics?.recordAssembly(assembled)
    }

    for (const [index, entry] of packages.entries()) {
      if (cancelled) return cancelledOutcome()

      const packageBytes = entry.pkg.sizeBytes
      const filesRemaining = packages.length - index
      const extractDir = getBootstrapExtractDir(deps.userDataPath, jobId, entry.pkg.id)

      /**
       * Story 075 D3 (AC1): what this package contributed. Called at each of this iteration's
       * exits - the fetch failure, the `mkdir` failure, the extraction failure and the success -
       * rather than once at the top or the bottom of the loop, because those exits are the whole
       * point: the 2026-09-08 run got all the way past this loop, and the report still has to name
       * the package that brought nothing. Pure bookkeeping over values already in hand; it is
       * never awaited and never sits between a failure and its `cleanUp()`.
       *
       * Story 078 D3 (AC8): `listing` is what the extraction produced, and is passed only by the
       * one exit that has an extraction to describe - every other exit leaves `contents` absent
       * rather than empty, which is the difference between "it produced nothing" and "it never got
       * that far".
       */
      const recordPackage = (
        url: string,
        sizeBytes: number,
        verified: boolean,
        extracted: boolean,
        listing?: { contents: string[]; contentsTruncated: boolean },
      ): void => {
        diagnostics?.recordPackage({
          id: entry.pkg.id,
          url,
          sizeBytes,
          verified,
          extracted,
          ...(listing
            ? {
                contents: listing.contents,
                ...(listing.contentsTruncated ? { contentsTruncated: true } : {}),
              }
            : {}),
        })
      }

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
        ...(jobLog ? { log: jobLog } : {}),
      })

      if (!fetched.ok) {
        // A cancel is not a failure needing a reason, and the fixed key set has no member for
        // "the user changed their mind" - so it never surfaces `fetched.key`.
        if (fetched.cancelled || cancelled) return cancelledOutcome()
        // The URL last attempted - the mirror, when the fallback got that far - and not the
        // manifest's primary: "where it actually came from" is the useful line in a bug report.
        // The declared size, since nothing verified arrived.
        recordPackage(
          fetched.attempts[fetched.attempts.length - 1]?.url ?? entry.pkg.url,
          entry.pkg.sizeBytes,
          false,
          false,
        )
        return failed(fetched.key, `${entry.pkg.id}: ${fetched.reason}`)
      }

      if (cancelled) return cancelledOutcome()

      // 7za is spawned with `cwd: extractDir`, so the directory has to exist before the spawn.
      try {
        await mkdir(extractDir, { recursive: true })
      } catch (error) {
        recordPackage(fetched.url, fetched.sizeBytes, true, false)
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
        recordPackage(fetched.url, fetched.sizeBytes, true, false)
        return failed(
          asExtractionErrorKey(extracted.error.key),
          `extracting ${entry.pkg.id} failed`,
        )
      }

      // Story 078 D3 (AC8): the only `await` this story adds to the loop, and deliberately on the
      // success path only - the failed-extraction exits above have already returned. It cannot
      // change the job's fate (`listExtraction` never throws) and it cannot move a `cleanUp()`: the
      // next thing that reads `cancelled` is the loop's own top-of-iteration check, exactly as it
      // was for a cancel arriving during the extraction itself.
      const listing = await listExtraction(extractDir, jobLog)

      // Verified by the fetcher and extracted by 7za. Whether it went on to *contribute* anything
      // is `recordAssembly`'s to say, further down - a package can extract perfectly and still
      // leave the installation unplayable, which is the failure this story exists for.
      recordPackage(fetched.url, fetched.sizeBytes, true, true, listing)

      doneBytes += packageBytes
      sources.push({ packageId: entry.pkg.id, dir: extractDir, role: entry.role })
      report({
        ratio: packagesProgress(doneBytes, 0, 0),
        bytesDone: doneBytes,
        bytesTotal: totalBytes,
        filesRemaining: packages.length - index - 1,
      })
    }

    if (cancelled) return cancelledOutcome()

    /**
     * Story 088 D4 (AC4): the verified retail root joins `sources` as one more `AssembleSource`,
     * with the `'retail'` role D3's allowlist block is keyed by - so the core pass below copies
     * pak0/pak1(+pak2) out of it in exactly the place a free-download run copies them out of the
     * demo/point-release extractions, and therefore strictly before the first revalidation. It is
     * *main's* path (`copySource.rootPath`, off the list main itself just produced), never the
     * renderer's string, and it is added after the download loop so nothing about the engine
     * package's own fetch/extract order changes.
     */
    if (copySource) {
      sources.push({
        packageId: RETAIL_SOURCE_PACKAGE_ID,
        dir: copySource.rootPath,
        role: 'retail',
      })
    }

    // 6. Assemble core - the engine payload and the baseq2 paks, allowlisted by 074 D3 and
    // corrected against the real archives by 076 D1. Declared outside the `try` only so its
    // `missingRequired` can be read below; a *thrown* assemble is still the local failure it was.
    let core: AssembleInstallationResult
    try {
      core = await assembleInstallation({
        sources,
        targetRoot,
        engine: input.engine,
        includeVideoAndPlayers: false,
        dataSource,
      })
      for (const file of core.copiedFiles) copied.add(file)
      recordAssembly(core.entries)
    } catch (error) {
      return failed(LOCAL_FAILURE, `assembling ${targetRoot} failed: ${String(error)}`)
    }

    if (cancelled) return cancelledOutcome()
    report({ ratio: ASSEMBLE_CORE_RATIO, bytesDone: totalBytes, bytesTotal: totalBytes })

    /**
     * Story 076 D3 (AC5). A package can download, verify and extract perfectly and still contain
     * none of the paths one of its *required* allowlist entries accepts - the 2026-09-08 failure,
     * where the run got all the way to step 9 and reported only "not playable", naming no archive.
     * Checked here, straight after the pass that knows it and before the first revalidation, so the
     * job fails on the specific thing that went wrong rather than on the verdict it causes.
     *
     * No cancel check of its own: there is no `await` between the one above and this branch, so
     * `cancelled` cannot have changed, and `failed()` runs the same `cleanUp()` every other failure
     * exit here runs - this adds a reason, not a second way out.
     */
    const [firstMissing] = core.missingRequired
    if (firstMissing) {
      // Every missing entry, with the candidate paths that were looked for: `failed()` warns this
      // through the teed log, so it is what story 075's `DownloadDiagnostics.logTail` carries into
      // a bug report - and "which paths were expected" is the half that makes it actionable.
      const reason = core.missingRequired
        .map((missing) => `role ${missing.role} contributed none of ${missing.from.join(' or ')}`)
        .join('; ')

      // Story 088 fix cycle (review F1): a `store-copy` run has no manifest package behind its
      // `'retail'` role - `packages` only ever resolves `engine` (plus `demo`/`point-release` for a
      // `free-download` run, see `resolvePackages`) - so a `'retail'` miss here means the detected
      // source verified at the D4 pre-check and then came up empty during the actual copy (moved or
      // deleted in between). That gets its own key and no `packageId` param, rather than
      // `PACKAGE_INCOMPLETE` falling back to the literal string `'retail'` and claiming a download
      // happened when nothing was fetched.
      if (firstMissing.role === 'retail') {
        return failed(RETAIL_COPY_INCOMPLETE, `copying retail source into ${targetRoot}: ${reason}`)
      }

      // `packages` is the role -> `ManifestPackage.id` mapping this file already holds (Decisions
      // (Sprint): the allowlist entry carries a role, `job.ts` resolves it). Every non-`'retail'`
      // role in `missingRequired` came from an allowlist entry, so it is always one of the resolved
      // packages; the role itself is the fallback rather than shipping `undefined` as a param.
      const packageId =
        packages.find((entry) => entry.role === firstMissing.role)?.pkg.id ?? firstMissing.role
      return failed(PACKAGE_INCOMPLETE, `assembling ${targetRoot}: ${reason}`, { packageId })
    }

    /**
     * Story 080 D3 (AC5). R1Q2's pinned build imports the x86 VC++ runtime and the archive carries
     * none of it - a fresh machine without that redistributable installed can have every file on
     * disk and still be unable to run `r1q2.exe`. Checked here, after the files exist and before
     * the first revalidation (which cannot see this at all - the files are present, so
     * `inspectInstallation` would happily call the folder playable), same pattern as the
     * `missingRequired` check just above: the specific, actionable cause rather than a generic
     * not-playable verdict.
     */
    if (input.engine === 'r1q2') {
      const runtimePresent = await deps.r1q2Setup.probeX86Runtime()
      if (cancelled) return cancelledOutcome()
      if (!runtimePresent) {
        return failed(MISSING_RUNTIME, `${targetRoot}: the x86 VC++ runtime was not found`)
      }

      /**
       * AC4/AC8, right after the runtime check passes: force `vid_ref "r1gl"` on a fresh install
       * (the pinned package ships `ref_r1gl.dll`, not `ref_gl.dll`, so R1Q2's own `gl` default
       * would leave a first launch without a renderer) and install the GPLv3 license text
       * alongside the game files. Both best-effort, like every other piece of bookkeeping in this
       * file (`removeDir`/`listExtraction`): a failure here is not a reason to fail a bootstrap
       * whose game files are already correctly assembled.
       *
       * Tracked in `copied` like every assembled file: a failed run's cleanup (`removeAssembled`)
       * has to be able to empty `baseq2` again, or a stray `autoexec.cfg`/license file left behind
       * would make `computeTargetVerdict` call the folder `alreadyInstalled` on every later retry -
       * the same folder story 077's adoption flow depends on being fully emptied by a failure.
       */
      try {
        await deps.r1q2Setup.seedR1glConfig(targetRoot)
        copied.add(join(BASE_GAME_DIR, 'autoexec.cfg'))
      } catch (error) {
        jobLog?.warn(`could not seed ${targetRoot}'s r1gl config: ${String(error)}`)
      }
      try {
        await deps.r1q2Setup.installR1q2Notices(targetRoot, deps.resolveR1q2LicensePath(), jobLog)
        copied.add('LICENSE-r1q2-GPL-3.0.txt')
      } catch (error) {
        jobLog?.warn(`could not install R1Q2's license notices into ${targetRoot}: ${String(error)}`)
      }
    }

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
          sources,
          targetRoot,
          engine: input.engine,
          includeVideoAndPlayers: true,
          dataSource,
        })
        for (const file of auxiliary.copiedFiles) copied.add(file)
        recordAssembly(auxiliary.entries)
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

    /**
     * Story 075 D3 (AC2): the inspector's last word on the target, recorded *before* the branch
     * that acts on it - so the not-playable failure and the success record the same thing and no
     * later edit to that branch can quietly stop recording it. `severity !== 'ok'` rather than
     * only `'error'`: a warning ("no write access", "missing mission packs") is exactly the kind
     * of detail the person reading the report needs, and the record is size-capped anyway
     * (`capDiagnostics`, `failure-log.ts`). The check's `messageKey` is an i18n key, never prose.
     */
    diagnostics?.recordTarget({
      targetPath: targetRoot,
      verdict: afterAll.value.status,
      missingChecks: afterAll.value.checks
        .filter((check) => check.severity !== 'ok')
        .map((check) => ({ id: check.id, messageKey: check.messageKey })),
    })

    if (afterAll.value.status === 'invalid' || afterAll.value.status === 'missing') {
      // Everything downloaded, verified and copied, and the inspector still says this is not a
      // usable installation. Succeeding here would hand the user a library entry that cannot
      // launch; failing runs the same cleanup every other failure does.
      return failed(NOT_PLAYABLE, `${targetRoot} is still ${afterAll.value.status} after assembly`)
    }

    report({ ratio: 1, bytesDone: totalBytes, bytesTotal: totalBytes, filesRemaining: 0 })
    // The extracted trees have served their purpose; the verified archives stay in the cache.
    await removeDir(extractRoot, jobLog)
    deps.jobs.finish(jobId, { status: 'succeeded' })
    jobLog?.info(`bootstrapped ${installation.name} into ${targetRoot} (job ${jobId})`)
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
