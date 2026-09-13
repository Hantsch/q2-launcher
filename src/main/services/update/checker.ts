import type { UpdateState } from '@shared/types/update'
import { scopedLogger, type Logger } from '../../lib/logger'
import type { UpdateCheckFailureReason, UpdateCheckOutcome, UpdateChecker } from './service'

/**
 * Story 097 D4: the only file in the repo that imports `electron-updater`. Mirrors
 * `news-service.ts`'s `fetchImpl` seam - `service.ts` never sees `electron-updater`, only the
 * plain {@link UpdateChecker} function this file produces.
 *
 * The real `electron-updater` import is a *dynamic* `import()`, deferred until the returned
 * checker actually runs with no injected {@link AutoUpdaterLike} - not a static top-level import.
 * `electron-updater`'s own `autoUpdater` export is a lazy getter that, on first access, constructs
 * a platform updater (`NsisUpdater` on Windows) whose default `app` adapter talks to Electron's
 * `app` module - safe once the real app is ready, not safe merely from importing this file. A
 * static `import { autoUpdater } from 'electron-updater'` would risk exactly that early access
 * depending on how the bundler/test runner interops the CJS export; the dynamic import sidesteps
 * the question entirely, and it also means `checker.test.ts` - which always injects a fake
 * `autoUpdater` - never touches the real package or Electron at all.
 */

/** Release notes are treated as untrusted foreign content (Decisions): capped, never rendered or
 * sanitised here - that is story 099's job. */
const NOTES_MAX_LENGTH = 20_000

/** One entry of `UpdateInfo.releaseNotes` when `fullChangelog` mode returns an array instead of a
 * single string. Mirrors `builder-util-runtime`'s `ReleaseNoteInfo`, kept structural so this file
 * does not need a value import from `electron-updater`/`builder-util-runtime` to describe it. */
export interface AutoUpdaterReleaseNote {
  readonly version?: string
  readonly note?: string | null
}

/** The slice of `electron-updater`'s `UpdateInfo` this adapter reads. Structural on purpose: the
 * real `UpdateInfo` (and the fakes `checker.test.ts` builds) both satisfy this without either side
 * importing the other's type. */
export interface AutoUpdaterUpdateInfo {
  readonly version: string
  readonly releaseNotes?: string | Array<AutoUpdaterReleaseNote> | null
  readonly releaseDate?: string | null
}

/** The slice of `electron-updater`'s `UpdateCheckResult` this adapter reads. */
export interface AutoUpdaterCheckResult {
  readonly isUpdateAvailable: boolean
  readonly updateInfo: AutoUpdaterUpdateInfo
}

/** The slice of `electron-updater`'s `autoUpdater` singleton this adapter configures and calls -
 * satisfied structurally by the real `AppUpdater` instance and by `checker.test.ts`'s fakes alike. */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  logger: unknown
  checkForUpdates(): Promise<AutoUpdaterCheckResult | null>
}

/**
 * Sets the three config flags the story's Decisions fix (`autoDownload`/`autoInstallOnAppQuit`
 * off, `allowPrerelease` on) and wires `electron-updater`'s own diagnostics into the repo's scoped
 * `electron-log` logger, so they land in the app log instead of the console. Exported directly so
 * `checker.test.ts` can assert the flags on a plain fake object without going through a whole
 * checker run.
 */
export function configureAutoUpdater(target: AutoUpdaterLike, log: Logger): void {
  target.autoDownload = false
  target.autoInstallOnAppQuit = false
  target.allowPrerelease = true
  target.logger = log
}

/** Joins array-form release notes into one string; a plain string passes through unchanged.
 * `null`/`undefined` becomes `''` - "no notes" is not an error. */
function joinNotes(notes: string | Array<AutoUpdaterReleaseNote> | null | undefined): string {
  if (notes === null || notes === undefined) return ''
  if (typeof notes === 'string') return notes
  return notes.map((entry) => entry.note ?? '').join('\n\n')
}

