/** Platforms the launcher can run on. Avoids depending on Node's `NodeJS.Platform`. */
export type Platform = 'win32' | 'darwin' | 'linux'

/** Version and path information about the running launcher, for the About/Settings UI. */
export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: Platform
  /** `app.getPath('userData')` - where the launcher stores its own state. */
  userDataPath: string
  /** Where `electron-log` writes. Surfaced so users can attach logs to bug reports. */
  logPath: string
  isDev: boolean
  isPackaged: boolean
}

/**
 * A message the main process wants the UI to render.
 *
 * Main never sends prose: it sends an i18n key plus parameters, so all
 * user-visible text lives in `src/renderer/src/i18n/locales/*.json`.
 */
export interface LocalizedMessage {
  key: string
  params?: Record<string, string | number>
}

/** Explicit success/failure envelope for operations the user can trigger and that can fail. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: LocalizedMessage }

export function ok<T>(value: T): Outcome<T> {
  return { ok: true, value }
}

export function fail(key: string, params?: Record<string, string | number>): Outcome<never> {
  return { ok: false, error: params ? { key, params } : { key } }
}
