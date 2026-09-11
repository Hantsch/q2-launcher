import { app as electronApp } from 'electron'
import {
  BOOTSTRAP_SUPPORTED_ENGINES,
  DOWNLOADS_HANDLERS,
  type ArchiveCacheStatus,
  type BootstrapEngineOption,
  type BootstrapSummary,
  type BootstrapTargetVerdict,
  type ClearArchiveCacheResult,
  type DetectedRetailSource,
  type DownloadFailure,
  type DownloadsSettings,
  type GameDataSourceVerdict,
  type ManifestSnapshot,
  type PackageSource,
  type StartRetailUpgradeResult,
} from '@shared/modules/downloads'
import { fail, isJobActive, ok, type Job, type Outcome } from '@shared/types'
import type { Logger } from '../../lib/logger'
import { userDataDir } from '../../lib/paths'
import type { AppContext } from '../../context'
import type { MainModule } from '../types'
import { resolveExtractorPath } from './7za-path'
import {
  buildBootstrapSummary,
  startBootstrap,
  type BootstrapDeps,
} from './bootstrap/job'
import { inspectGameDataSource } from './bootstrap/game-data-source'
import {
  manifestSourceFrom,
  realExtractor,
  realPackageFetcher,
  realR1q2Setup,
} from './bootstrap/ports'
import { resolveR1q2LicensePath } from './bootstrap/r1q2-setup'
import { computeTargetVerdict } from './bootstrap/target'
import { clear, enforceBudget, NOTHING_IN_USE, status } from './cache'
import {
  createDiagnosticsCollector,
  diagnosticsFor,
  dropDiagnostics,
  UNKNOWN_DOWNLOAD_FAILURE_KEY,
} from './diagnostics'
import { appendFailure, dismissFailure, restoreFailure } from './failure-log'
import { PRODUCTION_DOWNLOAD_SOURCE, resolveDownloadSource } from './harness'
import { ManifestService, ManifestUnavailableError } from './manifest-service'
import {
  createDownloadPipeline,
  type DownloadPipeline,
  type PipelineLog,
  type StartedDownload,
} from './pipeline'
import { detectedRetailSourcesFor } from './retail/sources'
import { startRetailUpgrade, type RetailUpgradeDeps } from './retail/upgrade-job'
import {
  bootstrapEngineOptionsInputSchema,
  bootstrapGameDataSourceInputSchema,
  bootstrapRetailSourcesInputSchema,
  bootstrapSummaryInputSchema,
  bootstrapTargetVerdictInputSchema,
  dismissFailureInputSchema,
  downloadsNoInputSchema,
  manifestGetInputSchema,
  patchDownloadsSettingsInputSchema,
  restoreFailureInputSchema,
  startBootstrapInputSchema,
  startRetailUpgradeInputSchema,
} from './schemas'

/** `DownloadsSettings.archiveCacheBudgetGB` is denominated in GB; `cache.ts` wants bytes. One
 * place to do that conversion, so it cannot happen differently in two call sites. */
const BYTES_PER_GB = 1024 * 1024 * 1024

/**
 * The downloads module - story 070 D4.
 *
 * Mirrors `../config/index.ts`'s shape: a `MainModule` whose `setup` registers handlers on the
 * shell's `module:invoke` channel and does nothing else. The one handler this deliverable adds,
 * `manifest.get`, is a thin IPC wrapper around `ManifestService` (D3) - it owns no manifest logic
 * of its own, only the request/response translation:
 *
 *  - success hands the renderer the `ManifestSnapshot` as-is;
 *  - `ManifestUnavailableError` (nothing fetchable and nothing cached) becomes the i18n key
 *    `downloads.error.manifestUnavailable` - never the thrown error's own prose message, per
 *    CLAUDE.md's "main sends i18n keys, never prose, across IPC" rule.
 *
 * `MODULE_MANIFESTS`' `downloads` entry (`@shared/types/module.ts`) deliberately stays
 * `status: 'planned'` even though this file registers a working main half: the renderer side
 * (wizard/Downloads tab UI) is a later story, and `MainModuleRegistry.manifests()` already
 * reports a module's status as `'planned'` unless its main half AND the manifest both say
 * otherwise - this file registering a handler does not by itself flip that.
 *
 * Story 071 D4 adds the download+extract pipeline to the same `setup()`, and no IPC channel
 * (Decisions (Sprint), "No IPC channel in this story"): the pipeline is reached by
 * `startDownload(app, source)` below, a plain main-process call, not through `module:invoke`.
 */