/** `UpdateInfo` -> `UpdateState['update']`: joins array-form notes, caps at
 * {@link NOTES_MAX_LENGTH}, and defaults a missing release date to `null` rather than an empty
 * string (AC2 + the story's "array notes joined and capped"). */
function normalizeUpdateInfo(info: AutoUpdaterUpdateInfo): NonNullable<UpdateState['update']> {
  const joined = joinNotes(info.releaseNotes)
  const notes = joined.length > NOTES_MAX_LENGTH ? joined.slice(0, NOTES_MAX_LENGTH) : joined
  return {
    version: info.version,
    notes,
    releasedAt: info.releaseDate ?? null,
  }
}

/** Node/http system error codes that mean "could not reach the server at all" - offline, DNS
 * failure, a dropped connection - as opposed to a server that answered with an error status. */
const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ECONNABORTED',
  'EPIPE',
])

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function errorStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

/** Classifies whatever the faked/real `checkForUpdates()` throws into a distinct
 * {@link UpdateCheckFailureReason} - never `'timeout'` (the service produces that itself) and
 * falling back to `'unknown'` only when nothing more specific matches. */
export function classifyCheckError(error: unknown): UpdateCheckFailureReason {
  // An HTTP error response (`builder-util-runtime`'s `HttpError`, or any error shaped like one)
  // carries a numeric `statusCode` - checked first, since a 4xx/5xx is a distinct cause from "the
  // network was unreachable" even though both can originate from the same request.
  if (errorStatusCode(error) !== undefined) return 'http'

  const code = errorCode(error)
  if (code !== undefined && NETWORK_ERROR_CODES.has(code)) return 'network'

  // A packaged-but-misconfigured build: `electron-updater` reads `app-update.yml` (or
  // `dev-app-update.yml`) from disk before it ever makes a request, and a missing file surfaces as
  // a plain `ENOENT` - the same code a corrupt/absent config produces, so both count as
  // "not configured" rather than "unknown".
  if (code === 'ENOENT' || /app-update\.yml/i.test(errorMessage(error))) return 'notConfigured'

  return 'unknown'
}

export interface CreateUpdateCheckerOptions {
  /** Injected for `checker.test.ts`; defaults to the real `electron-updater` `autoUpdater`
   * singleton, loaded and configured lazily via a dynamic import on first use. */
  autoUpdater?: AutoUpdaterLike
  log?: Logger
}

/** Builds the {@link UpdateChecker} `service.ts` calls. Never throws itself - resolving with
 * `{ ok: false, reason: 'unknown' }` is the worst case if something above misbehaves, and even
 * that is redundant with the service's own catch-all. */
export function createUpdateChecker(options: CreateUpdateCheckerOptions = {}): UpdateChecker {
  const log = options.log ?? scopedLogger('update')

  // Memoizes only a *successful* resolution. A failed dynamic import/getter access must not stick
  // around forever: the `.catch()` below clears the slot before rethrowing, so the next call
  // retries the import instead of replaying a cached rejection for the rest of the app session.
  let realAutoUpdater: Promise<AutoUpdaterLike> | undefined
  async function resolveRealAutoUpdater(): Promise<AutoUpdaterLike> {
    realAutoUpdater ??= (async () => {
      const mod = await import('electron-updater')
      configureAutoUpdater(mod.autoUpdater, log)
      return mod.autoUpdater
    })().catch((error: unknown) => {
      realAutoUpdater = undefined
      throw error
    })
    return realAutoUpdater
  }

  return async function checkForUpdate(): Promise<UpdateCheckOutcome> {
    try {
      const updater = options.autoUpdater ?? (await resolveRealAutoUpdater())
      const result = await updater.checkForUpdates()
      if (result === null || !result.isUpdateAvailable) {
        return { ok: true, available: false }
      }
      return { ok: true, available: true, update: normalizeUpdateInfo(result.updateInfo) }
    } catch (error) {
      log.warn(`update: checkForUpdates() failed (${errorMessage(error) || String(error)})`)
      return { ok: false, reason: classifyCheckError(error) }
    }
  }
}
