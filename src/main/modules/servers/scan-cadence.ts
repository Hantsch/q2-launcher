import type { ServersScanSettings, ServersState } from '@shared/modules/servers'
import type { LaunchState } from '@shared/types'
import type { LaunchHost } from '../../services/write-guard'
import { isScanBlocked } from './scan-guard'
import type { ScanService } from './scan-service'
import type { TimerHandle } from './udp-master-source'

/**
 * Story 115 D3: when the Servers view scans *on its own* - auto-scan-on-open and the auto-refresh
 * interval. The manual trigger (`scan.start` in index.ts) never passes through this file: a manual
 * scan ignores both auto settings and the minimum spacing (story 115's Decisions, AC3), so this
 * module deliberately exports nothing a manual caller could route through.
 *
 * Two layers:
 *
 * - **Pure decisions** (`decideAutoTrigger`, `autoRefreshDelayMs`). No timers, no `Date.now()`,
 *   no state - `now` and every setting are parameters, so AC4 ("skipped, not queued") and the
 *   minimum-spacing gate are provable without fake timers. Every threshold comes from the passed
 *   `ServersScanSettings`; there is no literal standing in for a setting anywhere in this file.
 * - **`createScanCadence`**, a thin stateful wrapper that owns the one timer handle. It is a
 *   `setTimeout` chain rather than a `setInterval`: each tick re-reads the settings before arming
 *   the next one, so a period is never cached past the tick that used it.
 *
 * Story 116 D3: the wrapper also reads the live launch state (`launch: LaunchHost`). Every decision
 * passes `gameRunning: isScanBlocked(launch.getState())`, so a due tick during a session is skipped
 * like any other (not queued; the timer chain simply keeps ticking). On the edge *out of* a blocked
 * phase it resumes promptly instead of waiting up to a full period: if the view is active and an
 * auto-refresh is overdue (`autoRefreshIntervalMs` has elapsed since the last completed scan, or none
 * ever ran), it runs the same `tryAutoTrigger('refresh')` gate a tick would and, if that started a
 * scan, re-arms the timer so the pending tick cannot become a second one. Nothing about the skipped
 * round is remembered (D-G) - due-ness is re-derived from `lastScanAt` alone.
 *
 * The timer's lifetime is the risk this deliverable exists for, so the rules are strict:
 * - The timer exists only while the view is active *and* `autoRefreshEnabled` is on.
 * - `onViewActive(false)` and `dispose()` clear it synchronously; after `dispose()` nothing ever
 *   arms again, even if a late `scan.setViewActive({ active: true })` arrives during shutdown.
 * - A skipped trigger (scan already running, or inside the spacing window) is simply dropped -
 *   there is no "retry once it finishes", no queue, no extra timer. The next natural trigger (the
 *   next tick; nothing, for auto-scan-on-open) is the only follow-up there ever is.
 */

/** Which automatic trigger is asking - each kind has its own on/off setting. */
export type AutoTriggerKind = 'open' | 'refresh'

export interface AutoTriggerInput {
  kind: AutoTriggerKind
  /** Wall-clock milliseconds (same clock `lastScanAt` was stamped with). */
  now: number
  settings: ServersScanSettings
  /** `ScanService.overview().scanning`. */
  scanning: boolean
  /** `ScanService.overview().lastScanAt` - when the last scan of *any* kind finished, or `null`. */
  lastScanAt: string | null
  /**
   * Story 116 D2: `isScanBlocked(launch.getState())`, computed by the caller. A plain `boolean`
   * rather than a live `LaunchState` or the guard function itself, so this file's "no timers, no
   * `Date.now()`, no state" purity discipline extends to it exactly as it already does to
   * `scanning`/`lastScanAt` - a snapshot value passed in, never a reference this module could
   * reach back through.
   */
  gameRunning: boolean
}

export type AutoTriggerSkipReason = 'game-running' | 'disabled' | 'scanning' | 'spacing'

export type AutoTriggerDecision = { trigger: true } | { trigger: false; reason: AutoTriggerSkipReason }

