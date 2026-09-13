import type { UpdateState } from '@shared/types'
import { UpdateCheckStore, type UpdateCheckStoreData } from './store'

/**
 * Story 097 D3: the update-check service - the only thing that decides *whether* a check runs, and
 * the only owner of `UpdateState`. Mirrors `src/main/modules/home/news/news-service.ts`: injected
 * `now`, injected checker, injected store, never throws, and no timer anywhere in this file (the
 * 24h window is a comparison against a persisted timestamp, not an interval - a long-running
 * session re-checks at the next start or when the user asks).
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

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`); optional, as in `store.ts`. */
export interface UpdateServiceLog {
  warn(message: string): void
}

/** Nothing known, nothing attempted. */
function idleState(supported: boolean): UpdateState {
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
  /** D4's adapter, injected. */
  check: UpdateChecker
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

  let state: UpdateState = idleState(supported)
  let restoring: Promise<void> | undefined
  let inFlight: Promise<UpdateState> | undefined

  function emit(next: UpdateState): void {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    try {
      options.onStateChange(state)
    } catch (error) {
      log?.warn(`update: a state listener threw (${describeError(error)})`)
    }
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
      emit({
        status: restoredStatus(data),
        update: data.update,
        error: null,
        lastCheckedAt: data.lastCheckedAt,
        lastSuccessAt: data.lastSuccessAt,
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

  async function persist(next: UpdateState): Promise<void> {
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
    emit({ ...state, status: 'checking', error: null })

    const outcome = await callChecker()
    const completedAt = now().toISOString()

    const next: UpdateState = outcome.ok
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
          update: state.update, // AC3: a failure never erases what is already known.
          error: { key: updateErrorKey(outcome.reason) },
          lastCheckedAt: completedAt,
          lastSuccessAt: state.lastSuccessAt, // AC4: untouched, so the window is not burnt.
          supported,
        }

    emit(next)
    await persist(next)
    return next
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

  return { getState, checkNow, scheduleStartupCheck }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
