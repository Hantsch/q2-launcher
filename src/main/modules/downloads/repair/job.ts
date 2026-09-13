import { mkdir, rm } from 'node:fs/promises'
import type {
  DownloadsErrorKey,
  ManifestPackage,
  PackageSource,
  RepairOfferKind,
  StartRepairInput,
} from '@shared/modules/downloads'
import {
  fail,
  ok,
  type EngineKind,
  type Installation,
  type InstallationStatus,
  type Job,
  type JobProgress,
  type Outcome,
  type ValidationResult,
} from '@shared/types'
import { inspectInstallation, type InspectOptions } from '../../../services/inspector'
import type { CreateJobInput } from '../../../services/jobs'
import { isWriteCancelled } from '../../../services/write-guard'
import { assembleInstallation, type AssembleFileRole } from '../bootstrap/assemble'
import {
  asExtractionErrorKey,
  INSTALLATION_NOT_FOUND,
  LOCAL_FAILURE,
  PACKAGE_INCOMPLETE,
  PACKAGE_UNAVAILABLE,
  REPAIR_NOT_APPLICABLE,
} from '../bootstrap/errors'
import { getBootstrapExtractDir, getBootstrapExtractRoot, toPackageSource } from '../bootstrap/job'
import type { BootstrapLog, Extractor, ManifestSource, PackageFetcher } from '../bootstrap/ports'
import { engineAllowlistFor } from '../engine/update-job'
import { markVerified, type ExtractorHandle } from '../extractor'
import type { FetchImpl } from '../fetcher'
import { buildRepairPlan } from './plan'

/**
 * Story 093 D4: the repair job - "download what this already-registered installation is missing and
 * put exactly that back, without touching anything else".
 *
 * Shaped after `engine/update-job.ts` and `retail/upgrade-job.ts` (job creation, the
 * `report`/`failed`/`cancelledOutcome` trio, the one-slot `writePhase` array around [[091]]'s guard,
 * the closing `installations.validate()`), and after `bootstrap/job.ts` for the download/extract
 * path - which it composes out of the same pieces (`toPackageSource`, `getBootstrapExtractDir`,
 * the `PackageFetcher`/`Extractor` ports, `assembleInstallation`) rather than calling
 * `startBootstrap`: that function registers/adopts installations and drives the wizard's phase
 * model, neither of which a repair of an existing entry has any business doing.
 *
 * ## The verdict this job acts on is its own, never the dialog's (AC1)
 *
 * `StartRepairInput.offers` is what the *user authorised*, decided against a `RepairPlan` the dialog
 * fetched some seconds or minutes ago. It is not evidence about the disk. So the job re-runs
 * `inspectInstallation` itself, once, at the top of the run, rebuilds the plan from *that* verdict
 * (`buildRepairPlan`, D2 - the same pure mapping `repair.plan` uses, so the two can never disagree
 * about what a finding means), and acts on the intersection:
 *
 *  - an authorised offer the fresh plan no longer carries is **skipped** - the finding is gone, and
 *    overwriting binaries to fix a problem that no longer exists is exactly the corruption this
 *    story's risk note is about;
 *  - an offer that has appeared *since* the dialog looked is **honoured**, as long as it is one of
 *    the repairs the user authorised - the job never widens its own mandate beyond `input.offers`,
 *    which is what keeps "the user said yes to this" and "this is currently justified" as two
 *    separate conditions that both have to hold.
 *
 * A run whose intersection is empty is a success with nothing done, not a failure: the installation
 * turned out to be fine, and it still ends through `validate()` so the library shows that.
 *
 * The one window this leaves open is between the inspection and the write when the guard defers the
 * write behind a running game. It is deliberately not closed by a second inspection: the packages
 * are already fetched by then, and re-deciding the plan *inside* the write lock would make what the
 * job does depend on how long the user played, which is harder to reason about than the narrow risk
 * it removes (the game itself cannot supply a missing engine binary or `pak2.pak`).
 *
 * ## The write is narrow by construction (AC2), and gated (AC7)
 *
 * Each repair copies through `assembleInstallation`'s existing allowlist with D3's `restrictTo`
 * filter - `roles: ['engine']` for `reinstall-engine`, `targets: ['baseq2/pak2.pak']` for
 * `install-point-release` - so "only the engine files" and "only pak2.pak" are properties of the
 * shared allowlist rather than of a filter written here. `includeVideoAndPlayers` is always false: a
 * repair replaces what is missing, it does not add extras nobody asked for.
 *
 * Downloading, verifying and extracting all happen in `userData/cache/downloads/`, outside the
 * installation and outside the guard (091's AC4). Only the assemble pass runs inside
 * `writeGuard.runWrite(...)`, which defers it for as long as that installation's own game is running
 * and resumes it when the game exits. This job implements no refusal, no polling and no backoff of
 * its own - `InstallationWriteGuard` owns all three.
 *
 * ## Nothing here writes a status
 *
 * `RepairInstallationsHost` exposes `find` and `validate`, and nothing else, for the same reason
 * `RetailUpgradeInstallationsHost` does: "the status is re-derived by the inspector, never hand-set"
 * is then checkable by reading the type instead of the whole flow.
 *
 * Unlike the retail upgrade, a run that ends with the installation still `invalid` is **not** turned
 * into a failure. A repair is by design a partial fix - the dialog can offer one of several
 * findings, and `retail-copy`/`set-write-dir` are handled elsewhere entirely - so an installation
 * that is still unplayable for a reason this job was never asked to fix is not this job failing. The
 * resulting status is reported (and logged), never rewritten.
 */

