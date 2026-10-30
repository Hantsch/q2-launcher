import type {
  Job,
  Outcome,
  UpdateDownloadProgress,
  UpdatePhase,
  UpdateSimulateScenario,
  UpdateState,
} from '@shared/types'
import type { PersistenceRegistry } from '../persistence'
import { UpdateChecks } from './check'
import { UpdateDownloads } from './download'
import { UpdateSimulation } from './simulate'
import { UpdateStateCell, type DownloadStage } from './state'
import type { UpdateCheckStore } from './store'

/**
 * Story 097: the update-check service - the only thing that decides *whether* a check runs, and
 * the only owner of `UpdateState`. Mirrors `src/main/modules/home/news/news-service.ts`: injected
 * `now`, injected checker, injected store, never throws, and no timer anywhere in this file (the
 * 24h window is a comparison against a persisted timestamp, not an interval - a long-running
 * session re-checks at the next start or when the user asks).
 *
 * ## Story 098: the staged actions, and the one guard that matters
 *
 * `startDownload` / `cancelDownload` / `installAndRestart` / `dismiss` are the four things a user
 * can do about a known update, and only a user does them - nothing below runs on its own.
 *
 * `installAndRestart` is the only call in the whole app that quits the launcher and overwrites its
 * own installation, so it is deliberately shaped guard-then-`fail(key)`, mirroring
 * `LaunchService.start()`'s `launch.error.installationBusy` refusal (story 091): it *reads*
 * `isGameRunning()` and the job list and refuses, and it cancels neither. A refusal is
 * authoritative here in main - a disabled button in the renderer is a courtesy, never the thing
 * standing between a running game and a restart.
 *
 * The other half of that is {@link UpdateBackend.autoInstallOnAppQuit}: left at `electron-updater`'s
 * default, a finished download installs itself on the next ordinary quit, which would make the
 * second confirmation meaningless. It is set to `false` when the service is built *and* again
 * before every download starts - the flag matters at the moment the download completes, which is
 * when `electron-updater` arms its quit handler.
 *
 * ## The seam the checker fills
 *
 * The service never imports `electron-updater`; it calls an injected {@link UpdateChecker} and
 * *relays* whatever that reports. In particular it never compares versions itself - per the
 * story's Decision the semver comparison is `electron-updater`'s own
 * `UpdateCheckResult.isUpdateAvailable`, which is exactly what `available` below carries.
 *
 * ## Why a failure can never quietly stop the launcher from checking
 *
 * `lastSuccessAt` is written *only* by a successful attempt and is the only thing the 24h window is
 * measured from, so "a failed check does not burn the daily window") holds by construction
 * rather than by a special case: a failed attempt moves `lastCheckedAt` and nothing else. For the
 * same reason a failure never nulls out `update` - the last *known* release outlives the last
 * *attempt*, so an update found yesterday still shows after an offline start today.
 *
 * Two more things guard the "stuck forever" shapes of this file:
 *
 *  - a hung checker cannot strand `status: 'checking'` - {@link UPDATE_CHECK_TIMEOUT_MS} turns it
 *    into a normal failed attempt, and the in-flight slot is released either way, so the *next*
 *    check still runs;
 *  - a `lastSuccessAt` in the future (a clock that was wrong once, then corrected) counts as
 *    "window open", not as a window that closes 24h after some date in 2049.
 *
 * Nothing here toasts, retries or broadcasts: `onStateChange` is a plain callback and the IPC layer is what
 * wires it to `update:state`.
 *
 * ## The parts
 *
 * This file holds the public vocabulary and wires the parts together. The mutable state lives in a
 * single `UpdateStateCell` (`state.ts`) that `check.ts`, `download.ts` and `simulate.ts` all write
 * through, so every transition is still published from one place (story 323).
 */

/** The 24h auto-check window, measured from `lastSuccessAt`. */
export const UPDATE_CHECK_WINDOW_MS = 24 * 60 * 60 * 1000

/** How long a single check may take before it counts as a failed attempt (Decisions: "a 20s
 * timeout guard - a hung request cannot strand the state in `checking` forever"). */
