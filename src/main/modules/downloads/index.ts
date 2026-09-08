import { app as electronApp } from 'electron'
import {
  DOWNLOADS_HANDLERS,
  type ManifestSnapshot,
  type PackageSource,
} from '@shared/modules/downloads'
import { fail, ok, type Outcome } from '@shared/types'
import { userDataDir } from '../../lib/paths'
import type { AppContext } from '../../context'
import type { MainModule } from '../types'
import { resolveExtractorPath } from './7za-path'
import { ManifestService, ManifestUnavailableError } from './manifest-service'
import {
  createDownloadPipeline,
  type DownloadPipeline,
  type PipelineLog,
  type StartedDownload,
} from './pipeline'
import { manifestGetInputSchema } from './schemas'

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
