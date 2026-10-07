import { join } from 'node:path'
import {
  MODS_EVENTS,
  MODS_HANDLERS,
  MODS_HANDLER_SCHEMAS,
  type ModsContract,
  type ModActiveInstall,
  type ModCatalogState,
  type ModGameDir,
  type ModLastLaunch,
  type ModMapList,
  type ModMapPresence,
  type ModRemovalPreview,
  type ModUpdatePreview,
  type ModsListResult,
} from '@shared/modules/mods'
import type { ModsErrorKey } from '@shared/modules/mods'
import { fail, ok, type Installation, type Outcome } from '@shared/types'
import { readBinaryArch } from '../../lib/fs-utils'
import { defineModule } from '../define-module'
import type { MainModule } from '../types'
import { readLastLaunch, readModsState, recordedGameDirs, withLastLaunch } from './install-records'
import { resolveDownloadSource } from '../../services/content/source'
import { resolveVendoredExtractor, stagePackage } from '../../services/package-staging'
import { toCatalogEntryDto } from './catalog-parse'
import { CatalogService } from './catalog-service'
import { listMaps } from './map-list'
import { mapPresence } from './map-presence'
import { previewModRemoval, startModRemove } from './remove-job'
import { previewModUpdate, startModUpdate } from './update-job'
import { computeModUpdateStatus } from './update-status'
import { startModInstall, type ModInstallDecision } from './install-job'

/** The mods module only ever answers with keys from its closed set. */
const failMods = (key: ModsErrorKey, params?: Record<string, string | number>): Outcome<never> =>
  fail(key, params)

/**
 * The mods module. Lists an installation's persisted game directories (no disk scan) minus
 * `baseq2`, tagged `catalog` when the launcher has an install record for it, else `manual`.
 * The renderer never sends a path - `reveal` resolves the folder from a listed game dir.
 *
 * Story 190: `install` starts the install job; when it meets a folder it did not create it asks
 * through the `installDecision` event and waits for `resolveInstall`.
 */
