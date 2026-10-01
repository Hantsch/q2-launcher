import { join } from 'node:path'
import { app as electronApp, shell } from 'electron'
import {
  MODS_EVENTS,
  MODS_HANDLERS,
  type ModActiveInstall,
  type ModCatalogState,
  type ModGameDir,
  type ModMapPresence,
  type ModRemovalPreview,
  type ModsListResult,
} from '@shared/modules/mods'
import { fail, ok, type Installation, type Outcome } from '@shared/types'
import { readBinaryArch } from '../../lib/fs-utils'
import { isUiHarnessEnabled, recordHarnessRevealedPath } from '../../lib/ui-harness'
import type { MainModule } from '../types'
import { readModsState, recordedGameDirs } from './install-records'
import { resolveDownloadSource } from '../downloads/harness'
import { resolveExtractorPath } from '../downloads/7za-path'
import { ManifestService } from '../downloads/manifest-service'
import { resolveVendoredExtractor, stagePackage } from '../downloads/stage-package'
import { toCatalogEntryDto } from './catalog-parse'
import { CatalogService } from './catalog-service'
import { mapPresence } from './map-presence'
import { previewModRemoval, startModRemove } from './remove-job'
import { startModInstall, type ModInstallDecision } from './install-job'
import {
  catalogGetInputSchema,
  installInputSchema,
  listInputSchema,
  mapPresenceInputSchema,
  removalPreviewInputSchema,
  removeInputSchema,
  resolveInstallInputSchema,
  revealInputSchema,
} from './schemas'

/**
 * The mods module. Lists an installation's persisted game directories (no disk scan) minus
 * `baseq2`, tagged `catalog` when the launcher has an install record for it, else `manual`.
 * The renderer never sends a path - `reveal` resolves the folder from a listed game dir.
 *
 * Story 190: `install` starts the install job; when it meets a folder it did not create it asks
 * through the `installDecision` event and waits for `resolveInstall`.
 */
function modGameDirs(installation: Installation): ModGameDir[] {
  const recorded = recordedGameDirs(installation.moduleData)
  const records = new Map(
    readModsState(installation.moduleData).records.map((r) => [r.gameDir.toLowerCase(), r]),
  )
  return installation.gameDirs
    .filter((gameDir) => gameDir.toLowerCase() !== 'baseq2')
    .map((gameDir): ModGameDir => {
      const key = gameDir.toLowerCase()
      const record = records.get(key)
      return {
        gameDir,
        folderPath: join(installation.rootPath, gameDir),
        origin: recorded.has(key) ? 'catalog' : 'manual',
        ...(record
          ? {
              catalogId: record.catalogId,
              version: record.version,
              contentOnly: record.contentOnly,
              engineKind: record.engineKind,
              arch: record.arch,
              ...(record.pkzUnsupported ? { pkzUnsupported: true } : {}),
            }
          : {}),
      }
    })
}

interface RunningInstall {
  installationId: string
  catalogId: string
  decision?: { folder: string; conflicts: string[] }
}