export const UPDATE_CHECK_TIMEOUT_MS = 20_000

/**
 * Why a check attempt failed. Every value maps to its own `update.error.*` key
 * ({@link updateErrorKey}); the checker adapter classifies `electron-updater`'s errors into these.
 *
 * `'timeout'` is the one reason a checker must never return: the service produces it itself when
 * the call outruns {@link UPDATE_CHECK_TIMEOUT_MS}.
 */
export type UpdateCheckFailureReason = 'network' | 'http' | 'notConfigured' | 'timeout' | 'unknown'

/**
 * What `checker.ts` resolves with. Deliberately a resolved value rather than a thrown error:
 * the reason is part of the result, not an exception. A checker that *does* throw is still safe -
 * the service treats it as `{ ok: false, reason: 'unknown' }`.
 *
 * `available` is `electron-updater`'s own verdict (`UpdateCheckResult.isUpdateAvailable`), never
 * recomputed here.
 */
export type UpdateCheckOutcome =
  | { ok: true; available: true; update: NonNullable<UpdateState['update']> }
  | { ok: true; available: false }
  | { ok: false; reason: UpdateCheckFailureReason }

/** The injected check. Called with no arguments; resolves, ideally, within the timeout. */
export type UpdateChecker = () => Promise<UpdateCheckOutcome>

/** One i18n key per distinct failure cause - main sends keys, never prose. */
const ERROR_KEYS: Record<UpdateCheckFailureReason, string> = {
  network: 'update.error.network',
  http: 'update.error.http',
  notConfigured: 'update.error.notConfigured',
  timeout: 'update.error.timeout',
  unknown: 'update.error.unknown',
}

/** The `update.error.*` key for a failure reason. */
export function updateErrorKey(reason: UpdateCheckFailureReason): string {
  return ERROR_KEYS[reason]
}

/** Every key this service can put into `UpdateState.error` - the `en.json` test reads this. */
export const UPDATE_ERROR_KEYS: readonly string[] = Object.values(ERROR_KEYS)

// ---- story 098: downloading, and the refusals -------------------------------------------------

/**
 * Why a download attempt ended without a staged update (story 098). Every one of these leaves the
 * installed launcher untouched and the update still offerable - there is no reason here that means
 * "something on disk changed".
 *
 * `'cancelled'` is the user's own doing via {@link UpdateService.cancelDownload}; the other three
 * are the checker adapter classifying whatever `electron-updater` reported.
 */
export type UpdateDownloadFailureReason = 'offline' | 'checksum' | 'cancelled' | 'unknown'

/** What {@link UpdateBackend.download} resolves with - a resolved value, not a thrown error, for
 * the same reason {@link UpdateCheckOutcome} is one. A backend that *does* throw is still safe: the
 * service treats it as `{ ok: false, reason: 'unknown' }`. */
export type UpdateDownloadOutcome =
  | { ok: true }
  | { ok: false; reason: UpdateDownloadFailureReason }
  /** Not a failure: the server has nothing newer than what is running, so the known release is
   * stale. The service answers it with "up to date", never with an error. */
  | { ok: false; reason: 'upToDate' }

const DOWNLOAD_ERROR_KEYS: Record<UpdateDownloadFailureReason, string> = {
  offline: 'appUpdate.error.offline',
  checksum: 'appUpdate.error.checksum',
  cancelled: 'appUpdate.error.cancelled',
  unknown: 'appUpdate.error.downloadFailed',
}

/** The `appUpdate.error.*` key for a download failure. */
export function updateDownloadErrorKey(reason: UpdateDownloadFailureReason): string {
  return DOWNLOAD_ERROR_KEYS[reason]
}

/**
 * The keys an action can refuse with. Named rather than inlined, because these are the strings the
 * renderer mirrors and the e2e flow asserts on - a typo in one of them would otherwise only show up
 * as a missing translation.
 */
