import { app as electronApp } from 'electron'
import {
  DOWNLOADS_HANDLERS,
  type ArchiveCacheStatus,
  type ClearArchiveCacheResult,
  type DownloadsSettings,
  type ManifestSnapshot,
  type PackageSource,
} from '@shared/modules/downloads'
import { fail, ok, type Outcome } from '@shared/types'
import { userDataDir } from '../../lib/paths'
import type { AppContext } from '../../context'
import type { MainModule } from '../types'
import { resolveExtractorPath } from './7za-path'
import { clear, enforceBudget, NOTHING_IN_USE, status } from './cache'
import { ManifestService, ManifestUnavailableError } from './manifest-service'
import {
  createDownloadPipeline,
  type DownloadPipeline,
  type PipelineLog,
  type StartedDownload,
} from './pipeline'
import {
  downloadsNoInputSchema,
  manifestGetInputSchema,
  patchDownloadsSettingsInputSchema,
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
    const manifestService = new ManifestService({ log })

    // Story 071 D4: builds the queue (and with it the pipeline) at startup, so the module owns
    // exactly one queue per `AppContext` no matter who calls `startDownload()` first. Nothing on
    // `app` is dereferenced here - every dependency below is a getter the pipeline calls when a
    // download actually starts, which is also what keeps the concurrency limit live ([[072]]).
    createPipelineFor(app, log)

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

    log.debug('downloads module ready')
  },
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
