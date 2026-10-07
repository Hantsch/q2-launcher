import { rm } from 'node:fs/promises'
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
  type Outcome,
  type ValidationResult,
} from '@shared/types'
import { inspectInstallation, type InspectOptions } from '../../../services/inspector'
import type { JobContext, JobOutcome, JobRunnerHost, StartedJob } from '../../ports'
import { assembleInstallation, type AssembleFileRole } from '../bootstrap/assemble'
import {
  INSTALLATION_NOT_FOUND,
  LOCAL_FAILURE,
  PACKAGE_INCOMPLETE,
  PACKAGE_UNAVAILABLE,
  REPAIR_NOT_APPLICABLE,
} from '../bootstrap/errors'
import { getBootstrapExtractDir, getBootstrapExtractRoot, toPackageSource } from '../bootstrap/job'
import type { BootstrapLog, Extractor, ManifestSource, PackageFetcher } from '../bootstrap/ports'
import { engineAllowlistFor } from '../engine/update-job'
import type { FetchImpl } from '../../../lib/net/fetcher'
import { stagePackage } from '../../../services/package-staging'
import { buildRepairPlan } from './plan'

/**
 * Story 093: the repair job - "download what this already-registered installation is missing and
 * put exactly that back, without touching anything else".
 *
 * Shaped after `engine/update-job.ts` (a body on the shared `JobRunner`, which owns admission,
 * cancellation, the write guard and the closing revalidation), and after `bootstrap/job.ts` for the download/extract
 * path - which it composes out of the same pieces (`toPackageSource`, `getBootstrapExtractDir`,
 * the `PackageFetcher`/`Extractor` ports, `assembleInstallation`) rather than calling
 * `startBootstrap`: that function registers/adopts installations and drives the wizard's phase
 * model, neither of which a repair of an existing entry has any business doing.
 *
 * ## The verdict this job acts on is its own, never the dialog's
 *
 * `StartRepairInput.offers` is what the *user authorised*, decided against a `RepairPlan` the dialog
 * fetched some seconds or minutes ago. It is not evidence about the disk. So the job re-runs
 * `inspectInstallation` itself, once, at the top of the run, rebuilds the plan from *that* verdict
 * (`buildRepairPlan`- the same pure mapping `repair.plan` uses, so the two can never disagree
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
 * ## The write is narrow by construction, and gated
 *
 * Each repair copies through `assembleInstallation`'s existing allowlist with the `restrictTo`
 * filter - `roles: ['engine']` for `reinstall-engine`, `targets: ['baseq2/pak2.pak']` for
 * `install-point-release` - so "only the engine files" and "only pak2.pak" are properties of the
 * shared allowlist rather than of a filter written here. `includeVideoAndPlayers` is always false: a
 * repair replaces what is missing, it does not add extras nobody asked for.
 *
 * Downloading, verifying and extracting all happen in `userData/cache/downloads/`, outside the
 * installation and outside the guard (story 091). Only the assemble pass runs inside
 * `ctx.write(...)`, which defers it for as long as that installation's own game is running
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
 * flow and `set-write-dir` through the installation card's own remedy - both are the dialog's
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

interface RepairSuccess {
  /** The offers that were actually acted on - the fresh plan's word, not the caller's. */
  performed: RepairOfferKind[]
  installationStatus: InstallationStatus
}

/** What became of one repair run. A one-shot value, never a second status source next to the job. */
export type RepairOutcome = JobOutcome<DownloadsErrorKey, RepairSuccess>

export type StartedRepair = StartedJob<DownloadsErrorKey, RepairSuccess>

/**
 * The `InstallationsService` surface this job uses - `find` and `validate`, deliberately nothing
 * that could write a status or a flag (see the module comment).
 */
export interface RepairInstallationsHost {
  find(id: string): Installation | undefined
  validate(id: string): Promise<Outcome<Installation>>
  /**
   * Story 093 finding fix: the one write this job makes to the installation record before
   * `validate()` - refreshing `Installation.recordedEngineKind` once a `reinstall-engine` repair
   * succeeds, so a future repair still knows the engine after another executable loss. Deliberately
   * not `update()`/a status field: this is the same one-way memory `create()`/`addExisting()` set at
   * registration time, kept accurate, not a verdict.
   */
  setRecordedEngineKind(id: string, engine: EngineKind): Outcome<Installation>
}

