import type {
  Job,
  Outcome,
  UpdateDownloadProgress,
  UpdatePhase,
  UpdateSimulateScenario,
  UpdateState,
} from '@shared/types'
import { fail, isJobActive, ok } from '@shared/types'
import { UpdateCheckStore, type UpdateCheckStoreData } from './store'

/**
 * Story 097 D3: the update-check service - the only thing that decides *whether* a check runs, and
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
 * `isGameRunning()` and the job list and refuses, and it cancels neither (AC6). A refusal is
 * authoritative here in main - a disabled button in the renderer is a courtesy, never the thing
 * standing between a running game and a restart.
 *
 * The other half of AC4 is {@link UpdateBackend.autoInstallOnAppQuit}: left at `electron-updater`'s
 * default, a finished download installs itself on the next ordinary quit, which would make the
 * second confirmation meaningless. It is set to `false` when the service is built *and* again
 * before every download starts - the flag matters at the moment the download completes, which is
 * when `electron-updater` arms its quit handler.
 *
 * ## The seam D4 fills
 *
 * The service never imports `electron-updater`; it calls an injected {@link UpdateChecker} and
 * *relays* whatever that reports. In particular it never compares versions itself - per the
 * story's Decision the semver comparison is `electron-updater`'s own
 * `UpdateCheckResult.isUpdateAvailable`, which is exactly what `available` below carries.
 *
 * ## Why a failure can never quietly stop the launcher from checking
 *
 * `lastSuccessAt` is written *only* by a successful attempt and is the only thing the 24h window is
 * measured from, so AC4 ("a failed check does not burn the daily window") holds by construction
 * rather than by a special case: a failed attempt moves `lastCheckedAt` and nothing else. For the
 * same reason a failure never nulls out `update` - the last *known* release outlives the last
 * *attempt* (AC3), so an update found yesterday still shows after an offline start today.
 *
 * Two more things guard the "stuck forever" shapes of this file:
 *
 *  - a hung checker cannot strand `status: 'checking'` - {@link UPDATE_CHECK_TIMEOUT_MS} turns it
 *    into a normal failed attempt, and the in-flight slot is released either way, so the *next*
 *    check still runs;
 *  - a `lastSuccessAt` in the future (a clock that was wrong once, then corrected) counts as
 *    "window open", not as a window that closes 24h after some date in 2049.
 *
 * Nothing here toasts, retries or broadcasts: `onStateChange` is a plain callback and D5 is what
 * wires it to `update:state`.
 */

/** The 24h auto-check window (AC1), measured from `lastSuccessAt`. */
export const UPDATE_CHECK_WINDOW_MS = 24 * 60 * 60 * 1000

/** How long a single check may take before it counts as a failed attempt (Decisions: "a 20s
 * timeout guard - a hung request cannot strand the state in `checking` forever"). */
export const UPDATE_CHECK_TIMEOUT_MS = 20_000

/**
 * Why a check attempt failed. Every value maps to its own `update.error.*` key
 * ({@link updateErrorKey}); D4's adapter classifies `electron-updater`'s errors into these.
 *
 * `'timeout'` is the one reason a checker must never return: the service produces it itself when
 * the call outruns {@link UPDATE_CHECK_TIMEOUT_MS}.
 */
export type UpdateCheckFailureReason = 'network' | 'http' | 'notConfigured' | 'timeout' | 'unknown'

/**
 * What D4's `checker.ts` resolves with. Deliberately a resolved value rather than a thrown error:
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

/** Every key this service can put into `UpdateState.error` - D6's `en.json` test reads this. */
export const UPDATE_ERROR_KEYS: readonly string[] = Object.values(ERROR_KEYS)

// ---- story 098: downloading, and the refusals -------------------------------------------------