export const modsModule: MainModule = {
  id: 'mods',

  setup({ handle, emit, app, log }) {
    // Resolved once, as in the downloads module; httpsOnly follows the harness result.
    const source = resolveDownloadSource({ isDev: app.isDev })
    const catalog = new CatalogService({ log, source })
    // The engines manifest, only to learn the arch of the package an installation came from.
    const manifest = new ManifestService({ log, source })

    // Running installs and their pending decisions, keyed by job id; dropped when the job settles.
    const pending = new Map<string, (choice: ModInstallDecision) => void>()
    const running = new Map<string, RunningInstall>()
    const activeFor = (installationId: string): ModActiveInstall[] =>
      [...running.entries()]
        .filter(([, r]) => r.installationId === installationId)
        .map(([jobId, r]) => ({
          catalogId: r.catalogId,
          jobId,
          ...(r.decision ? { decision: r.decision } : {}),
        }))

    handle(
      MODS_HANDLERS.catalogGet,
      catalogGetInputSchema,
      async (input): Promise<Outcome<ModCatalogState>> => {
        const snapshot = await catalog.getCatalog({ refresh: input.refresh })
        if (snapshot.status === 'unavailable') return ok({ status: 'unavailable' })
        return ok({
          status: 'ok',
          entries: snapshot.entries.map(toCatalogEntryDto),
          fetchedAt: snapshot.fetchedAt,
          fromCache: snapshot.fromCache,
          ageMs: snapshot.ageMs,
        })
      },
    )

    handle(
      MODS_HANDLERS.install,
      installInputSchema,
      async (input): Promise<Outcome<{ jobId: string }>> => {
        // `askDecision` runs only after staging (async), by which time `running.set` below has run.
        const started = await startModInstall(
          {
            jobs: app.jobs,
            installations: app.installations,
            writeGuard: app.writeGuard,
            catalog,
            enginePackages: async () => {
              try {
                return (await manifest.getManifest()).packages
              } catch {
                return []
              }
            },
            stage: stagePackage,
            resolveExtractor: resolveVendoredExtractor,
            readArch: readBinaryArch,
            userDataPath: electronApp.getPath('userData'),
            askDecision: (jobId, request) =>
              new Promise<ModInstallDecision>((resolve) => {
                const entry = running.get(jobId) ?? {
                  installationId: input.installationId,
                  catalogId: input.catalogId,
                }
                running.set(jobId, entry)
                entry.decision = request
                pending.set(jobId, resolve)
                emit(MODS_EVENTS.installDecision, {
                  jobId,
                  installationId: entry.installationId,
                  catalogId: entry.catalogId,
                  folder: request.folder,
                  conflicts: request.conflicts,
                })
              }),
            log,
          },
          input,
        )
        if (!started.ok) return started
        const { jobId, settled } = started.value
        if (!running.has(jobId)) {
          running.set(jobId, { installationId: input.installationId, catalogId: input.catalogId })
        }
        void settled.then(() => {
          // A job cancelled from the Downloads tab never gets an answer: settle it as cancel and drop it.
          pending.get(jobId)?.('cancel')
          pending.delete(jobId)
          running.delete(jobId)
        })
        return ok({ jobId })
      },
    )

    handle(MODS_HANDLERS.resolveInstall, resolveInstallInputSchema, (input): Outcome<null> => {
      const resolve = pending.get(input.jobId)
      if (!resolve) return fail('mods.error.noPendingDecision')
      pending.delete(input.jobId)
      const entry = running.get(input.jobId)
      if (entry) delete entry.decision
      resolve(input.choice)
      return ok(null)
    })

    const removeDeps = {
      jobs: app.jobs,
      installations: app.installations,
      writeGuard: app.writeGuard,
      broadcast: app.broadcast,
      log,
    }

    handle(
      MODS_HANDLERS.removalPreview,
      removalPreviewInputSchema,
      (input): Promise<Outcome<ModRemovalPreview>> => previewModRemoval(removeDeps, input),
    )

    handle(MODS_HANDLERS.remove, removeInputSchema, (input): Outcome<{ jobId: string }> => {
      const started = startModRemove(removeDeps, input)
      if (!started.ok) return started
      return ok({ jobId: started.value.jobId })
    })

    handle(MODS_HANDLERS.list, listInputSchema, (input): Outcome<ModsListResult> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return fail('mods.error.installationNotFound')
      return ok({
        installationId: installation.id,
        gameDirs: modGameDirs(installation),
        activeInstalls: activeFor(installation.id),
      })
    })

    handle(
      MODS_HANDLERS.mapPresence,
      mapPresenceInputSchema,
      async (input): Promise<Outcome<ModMapPresence>> => {
        const installation = app.installations.find(input.installationId)
        if (!installation) return fail('mods.error.installationNotFound')
        const extractor = resolveExtractorPath({
          isPackaged: electronApp.isPackaged,
          resourcesPath: process.resourcesPath,
        })
        // The root comes from the installation record; only the two safe names come from the payload.
        const presence = await mapPresence(
          { rootPath: installation.rootPath, gameDir: input.gameDir, map: input.map },
          { zipDeps: { extractorPath: extractor.path, extractorExists: extractor.exists } },
        )
        return ok(presence)
      },
    )

    handle(MODS_HANDLERS.reveal, revealInputSchema, async (input): Promise<Outcome<null>> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return fail('mods.error.installationNotFound')
      const wanted = input.gameDir.toLowerCase()
      const entry = modGameDirs(installation).find((d) => d.gameDir.toLowerCase() === wanted)
      if (!entry) return fail('mods.error.gameDirNotFound')

      if (isUiHarnessEnabled({ isDev: app.isDev })) {
        recordHarnessRevealedPath(entry.folderPath)
        return ok(null)
      }
      const message = await shell.openPath(entry.folderPath)
      if (message) return fail('mods.error.revealFailed', { message })
      return ok(null)
    })

    log.debug('mods module ready')
  },
}
