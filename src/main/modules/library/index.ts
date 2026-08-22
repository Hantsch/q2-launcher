import { LIBRARY_HANDLERS, type LibraryStats } from '@shared/modules/library'
import type { EngineKind, Installation } from '@shared/types'
import type { MainModule } from '../types'

/**
 * The library module - the only module with a working main-process half in
 * step 1, and therefore the reference implementation of the seam.
 *
 * It is intentionally tiny: everything an installation needs already lives on
 * the shell's `installations:*` channels, so all this module adds is a derived
 * view. Copy this file's shape when starting the config, downloads, mods or assets
 * modules; the contract it answers against lives in `src/shared/modules/library.ts`.
 */
export const libraryModule: MainModule = {
  id: 'library',

  setup({ handle, app, log }) {
    handle(LIBRARY_HANDLERS.stats, (): LibraryStats => {
      const installations = app.installations.list()

      const byEngine: Partial<Record<EngineKind, number>> = {}
      for (const installation of installations) {
        byEngine[installation.engineKind] = (byEngine[installation.engineKind] ?? 0) + 1
      }

      return {
        total: installations.length,
        ok: count(installations, (i) => i.status === 'ok'),
        needsAttention: count(
          installations,
          (i) => i.status === 'warning' || i.status === 'invalid',
        ),
        missing: count(installations, (i) => i.status === 'missing'),
        favorites: count(installations, (i) => i.favorite),
        totalPlaytimeSeconds: installations.reduce((sum, i) => sum + i.totalPlaytimeSeconds, 0),
        byEngine,
      }
    })

    log.debug('library module ready')
  },
}

function count(installations: Installation[], predicate: (i: Installation) => boolean): number {
  return installations.filter(predicate).length
}
