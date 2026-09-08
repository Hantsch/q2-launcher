import type { AppContext } from '../context'
import { configModule } from './config'
import { downloadsModule } from './downloads'
import { libraryModule } from './library'
import type { MainModule } from './types'

/**
 * Every main-process module the shell loads, in order.
 *
 * Story 070 D4: `downloads` now has a working main half (`manifest.get`), so it is registered
 * here like every other module - its `MODULE_MANIFESTS` entry (`src/shared/types/module.ts`)
 * deliberately keeps `status: 'planned'` regardless, since the renderer half (wizard/Downloads
 * tab UI) is a later story. `mods`/`assets` remain parked with no entry here yet. Adding one is a
 * single line - see `src/main/modules/library/index.ts` for the reference shape and
 * docs/ARCHITECTURE.md for the full checklist.
 */
const MODULES: readonly MainModule[] = [libraryModule, configModule, downloadsModule]

export async function registerModules(app: AppContext): Promise<void> {
  for (const module of MODULES) {
    await app.modules.register(module, app)
  }
}

export type { MainModule, ModuleSetup, ModuleHandler } from './types'