/** `Job.kind` for this job - the discriminator the Downloads tab keys on. */
export const REPAIR_JOB_KIND = 'repair'

/** i18n key for the job's label; `{{name}}` is the installation being repaired. */
export const REPAIR_JOB_LABEL_KEY = 'downloads.job.repair'

/**
 * The offer kinds *this job* performs. `retail-copy` runs through [[090]]'s existing retail-upgrade
 * flow and `set-write-dir` through the installation card's own remedy - both are the dialog's (D5)
 * to route, and neither downloads anything, which is the whole of what this job is.
 */
export const REPAIRS_BY_JOB = [
  'reinstall-engine',
  'install-point-release',
] as const satisfies readonly RepairOfferKind[]

/** The two `RepairOfferKind`s above, as a type - what every "which repair" slot in this file takes. */
export type JobRepairKind = (typeof REPAIRS_BY_JOB)[number]

/** The manifest role each repair's package comes from, and how narrowly it may copy. */
const REPAIR_SPECS: Record<
  JobRepairKind,
  { role: AssembleFileRole; restrictTo: { roles?: AssembleFileRole[]; targets?: string[] } }
> = {
  'reinstall-engine': { role: 'engine', restrictTo: { roles: ['engine'] } },
  'install-point-release': {
    role: 'point-release',
    restrictTo: { targets: ['baseq2/pak2.pak'] },
  },
}

/** Share of the progress ratio the downloads own; extraction and the write share the rest. */
const DOWNLOAD_SHARE = 0.8

/** Reached once every package is extracted and only the write into the installation is left. */
const EXTRACT_DONE_RATIO = 0.9

/** What became of one repair run. A one-shot value, never a second status source next to the job. */
export type RepairOutcome =
  | {
      status: 'succeeded'
      /** The offers that were actually acted on - the fresh plan's word, not the caller's. */
      performed: RepairOfferKind[]
      installationStatus: InstallationStatus
    }
  | { status: 'failed'; key: DownloadsErrorKey }
  | { status: 'cancelled' }

export interface StartedRepair {
  /** The `Job.id` - what `jobs:cancel` takes, and what the UI renders. */
  jobId: string
  /** Resolves once the job has reached a terminal state. Never rejects. */
  settled: Promise<RepairOutcome>
}

/** The `JobsService` surface this job uses. `JobsService` satisfies it structurally. */
export interface RepairJobsHost {
  create(input: CreateJobInput): Job
  progress(id: string, progress: JobProgress): void
  finish(
    id: string,
    outcome: { status: 'succeeded' | 'failed' | 'cancelled'; error?: Job['error'] },
  ): void
}