export const downloadsModule: MainModule = {
  id: 'downloads',

  setup({ handle, app, log }) {
    // Story 074 D8: resolved exactly once, here, and then only ever passed around as a value -
    // see `harness.ts`. In a packaged build (and in any `npm run dev` without `Q2L_UI_HARNESS=1`)
    // this is `PRODUCTION_DOWNLOAD_SOURCE`, and no later change of environment can alter it.
    const source = resolveDownloadSource({ isDev: app.isDev })
    if (source !== PRODUCTION_DOWNLOAD_SOURCE) {
      log.warn(`UI harness: download source overridden to ${source.baseUrl} (dev build only)`)
    }
    const manifestService = new ManifestService({ log, source })

    // Story 071 D4: builds the queue (and with it the pipeline) at startup, so the module owns
    // exactly one queue per `AppContext` no matter who calls `startDownload()` first. Nothing on
    // `app` is dereferenced here - every dependency below is a getter the pipeline calls when a
    // download actually starts, which is also what keeps the concurrency limit live ([[072]]).
    createPipelineFor(app, log)

    // Story 073 D2: start observing job changes before any handler is registered, so no failure
    // can slip past between setup and the first renderer call.
    subscriptions.add(observeFailedJobs(app, log))

    handle(
      DOWNLOADS_HANDLERS.manifestGet,
      manifestGetInputSchema,
      async (input): Promise<Outcome<ManifestSnapshot>> => {
        try {
          const snapshot = await manifestService.getManifest({ refresh: input.refresh })
          return ok(snapshot)
        } catch (error) {
          if (error instanceof ManifestUnavailableError) {
            return fail('downloads.error.manifestUnavailable')
          }
          throw error
        }
      },
    )

    /**
     * Story 074 D1 (AC1): lists the engines the bootstrap wizard can offer - only the ones both
     * pinned by the manifest and named in `BOOTSTRAP_SUPPORTED_ENGINES`. No failure mode of its
     * own (like `getSettings` below): a manifest that cannot be fetched, or that pins nothing for
     * any bootstrap-supported engine, is legitimately "no options yet", not an error the caller
     * needs to unwrap - the wizard step (a later deliverable) is expected to handle an empty list.
     */
    handle(
      DOWNLOADS_HANDLERS.bootstrapEngineOptions,
      bootstrapEngineOptionsInputSchema,
      async (): Promise<BootstrapEngineOption[]> => {
        try {
          await manifestService.getManifest()
        } catch (error) {
          if (error instanceof ManifestUnavailableError) return []
          throw error
        }

        const options: BootstrapEngineOption[] = []
        for (const engine of BOOTSTRAP_SUPPORTED_ENGINES) {
          const pkg = manifestService.pinnedEnginePackage(engine)
          if (pkg === undefined) continue
          options.push({ engine, packageId: pkg.id, version: pkg.version, sizeBytes: pkg.sizeBytes })
        }
        return options
      },
    )

    /**
     * Story 074 D4 (AC3): the verdict for one candidate target folder. A thin wrapper around D2's
     * `computeTargetVerdict` - no failure mode of its own (like `getSettings` below), because
     * "this folder is blocked" is a verdict the wizard renders, not an error it unwraps.
     */
    handle(
      DOWNLOADS_HANDLERS.bootstrapTargetVerdict,
      bootstrapTargetVerdictInputSchema,
      ({ targetPath }): Promise<BootstrapTargetVerdict> => computeTargetVerdict(targetPath),
    )

    /**
     * Story 074 D4 (AC4): what the confirm step states before anything is downloaded. Fails when
     * the manifest cannot resolve all three packages - the wizard has nothing truthful to show in
     * that case, so this is a real failure rather than an empty summary.
     */
    handle(
      DOWNLOADS_HANDLERS.bootstrapSummary,
      bootstrapSummaryInputSchema,
      (input): Promise<Outcome<BootstrapSummary>> =>
        buildBootstrapSummary(
          {
            manifest: manifestSourceFrom(manifestService, log),
            // Story 088 D4 (AC5): the same lister the job re-verifies against, so the store name
            // the confirm step shows and the source the run accepts come from one list.
            retailSources: () => detectedRetailSourcesFor(app),
          },
          input,
        ),
    )

    /**
     * Story 088 D2 (AC1/AC2): the detected Steam/GOG/Epic sources the game-data step can offer to
     * copy from - a fast-pass-only `app.detection.scan({})` filtered to store sources and already
     * inspected (`listDetectedRetailSources`). No failure mode of its own (like
     * `bootstrapEngineOptions` above): an empty array is "nothing detected", which the wizard
     * renders by not offering the option at all (AC1).
     *
     * Story 088 D2's harness override (`resolveDetectedRetailSourcesOverride`) lets a UI-
     * verification flow substitute fixture sources for the real scan, under the same double gate as
     * `resolveDownloadSource` above - resolved fresh on every call, unlike that source (which is
     * resolved once at `setup()`), because a flow needs to change its fixture between wizard runs
     * within the same launch.
     */
    handle(
      DOWNLOADS_HANDLERS.bootstrapRetailSources,
      bootstrapRetailSourcesInputSchema,
      (): Promise<DetectedRetailSource[]> => detectedRetailSourcesFor(app),
    )

    /**
     * Story 089 D3 (AC2): what the wizard's game-data step found in the folder the user browsed to.
     * A thin wrapper around `inspectGameDataSource`, with no failure mode of its own - like
     * `bootstrapTargetVerdict` above, "this folder holds nothing usable" is a verdict the wizard
     * renders, not an error it unwraps. The path is re-judged again, independently, when the run
     * starts (`startBootstrap`, step 1c): this answer is a report, never an authorisation.
     */
    handle(
      DOWNLOADS_HANDLERS.bootstrapGameDataSource,
      bootstrapGameDataSourceInputSchema,
      ({ rootPath }): Promise<GameDataSourceVerdict> => inspectGameDataSource(rootPath),
    )

    /**
     * Story 074 D4 (AC5/AC6): starts the bootstrap job and answers its id. Deliberately does not
     * await the job - `startBootstrap` returns as soon as the installation is registered and the
     * job exists, exactly like `startDownload` above, so the wizard can switch to the progress
     * step instead of blocking on a several-hundred-megabyte download.
     */
    handle(
      DOWNLOADS_HANDLERS.bootstrapStart,
      startBootstrapInputSchema,
      async (input): Promise<Outcome<{ jobId: string; installationId: string }>> => {
        const started = await startBootstrap(bootstrapDepsFor(app, manifestService, log), input)
        if (!started.ok) return started
        return ok({ jobId: started.value.jobId, installationId: started.value.installationId })
      },
    )

    /**
     * Story 090 D1/D2 (INST-D4): upgrades one already-registered demo installation with
     * `pak0.pak`/`pak1.pak` copied out of a store installation main itself detected. A thin wrapper
     * around D2's `startRetailUpgrade` (`retail/upgrade-job.ts`), which owns the whole order -
     * resolve the installation, refuse while its game is running (AC7), re-verify the renderer's
     * source against main's own fresh list (AC6), copy through [[088]]'s routine, then
     * `InstallationsService.validate()` (AC5).
     *
     * Like `bootstrapStart` above, this deliberately does not await the job: it answers as soon as
     * the job exists, so the dialog can switch to the progress state instead of blocking on ~197 MB
     * of copying. `settled` stays in main - the job itself is the renderer's progress and outcome
     * surface, over `jobs:changed`.
     */
    handle(
      DOWNLOADS_HANDLERS.retailUpgradeStart,
      startRetailUpgradeInputSchema,
      async (input): Promise<Outcome<StartRetailUpgradeResult>> => {
        const started = await startRetailUpgrade(retailUpgradeDepsFor(app, log), input)
        if (!started.ok) return started
        return ok({ jobId: started.value.jobId })
      },
    )

    // Story 072 D4: reads the persisted settings verbatim - no failure mode of its own, so (like
    // `library`'s `stats` and `config`'s `list`) it returns the plain value rather than an
    // `Outcome`; `manifestGet` above only wraps because it has a real failure to report.
    handle(DOWNLOADS_HANDLERS.getSettings, downloadsNoInputSchema, (): DownloadsSettings =>
      app.state.getDownloadsSettings(),
    )

    /**
     * Story 072 D4: validates and persists a partial `DownloadsSettings` patch (AC2). An
     * out-of-range `concurrentJobs` or an `archiveCacheBudgetGB` outside
     * `ARCHIVE_CACHE_BUDGET_CHOICES_GB` never reaches this handler at all -
     * `patchDownloadsSettingsInputSchema` already rejects it at the registry, which answers
     * `fail('ipc.error.invalidPayload')` before this function is entered (`MainModuleRegistry.
     * invoke()`), so there is nothing left for this handler itself to validate.
     *
     * Budget enforcement (AC5, Decisions (Sprint): "runs when the budget is lowered and after a
     * clear") only fires when the patch actually *lowers* `archiveCacheBudgetGB` below the
     * previously persisted value - raising it or leaving the other two fields alone never evicts
     * anything. Best-effort: a failed eviction is logged, not surfaced as a failed patch - the
     * settings themselves were already persisted successfully, and the next lower/clear retries it.
     */
    handle(
      DOWNLOADS_HANDLERS.patchSettings,
      patchDownloadsSettingsInputSchema,
      async (patch): Promise<DownloadsSettings> => {
        const previous = app.state.getDownloadsSettings()
        const merged: DownloadsSettings = { ...previous, ...patch }
        app.state.setDownloadsSettings(merged)

        if (
          patch.archiveCacheBudgetGB !== undefined &&
          patch.archiveCacheBudgetGB < previous.archiveCacheBudgetGB
        ) {
          try {
            await enforceBudget({
              userDataPath: userDataDir(),
              budgetBytes: patch.archiveCacheBudgetGB * BYTES_PER_GB,
              isInUse: NOTHING_IN_USE,
              log,
            })
          } catch (error) {
            log.error('failed to enforce the lowered archive cache budget', error)
          }
        }

        return merged
      },
    )

    // Story 072 D4 (AC3): the archive cache's current size/count - a thin pass-through to D3's
    // `cache.status`, which already owns the "what counts as evictable" rule.
    handle(DOWNLOADS_HANDLERS.cacheStatus, downloadsNoInputSchema, (): Promise<ArchiveCacheStatus> =>
      status({ userDataPath: userDataDir(), log }),
    )

    // Story 072 D4 (AC4): deletes every evictable cache entry and reports exactly what went -
    // D3's `cache.clear` already guarantees the report matches the deletion, so this does not
    // reshape or recompute its result.
    handle(
      DOWNLOADS_HANDLERS.clearCache,
      downloadsNoInputSchema,
      (): Promise<ClearArchiveCacheResult> =>
        clear({ userDataPath: userDataDir(), isInUse: NOTHING_IN_USE, log }),
    )

    // Story 073 D2 (AC2): the failure log. All three handlers read through
    // `state.getDownloadFailures()`, which prunes on the way out, and write through
    // `state.setDownloadFailures()`, which prunes again on the way in - so retention is applied
    // whichever of them a call goes through, and none of them re-implements it.
    handle(DOWNLOADS_HANDLERS.failures, downloadsNoInputSchema, (): DownloadFailure[] =>
      app.state.getDownloadFailures(),
    )

    // Both mutating handlers answer the *new* list rather than nothing, so the renderer's dismiss/
    // restore call is also its refetch - one round trip, and no window in which the tab shows a
    // list main has already moved past.
    handle(
      DOWNLOADS_HANDLERS.dismissFailure,
      dismissFailureInputSchema,
      ({ id }): DownloadFailure[] =>
        app.state.setDownloadFailures(dismissFailure(app.state.getDownloadFailures(), id)),
    )

    handle(
      DOWNLOADS_HANDLERS.restoreFailure,
      restoreFailureInputSchema,
      ({ id }): DownloadFailure[] =>
        app.state.setDownloadFailures(restoreFailure(app.state.getDownloadFailures(), id)),
    )

    log.debug('downloads module ready')
  },

  dispose() {
    for (const unsubscribe of subscriptions) unsubscribe()
    subscriptions.clear()
  },
}

