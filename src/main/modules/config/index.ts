import { CONFIG_HANDLERS, type ConfigProfile } from '@shared/modules/config'
import type { MainModule } from '../types'
import { ProfilesStore } from './profiles'
import {
  createConfigProfileInputSchema,
  removeConfigProfileInputSchema,
  renameConfigProfileInputSchema,
} from './schemas'

/**
 * The config module - CRUD over centrally-owned config profiles.
 *
 * Mirrors `library`'s shape (see `../library/index.ts`): a `MainModule` whose
 * `setup` registers handlers on the shell's `module:invoke` channel and does
 * nothing else. Profile logic itself lives in `ProfilesStore`; this file only
 * wires payload validation to it and shapes the return values.
 *
 * No `emit` here - the renderer reloads from each mutation's returned list,
 * there is no broadcast event for this module in step 1.
 */
export const configModule: MainModule = {
  id: 'config',

  setup({ handle, app, log }) {
    const profiles = new ProfilesStore(app.state)

    handle(CONFIG_HANDLERS.list, (): ConfigProfile[] => profiles.list())

    handle(CONFIG_HANDLERS.create, (payload): ConfigProfile[] =>
      profiles.create(createConfigProfileInputSchema.parse(payload)),
    )

    handle(CONFIG_HANDLERS.rename, (payload): ConfigProfile[] =>
      profiles.rename(renameConfigProfileInputSchema.parse(payload)),
    )

    handle(CONFIG_HANDLERS.remove, (payload): ConfigProfile[] =>
      profiles.remove(removeConfigProfileInputSchema.parse(payload)),
    )

    log.debug('config module ready')
  },
}