/**
 * Why a download attempt ended without a staged update (098 AC7). Every one of these leaves the
 * installed launcher untouched and the update still offerable - there is no reason here that means
 * "something on disk changed".
 *
 * `'cancelled'` is the user's own doing via {@link UpdateService.cancelDownload}; the other three
 * are D4's adapter classifying whatever `electron-updater` reported.
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
  /** AC4: asked to restart before the download finished. */
  notReady: 'appUpdate.error.notReady',
  /** AC6: a game this launcher started is running. */
  gameRunning: 'appUpdate.error.gameRunning',
  /** AC6: a download job is in flight. */
  jobActive: 'appUpdate.error.jobActive',
  /** The updater itself refused to hand over at the last moment; nothing was installed. */
  installFailed: 'appUpdate.error.installFailed',
} as const

/** Every `appUpdate.error.*` key story 098 can produce - D3's `en.json` coverage test reads this. */
export const APP_UPDATE_ERROR_KEYS: readonly string[] = [
  ...Object.values(DOWNLOAD_ERROR_KEYS),
  ...Object.values(APP_UPDATE_REFUSAL_KEYS),
]

/**
 * The seam between this service and whatever actually fetches and installs the release: the real
 * `electron-updater` adapter in `checker.ts` in production, a fake in tests and behind D4's
 * `dev:simulateAppUpdate`. As with {@link UpdateChecker}, the service never imports
 * `electron-updater` itself.
 */
export interface UpdateBackend {
  /**
   * Mirrors `electron-updater`'s flag of the same name, and is the reason it is on this interface
   * at all: the service sets it to `false` and a test can read it back (098 AC4). A backend must
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

/** How far the *download* has got - the half of the phase that the check status knows nothing
 * about. Kept separate from `UpdateState.status` so the two can never contradict each other. */
type DownloadStage = 'none' | 'downloading' | 'downloaded'

/**
 * The single place {@link UpdateState.phase} is decided, so `phase` and `status` cannot drift.
 *
 * A staged or in-flight download outranks everything: it is what the user is waiting on. Otherwise
 * a *known* release outranks a failed attempt, which is what makes two things true by construction
 * rather than by special case - 097 AC3 (a failed check never erases what is known) and 098 AC7 (a
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

/**
 * The part of `UpdateState` that a *check* owns. The other three fields (`phase`, `progress`,
 * `dismissed`) are owned by the closure in {@link createUpdateService} and written in exactly one
 * place, so no caller can hand in a `phase` that disagrees with the facts it came with.
 */
type UpdateFacts = Pick<
  UpdateState,
  'status' | 'update' | 'error' | 'lastCheckedAt' | 'lastSuccessAt' | 'supported'
>

/** Nothing known, nothing attempted. */
function idleFacts(supported: boolean): UpdateFacts {
  return {
    status: 'idle',
    update: null,
    error: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    supported,
  }
}

/**
 * The status a restored record implies. The store does not persist `status` (nor the error key): a
 * new session has made no attempt of its own yet, so the honest answer is derived from what is
 * known, not replayed from what once happened.
 */
function restoredStatus(data: UpdateCheckStoreData): UpdateState['status'] {
  if (data.update !== null) return 'available'
  if (data.lastSuccessAt !== null) return 'upToDate'
  return 'idle'
}

export interface UpdateServiceOptions {
  /** `app.isPackaged`, injected as a plain boolean so no test needs Electron. `false` makes the
   * whole service a no-op reporting `supported: false` (AC5) - no checker call, no store read. */
  isPackaged: boolean
  /** `app.getVersion()`: a restored record whose known release *is* this version is stale - the
   * user installed it - and is dropped instead of offered again. */
  currentVersion: string
  /** D4's adapter, injected. */
  check: UpdateChecker
  /**
   * Story 098: what actually downloads and installs. Required rather than optional on purpose -
   * a forgotten backend would make the whole update path silently inert, and the compiler is the
   * cheapest place to notice that.
   */
  backend: UpdateBackend
  /**
   * Story 098 AC6: `LaunchService.isRunning()`, injected as a plain predicate so the service stays
   * Electron-free. Required for the same reason as `backend`: a guard that defaults to "nothing is
   * running" is a guard that silently is not there.
   */
  isGameRunning: () => boolean
  /** Story 098 AC6: `JobsService.list()`. The *list*, not a boolean, so the "is anything active"
   * question is answered by `isJobActive` from the shared contract rather than re-derived here. */
  listJobs: () => Job[]
  /** Called on every state change; D5 wires it to `broadcast.emit('update:state', …)`. A listener
   * that throws is logged and ignored - it can never break a check. */
  onStateChange: (state: UpdateState) => void
  /** Defaults to a real {@link UpdateCheckStore}, built lazily (its path resolves through
   * `app.getPath('userData')`, which is only safe once Electron is ready - and never in a test). */
  store?: Pick<UpdateCheckStore, 'load' | 'save'>
  now?: () => Date
  timeoutMs?: number
  log?: UpdateServiceLog
}

export interface UpdateService {
  /** The current state, restoring the persisted record first if that has not happened yet (AC8).
   * Never checks, never throws. */
  getState(): Promise<UpdateState>
  /** A manual check (AC7): always runs, regardless of the 24h window, and resolves with the
   * resulting state - including a failure reason. Joins an already-running check instead of
   * starting a second one. Never rejects. */
  checkNow(): Promise<UpdateState>
  /** The startup check (AC1/AC3): returns `void` *immediately*, without awaiting anything, which is
   * what makes "does not block startup" true by construction. Checks only if the 24h window is
   * open and the build is packaged. */
  scheduleStartupCheck(): void