/**
 * The `JobsService.onChange` unsubscribers handed out to this module, so `dispose()` gives them
 * back. A set on the module object's behalf rather than a single field: `downloadsModule` is one
 * shared const, and two `AppContext`s in the same process (which is exactly what a test does) each
 * get their own subscription - a single field would leak the first one.
 */
const subscriptions = new Set<() => void>()

/**
 * Story 073 D2: the failure reason recorded for a `downloads` job that reached `failed` without
 * carrying one. `JobsService.finish()` allows a terminal status with no `error`, and the acceptance
 * is "a `downloads` job finishing `failed` produces exactly one log entry" - so an entry is written
 * either way, with this key standing in for the missing reason rather than the entry being dropped
 * (a failure the user is never told about is the one outcome the log exists to prevent).
 *
 * Not a member of `DOWNLOADS_ERROR_KEYS`, on purpose: that set enumerates the reasons the download
 * pipeline *produces*, and this is the absence of one.
 *
 * Defined in `diagnostics.ts` (so `diagnosticsFor()` can use the same key without importing this
 * module and creating a cycle) and re-exported here, since callers/tests already reach it as
 * `./index`'s own export.
 */
export { UNKNOWN_DOWNLOAD_FAILURE_KEY }

/**
 * Story 073 D2 (AC2): appends one failure-log entry per `downloads` job that reaches `failed`
 * (Decisions (Sprint): "the downloads main module observes job transitions ... so the log is
 * truthful for any producer").
 *
 * Two things make "exactly one entry" true rather than merely likely:
 *
 *  - **the seen set.** `JobsService` fires on *every* change and keeps a `failed` job in its list
 *    (`clearFinished()` only drops `succeeded`/`cancelled` ones), so the same failed job is part of
 *    many snapshots. A job id is recorded here the first time it is seen `failed` and never acted
 *    on again.
 *  - **marking before appending.** The id is added to the set before the write is attempted, so a
 *    write that throws *after* having persisted is not retried into a second entry. A genuinely
 *    lost entry is the cheaper failure of the two, and it is logged.
 *
 * The set forgets ids that have left the job list, so a long session cannot grow it without bound;
 * job ids are UUIDs, so a forgotten id can never come back and be logged twice.
 *
 * Story 075 D2: also drops the job's `diagnostics.ts` registry entry (if any) on *any* terminal
 * status, not just `failed` - a succeeded or cancelled job leaves nothing behind either, so the
 * registry cannot grow unbounded across a session. This runs after `failureFor()` has had its
 * chance to read the entry for a job failing in this same tick, never before.
 */
