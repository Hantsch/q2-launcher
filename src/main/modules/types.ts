import type { ZodType } from 'zod'
import type { ModuleId } from '@shared/types'
import type { Logger } from '../lib/logger'
import type { AppContext } from '../context'

/**
 * A registered handler as the registry stores it. The schema has already
 * narrowed the payload by the time it is called, so the stored signature
 * forgets the concrete type - `ModuleSetup.handle` is where schema and handler
 * are tied together.
 */
export type ModuleHandler = (payload: unknown) => Promise<unknown> | unknown

/** What the shell hands a module during registration. */
export interface ModuleSetup {
  /**
   * Registers a handler callable from the renderer as `{ moduleId, type }`.
   *
   * The schema is a required parameter, not an option: `MainModuleRegistry`
   * parses the incoming payload against it and answers
   * `fail('ipc.error.invalidPayload')` before the handler runs, so no module
   * handler ever sees an unvalidated payload. `T` exists only to link `schema`
   * to `handler` at the call site - a schema that parses to the wrong shape is
   * a compile error there. A handler that takes no payload passes `z.void()`.
   */
  handle: <T>(
    type: string,
    schema: ZodType<T>,
    handler: (payload: T) => Promise<unknown> | unknown,
  ) => void
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
