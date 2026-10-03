import type { AppContext } from '../context'
import type { MigrationStep } from '../services/migrations'
import { configModule } from './config'
import { CONFIG_MIGRATIONS } from './config/persisted-migrations'
import { downloadsModule } from './downloads'
import { homeModule } from './home'
import { libraryModule } from './library'
import { modsModule } from './mods'
import { replaysModule } from './replays'
import { serversModule } from './servers'
import type { MainModule } from './types'

/**
 * Every main-process module the shell loads, in order.
 *
 * Story 070: `downloads` has a working main half, so it is registered
 * here like every other module - its `MODULE_MANIFESTS` entry (`src/shared/types/module.ts`)
 * deliberately keeps `status: 'planned'` regardless, since the renderer half (wizard/Downloads
 * tab UI) is a later story. Story 188 registers `mods` (list/reveal); `assets` remains parked with
 * no entry here yet. Adding one is a
 * single line - see `src/main/modules/library/index.ts` for the reference shape and
 * docs/ARCHITECTURE.md for the full checklist.
 */
export const MODULES: readonly MainModule[] = [
  homeModule,
  libraryModule,
  configModule,
  downloadsModule,
  serversModule,
  replaysModule,
  modsModule,
]

/**
 * Every module's `state.json` migration steps in one ascending list (the shell's runner validates
 * that it ends at `STATE_SCHEMA_VERSION`). Only config has any; a module adding steps keeps the
 * concatenation sorted by `to`.
 */
export const MODULE_MIGRATIONS: readonly MigrationStep[] = [...CONFIG_MIGRATIONS]

export async function registerModules(app: AppContext): Promise<void> {
  for (const module of MODULES) {
    await app.modules.register(module, app)
  }
}

export type { MainModule, ModuleSetup, ModuleHandler } from './types'