function observeFailedJobs(app: AppContext, log: Logger): () => void {
  const recorded = new Set<string>()

  return app.jobs.onChange((jobs) => {
    for (const job of jobs) {
      if (job.moduleId !== 'downloads') continue

      if (job.status === 'failed' && !recorded.has(job.id)) {
        recorded.add(job.id)

        try {
          app.state.setDownloadFailures(
            appendFailure(app.state.getDownloadFailures(), failureFor(job)),
          )
        } catch (error) {
          log.error(`failed to record the failure of job ${job.id}`, error)
        }
      }

      if (!isJobActive(job)) dropDiagnostics(job.id)
    }

    const present = new Set(jobs.map((job) => job.id))
    for (const id of recorded) {
      if (!present.has(id)) recorded.delete(id)
    }
  })
}

/**
 * The log entry a failed job produces. Everything comes off the job itself - `labelKey`/
 * `labelParams`, `installationId` and the `error` key/params - because the job is long gone from
 * `JobsService` by the time the entry is read (`DownloadFailure`'s own doc comment). `error` is
 * copied field by field rather than by reference, so the persisted entry cannot be changed by
 * whoever still holds the job.
 *
 * Story 075 D2: also attaches whatever `diagnostics.ts`'s registry holds for this job id -
 * `undefined` for any failure not produced by an instrumented job (the pipeline stays
 * uninstrumented this sprint), which simply omits the `diagnostics` field rather than sending an
 * empty one.
 */
