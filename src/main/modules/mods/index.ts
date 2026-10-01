import { join } from 'node:path'
import { shell } from 'electron'
import {
  MODS_HANDLERS,
  type ModCatalogState,
  type ModGameDir,
  type ModsListResult,
} from '@shared/modules/mods'
import { fail, ok, type Installation, type Outcome } from '@shared/types'
import { isUiHarnessEnabled, recordHarnessRevealedPath } from '../../lib/ui-harness'
import type { MainModule } from '../types'
import { recordedGameDirs } from './install-records'
import { resolveDownloadSource } from '../downloads/harness'
import { toCatalogEntryDto } from './catalog-parse'
import { CatalogService } from './catalog-service'
import { catalogGetInputSchema, listInputSchema, revealInputSchema } from './schemas'

/**
 * The mods module. Lists an installation's persisted game directories (no disk scan) minus
 * `baseq2`, tagged `catalog` when the launcher has an install record for it, else `manual`.
 * The renderer never sends a path - `reveal` resolves the folder from a listed game dir.
 */
function modGameDirs(installation: Installation): ModGameDir[] {
  const recorded = recordedGameDirs(installation.moduleData)
  return installation.gameDirs
    .filter((gameDir) => gameDir.toLowerCase() !== 'baseq2')
    .map((gameDir) => ({
      gameDir,
      folderPath: join(installation.rootPath, gameDir),
      origin: recorded.has(gameDir.toLowerCase()) ? ('catalog' as const) : ('manual' as const),
    }))
}

export const modsModule: MainModule = {
  id: 'mods',

  setup({ handle, app, log }) {
    // Resolved once, as in the downloads module; httpsOnly follows the harness result.
    const catalog = new CatalogService({ log, source: resolveDownloadSource({ isDev: app.isDev }) })

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

    handle(MODS_HANDLERS.list, listInputSchema, (input): Outcome<ModsListResult> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return fail('mods.error.installationNotFound')
      return ok({ installationId: installation.id, gameDirs: modGameDirs(installation) })
    })

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