export const APP_UPDATE_REFUSAL_KEYS = {
  /** Nothing to download: no release is known, or this build cannot update itself at all. */
  notAvailable: 'appUpdate.error.notAvailable',
  /** asked to restart before the download finished. */
  notReady: 'appUpdate.error.notReady',
  /** a game this launcher started is running. */
  gameRunning: 'appUpdate.error.gameRunning',
  /** a download job is in flight. */
  jobActive: 'appUpdate.error.jobActive',
  /** The updater itself refused to hand over at the last moment; nothing was installed. */
  installFailed: 'appUpdate.error.installFailed',
} as const

/** Every `appUpdate.error.*` key story 098 can produce - the `en.json` coverage test reads this. */
export const APP_UPDATE_ERROR_KEYS: readonly string[] = [
  ...Object.values(DOWNLOAD_ERROR_KEYS),
  ...Object.values(APP_UPDATE_REFUSAL_KEYS),
]

/**
 * The seam between this service and whatever actually fetches and installs the release: the real
 * `electron-updater` adapter in `checker.ts` in production, a fake in tests and behind the
 * `dev:simulateAppUpdate`. As with {@link UpdateChecker}, the service never imports
 * `electron-updater` itself.
 */
export interface UpdateBackend {
  /**
   * Mirrors `electron-updater`'s flag of the same name, and is the reason it is on this interface
   * at all: the service sets it to `false` and a test can read it back (story 098). A backend must
   * apply it to the real updater, not just store it.
   */
  autoInstallOnAppQuit: boolean
  /**
   * Downloads the pending release, calling `onProgress` as it goes, and resolves once the download
   * has finished or failed.
   *
   * Contract: it **must** settle after {@link cancelDownload} - the service does not write the
   * "back to available" state from the cancel call itself, so a backend that never settles leaves
   * the phase stuck at `downloading`.
   */
  download(onProgress: (progress: UpdateDownloadProgress) => void): Promise<UpdateDownloadOutcome>
  /** Asks an in-flight {@link download} to stop. Called only while one is running. */
  cancelDownload(): void
  /**
   * Quits the launcher and installs the staged release. Called from exactly one place
   * ({@link UpdateService.installAndRestart}), and only after every guard has passed.
   */
  quitAndInstall(): void
}

/**
 * The single place {@link UpdateState.phase} is decided, so `phase` and `status` cannot drift.
 *
 * A staged or in-flight download outranks everything: it is what the user is waiting on. Otherwise
 * a *known* release outranks a failed attempt, which is what makes two things true by construction
 * rather than by special case - story 097 (a failed check never erases what is known) and story 098 (a
 * failed download falls back to `available`, carrying its reason, with nothing installed).
 */