  // ---- story 098: the four staged actions ----------------------------------------------------

  /**
   * Starts downloading the known release and resolves as soon as it has *started* (098 AC3) - the
   * launcher stays usable and progress arrives through `onStateChange`. Refuses with
   * `appUpdate.error.notAvailable` when there is nothing to download; a call while a download is
   * already running or staged is a no-op reporting the current state.
   */
  startDownload(): Promise<Outcome<UpdateState>>
  /** Asks the backend to stop an in-flight download. The state returns to `available` carrying
   * `appUpdate.error.cancelled` once the backend settles (AC7). A no-op otherwise. */
  cancelDownload(): Outcome<UpdateState>
  /**
   * The second, deliberate confirmation (AC4): quits the launcher and installs the staged release.
   * Refuses - and changes nothing at all - unless the download has finished
   * (`appUpdate.error.notReady`), no game this launcher started is running
   * (`appUpdate.error.gameRunning`) and no job is in flight (`appUpdate.error.jobActive`). It never
   * cancels the game or the job it refuses for (AC6).
   */
  installAndRestart(): Promise<Outcome<null>>
  /** AC5: drop the attention marker for this session. In-memory, never persisted; the control
   * itself stays reachable, and nothing about the update itself changes. */
  dismiss(): Outcome<UpdateState>

  /**
   * Story 098 D4: drives a `dev:simulateAppUpdate` scenario through the exact same
   * `emit`/`publish` machinery every real transition in this file uses - fixture releases in e2e
   * tests are not real installers to check for or fetch, so this is the offline stand-in for a
   * real check/download. Mirrors `LaunchService.simulate()`: a permanent method on the real
   * service, reachable only through the dev-only IPC channel (`src/main/ipc/dev.ts`), never called
   * in production. It never touches `supported`, the checker or the backend - and it is not how
   * AC6's restart guard is exercised: `installAndRestart()` itself is real and unfaked, called
   * directly once `simulate({ scenario: 'downloaded' })` has staged a release.
   */
  simulate(scenario: UpdateSimulateScenario): void
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const now = options.now ?? ((): Date => new Date())
  const timeoutMs = options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS
  const log = options.log
  const supported = options.isPackaged

  let storeInstance: Pick<UpdateCheckStore, 'load' | 'save'> | undefined
  function store(): Pick<UpdateCheckStore, 'load' | 'save'> {
    if (options.store !== undefined) return options.store
    storeInstance ??= new UpdateCheckStore(log !== undefined ? { log } : {})
    return storeInstance
  }