/**
 * The automatic-trigger gate. Order of the checks only affects which `reason` is reported; any
 * failing check means "skip this round".
 *
 * - `game-running`: a game session is live (`isScanBlocked`), launcher-wide (D-C) - checked ahead
 *   of every other reason, since the point of story 116 is to make its skip visible and
 *   unambiguous, not conditional on which other rule might also have fired.
 * - `disabled`: the trigger kind's own setting is off (`autoScanOnOpen` / `autoRefreshEnabled`).
 * - `scanning`: a scan is already running - AC4, skipped, not queued.
 * - `spacing`: less than `minSpacingMs` has passed since `lastScanAt`. `null` (no scan yet) always
 *   passes. An unparseable timestamp or a negative elapsed time (the wall clock moved backwards)
 *   also passes: the real elapsed time is unknowable then, and holding automatic scans off until
 *   the clock catches up could starve them for as long as the jump was.
 */
export function decideAutoTrigger(input: AutoTriggerInput): AutoTriggerDecision {
  const { kind, now, settings, scanning, lastScanAt, gameRunning } = input

  if (gameRunning) return { trigger: false, reason: 'game-running' }

  const enabled = kind === 'open' ? settings.autoScanOnOpen : settings.autoRefreshEnabled
  if (!enabled) return { trigger: false, reason: 'disabled' }

  if (scanning) return { trigger: false, reason: 'scanning' }

  if (lastScanAt !== null) {
    const elapsed = now - Date.parse(lastScanAt)
    if (elapsed >= 0 && elapsed < settings.minSpacingMs) return { trigger: false, reason: 'spacing' }
  }

  return { trigger: true }
}

/**
 * Whether the auto-refresh timer should be armed at all, and with which period: the configured
 * `autoRefreshIntervalMs` while the view is active and auto-refresh is on, otherwise `null` (no
 * timer).
 */
export function autoRefreshDelayMs(settings: ServersScanSettings, viewActive: boolean): number | null {
  if (!viewActive || !settings.autoRefreshEnabled) return null
  return settings.autoRefreshIntervalMs
}

/** The timer and wall-clock seam the wrapper needs - injectable so the teardown rules are testable. */
export interface CadenceClock {
  setTimeout: (callback: () => void, ms: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
  /** Wall-clock milliseconds - compared against `lastScanAt`, an ISO timestamp. */
  now: () => number
}

/** Looks the globals up per call, so a test that installs fake timers is honoured even here. */
export const systemCadenceClock: CadenceClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => Date.now(),
}

export interface CreateScanCadenceOptions {
  /** Read fresh at every decision and every (re)arm - never a snapshot. */
  getServersState: () => ServersState
  scanService: Pick<ScanService, 'start' | 'overview'>
  /** Story 116 D3 (D-E): read live at every decision, and observed to resume promptly on unblock. */
  launch: LaunchHost
  clock?: CadenceClock
  /** Called if an automatic trigger throws, so a timer callback never becomes an uncaught error. */
  onError?: (error: unknown) => void
}

export interface ScanCadence {
  /** The renderer's `scan.setViewActive` signal. Idempotent in both directions. */
  onViewActive: (active: boolean) => void
  /** Call after `scan.patchSettings` persisted - reschedules if the effective period changed. */
  onSettingsChanged: () => void
  /** Clears the timer and the launch subscription for good; every later call is a no-op. */
  dispose: () => void
}

/**
 * Story 116 D3's resume check: has a full auto-refresh period elapsed since the last completed scan?
 * `null` (never scanned), an unparseable timestamp and a negative elapsed time all count as overdue,
 * for the same reason `decideAutoTrigger`'s spacing gate lets them through. Only the *extra* resume
 * path asks this; whether the scan may actually start is still `decideAutoTrigger`'s call (D-P).
 */
function isRefreshOverdue(settings: ServersScanSettings, now: number, lastScanAt: string | null): boolean {
  if (lastScanAt === null) return true
  const elapsed = now - Date.parse(lastScanAt)
  return !(elapsed >= 0 && elapsed < settings.autoRefreshIntervalMs)
}

