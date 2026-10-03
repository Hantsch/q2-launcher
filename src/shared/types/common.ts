import type { ReleaseNoteSection } from '../release-notes'

/** Platforms the launcher can run on. Avoids depending on Node's `NodeJS.Platform`. */
export type Platform = 'win32' | 'darwin' | 'linux'

/** Version and path information about the running launcher, for the About/Settings UI. */
export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: Platform
  /** `os.release()` - the OS kernel/build version, for bug reports. */
  osVersion: string
  /** `app.getPath('userData')` - where the launcher stores its own state. */
  userDataPath: string
  /** Where `electron-log` writes. Surfaced so users can attach logs to bug reports. */
  logPath: string
  isDev: boolean
  isPackaged: boolean
}

/**
 * One version's release notes, already parsed into data (story 099 R2: never an HTML string).
 *
 * `null` - not a separate error shape - is the honest answer whenever the version in question has
 * no section in the changelog it was resolved from: a development build, a build from before
 * releases were published, or a version bump whose changelog entry isn't written yet. AC5 renders
 * that as an empty state, so it is a normal outcome rather than a failure.
 */
export type ReleaseNotes = {
  version: string
  date: string
  sections: ReleaseNoteSection[]
} | null

/**
 * A message the main process wants the UI to render.
 *
 * Main never sends prose: it sends an i18n key plus parameters, so all
 * user-visible text lives in `src/renderer/src/i18n/locales/` and each module's `locale/` folder.
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

/**
 * Strict envelope check. A domain union that merely carries `ok: true` (`{ ok: true, list: [] }`)
 * is deliberately not an Outcome: only an own `value` key (success) or a keyed `error` (failure)
 * counts, so a handler's own result shape is never mistaken for the envelope.
 */
export function isOutcome(value: unknown): value is Outcome<unknown> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.ok === true) return Object.prototype.hasOwnProperty.call(candidate, 'value')
  if (candidate.ok === false) {
    const error = candidate.error
    return (
      typeof error === 'object' &&
      error !== null &&
      typeof (error as Record<string, unknown>).key === 'string'
    )
  }
  return false
}

export function fail(key: string, params?: Record<string, string | number>): Outcome<never> {
  return { ok: false, error: params ? { key, params } : { key } }
}

/**
 * A handler's expected domain "no", returned inside `Outcome.value`. `reasonKey` is always a full
 * i18n key the renderer can show as-is - never a code it has to template into a key.
 */
export type Refusal<R extends string = string> = {
  ok: false
  reasonKey: R
  params?: Record<string, string | number>
}

/** A domain result: success carrying `T` (bare success: `Record<never, never>`) or a `Refusal`. */
export type DomainResult<T extends object, R extends string = string> =
  | ({ ok: true } & T)
  | Refusal<R>

export function refuse<R extends string>(
  reasonKey: R,
  params?: Record<string, string | number>
): Refusal<R> {
  return params ? { ok: false, reasonKey, params } : { ok: false, reasonKey }
}
