import type { MainModule } from '../types'

/**
 * The home module - story 081 D1. The shell's hardcoded home screen becomes a
 * real module, but its main-process half has nothing to add yet: no handlers,
 * no IPC channel. Registering it here is what keeps its manifest entry
 * (`src/shared/types/module.ts`) reported as `available` rather than being
 * downgraded to `planned` by `MainModuleRegistry.manifests()`.
 *
 * Copy `src/main/modules/library/index.ts` when this module needs its first
 * handler.
 */
export const homeModule: MainModule = {
  id: 'home',

  setup({ log }) {
    log.debug('home module ready')
  },
}