  let facts: UpdateFacts = idleFacts(supported)
  /** Story 098: the download half of the state. Written only by `startDownload`/`runDownload` and
   * by a check that learns of a *different* release. */
  let stage: DownloadStage = 'none'
  let progress: UpdateDownloadProgress | null = null
  let dismissed = false
  /** Guards a superseded download: a late progress callback or resolution from a download the user
   * already cancelled must not write over the state a newer one produced. */
  let downloadGeneration = 0
  let cancelRequested = false

  let state: UpdateState = compose()
  let restoring: Promise<void> | undefined
  let inFlight: Promise<UpdateState> | undefined

  // Story 098 AC4, belt: off from the moment the service exists, not only once a download starts,
  // so a release staged by a *previous* session's `electron-updater` cannot install itself on this
  // session's next quit either.
  options.backend.autoInstallOnAppQuit = false

  /** The full state, assembled from the facts plus the three fields this closure owns. The only
   * place `phase`/`progress`/`dismissed` are produced. */
  function compose(): UpdateState {
    return {
      ...facts,
      phase: resolveUpdatePhase(facts.status, facts.update !== null, stage),
      // Progress belongs to a running download and to nothing else - a stale readout on a finished
      // or failed one would be a lie the UI has no way to detect.
      progress: stage === 'downloading' ? progress : null,
      dismissed,
    }
  }

  /** Publishes whatever `compose()` now says, if it differs from what was last published. Every
   * state change in this file goes through here, whichever half of the state changed. */
  function publish(): void {
    const next = compose()
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    try {
      options.onStateChange(state)
    } catch (error) {
      log?.warn(`update: a state listener threw (${describeError(error)})`)
    }
  }

  function emit(next: UpdateFacts): void {
    facts = next
    publish()
  }

  /** Restores the persisted record exactly once, before any check can run (AC8). */
  function ensureRestored(): Promise<void> {
    // An unpackaged build knows nothing and stores nothing - it does not even read the file.
    if (!supported) return Promise.resolve()
    restoring ??= (async () => {
      let data: UpdateCheckStoreData
      try {
        data = await store().load()
      } catch (error) {
        // `UpdateCheckStore.load()` degrades a damaged file to "nothing known" on its own, so this
        // is the belt to that braces: one wasted check beats a service that cannot start.
        log?.warn(`update: the check record could not be read (${describeError(error)})`)
        return
      }
      // The record outlives the update it announced: after "Restart and install" the new build
      // restores a record that still offers itself, and with the 24h window closed nothing would
      // re-check. Dropping the release *and* the success stamp clears the offer and reopens the
      // window, so the startup check replaces the record right away.
      const restored: UpdateCheckStoreData =
        data.update !== null && data.update.version === options.currentVersion
          ? { ...data, update: null, lastSuccessAt: null }
          : data
      emit({
        status: restoredStatus(restored),
        update: restored.update,
        error: null,
        lastCheckedAt: restored.lastCheckedAt,
        lastSuccessAt: restored.lastSuccessAt,
        supported,
      })
    })()
    return restoring
  }

  /** True when a check should run now: nothing known yet, the last success is 24h old, or the
   * stored timestamp cannot be trusted (unparseable, or in the future after a clock correction). */
  function isWindowOpen(): boolean {
    const last = state.lastSuccessAt
    if (last === null) return true
    const lastMs = Date.parse(last)
    if (Number.isNaN(lastMs)) return true
    const elapsed = now().getTime() - lastMs
    if (elapsed < 0) return true
    return elapsed >= UPDATE_CHECK_WINDOW_MS
  }