function modGameDirs(
  installation: Installation,
  catalogEntries: ReadonlyMap<string, { pinned: string }> = new Map(),
): ModGameDir[] {
  const recorded = recordedGameDirs(installation.moduleData)
  const records = new Map(
    readModsState(installation.moduleData).records.map((r) => [r.gameDir.toLowerCase(), r]),
  )
  return installation.gameDirs
    .filter((gameDir) => gameDir.toLowerCase() !== 'baseq2')
    .map((gameDir): ModGameDir => {
      const key = gameDir.toLowerCase()
      const record = records.get(key)
      const update = computeModUpdateStatus(
        record,
        record ? catalogEntries.get(record.catalogId) : undefined,
      )
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
              ...(update.updateAvailable
                ? {
                    status: 'update-available' as const,
                    ...(update.installedVersion
                      ? { installedVersion: update.installedVersion }
                      : {}),
                    ...(update.pinnedVersion ? { pinnedVersion: update.pinnedVersion } : {}),
                  }
                : {}),
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

  setup(setup) {
    const { app, log } = setup
    const { handle, emit } = defineModule<ModsContract>('mods', MODS_HANDLER_SCHEMAS).bind(setup)
    // Resolved once, as in the downloads module; httpsOnly follows the harness result.
    const source = resolveDownloadSource(app.harness)
    const catalog = new CatalogService({ log, source })
    app.persistence.register('mods-catalog', catalog)
    // The engines manifest, only to learn the arch of the package an installation came from.
    const manifest = app.content.manifest

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

    handle(MODS_HANDLERS.catalogGet, async (input): Promise<Outcome<ModCatalogState>> => {
      const snapshot = await catalog.getCatalog({ refresh: input.refresh })
      if (snapshot.status === 'unavailable') return ok({ status: 'unavailable' })
      return ok({
        status: 'ok',
        entries: snapshot.entries.map(toCatalogEntryDto),
        fetchedAt: snapshot.fetchedAt,
        fromCache: snapshot.fromCache,
        ageMs: snapshot.ageMs,
      })
    })

    handle(MODS_HANDLERS.install, async (input): Promise<Outcome<{ jobId: string }>> => {
      // `askDecision` runs only after staging (async), by which time `running.set` below has run.
      const started = await startModInstall(
        {
          runner: app.jobRunner,
          jobs: app.jobs,
          installations: app.installations,
          catalog,
          enginePackages: async () => {
            try {
              return (await manifest.getManifest()).packages
            } catch {
              return []
            }
          },
          stage: stagePackage,
          resolveExtractor: () => resolveVendoredExtractor(app.isPackaged),
          readArch: readBinaryArch,
          userDataPath: app.userDataDir,
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
    })

    handle(MODS_HANDLERS.resolveInstall, (input): Outcome<null> => {
      const resolve = pending.get(input.jobId)
      if (!resolve) return failMods('mods.error.noPendingDecision')
      pending.delete(input.jobId)
      const entry = running.get(input.jobId)
      if (entry) delete entry.decision
      resolve(input.choice)
      return ok(null)
    })

    const removeDeps = {
      runner: app.jobRunner,
      installations: app.installations,
      broadcast: app.broadcast,
      log,
    }

    handle(MODS_HANDLERS.removalPreview, (input): Promise<Outcome<ModRemovalPreview>> =>
      previewModRemoval(removeDeps, input),
    )

    handle(MODS_HANDLERS.remove, (input): Outcome<{ jobId: string }> => {
      const started = startModRemove(removeDeps, input)
      if (!started.ok) return started
      return ok({ jobId: started.value.jobId })
    })

    const updateDeps = {
      runner: app.jobRunner,
      installations: app.installations,
      catalog,
      enginePackages: async () => {
        try {
          return (await manifest.getManifest()).packages
        } catch {
          return []
        }
      },
      stage: stagePackage,
      resolveExtractor: () => resolveVendoredExtractor(app.isPackaged),
      readArch: readBinaryArch,
      userDataPath: app.userDataDir,
      log,
    }

    /** Both update handlers: a mod the launcher did not install has no record to update from. */
    const checkUpdatable = (installationId: string, catalogId: string): Outcome<null> => {
      const installation = app.installations.find(installationId)
      if (!installation) return failMods('mods.error.installationNotFound')
      const hasRecord = readModsState(installation.moduleData).records.some(
        (r) => r.catalogId === catalogId,
      )
      return hasRecord ? ok(null) : fail('mods.update.refused.noRecord')
    }

    handle(MODS_HANDLERS.updatePreview, async (input): Promise<Outcome<ModUpdatePreview>> => {
      const checked = checkUpdatable(input.installationId, input.catalogId)
      if (!checked.ok) return checked
      return previewModUpdate(updateDeps, input)
    })

    handle(MODS_HANDLERS.update, async (input): Promise<Outcome<{ jobId: string }>> => {
      const checked = checkUpdatable(input.installationId, input.catalogId)
      if (!checked.ok) return checked
      // Like 190's install: the jobs list and the post-job revalidation are the refresh signal.
      const started = await startModUpdate(updateDeps, input)
      if (!started.ok) return started
      return ok({ jobId: started.value.jobId })
    })

    handle(MODS_HANDLERS.list, async (input): Promise<Outcome<ModsListResult>> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return failMods('mods.error.installationNotFound')
      // Only the catalog (never the gamedir, never a package) is consulted, and only when a record exists.
      const catalogEntries = new Map<string, { pinned: string }>()
      if (readModsState(installation.moduleData).records.length > 0) {
        try {
          const snapshot = await catalog.getCatalog()
          if (snapshot.status === 'ok')
            for (const e of snapshot.entries) catalogEntries.set(e.id, { pinned: e.pinned })
        } catch (error) {
          log.warn(`mods list: catalog unavailable for update status: ${String(error)}`)
        }
      }
      return ok({
        installationId: installation.id,
        gameDirs: modGameDirs(installation, catalogEntries),
        activeInstalls: activeFor(installation.id),
      })
    })

    handle(MODS_HANDLERS.mapPresence, async (input): Promise<Outcome<ModMapPresence>> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return failMods('mods.error.installationNotFound')
      const extractor = resolveVendoredExtractor(app.isPackaged)
      // The root comes from the installation record; only the two safe names come from the payload.
      const presence = await mapPresence(
        { rootPath: installation.rootPath, gameDir: input.gameDir, map: input.map },
        { zipDeps: { extractorPath: extractor.path, extractorExists: extractor.exists } },
      )
      return ok(presence)
    })

    handle(MODS_HANDLERS.mapsList, async (input): Promise<Outcome<ModMapList>> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return failMods('mods.error.installationNotFound')
      const extractor = resolveVendoredExtractor(app.isPackaged)
      return ok(
        await listMaps(
          {
            rootPath: installation.rootPath,
            gameDir: input.gameDir,
            engineKind: installation.engineKind,
          },
          { zipDeps: { extractorPath: extractor.path, extractorExists: extractor.exists } },
        ),
      )
    })

    handle(MODS_HANDLERS.lastLaunchGet, (input): Outcome<ModLastLaunch | null> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return failMods('mods.error.installationNotFound')
      return ok(readLastLaunch(installation.moduleData))
    })

    handle(MODS_HANDLERS.lastLaunchRemember, (input): Outcome<null> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return failMods('mods.error.installationNotFound')
      const saved = app.installations.setModuleData(
        installation.id,
        'mods',
        withLastLaunch(installation.moduleData, input)['mods'],
      )
      return saved.ok ? ok(null) : saved
    })

    handle(MODS_HANDLERS.reveal, async (input): Promise<Outcome<null>> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return failMods('mods.error.installationNotFound')
      const wanted = input.gameDir.toLowerCase()
      const entry = modGameDirs(installation).find((d) => d.gameDir.toLowerCase() === wanted)
      if (!entry) return failMods('mods.error.gameDirNotFound')

      const message = await app.os.openPath(entry.folderPath)
      if (message) return failMods('mods.error.revealFailed', { message })
      return ok(null)
    })

    log.debug('mods module ready')
  },
}