/**
 * The `InstallationsService` surface this job uses - `find` and `validate`, deliberately nothing
 * that could write a status or a flag (see the module comment).
 */
export interface RepairInstallationsHost {
  find(id: string): Installation | undefined
  validate(id: string): Promise<Outcome<Installation>>
  /**
   * Story 093 finding fix (AC1): the one write this job makes to the installation record before
   * `validate()` - refreshing `Installation.recordedEngineKind` once a `reinstall-engine` repair
   * succeeds, so a future repair still knows the engine after another executable loss. Deliberately
   * not `update()`/a status field: this is the same one-way memory `create()`/`addExisting()` set at
   * registration time, kept accurate, not a verdict.
   */
  setRecordedEngineKind(id: string, engine: EngineKind): Outcome<Installation>
}

/**
 * The `InstallationWriteGuard` surface this job uses ([[091]]) - `runWrite` only, mirroring
 * `RetailUpgradeWriteGuardHost`/`EngineUpdateWriteGuardHost`. `InstallationWriteGuard` satisfies it
 * structurally, so this job cannot reach past the one seam into `isBlockedFor`/`isWriting` and
 * decide for itself whether to wait.
 */
export interface RepairWriteGuardHost {
  runWrite(
    installationId: string,
    jobId: string,
    signal: AbortSignal,
    fn: () => Promise<void>,
  ): Promise<void>
}

export interface RepairDeps {
  jobs: RepairJobsHost
  installations: RepairInstallationsHost
  /**
   * [[091]]'s write guard. Required, never optional, for the same reason `RetailUpgradeDeps.
   * writeGuard` is: a wiring that forgot it would overwrite the binaries of a running game, so its
   * absence has to be a compile error rather than an ungated run.
   */
  writeGuard: RepairWriteGuardHost
  /** The manifest, through `bootstrap/ports.ts`'s existing port (INST-M1: no URLs in launcher code). */
  manifest: ManifestSource
  fetcher: PackageFetcher
  extractor: Extractor
  /** `app.getPath('userData')`; the download cache and the extract directories are built from it. */
  userDataPath: string
  /** `resolveExtractorPath(...)` (`7za-path.ts`), called per extraction like the pipeline does. */
  resolveExtractor: () => { path: string; exists: boolean }
  /**
   * The fresh inspection this job's whole plan is derived from - `inspectInstallation` unless a test
   * substitutes one. Optional where `writeGuard` above is required, and the difference is the one
   * `BootstrapDeps` already draws: the default below *is* the production implementation, so there is
   * no wiring in which the verdict goes unread.
   */
  inspect?: (rootPath: string, options: InspectOptions) => Promise<ValidationResult>
  /** Handed to the fetcher; the real Electron client unless overridden. */
  fetchImpl?: FetchImpl
  log?: BootstrapLog
}

/** One repair, fully resolved: which package supplies it, and where its archive is extracted to. */
interface RepairStep {
  kind: JobRepairKind
  pkg: ManifestPackage
  source: PackageSource
  extractDir: string
  /** The `AssembleSource.role` the extraction is offered under - `findSource` matches on it. */
  role: AssembleFileRole
  restrictTo: { roles?: AssembleFileRole[]; targets?: string[] }
  /** Set for `reinstall-engine`: the engine whose allowlist block the plan is built from. */
  engine?: EngineKind
}

/**
 * Starts the repair and answers as soon as the job exists (or as soon as a pre-flight check has
 * refused it) - it never waits for the download, mirroring `startEngineUpdate`/`startRetailUpgrade`.
 *
 * Only two things are decided before the job exists, and both are questions about the *request*
 * rather than about the disk: does the installation still exist, and does the request name a repair
 * this job performs at all. Everything that depends on what is currently on disk happens inside the
 * job, where the user can see it - see the module comment.
 */