  /** Calls the checker, never rejecting and never taking longer than the timeout. */
  async function callChecker(): Promise<UpdateCheckOutcome> {
    // Wrapped first, so the checker's promise cannot surface as an unhandled rejection when the
    // timeout wins the race below and nobody is awaiting it any more.
    const checking: Promise<UpdateCheckOutcome> = (async (): Promise<UpdateCheckOutcome> => {
      try {
        return await options.check()
      } catch (error) {
        log?.warn(`update: the check failed (${describeError(error)})`)
        return { ok: false, reason: 'unknown' }
      }
    })()

    let timer: ReturnType<typeof setTimeout> | undefined
    const timingOut = new Promise<UpdateCheckOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve({ ok: false, reason: 'timeout' })
      }, timeoutMs)
    })

    try {
      return await Promise.race([checking, timingOut])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async function persist(next: UpdateFacts): Promise<void> {
    try {
      await store().save({
        update: next.update,
        lastCheckedAt: next.lastCheckedAt,
        lastSuccessAt: next.lastSuccessAt,
      })
    } catch (error) {
      log?.warn(`update: the check record could not be written (${describeError(error)})`)
    }
  }

  async function runAttempt(): Promise<UpdateState> {
    // `update` is carried through deliberately: a check in progress does not un-know an update that
    // was already found. The error is cleared, because "checking" is not a state that has one.
    emit({ ...facts, status: 'checking', error: null })

    const outcome = await callChecker()
    const completedAt = now().toISOString()

    const next: UpdateFacts = outcome.ok
      ? {
          status: outcome.available ? 'available' : 'upToDate',
          // A successful "up to date" is the one thing that may clear a known update - the user
          // installed it.
          update: outcome.available ? outcome.update : null,
          error: null,
          lastCheckedAt: completedAt,
          lastSuccessAt: completedAt,
          supported,
        }
      : {
          status: 'error',
          update: facts.update, // AC3: a failure never erases what is already known.
          error: { key: updateErrorKey(outcome.reason) },
          lastCheckedAt: completedAt,
          lastSuccessAt: facts.lastSuccessAt, // AC4: untouched, so the window is not burnt.
          supported,
        }

    // Story 098: a *different* release than the one currently known is a new offer, so it undoes
    // this session's dismissal and un-stages an earlier download - "Restart and install" must never
    // be offered for a build that was never fetched. A download still in flight is left alone; it
    // finishes or fails on its own terms.
    if (next.update?.version !== facts.update?.version) {
      dismissed = false
      if (stage !== 'downloading') {
        stage = 'none'
        progress = null
      }
    }

    emit(next)
    await persist(next)
    return state
  }

  /**
   * Starts an attempt, or joins the one already running (Decisions: "a manual check during a
   * running one joins it"). Synchronous up to the point where `inFlight` is assigned, so two calls
   * in the same tick cannot both start a check.
   */
  function beginAttempt(): Promise<UpdateState> {
    if (!supported) return Promise.resolve(state)
    if (inFlight !== undefined) return inFlight
    const attempt = runAttempt()
      .catch((error: unknown) => {
        // `runAttempt()` swallows everything it knows about; this keeps the promise this service
        // hands out from rejecting even if something unforeseen (a broken injected `now`) throws.
        log?.warn(`update: the check attempt failed unexpectedly (${describeError(error)})`)
        return state
      })
      .finally(() => {
        inFlight = undefined
      })
    inFlight = attempt
    return attempt
  }

  async function getState(): Promise<UpdateState> {
    await ensureRestored()
    return state
  }

  async function checkNow(): Promise<UpdateState> {
    await ensureRestored()
    return beginAttempt()
  }

  async function startupCheck(): Promise<UpdateState> {
    await ensureRestored()
    if (!isWindowOpen()) return state
    return beginAttempt()
  }

  function scheduleStartupCheck(): void {
    // Fire-and-forget on purpose (AC3): nothing awaits this, and `startupCheck()` cannot reject.
    void startupCheck().catch(() => undefined)
  }

  // ---- story 098: the four staged actions ------------------------------------------------------

  /**
   * Runs one download to completion and writes the single state change it produces. The *only*
   * writer of `stage`/`progress` once a download is under way - `cancelDownload()` deliberately
   * does not write the "back to available" state itself, so there is exactly one place that can
   * decide how a download ended.
   */
  async function runDownload(generation: number): Promise<void> {
    let outcome: UpdateDownloadOutcome
    try {
      outcome = await options.backend.download((next) => {
        // A callback from a superseded download, or one arriving after this one ended, is dropped
        // rather than published - progress from a download nobody is waiting on is noise.
        if (generation !== downloadGeneration || stage !== 'downloading') return
        progress = next
        publish()
      })
    } catch (error) {
      log?.warn(`update: the download failed (${describeError(error)})`)
      outcome = { ok: false, reason: 'unknown' }
    }

    if (generation !== downloadGeneration) return

    progress = null

    if (!outcome.ok && outcome.reason === 'upToDate') {
      // The known release turned out to be stale - typically the very build now running, carried
      // over from the check the previous version made. That is a successful check saying "up to
      // date", so it is recorded as one instead of offering a download that can never succeed.
      stage = 'none'
      const completedAt = now().toISOString()
      const next: UpdateFacts = {
        status: 'upToDate',
        update: null,
        error: null,
        lastCheckedAt: completedAt,
        lastSuccessAt: completedAt,
        supported,
      }
      emit(next)
      await persist(next)
      return
    }

    if (outcome.ok) {
      // It finished, so it finished - even if a cancel was requested just too late. Nothing is
      // installed by this: `phase: 'downloaded'` only *offers* the restart (AC4).
      stage = 'downloaded'
      emit({ ...facts, error: null })
      return
    }

    // AC7: nothing was installed and nothing on disk changed, so the update stays offerable -
    // `resolveUpdatePhase` puts a known release back at `available` on its own, and the reason
    // rides along in `error`.
    stage = 'none'
    const reason = cancelRequested ? 'cancelled' : outcome.reason
    log?.warn(`update: the download ended without a staged release (${reason})`)
    emit({ ...facts, error: { key: updateDownloadErrorKey(reason) } })
  }

  async function startDownload(): Promise<Outcome<UpdateState>> {
    await ensureRestored()
    if (!supported || facts.update === null) {
      return fail(APP_UPDATE_REFUSAL_KEYS.notAvailable)
    }
    // Already running or already staged: report where we are instead of starting a second fetch of
    // the same release.
    if (stage !== 'none') return ok(state)

    // AC4, braces to the constructor's belt: `electron-updater` arms its install-on-quit handler
    // when a download *completes*, so this is the last moment the flag can be turned off.
    options.backend.autoInstallOnAppQuit = false

    downloadGeneration += 1
    cancelRequested = false
    stage = 'downloading'
    progress = { ratio: null, bytesDone: 0, bytesTotal: null, bytesPerSecond: null }
    // Clears a previous attempt's failure reason, and publishes the `downloading` phase.
    emit({ ...facts, error: null })

    // Deliberately not awaited (AC3): the launcher stays fully usable while this runs, and every
    // later state change arrives through `onStateChange`. `runDownload` cannot reject.
    void runDownload(downloadGeneration).catch((error: unknown) => {
      log?.warn(`update: the download ended unexpectedly (${describeError(error)})`)
    })

    return ok(state)
  }

  function cancelDownload(): Outcome<UpdateState> {
    if (stage !== 'downloading') return ok(state)
    cancelRequested = true
    try {
      options.backend.cancelDownload()
    } catch (error) {
      // A backend that cannot be cancelled is not a failure the user can act on; the download
      // either finishes or fails, and both are handled above.
      log?.warn(`update: the download could not be cancelled (${describeError(error)})`)
    }
    return ok(state)
  }

  async function installAndRestart(): Promise<Outcome<null>> {
    await ensureRestored()

    // AC4: nothing is installed until there is something staged to install. Deliberately not also
    // gated on `supported`: `simulate()` (098 D4) legitimately drives `stage` to `'downloaded'` on an
    // unpackaged build so the game/job guards below can be proven for real without a packaged
    // install - `download()` already refuses `!supported` on the real path, so `stage` cannot
    // reach `'downloaded'` there without simulation, and `checker.ts`'s `quitAndInstall()` still
    // throws on an unresolved updater as the last line of defence.
    if (stage !== 'downloaded') return fail(APP_UPDATE_REFUSAL_KEYS.notReady)

    // AC6. Both guards *read* live state that main already tracks and return before anything is
    // touched - the game keeps running, the job keeps running, and the staged update stays staged
    // so the user can come back to it. Nothing here cancels, kills or quits.
    if (options.isGameRunning()) {
      log?.warn('update: refused to restart - a game started by this launcher is running')
      return fail(APP_UPDATE_REFUSAL_KEYS.gameRunning)
    }
    if (options.listJobs().some(isJobActive)) {
      log?.warn('update: refused to restart - a job is in flight')
      return fail(APP_UPDATE_REFUSAL_KEYS.jobActive)
    }

    try {
      options.backend.quitAndInstall()
    } catch (error) {
      log?.warn(`update: quitAndInstall() failed (${describeError(error)})`)
      return fail(APP_UPDATE_REFUSAL_KEYS.installFailed)
    }
    return ok(null)
  }

  function dismiss(): Outcome<UpdateState> {
    dismissed = true
    publish()
    return ok(state)
  }

  function simulate(scenario: UpdateSimulateScenario): void {
    // Marks the persisted-record restore as already done, exactly as a real `checkNow()`/
    // `startDownload()` leaves it (both call `ensureRestored()` first) - otherwise the *next*
    // `getState()` would run it for the first time, read "nothing known" from the real store, and
    // clobber the facts this call is about to set.
    restoring ??= Promise.resolve()

    const completedAt = now().toISOString()

    switch (scenario.scenario) {
      case 'available':
        // Same reset a real check applies to a newly-known release (`runAttempt`, above): a fresh
        // offer is never dismissed and never carries over a previous, unrelated download.
        stage = 'none'
        progress = null
        dismissed = false
        emit({
          status: 'available',
          update: { version: scenario.version, notes: scenario.notes ?? '', releasedAt: null },
          error: null,
          lastCheckedAt: completedAt,
          lastSuccessAt: completedAt,
          supported,
        })
        return

      case 'progress':
        // Only `stage`/`progress` move - the same two fields `runDownload`'s own progress callback
        // writes - so `publish()` alone is correct here, exactly as it is there.
        stage = 'downloading'
        progress = {
          ratio: scenario.ratio,
          bytesDone: Math.round(scenario.ratio * 1_000_000_000),
          bytesTotal: 1_000_000_000,
          bytesPerSecond: 5_000_000,
        }
        publish()
        return

      case 'downloaded':
        stage = 'downloaded'
        progress = null
        emit({ ...facts, error: null })
        return

      case 'error':
        // AC7: falls back to `available` - `resolveUpdatePhase` does that on its own once `stage`
        // is `'none'` and `facts.update` is still non-null, same as a real failed download.
        stage = 'none'
        progress = null
        emit({ ...facts, error: { key: updateDownloadErrorKey(scenario.reason) } })
        return

      case 'upToDate':
        // AC8: the same facts a real "up to date" check produces - `resolveUpdatePhase` returns
        // `idle` once `update` is null and `status` is not `checking`/`error`, which is what makes
        // the control disappear.
        stage = 'none'
        progress = null
        dismissed = false
        emit({
          status: 'upToDate',
          update: null,
          error: null,
          lastCheckedAt: completedAt,
          lastSuccessAt: completedAt,
          supported,
        })
        return

      case 'checkFailed':
        // Story 099 D7: a failed *check*, mirroring `runAttempt()`'s own real failure branch above
        // - a failed check never erases what is already known (AC3) and never touches
        // `lastSuccessAt` (AC4), it only moves `lastCheckedAt` and reports the reason.
        emit({
          status: 'error',
          update: facts.update,
          error: { key: updateErrorKey(scenario.reason) },
          lastCheckedAt: completedAt,
          lastSuccessAt: facts.lastSuccessAt,
          supported,
        })
        return
    }
  }

  return {
    getState,
    checkNow,
    scheduleStartupCheck,
    startDownload,
    cancelDownload,
    installAndRestart,
    dismiss,
    simulate,
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