function failureFor(job: Job): Omit<DownloadFailure, 'id' | 'createdAt' | 'dismissedAt'> {
  const diagnostics = diagnosticsFor(job)
  return {
    jobId: job.id,
    labelKey: job.labelKey,
    ...(job.labelParams ? { labelParams: { ...job.labelParams } } : {}),
    ...(job.installationId ? { installationId: job.installationId } : {}),
    error: job.error
      ? { key: job.error.key, ...(job.error.params ? { params: { ...job.error.params } } : {}) }
      : { key: UNKNOWN_DOWNLOAD_FAILURE_KEY },
    ...(diagnostics ? { diagnostics } : {}),
  }
}

/**
 * One pipeline per `AppContext`, rather than one per process: a module-level singleton would be
 * shared by two contexts in the same process (which is exactly what a test does), and the
 * download cache and job registry it owns belong to a context, not to a process. Weakly keyed so
 * a discarded context takes its pipeline with it.
 */
const pipelines = new WeakMap<AppContext, DownloadPipeline>()

function createPipelineFor(app: AppContext, log?: PipelineLog): DownloadPipeline {
  const existing = pipelines.get(app)
  if (existing) return existing

  const pipeline = createDownloadPipeline({
    getJobs: () => app.jobs,
    getUserDataPath: () => userDataDir(),
    getConcurrency: () => app.state.getDownloadsSettings().concurrentJobs,
    // Resolved per extraction, and deliberately with the real `electron.app` rather than an
    // injected value: this is the production wiring, and `7za-path.ts` already takes its inputs
    // as parameters so that its own tests need no Electron runtime.
    resolveExtractor: () =>
      resolveExtractorPath({
        isPackaged: electronApp.isPackaged,
        resourcesPath: process.resourcesPath,
      }),
    ...(log ? { log } : {}),
  })

  pipelines.set(app, pipeline)
  return pipeline
}