export function resolveUpdatePhase(
  status: UpdateState['status'],
  hasUpdate: boolean,
  stage: DownloadStage,
): UpdatePhase {
  if (stage === 'downloading') return 'downloading'
  if (stage === 'downloaded') return 'downloaded'
  if (status === 'checking') return 'checking'
  if (hasUpdate) return 'available'
  if (status === 'error') return 'error'
  return 'idle'
}

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`); optional, as in `store.ts`. */
export interface UpdateServiceLog {
  warn(message: string): void
}

export interface UpdateServiceOptions {
  /** `app.isPackaged`, injected as a plain boolean so no test needs Electron. `false` makes the
   * whole service a no-op reporting `supported: false` - no checker call, no store read. */
  isPackaged: boolean
  /** `app.getVersion()`: a restored record whose known release *is* this version is stale - the
   * user installed it - and is dropped instead of offered again. */
  currentVersion: string
  /** The checker adapter, injected. */
  check: UpdateChecker
  /**
   * Story 098: what actually downloads and installs. Required rather than optional on purpose -
   * a forgotten backend would make the whole update path silently inert, and the compiler is the
   * cheapest place to notice that.
   */
  backend: UpdateBackend
  /**
   * Story 098: `LaunchService.isRunning()`, injected as a plain predicate so the service stays
   * Electron-free. Required for the same reason as `backend`: a guard that defaults to "nothing is
   * running" is a guard that silently is not there.
   */
  isGameRunning: () => boolean
  /** Story 098: `JobsService.list()`. The *list*, not a boolean, so the "is anything active"
   * question is answered by `isJobActive` from the shared contract rather than re-derived here. */
  listJobs: () => Job[]
  /** Called on every state change; the IPC layer wires it to `broadcast.emit('update:state', …)`. A listener
   * that throws is logged and ignored - it can never break a check. */
  onStateChange: (state: UpdateState) => void
  /** Defaults to a real {@link UpdateCheckStore}, built lazily (its path resolves through
   * `app.getPath('userData')`, which is only safe once Electron is ready - and never in a test). */
  store?: Pick<UpdateCheckStore, 'load' | 'save'>
  /** Where the lazily built default store registers itself so shutdown can settle it. */
  persistence?: PersistenceRegistry
  now?: () => Date
  timeoutMs?: number
  log?: UpdateServiceLog
}

export interface UpdateService {
  /** The current state, restoring the persisted record first if that has not happened yet.
   * Never checks, never throws. */
  getState(): Promise<UpdateState>
  /** A manual check: always runs, regardless of the 24h window, and resolves with the
   * resulting state - including a failure reason. Joins an already-running check instead of
   * starting a second one. Never rejects. */
  checkNow(): Promise<UpdateState>
  /** The startup check: returns `void` *immediately*, without awaiting anything, which is
   * what makes "does not block startup" true by construction. Checks only if the 24h window is
   * open and the build is packaged. */
  scheduleStartupCheck(): void

  // ---- story 098: the four staged actions ----------------------------------------------------

  /**
   * Starts downloading the known release and resolves as soon as it has *started* (story 098) - the
   * launcher stays usable and progress arrives through `onStateChange`. Refuses with
   * `appUpdate.error.notAvailable` when there is nothing to download; a call while a download is
   * already running or staged is a no-op reporting the current state.
   */
  startDownload(): Promise<Outcome<UpdateState>>
  /** Asks the backend to stop an in-flight download. The state returns to `available` carrying
   * `appUpdate.error.cancelled` once the backend settles. A no-op otherwise. */
  cancelDownload(): Outcome<UpdateState>
  /**
   * The second, deliberate confirmation: quits the launcher and installs the staged release.
   * Refuses - and changes nothing at all - unless the download has finished
   * (`appUpdate.error.notReady`), no game this launcher started is running
   * (`appUpdate.error.gameRunning`) and no job is in flight (`appUpdate.error.jobActive`). It never
   * cancels the game or the job it refuses for.
   */
  installAndRestart(): Promise<Outcome<null>>
  /** drop the attention marker for this session. In-memory, never persisted; the control
   * itself stays reachable, and nothing about the update itself changes. */
  dismiss(): Outcome<UpdateState>

  /**
   * Story 098: drives a `dev:simulateAppUpdate` scenario through the exact same
   * `emit`/`publish` machinery every real transition in this file uses - fixture releases in e2e
   * tests are not real installers to check for or fetch, so this is the offline stand-in for a
   * real check/download. Mirrors `LaunchService.simulate()`: a permanent method on the real
   * service, reachable only through the dev-only IPC channel (`src/main/ipc/dev.ts`), never called
   * in production. It never touches `supported`, the checker or the backend - and it is not how
   * the restart guard is exercised: `installAndRestart()` itself is real and unfaked, called
   * directly once `simulate({ scenario: 'downloaded' })` has staged a release.
   */
  simulate(scenario: UpdateSimulateScenario): void
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const now = options.now ?? ((): Date => new Date())
  const cell = new UpdateStateCell(options)
  const checks = new UpdateChecks(cell, options, now)
  const downloads = new UpdateDownloads(cell, checks, options, now)
  const simulation = new UpdateSimulation(cell, checks, now)
  return {
    getState: checks.getState.bind(checks),
    checkNow: checks.checkNow.bind(checks),
    scheduleStartupCheck: checks.scheduleStartupCheck.bind(checks),
    startDownload: downloads.startDownload.bind(downloads),
    cancelDownload: downloads.cancelDownload.bind(downloads),
    installAndRestart: downloads.installAndRestart.bind(downloads),
    dismiss: downloads.dismiss.bind(downloads),
    simulate: simulation.simulate.bind(simulation),
  }
}
