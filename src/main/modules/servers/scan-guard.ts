import type { LaunchState } from '@shared/types'

/**
 * Story 116 D2: the launcher-wide scan guard. Unlike `InstallationWriteGuard`'s
 * `isBlockedFor` (which is scoped to *one* installation's writes), a scan
 * contends for the network path and the CPU rather than any installation's
 * files, so D-C makes it launcher-wide - any active session blocks every scan,
 * regardless of which installation it belongs to.
 *
 * A pure predicate rather than a class: this module has no host to depend on
 * (nothing here reads live state or subscribes to anything - the caller,
 * story 116 D3's `scan-service.ts`, calls `isScanBlocked(launch.getState())`
 * itself and feeds the boolean into story 115's `decideAutoTrigger`), so
 * unlike `write-guard.ts` there is no `LaunchHost` to declare here.
 */

/** True while ANY installation's game session is live (D-C: launcher-wide, not per-installation).
 * Exactly `LaunchService.isRunning()`'s predicate (D-D): `'starting'`/`'running'` block,
 * `'handed-off'` does not - the launcher has no reliable knowledge of a Steam-handed-off
 * process, so it is never treated as a live session here either. */
export function isScanBlocked(state: LaunchState): boolean {
  return state.phase === 'starting' || state.phase === 'running'
}
