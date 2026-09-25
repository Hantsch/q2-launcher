import type { ServersScanSettings, ServersState } from '@shared/modules/servers'
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
}

export type AutoTriggerSkipReason = 'disabled' | 'scanning' | 'spacing'

export type AutoTriggerDecision = { trigger: true } | { trigger: false; reason: AutoTriggerSkipReason }

/**
 * The automatic-trigger gate. Order of the checks only affects which `reason` is reported; any
 * failing check means "skip this round".
 *
 * - `disabled`: the trigger kind's own setting is off (`autoScanOnOpen` / `autoRefreshEnabled`).
 * - `scanning`: a scan is already running - AC4, skipped, not queued.
 * - `spacing`: less than `minSpacingMs` has passed since `lastScanAt`. `null` (no scan yet) always
 *   passes. An unparseable timestamp or a negative elapsed time (the wall clock moved backwards)
 *   also passes: the real elapsed time is unknowable then, and holding automatic scans off until
 *   the clock catches up could starve them for as long as the jump was.
 */
export function decideAutoTrigger(input: AutoTriggerInput): AutoTriggerDecision {
  const { kind, now, settings, scanning, lastScanAt } = input

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
  clock?: CadenceClock
  /** Called if an automatic trigger throws, so a timer callback never becomes an uncaught error. */
  onError?: (error: unknown) => void
}

export interface ScanCadence {
  /** The renderer's `scan.setViewActive` signal. Idempotent in both directions. */
  onViewActive: (active: boolean) => void
  /** Call after `scan.patchSettings` persisted - reschedules if the effective period changed. */
  onSettingsChanged: () => void
  /** Clears the timer for good; every later call is a no-op. */
  dispose: () => void
}

export function createScanCadence(options: CreateScanCadenceOptions): ScanCadence {
  const { getServersState, scanService, onError } = options
  const clock = options.clock ?? systemCadenceClock

  let viewActive = false
  let disposed = false
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
   * refusal from `start()` itself - is dropped on the floor on purpose (AC4). */
  function tryAutoTrigger(kind: AutoTriggerKind): void {
    try {
      const { scanning, lastScanAt } = scanService.overview()
      const decision = decideAutoTrigger({
        kind,
        now: clock.now(),
        settings: getServersState().scan,
        scanning,
        lastScanAt,
      })
      if (decision.trigger) scanService.start()
    } catch (error) {
      onError?.(error)
    }
  }

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
  }

  return { onViewActive, onSettingsChanged, dispose }
}
