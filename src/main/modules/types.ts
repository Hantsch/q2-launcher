import type { ZodType } from 'zod'
import type { FeatureName } from '@shared/features'
import type { ModuleId, Outcome } from '@shared/types'
import type { Logger } from '../lib/logger'
import type { AppContext } from '../context'

/**
 * A registered handler as the registry stores it. The schema has already
 * narrowed the payload by the time it is called, so the stored signature
 * forgets the concrete type - `ModuleSetup.handle` is where schema and handler
 * are tied together.
 */
export type ModuleHandler = (payload: unknown) => Promise<Outcome<unknown>> | Outcome<unknown>

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
   *
   * A handler returns an `Outcome<R>`, never a bare value: the registry passes it through
   * unchanged (a non-Outcome return is answered with `modules.error.handlerFailed`), so the
   * client receives exactly `Outcome<R>`, never a nested envelope.
   *
   * Story 130: `options.feature` gates the handler behind an unlockable feature. When that
   * feature is locked in this process, the handler is never registered at all - `module:invoke`
   * for that type then answers exactly like an unknown type (`modules.error.notImplemented`),
   * never a distinct "locked"/"forbidden" response, because any distinguishable answer would
   * reveal to a caller probing blind that the feature exists. Without `options.feature` the
   * handler is ungated and always registered.
   */
  handle: <T, R>(
    type: string,
    schema: ZodType<T>,
    handler: (payload: T) => Outcome<R> | Promise<Outcome<R>>,
    options?: { feature?: FeatureName },
  ) => void
  /** Pushes a namespaced event to the UI. */
  emit: (type: string, payload: unknown) => void
  /**
   * Access to the shell's services: installations, jobs, settings, ... A module reaches the OS,
   * the screen and the harness only through `app.os`, `app.displays`, `app.harness`, `app.env`,
   * `app.isPackaged` and `app.userDataDir` - never `electron` or `process.env` itself
   * (the narrow shell libs `lib/paths`, `lib/net/fetcher` and `lib/native-image` are the only other
   * route, one edge each, listed in `ALLOWED` in `src/architecture.test.ts`).
   */
  app: AppContext
  log: Logger
  /**
   * Registers a disposer for something `setup()` created. `MainModuleRegistry.disposeAll()` runs
   * all disposers in reverse registration order, so a later-created resource is released before
   * the one it depends on. Disposers registered before a throwing `setup()` still run.
   */
  onDispose: (cb: () => void | Promise<void>) => void
}

/**
 * The main-process half of a module.
 *
 * A module never touches `ipcMain` or `BrowserWindow` directly. It owns its persisted state
 * through its own `persisted.ts`, built on `app.state.section()`; everything else goes through
 * `ModuleSetup`. That keeps the security surface fixed (the
 * preload allowlist cannot grow) and means the shell can load, skip or later
 * unload modules without special cases.
 */
export interface MainModule {
  id: ModuleId
  setup: (setup: ModuleSetup) => void | Promise<void>
}
