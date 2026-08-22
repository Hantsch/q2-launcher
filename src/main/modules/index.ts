import type { AppContext } from '../context'
import { configModule } from './config'
import { libraryModule } from './library'
import type { MainModule } from './types'

/**
 * Every main-process module the shell loads, in order.
 *
 * Parked modules (`downloads`, `mods`, `assets`) are declared in
 * `src/shared/types/module.ts` so the UI can show them as "planned", but they
 * have no entry here yet. Adding one is a single line - see
 * `src/main/modules/library/index.ts` for the reference shape and
 * docs/ARCHITECTURE.md for the full checklist.
 */
const MODULES: readonly MainModule[] = [libraryModule, configModule]

export async function registerModules(app: AppContext): Promise<void> {
  for (const module of MODULES) {
    await app.modules.register(module, app)
  }
}

export type { MainModule, ModuleSetup, ModuleHandler } from './types'
