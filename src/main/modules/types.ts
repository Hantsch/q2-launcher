import type { ModuleId } from '@shared/types'
import type { Logger } from '../lib/logger'
import type { AppContext } from '../context'

/** A request handler a module exposes through the shell's `module:invoke` channel. */
export type ModuleHandler = (payload: unknown) => Promise<unknown> | unknown

/** What the shell hands a module during registration. */
export interface ModuleSetup {
  /** Registers a handler callable from the renderer as `{ moduleId, type }`. */
  handle: (type: string, handler: ModuleHandler) => void
  /** Pushes a namespaced event to the UI. */
  emit: (type: string, payload: unknown) => void
  /** Access to the shell's services: installations, jobs, settings, ... */
  app: AppContext
  log: Logger
}

/**
 * The main-process half of a module.
 *
 * A module never touches `ipcMain`, `BrowserWindow` or the state file directly -
 * it goes through `ModuleSetup`. That keeps the security surface fixed (the
 * preload allowlist cannot grow) and means the shell can load, skip or later
 * unload modules without special cases.
 */
export interface MainModule {
  id: ModuleId
  setup: (setup: ModuleSetup) => void | Promise<void>
  dispose?: () => void | Promise<void>
}
