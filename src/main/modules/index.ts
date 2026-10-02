import type { AppContext } from '../context'
import { configModule } from './config'
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
 * Story 070 D4: `downloads` has a working main half, so it is registered
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

export async function registerModules(app: AppContext): Promise<void> {
  for (const module of MODULES) {
    await app.modules.register(module, app)
  }
}

export type { MainModule, ModuleSetup, ModuleHandler } from './types'