export interface RepairDeps {
  runner: JobRunnerHost
  installations: RepairInstallationsHost
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

/** A write-phase step that failed; thrown inside the write so the body can end the job with its reason. */
class CopyRefused extends Error {
  constructor(
    readonly key: DownloadsErrorKey,
    reason: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(reason)
  }
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

  // From here on there is work to cancel, so from here on there is a job.
  return deps.runner.run<DownloadsErrorKey, RepairSuccess>(
    {
      moduleId: 'downloads',
      kind: REPAIR_JOB_KIND,
      labelKey: REPAIR_JOB_LABEL_KEY,
      labelParams: { name: installation.name },
      installationId: installation.id,
      exclusive: 'installation',
    },
    (ctx) => runRepair(ctx, { deps, installation, requested }),
  )
}

/**
 * The run itself: re-inspect, resolve every package the surviving repairs need, download and extract
 * them outside the installation, then - behind the guard - copy them in, and let the inspector have
 * the last word. Split out of `startRepair` so the pre-flight refusals (which can still answer the
 * caller) and the job body (which can only answer the `Job`) read as the two things they are.
 */
async function runRepair(
  ctx: JobContext<DownloadsErrorKey, RepairSuccess>,
  args: { deps: RepairDeps; installation: Installation; requested: JobRepairKind[] },
): Promise<RepairOutcome> {
  const { deps, installation, requested } = args
  const log = deps.log
  const jobId = ctx.jobId

  const extractRoot = getBootstrapExtractRoot(deps.userDataPath, jobId)

  try {
    ctx.report({ ratio: 0, bytesDone: 0, bytesTotal: 0, filesRemaining: requested.length })
    if (ctx.signal.aborted) return ctx.cancelled()

    // 1. The verdict this run acts on, read now, from the disk, exactly once.
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
     * `downloads.error.packageUnavailable` rather than quietly doing nothing.
     */
    const plan = buildRepairPlan(installation.id, verdict, { canSupplyEngine: true })

    const performed = requested.filter((kind) => plan.offers.some((offer) => offer.kind === kind))
    const skipped = requested.filter((kind) => !performed.includes(kind))
    if (skipped.length > 0) {
      log?.info(
        `skipping ${skipped.join(', ')} on ${installation.name}: a fresh inspection no longer offers it`,
      )
    }

    if (ctx.signal.aborted) return ctx.cancelled()

    // 2. Every package, resolved before a single byte is fetched and long before anything is
    // written: a manifest that cannot supply one of the repairs fails the whole run here, with the
    // installation untouched, rather than after the other repair has already been copied in.
    const steps: RepairStep[] = []
    for (const kind of performed) {
      // The *recorded* engine kind, not `verdict.engineKind`: `reinstall-engine` exists precisely
      // for a missing/unusable executable, and for engines whose only markers are their own exe
      // (r1q2, q2pro) a fresh inspection of that installation reports `'unknown'` - the record is
      // what the launcher remembers to ask the manifest for again (see `repair/plan.ts`).
      // `recordedEngineKind` (story 093) is that record; `engineKind` alone is a
      // fallback for installations that predate the field.
      const recordedEngine = installation.recordedEngineKind ?? installation.engineKind
      const resolved = await resolveStep(deps, kind, recordedEngine, jobId)
      if (!resolved.ok) {
        return ctx.fail(
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
    // outside the guard, because reading and downloading are never gated ([[091]]).
    for (const [index, step] of steps.entries()) {
      if (ctx.signal.aborted) return ctx.cancelled()

      // Download, verify, create `step.extractDir` (7za is spawned with `cwd: extractDir`) and
      // extract. The stager publishes the extractor handle with no `await` after its own cancel
      // check, so `onCancel` can always kill a running 7za.
      const staged = await stagePackage({
        source: step.source,
        jobId,
        index,
        extractDir: step.extractDir,
        userDataPath: deps.userDataPath,
        signal: ctx.signal,
        onProgress: (receivedBytes) =>
          ctx.report({
            ratio: ((doneBytes + receivedBytes) / safeTotal) * DOWNLOAD_SHARE,
            bytesDone: doneBytes + receivedBytes,
            bytesTotal,
            filesRemaining: steps.length,
          }),
        onExtractor: ctx.setExtractor,
        resolveExtractor: deps.resolveExtractor,
        download: deps.fetcher.fetch,
        extract: deps.extractor.extract,
        options: {
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          ...(log ? { log } : {}),
        },
      })

      // Before the result, on purpose: a kill that lost the race against 7za's own clean exit must
      // not turn a cancelled job into a succeeded one. A cancel is not a failure needing a reason,
      // and the fixed key set has no member for "the user changed their mind" - so it never
      // surfaces the stager's key.
      if (ctx.signal.aborted) return ctx.cancelled()
      if (!staged.ok) {
        if (staged.cancelled) return ctx.cancelled()
        if (staged.stage === 'download') {
          return ctx.fail(staged.key, `downloading ${step.pkg.id} failed: ${staged.reason}`)
        }
        if (staged.stage === 'prepare') return ctx.fail(staged.key, staged.reason)
        return ctx.fail(
          staged.key,
          `extracting ${step.pkg.id} failed with ${staged.extractorKey ?? staged.key}`,
        )
      }

      doneBytes += step.pkg.sizeBytes
      ctx.report({
        ratio: (doneBytes / safeTotal) * EXTRACT_DONE_RATIO,
        bytesDone: doneBytes,
        bytesTotal,
        filesRemaining: steps.length,
      })
    }

    if (ctx.signal.aborted) return ctx.cancelled()

    /**
     * 4. The only code in this file that writes inside the installation, and therefore the only code
     * the guard wraps. Answers `null` for "keep going" and a `RepairOutcome` for "this run is over" -
     * `runWrite` only takes a `() => Promise<void>`, so its caller below carries the value back out.
     */
    const copyIn = async (): Promise<void> => {
      for (const step of steps) {
        const assembled = await assembleInstallation({
          sources: [{ packageId: step.pkg.id, dir: step.extractDir, role: step.role }],
          targetRoot: installation.rootPath,
          ...(step.engine ? { engine: step.engine } : {}),
          scope: 'core',
          restrictTo: step.restrictTo,
        })

        if (assembled.missingRequired.length > 0) {
          throw new CopyRefused(
            PACKAGE_INCOMPLETE,
            `${step.pkg.id} arrived intact and held none of ${assembled.missingRequired
              .map((entry) => entry.from.join(' | '))
              .join(', ')}`,
            { packageId: step.pkg.id },
          )
        }
        if (assembled.copiedFiles.length === 0) {
          throw new CopyRefused(PACKAGE_INCOMPLETE, `${step.pkg.id} contributed no file at all`, {
            packageId: step.pkg.id,
          })
        }

        log?.info(
          `${step.kind} on ${installation.name} restored ${assembled.copiedFiles.join(', ')} (job ${jobId})`,
        )
      }
    }

    /**
     * A run with nothing left to do still goes through the guard rather than around it: `ctx.write`
     * is also where a cancelled job stops, and "no repair was justified" must not become the one
     * path that ignores a cancel.
     */
    let written: 'done' | 'cancelled'
    try {
      written = await ctx.write(installation.id, copyIn)
    } catch (error) {
      if (error instanceof CopyRefused) return ctx.fail(error.key, error.message, error.params)
      throw error
    }
    if (written === 'cancelled') return ctx.cancelled()

    // 4b. Story 093 finding fix: a successful `reinstall-engine` just confirmed which engine
    // this installation actually is - refresh the one-way memory so a *future* repair (after another
    // executable loss) still knows it, exactly as `create()`/`addExisting()` set it at registration.
    // A distinct, explicit write, not folded into `validate()` below - the rule "status only from
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

    // 5. The status is whatever `inspectInstallation` now makes of the folder. This file never
    // writes one, and `RepairInstallationsHost` gives it no way to.
    const revalidated = await ctx.revalidate(installation.id)
    if (!revalidated.ok) {
      return ctx.fail(
        LOCAL_FAILURE,
        `revalidating ${installation.id} failed: ${revalidated.error.key}`,
      )
    }
    if (revalidated.value.status === 'invalid' || revalidated.value.status === 'missing') {
      // Reported, not failed - see the module comment: a repair fixes what it was asked to fix, and
      // an installation that is still broken for another reason is not this run going wrong.
      log?.warn(
        `${installation.rootPath} is still ${revalidated.value.status} after repairing ${performed.join(', ') || 'nothing'}`,
      )
    }

    ctx.report({ ratio: 1, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })
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
 * launcher has to be able to *enumerate* that engine's files (`engineAllowlistFor`, [[092]]). An
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
