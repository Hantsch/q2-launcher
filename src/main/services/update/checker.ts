import type { UpdateDownloadProgress, UpdateState } from '@shared/types/update'
import { scopedLogger, type Logger } from '../../lib/logger'
import type {
  UpdateBackend,
  UpdateCheckFailureReason,
  UpdateCheckOutcome,
  UpdateChecker,
  UpdateDownloadFailureReason,
  UpdateDownloadOutcome,
} from './service'

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

/**
 * The one way this file is allowed to get hold of the real `autoUpdater`, because reaching for
 * `(await import('electron-updater')).autoUpdater` directly does not survive packaging.
 *
 * `electron-updater` does not export `autoUpdater` as a plain binding: it installs it with
 * `Object.defineProperty(exports, 'autoUpdater', { get })`, a lazy getter that constructs the
 * platform-specific updater (`AppImageUpdater`, `NsisUpdater`, …) on first access. Node's
 * named-export detection for a CommonJS module is *static*, so it never sees that getter: in the
 * packaged build the namespace object's `autoUpdater` is `undefined` and the value is only
 * reachable through `default`. Dev never shows this - `supported` is `app.isPackaged`, so an
 * unpackaged run never checks and never performs this import at all.
 *
 * Symptom before this existed: every update check on a packaged build died with "Cannot set
 * properties of undefined (setting 'autoDownload')" in `configureAutoUpdater()`. Caught by
 * `scripts/linux-update-e2e.mjs` (story 101 D6), not by any unit test - the shape being worked
 * around here only exists in a real packaged bundle, which is also why the explicit `throw` below
 * is worth its two lines: if a future `electron-updater` changes shape again, this says so instead
 * of failing four frames later on a property assignment.
 */
async function importAutoUpdater(): Promise<AutoUpdaterLike> {
  const mod = await import('electron-updater')
  // The named export first, and `default` only if that came back undefined: the named export is a
  // getter whose *access* is what constructs the platform updater, so consulting `default`
  // speculatively would touch it an extra time (and swallow the very first construction error the
  // retry logic in `createUpdateChecker` exists to recover from).
  const resolved = (mod.autoUpdater ??
    (mod as { default?: { autoUpdater?: unknown } }).default?.autoUpdater) as
    | AutoUpdaterLike
    | undefined
  if (resolved === undefined) {
    throw new Error(
      'electron-updater exposed no `autoUpdater`, neither as a named export nor on `default`',
    )
  }
  return resolved
}

/** Joins array-form release notes into one string; a plain string passes through unchanged.
 * `null`/`undefined` becomes `''` - "no notes" is not an error. */
function joinNotes(notes: string | Array<AutoUpdaterReleaseNote> | null | undefined): string {
  if (notes === null || notes === undefined) return ''
  if (typeof notes === 'string') return notes
  return notes.map((entry) => entry.note ?? '').join('\n\n')
}

/** Any HTML start/end tag - the test for "this body is HTML, not markdown". */
const HTML_TAG = /<\/?[a-z][a-z0-9]*\b[^>]*>/i

const HTML_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Decodes the handful of entities GitHub emits plus numeric ones; `&amp;` goes last so an
 * escaped `&amp;lt;` stays the literal text `&lt;` instead of being decoded twice. */
function decodeHtmlEntities(text: string): string {
  // Out-of-range code points would make `fromCodePoint` throw; foreign content must not.
  const codePoint = (value: number): string =>
    Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, name: string) => HTML_ENTITIES[name] ?? '')
    .replace(/&amp;/g, '&')
}

/** Strips every tag and folds whitespace (including `<br>` line wraps) into single spaces. */
function htmlToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * GitHub's releases feed - where `electron-updater`'s GitHub provider reads `releaseNotes` from -
 * delivers the release body *rendered*: `<h3>Added</h3><ul><li>…</li></ul>`, not the markdown the
 * release was created with. `parseReleaseNotes` (`src/shared/release-notes.ts`) only reads the
 * `### Heading` / `- item` subset, so an HTML body parsed to zero sections and every update showed
 * "This version has no release notes". This maps the rendered shape back onto that subset; every
 * other tag is dropped, never passed on - the notes stay plain text. A body with no tags at all
 * (markdown from `latest.yml`, or plain text) passes through unchanged.
 */
