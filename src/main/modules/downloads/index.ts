import { DOWNLOADS_HANDLERS, type ManifestSnapshot } from '@shared/modules/downloads'
import { fail, ok, type Outcome } from '@shared/types'
import type { MainModule } from '../types'
import { ManifestService, ManifestUnavailableError } from './manifest-service'
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
 */
export const downloadsModule: MainModule = {
  id: 'downloads',

  setup({ handle, log }) {
    const manifestService = new ManifestService({ log })

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