export async function startRepair(
  deps: RepairDeps,
  input: StartRepairInput,
): Promise<Outcome<StartedRepair>> {
  const log = deps.log

  const installation = deps.installations.find(input.installationId)
  if (!installation) return fail(INSTALLATION_NOT_FOUND)

  const requested = REPAIRS_BY_JOB.filter((kind) => input.offers.includes(kind))
  if (requested.length === 0) {
    log?.warn(
      `refusing to repair ${installation.name}: none of ${JSON.stringify(input.offers)} is a repair this job performs`,
    )
    return fail(REPAIR_NOT_APPLICABLE)
  }

  // From here on there is work to cancel, so from here on there is a job. One `AbortController` is
  // the whole of this job's cancellation ([[091]] D4): its signal is what the checkpoints read and
  // what `writeGuard.runWrite` waits on, so a cancel while the write is still deferred and a cancel
  // mid-download are the same event, seen by the same object.
  const cancellation = new AbortController()
  let extractor: ExtractorHandle | undefined
  const job = deps.jobs.create({
    moduleId: 'downloads',
    kind: REPAIR_JOB_KIND,
    labelKey: REPAIR_JOB_LABEL_KEY,
    labelParams: { name: installation.name },
    installationId: installation.id,
    cancellable: true,
    onCancel: () => {
      cancellation.abort()
      extractor?.kill()
    },
  })

  const settled = (async (): Promise<RepairOutcome> => {
    try {
      return await runRepair({
        deps,
        job,
        installation,
        requested,
        signal: cancellation.signal,
        setExtractor: (handle) => {
          extractor = handle
        },
      })
    } catch (error) {
      // Nothing in `runRepair` is expected to throw; if something does, the job must still end - an
      // unfinished job would sit in the Downloads tab forever.
      log?.warn(`the repair of ${installation.name} threw: ${String(error)}`)
      deps.jobs.finish(job.id, { status: 'failed', error: { key: LOCAL_FAILURE } })
      return { status: 'failed', key: LOCAL_FAILURE }
    }
  })()

  return ok({ jobId: job.id, settled })
}

/**
 * The run itself: re-inspect, resolve every package the surviving repairs need, download and extract
 * them outside the installation, then - behind the guard - copy them in, and let the inspector have
 * the last word. Split out of `startRepair` so the pre-flight refusals (which can still answer the
 * caller) and the job body (which can only answer the `Job`) read as the two things they are.
 */