export function createScanCadence(options: CreateScanCadenceOptions): ScanCadence {
  const { getServersState, scanService, launch, onError } = options
  const clock = options.clock ?? systemCadenceClock

  let viewActive = false
  let disposed = false
  /** Last launch state seen by the subscription below - only to detect the edge out of a block. */
  let blocked = isScanBlocked(launch.getState())
  let timer: TimerHandle | null = null
  /** The period the live timer was armed with - `null` exactly when `timer` is `null`. */
  let armedDelayMs: number | null = null

  function clearTimer(): void {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
    armedDelayMs = null
  }

  /** Arms the next tick from now if the current settings want one; otherwise leaves it cleared. */
  function armTimer(): void {
    clearTimer()
    if (disposed) return
    const delay = autoRefreshDelayMs(getServersState().scan, viewActive)
    if (delay === null) return
    armedDelayMs = delay
    timer = clock.setTimeout(onTick, delay)
  }

  /** One automatic trigger: ask the pure gate, and call `start()` only on a yes. A no - and a
   * refusal from `start()` itself - is dropped on the floor on purpose (AC4). Returns whether a scan
   * actually started. */
  function tryAutoTrigger(kind: AutoTriggerKind): boolean {
    try {
      const { scanning, lastScanAt } = scanService.overview()
      const decision = decideAutoTrigger({
        kind,
        now: clock.now(),
        settings: getServersState().scan,
        scanning,
        lastScanAt,
        // Read live, never cached from the subscription below, so listener order cannot matter.
        gameRunning: isScanBlocked(launch.getState()),
      })
      return decision.trigger && scanService.start().ok
    } catch (error) {
      onError?.(error)
      return false
    }
  }

  /** Story 116 D3: on the edge out of a blocked phase, re-evaluate due-ness once (D-G). */
  function onLaunchState(state: LaunchState): void {
    const wasBlocked = blocked
    blocked = isScanBlocked(state)
    if (disposed || !viewActive || blocked || !wasBlocked) return
    try {
      const { lastScanAt } = scanService.overview()
      if (!isRefreshOverdue(getServersState().scan, clock.now(), lastScanAt)) return
      // A started scan restarts the countdown, so the tick that was already pending cannot fire a
      // second, back-to-back scan right after this one.
      if (tryAutoTrigger('refresh')) armTimer()
    } catch (error) {
      onError?.(error)
    }
  }

  const unsubscribeLaunch = launch.onStateChange(onLaunchState)

  function onTick(): void {
    // This handle has fired; forget it before doing anything so `armTimer()` below never clears a
    // handle that is already spent.
    timer = null
    armedDelayMs = null
    if (disposed || !viewActive) return
    tryAutoTrigger('refresh')
    try {
      armTimer()
    } catch (error) {
      // A timer callback has no caller to throw to. The chain stops here; the next
      // `onViewActive(true)` or `onSettingsChanged()` re-arms it.
      onError?.(error)
    }
  }

  function onViewActive(active: boolean): void {
    if (disposed || active === viewActive) return
    viewActive = active
    if (!active) {
      clearTimer()
      return
    }
    tryAutoTrigger('open')
    armTimer()
  }

  function onSettingsChanged(): void {
    if (disposed) return
    let desired: number | null
    try {
      desired = autoRefreshDelayMs(getServersState().scan, viewActive)
    } catch (error) {
      onError?.(error)
      return
    }
    // Only the period (or on/off) needs active rescheduling - a budget or spacing change is read
    // fresh at the next decision anyway, and restarting the countdown for it would postpone the
    // next refresh every time the user touched an unrelated setting.
    if (desired === armedDelayMs) return
    armTimer()
  }

  function dispose(): void {
    disposed = true
    viewActive = false
    clearTimer()
    unsubscribeLaunch()
  }

  return { onViewActive, onSettingsChanged, dispose }
}