/**
 * Story 074 D4: the production wiring for the bootstrap job (`bootstrap/job.ts`). Built per call
 * rather than per context: unlike the download pipeline, a bootstrap job owns no queue and no
 * cross-call state, so there is nothing to keep alive between two of them.
 *
 * The extractor is resolved per extraction with the real `electron.app` (like `createPipelineFor`
 * above), and `app.installations` is the shell's real `InstallationsService` - the job's narrow
 * `BootstrapInstallationsHost` is satisfied structurally, so nothing in this module can reach past
 * `create`/`validate`/`remove` into the library.
 */
function bootstrapDepsFor(
  app: AppContext,
  manifestService: ManifestService,
  log: Logger,
): BootstrapDeps {
  return {
    jobs: app.jobs,
    installations: app.installations,
    manifest: manifestSourceFrom(manifestService, log),
    // Story 088 D4: main's own list, re-derived per run - never anything the renderer sent.
    retailSources: () => detectedRetailSourcesFor(app),
    fetcher: realPackageFetcher,
    extractor: realExtractor,
    r1q2Setup: realR1q2Setup,
    userDataPath: userDataDir(),
    resolveExtractor: () =>
      resolveExtractorPath({
        isPackaged: electronApp.isPackaged,
        resourcesPath: process.resourcesPath,
      }),
    // Story 080 finding fix: resolved per call with the real `electron.app`, same as
    // `resolveExtractor` above and for the same reason (`isPackaged`/`resourcesPath` only exist
    // once `electron` is available).
    resolveR1q2LicensePath: () =>
      resolveR1q2LicensePath({
        isPackaged: electronApp.isPackaged,
        resourcesPath: process.resourcesPath,
      }),
    // Story 075 D3: a factory, not a collector - the registry is keyed by the job id, which
    // `startBootstrap` only has once it has created the `Job` (`ports.ts`'s
    // `BootstrapDiagnosticsSource`). `observeFailedJobs` above drops the entry again on any
    // terminal status, so an instrumented job leaves nothing behind either way.
    diagnostics: (jobId, kind) => createDiagnosticsCollector(jobId, kind),
    log,
  }
}

/**
 * Story 090 D2: the production wiring for the retail-upgrade job (`retail/upgrade-job.ts`). Built
 * per call, like `bootstrapDepsFor` above and for the same reason - the job owns no queue and no
 * cross-call state.
 *
 * `app.installations` and `app.launch` are the shell's real services; the job's narrow
 * `RetailUpgradeInstallationsHost`/`RetailUpgradeLaunchHost` are satisfied structurally, so nothing
 * in this module can reach past `find`/`validate` into the library or past `getState()` into the
 * launcher. `copyGameData` is deliberately not passed: its default *is* [[088]]'s
 * `copyRetailGameData`, so there is no wiring in which the copy could come from somewhere else.
 */
function retailUpgradeDepsFor(app: AppContext, log: Logger): RetailUpgradeDeps {
  return {
    jobs: app.jobs,
    installations: app.installations,
    launch: app.launch,
    // Main's own list, re-derived per run - never anything the renderer sent, and the same
    // resolution the wizard's picker and the bootstrap job use.
    retailSources: () => detectedRetailSourcesFor(app),
    log,
  }
}

/**
 * Story 071 D4: starts a verified download of `source` and, on success, extracts it - as one
 * `Job` created through the shell's `JobsService`, admitted by the module's own concurrency queue
 * (`queue.ts`).
 *
 * A plain function, on purpose. This story adds no IPC channel and no renderer half, so there is
 * nothing for `module:invoke` to carry; the caller is main-process code ([[074]]'s install
 * wizard), which calls this directly. Returns as soon as the job exists - `jobId` is what
 * `jobs:cancel` takes, and `settled` resolves once the job has reached a terminal state (it never
 * rejects, and awaiting it is optional: the job itself is the progress and status surface).
 */
export function startDownload(app: AppContext, source: PackageSource): StartedDownload {
  return createPipelineFor(app).start(source)
}