async function runRepair(args: {
  deps: RepairDeps
  job: Job
  installation: Installation
  requested: JobRepairKind[]
  signal: AbortSignal
  setExtractor: (handle: ExtractorHandle) => void
}): Promise<RepairOutcome> {
  const { deps, job, installation, requested, signal, setExtractor } = args
  const log = deps.log
  const jobId = job.id

  /** The single reading of "was this job cancelled", for every checkpoint below. */
  const isCancelled = (): boolean => signal.aborted

  /** Silent once cancelled: `JobsService.progress()` unconditionally sets `status: 'running'`. */
  const report = (progress: JobProgress): void => {
    if (isCancelled()) return
    deps.jobs.progress(jobId, progress)
  }

  /** The one failing exit: log the (prose) reason, end the job with the i18n key. */
  const failed = (
    key: DownloadsErrorKey,
    reason: string,
    params?: Record<string, string | number>,
  ): RepairOutcome => {
    log?.warn(`the repair of ${installation.name} failed with ${key}: ${reason}`)
    deps.jobs.finish(jobId, { status: 'failed', error: { key, ...(params ? { params } : {}) } })
    return { status: 'failed', key }
  }

  /** `jobs.cancel()` has already finished the job as cancelled; nothing more to report. */
  const cancelledOutcome = (): RepairOutcome => {
    log?.info(`the repair of ${installation.name} was cancelled (job ${jobId})`)
    return { status: 'cancelled' }
  }

  const extractRoot = getBootstrapExtractRoot(deps.userDataPath, jobId)

  try {
    report({ ratio: 0, bytesDone: 0, bytesTotal: 0, filesRemaining: requested.length })
    if (isCancelled()) return cancelledOutcome()

    // 1. AC1: the verdict this run acts on, read now, from the disk, exactly once.
    const inspect = deps.inspect ?? inspectInstallation
    const verdict = await inspect(installation.rootPath, {
      ...(installation.executablePath ? { executablePath: installation.executablePath } : {}),
      ...(installation.writeDirPath ? { writeDirPath: installation.writeDirPath } : {}),
    })

    /**
     * `canSupplyEngine: true`, deliberately, where `repair.plan`'s handler passes the manifest's
     * real answer. That flag exists so a *dialog* never offers a fix nobody can carry out; here it
     * would turn "the manifest is missing the engine build" into "this repair was not justified,
     * skip it", i.e. into a run that reports success while the engine is still missing. This plan
     * answers only "which findings are repairable in principle"; whether the package for one of them
     * is actually obtainable is `resolveStep`'s to decide, and it fails the job with
     * `downloads.error.packageUnavailable` (AC8) rather than quietly doing nothing.
     */
    const plan = buildRepairPlan(installation.id, verdict, { canSupplyEngine: true })

    const performed = requested.filter((kind) => plan.offers.some((offer) => offer.kind === kind))
    const skipped = requested.filter((kind) => !performed.includes(kind))
    if (skipped.length > 0) {
      log?.info(
        `skipping ${skipped.join(', ')} on ${installation.name}: a fresh inspection no longer offers it`,
      )
    }

    if (isCancelled()) return cancelledOutcome()

    // 2. Every package, resolved before a single byte is fetched and long before anything is
    // written: a manifest that cannot supply one of the repairs fails the whole run here, with the
    // installation untouched (AC8), rather than after the other repair has already been copied in.
    const steps: RepairStep[] = []
    for (const kind of performed) {
      // The *recorded* engine kind, not `verdict.engineKind`: `reinstall-engine` exists precisely
      // for a missing/unusable executable, and for engines whose only markers are their own exe
      // (r1q2, q2pro) a fresh inspection of that installation reports `'unknown'` - the record is
      // what the launcher remembers to ask the manifest for again (see `repair/plan.ts`).
      // `recordedEngineKind` (story 093 finding fix, AC1) is that record; `engineKind` alone is a
      // fallback for installations that predate the field.
      const recordedEngine = installation.recordedEngineKind ?? installation.engineKind
      const resolved = await resolveStep(deps, kind, recordedEngine, jobId)
      if (!resolved.ok) {
        return failed(
          PACKAGE_UNAVAILABLE,
          `no usable package for ${kind} on ${installation.name}: ${resolved.error.key}`,
          { role: kind },
        )
      }
      steps.push(resolved.value)
    }

    const bytesTotal = steps.reduce((total, step) => total + step.pkg.sizeBytes, 0)
    const safeTotal = Math.max(1, bytesTotal)
    let doneBytes = 0

    // 3. Download and extract, into `userData/cache/downloads/` - outside the installation and
    // outside the guard, because reading and downloading are never gated ([[091]] AC4).
    for (const step of steps) {
      if (isCancelled()) return cancelledOutcome()

      const fetched = await deps.fetcher.fetch(step.source, {
        userDataPath: deps.userDataPath,
        signal,
        onProgress: ({ receivedBytes }) =>
          report({
            ratio: ((doneBytes + receivedBytes) / safeTotal) * DOWNLOAD_SHARE,
            bytesDone: doneBytes + receivedBytes,
            bytesTotal,
            filesRemaining: steps.length,
          }),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(log ? { log } : {}),
      })
      if (!fetched.ok) {
        // A cancel is not a failure needing a reason, and the fixed key set has no member for "the
        // user changed their mind" - so it never surfaces `fetched.key`.
        if (fetched.cancelled || isCancelled()) return cancelledOutcome()
        return failed(fetched.key, `downloading ${step.pkg.id} failed: ${fetched.reason}`)
      }

      if (isCancelled()) return cancelledOutcome()

      // 7za is spawned with `cwd: extractDir`, so the directory has to exist before the spawn.
      try {
        await mkdir(step.extractDir, { recursive: true })
      } catch (error) {
        return failed(LOCAL_FAILURE, `mkdir ${step.extractDir} failed: ${String(error)}`)
      }

      if (isCancelled()) return cancelledOutcome()

      const extractorPath = deps.resolveExtractor()
      // No `await` between the check above and the assignment below, so a cancel can never land in
      // a gap where the extractor runs but `onCancel` cannot see it yet.
      const handle = deps.extractor.extract({
        archive: markVerified(fetched.path),
        extractDir: step.extractDir,
        extractorPath: extractorPath.path,
        extractorExists: extractorPath.exists,
      })
      setExtractor(handle)
      const extracted = await handle.result

      // Before `extracted.ok`, on purpose: a kill that lost the race against 7za's own clean exit
      // must not turn a cancelled job into a succeeded one.
      if (isCancelled()) return cancelledOutcome()
      if (!extracted.ok) {
        return failed(
          asExtractionErrorKey(extracted.error.key),
          `extracting ${step.pkg.id} failed with ${extracted.error.key}`,
        )
      }

      doneBytes += step.pkg.sizeBytes
      report({
        ratio: (doneBytes / safeTotal) * EXTRACT_DONE_RATIO,
        bytesDone: doneBytes,
        bytesTotal,
        filesRemaining: steps.length,
      })
    }

    if (isCancelled()) return cancelledOutcome()

    /**
     * 4. The only code in this file that writes inside the installation, and therefore the only code
     * the guard wraps. Answers `null` for "keep going" and a `RepairOutcome` for "this run is over" -
     * `runWrite` only takes a `() => Promise<void>`, so its caller below carries the value back out.
     */
    const copyIn = async (): Promise<RepairOutcome | null> => {
      for (const step of steps) {
        const assembled = await assembleInstallation({
          sources: [{ packageId: step.pkg.id, dir: step.extractDir, role: step.role }],
          targetRoot: installation.rootPath,
          ...(step.engine ? { engine: step.engine } : {}),
          includeVideoAndPlayers: false,
          restrictTo: step.restrictTo,
        })

        if (assembled.missingRequired.length > 0) {
          return failed(
            PACKAGE_INCOMPLETE,
            `${step.pkg.id} arrived intact and held none of ${assembled.missingRequired
              .map((entry) => entry.from.join(' | '))
              .join(', ')}`,
            { packageId: step.pkg.id },
          )
        }
        if (assembled.copiedFiles.length === 0) {
          return failed(PACKAGE_INCOMPLETE, `${step.pkg.id} contributed no file at all`, {
            packageId: step.pkg.id,
          })
        }

        log?.info(
          `${step.kind} on ${installation.name} restored ${assembled.copiedFiles.join(', ')} (job ${jobId})`,
        )
      }
      return null
    }

    /**
     * [[091]] D4: the write phase, and only the write phase, runs with the installation's write lock
     * held - deferred for as long as that installation's own game is running, resumed by the guard
     * when it exits (AC7). A one-slot list rather than a `let`, because `runWrite` answers `void` and
     * TypeScript's flow analysis does not follow an assignment made inside the callback.
     *
     * A run with nothing left to do still goes through the guard rather than around it: `runWrite`
     * is also where a cancelled job stops, and "no repair was justified" must not become the one
     * path that ignores a cancel.
     */
    const writePhase: RepairOutcome[] = []
    try {
      await deps.writeGuard.runWrite(installation.id, jobId, signal, async () => {
        const outcome = await copyIn()
        if (outcome) writePhase.push(outcome)
      })
    } catch (error) {
      // `runWrite` rejects when the job was cancelled while its write was still deferred - the same
      // cancellation the checkpoints above answer, so it takes the same exit through the same
      // `finally`. Anything else is a real failure and keeps travelling to `startRepair`'s catch.
      if (isWriteCancelled(error) || isCancelled()) return cancelledOutcome()
      throw error
    }
    if (writePhase.length > 0) return writePhase[0]

    // 4b. Story 093 finding fix (AC1): a successful `reinstall-engine` just confirmed which engine
    // this installation actually is - refresh the one-way memory so a *future* repair (after another
    // executable loss) still knows it, exactly as `create()`/`addExisting()` set it at registration.
    // A distinct, explicit write, not folded into `validate()` below - AC9's "status only from
    // `validate()`" stays true; this never touches `status`.
    const reinstalledEngine = steps.find((step) => step.kind === 'reinstall-engine')?.engine
    if (reinstalledEngine) {
      const recorded = deps.installations.setRecordedEngineKind(installation.id, reinstalledEngine)
      if (!recorded.ok) {
        log?.warn(
          `could not update the recorded engine of ${installation.name} to ${reinstalledEngine}: ${recorded.error.key}`,
        )
      }
    }

    // 5. AC9: the status is whatever `inspectInstallation` now makes of the folder. This file never
    // writes one, and `RepairInstallationsHost` gives it no way to.
    const revalidated = await deps.installations.validate(installation.id)
    if (!revalidated.ok) {
      return failed(LOCAL_FAILURE, `revalidating ${installation.id} failed: ${revalidated.error.key}`)
    }
    if (revalidated.value.status === 'invalid' || revalidated.value.status === 'missing') {
      // Reported, not failed - see the module comment: a repair fixes what it was asked to fix, and
      // an installation that is still broken for another reason is not this run going wrong.
      log?.warn(
        `${installation.rootPath} is still ${revalidated.value.status} after repairing ${performed.join(', ') || 'nothing'}`,
      )
    }

    report({ ratio: 1, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })
    deps.jobs.finish(jobId, { status: 'succeeded' })
    log?.info(
      `repaired ${installation.name}: ${performed.join(', ') || 'nothing left to do'} (job ${jobId})`,
    )
    return {
      status: 'succeeded',
      performed,
      installationStatus: revalidated.value.status,
    }
  } finally {
    // Best-effort, on every exit: the extracted trees have either been copied into the installation
    // or abandoned, and are of no use to anyone either way. The verified archives stay in the cache.
    try {
      await rm(extractRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error) {
      log?.warn(`could not remove the extract directory ${extractRoot}: ${String(error)}`)
    }
  }
}

/**
 * One repair's package, its download source and its extraction directory - or a failure, which the
 * caller turns into `downloads.error.packageUnavailable` whatever its reason: to the user, a
 * manifest that does not list the package, one that lists it with an unusable URL, and one whose
 * package id would not make a safe path segment are the same problem with the same remedy.
 *
 * The `reinstall-engine` case adds one condition of its own, before the manifest is even asked: this
 * launcher has to be able to *enumerate* that engine's files (`engineAllowlistFor`, [[092]] D5). An
 * engine the manifest can supply but `buildAssemblePlan` refuses is one whose files must not be
 * replaced by guesswork.
 */
async function resolveStep(
  deps: RepairDeps,
  kind: JobRepairKind,
  engine: EngineKind,
  jobId: string,
): Promise<Outcome<RepairStep>> {
  const spec = REPAIR_SPECS[kind]

  let pkg: ManifestPackage | undefined
  if (kind === 'reinstall-engine') {
    if (engineAllowlistFor(engine).length === 0) {
      return fail(PACKAGE_UNAVAILABLE, { reason: `no engine file allowlist for ${engine}` })
    }
    pkg = await deps.manifest.resolveEnginePackage(engine)
  } else {
    pkg = await deps.manifest.resolveGameDataPackage('point-release')
  }
  if (pkg === undefined) return fail(PACKAGE_UNAVAILABLE, { reason: 'not listed' })

  const source = toPackageSource(pkg)
  if (source === undefined) return fail(PACKAGE_UNAVAILABLE, { reason: 'unusable url' })

  // Also the package id's safety check: `getBootstrapExtractDir` refuses anything that is not a
  // single safe path segment, and refusing here means it happens before anything is created.
  let extractDir: string
  try {
    extractDir = getBootstrapExtractDir(deps.userDataPath, jobId, pkg.id)
  } catch {
    return fail(PACKAGE_UNAVAILABLE, { reason: 'unusable package id' })
  }

  return ok({
    kind,
    pkg,
    source,
    extractDir,
    role: spec.role,
    restrictTo: spec.restrictTo,
    ...(kind === 'reinstall-engine' ? { engine } : {}),
  })
}