export function releaseNotesHtmlToMarkdown(notes: string): string {
  if (!HTML_TAG.test(notes)) return notes
  return notes
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, inner: string) => `\n### ${htmlToText(inner)}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => `\n- ${htmlToText(inner)}\n`)
    .split('\n')
    .map((line) => (/^(###|-) /.test(line) ? line : htmlToText(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** `UpdateInfo` -> `UpdateState['update']`: joins array-form notes, maps an HTML body back onto
 * markdown, caps at {@link NOTES_MAX_LENGTH}, and defaults a missing release date to `null` rather
 * than an empty string (AC2 + the story's "array notes joined and capped"). */
function normalizeUpdateInfo(info: AutoUpdaterUpdateInfo): NonNullable<UpdateState['update']> {
  const joined = releaseNotesHtmlToMarkdown(joinNotes(info.releaseNotes))
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
      const real = await importAutoUpdater()
      configureAutoUpdater(real, log)
      return real
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

// ---- story 098: the download/install half of the same adapter ----------------------------------

/** The slice of `electron-updater`'s `ProgressInfo` this adapter reads (`percent` is 0..100). */
export interface AutoUpdaterProgressInfo {
  readonly bytesPerSecond?: number
  readonly percent?: number
  readonly transferred?: number
  readonly total?: number
}

/** The rest of `electron-updater`'s `autoUpdater` that story 098 needs: downloading, the progress
 * event, and the one call that replaces the installed launcher. Structural for the same reason
 * {@link AutoUpdaterLike} is. */
export interface AutoUpdaterDownloadLike extends AutoUpdaterLike {
  downloadUpdate(cancellationToken?: unknown): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'download-progress', listener: (info: AutoUpdaterProgressInfo) => void): unknown
  off(event: 'download-progress', listener: (info: AutoUpdaterProgressInfo) => void): unknown
}

/**
 * `builder-util-runtime`'s `CancellationToken` shape - the token `downloadUpdate()` takes, and the
 * only way `electron-updater` offers to stop a download in flight. Loaded through a dynamic import
 * like `autoUpdater` above, and from `builder-util-runtime` because `electron-updater` does not
 * re-export it; it is `electron-updater`'s own hard dependency, so it is always installed beside
 * it. A failure to load it costs cancellation, not the download.
 */
interface CancellationTokenLike {
  cancel(): void
}

/**
 * Classifies a failed download into one of story 098 AC7's reasons. `'cancelled'` is checked first:
 * `electron-updater` reports a cancelled download as a rejection like any other, and telling the
 * user their own cancel was a network failure would be actively misleading.
 */
export function classifyDownloadError(error: unknown): UpdateDownloadFailureReason {
  const message = errorMessage(error)
  const code = errorCode(error)

  if (code === 'ERR_UPDATER_CANCELLED' || /cancell?ed/i.test(message)) return 'cancelled'
  // `electron-updater` verifies the sha512 of what it downloaded and the publisher signature of the
  // installer; both mean "the bytes are not the release", which is a distinct thing to tell a user.
  if (/sha512|checksum|integrity|signature/i.test(message)) return 'checksum'
  if (code !== undefined && NETWORK_ERROR_CODES.has(code)) return 'offline'

  return 'unknown'
}

/** `ProgressInfo` -> the contract's own progress shape. A missing or zero total stays `null` rather
 * than becoming a fake 0, so the UI can show an indeterminate bar instead of a wrong one. */
function normalizeProgress(info: AutoUpdaterProgressInfo): UpdateDownloadProgress {
  const total = typeof info.total === 'number' && info.total > 0 ? info.total : null
  const percent = typeof info.percent === 'number' ? info.percent : null
  return {
    ratio: percent === null ? null : Math.min(1, Math.max(0, percent / 100)),
    bytesDone: typeof info.transferred === 'number' ? info.transferred : 0,
    bytesTotal: total,
    bytesPerSecond: typeof info.bytesPerSecond === 'number' ? info.bytesPerSecond : null,
  }
}

export interface CreateUpdateBackendOptions {
  /** Injected in tests; defaults to the real `electron-updater` singleton, resolved lazily. */
  autoUpdater?: AutoUpdaterDownloadLike
  /** Injected in tests; defaults to `electron-updater`'s own `CancellationToken`. */
  createCancellationToken?: () => CancellationTokenLike
  log?: Logger
}

/**
 * Builds the {@link UpdateBackend} the update service drives (story 098 D1).
 *
 * `autoInstallOnAppQuit` is an accessor rather than a plain field because the real updater is
 * resolved lazily: the service sets the flag the moment it is constructed, which can be before the
 * dynamic import has happened, so the value is remembered and applied to the real `autoUpdater` as
 * soon as one exists. Getting this wrong is exactly the failure story 098 AC4 is about - a
 * downloaded update installing itself on the next ordinary quit - so the flag is never merely
 * stored here.
 */
export function createUpdateBackend(options: CreateUpdateBackendOptions = {}): UpdateBackend {
  const log = options.log ?? scopedLogger('update')

  let desiredAutoInstall = false
  let resolved: AutoUpdaterDownloadLike | undefined = options.autoUpdater
  let resolving: Promise<AutoUpdaterDownloadLike> | undefined
  let cancellationToken: CancellationTokenLike | undefined

  async function updater(): Promise<AutoUpdaterDownloadLike> {
    if (options.autoUpdater !== undefined) return options.autoUpdater
    resolving ??= (async () => {
      const real = (await importAutoUpdater()) as unknown as AutoUpdaterDownloadLike
      configureAutoUpdater(real, log)
      real.autoInstallOnAppQuit = desiredAutoInstall
      resolved = real
      return real
    })().catch((error: unknown) => {
      resolving = undefined
      throw error
    })
    return resolving
  }

  async function newCancellationToken(): Promise<CancellationTokenLike | undefined> {
    if (options.createCancellationToken !== undefined) return options.createCancellationToken()
    try {
      const mod = await import('builder-util-runtime')
      return new mod.CancellationToken()
    } catch (error) {
      // Without a token a download simply cannot be cancelled; that is worth a log line, not a
      // refusal to download at all.
      log.warn(`update: no cancellation token available (${errorMessage(error) || String(error)})`)
      return undefined
    }
  }

  return {
    get autoInstallOnAppQuit(): boolean {
      return desiredAutoInstall
    },
    set autoInstallOnAppQuit(value: boolean) {
      desiredAutoInstall = value
      if (resolved !== undefined) resolved.autoInstallOnAppQuit = value
    },

    async download(
      onProgress: (progress: UpdateDownloadProgress) => void,
    ): Promise<UpdateDownloadOutcome> {
      let target: AutoUpdaterDownloadLike
      try {
        target = await updater()
      } catch (error) {
        log.warn(
          `update: the updater could not be loaded (${errorMessage(error) || String(error)})`,
        )
        return { ok: false, reason: 'unknown' }
      }

      const listener = (info: AutoUpdaterProgressInfo): void => {
        onProgress(normalizeProgress(info))
      }
      target.on('download-progress', listener)
      try {
        // `downloadUpdate()` needs a check to have resolved *in this process*, which a state
        // restored from the previous session's record has not - so the check is repeated here
        // rather than assumed. `autoDownload` is off, so this only fetches the metadata.
        const result = await target.checkForUpdates()
        if (result === null || !result.isUpdateAvailable) {
          // Not a failure: the known release is stale (typically it is the one now running), and
          // the service turns this into "up to date" instead of a download error.
          log.warn('update: asked to download, but the server reports no newer release')
          return { ok: false, reason: 'upToDate' }
        }

        cancellationToken = await newCancellationToken()
        await target.downloadUpdate(cancellationToken)
        return { ok: true }
      } catch (error) {
        log.warn(`update: downloadUpdate() failed (${errorMessage(error) || String(error)})`)
        return { ok: false, reason: classifyDownloadError(error) }
      } finally {
        cancellationToken = undefined
        target.off('download-progress', listener)
      }
    },

    cancelDownload(): void {
      cancellationToken?.cancel()
    },

    quitAndInstall(): void {
      // The only call in the app that replaces the installed launcher. Everything that decides
      // *whether* it may happen lives in `service.ts`'s `installAndRestart()`.
      //
      // A backend that never resolved an updater cannot have downloaded anything either, so this
      // throws rather than returning quietly - the service turns that into
      // `appUpdate.error.installFailed` instead of telling the user a restart is under way that
      // will never come.
      if (resolved === undefined) throw new Error('the updater was never loaded')
      resolved.quitAndInstall()
    },
  }
}
