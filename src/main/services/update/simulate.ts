import type { UpdateSimulateScenario } from '@shared/types'
import type { UpdateChecks } from './check'
import { updateDownloadErrorKey, updateErrorKey } from './service'
import type { UpdateStateCell } from './state'

/**
 * The `dev:simulateAppUpdate` scenarios, written straight into the state cell through the same
 * `emit`/`publish` every real transition uses. It never touches `supported`, the checker or the
 * backend.
 */
export class UpdateSimulation {
  private readonly cell: UpdateStateCell
  private readonly checks: Pick<UpdateChecks, 'markRestored'>
  private readonly now: () => Date

  constructor(cell: UpdateStateCell, checks: Pick<UpdateChecks, 'markRestored'>, now: () => Date) {
    this.cell = cell
    this.checks = checks
    this.now = now
  }

  simulate(scenario: UpdateSimulateScenario): void {
    const cell = this.cell
    // Marks the persisted-record restore as already done, exactly as a real `checkNow()`/
    // `startDownload()` leaves it (both call `ensureRestored()` first) - otherwise the *next*
    // `getState()` would run it for the first time, read "nothing known" from the real store, and
    // clobber the facts this call is about to set.
    this.checks.markRestored()

    const completedAt = this.now().toISOString()

    switch (scenario.scenario) {
      case 'available':
        // Same reset a real check applies to a newly-known release (`runAttempt`, in check.ts): a
        // fresh offer is never dismissed and never carries over a previous, unrelated download.
        cell.stage = 'none'
        cell.progress = null
        cell.dismissed = false
        cell.emit({
          status: 'available',
          update: { version: scenario.version, notes: scenario.notes ?? '', releasedAt: null },
          error: null,
          lastCheckedAt: completedAt,
          lastSuccessAt: completedAt,
          supported: cell.supported,
        })
        return

      case 'progress':
        // Only `stage`/`progress` move - the same two fields `runDownload`'s own progress callback
        // writes - so `publish()` alone is correct here, exactly as it is there.
        cell.stage = 'downloading'
        cell.progress = {
          ratio: scenario.ratio,
          bytesDone: Math.round(scenario.ratio * 1_000_000_000),
          bytesTotal: 1_000_000_000,
          bytesPerSecond: 5_000_000,
        }
        cell.publish()
        return

      case 'downloaded':
        cell.stage = 'downloaded'
        cell.progress = null
        cell.emit({ ...cell.facts, error: null })
        return

      case 'error':
        // falls back to `available` - `resolveUpdatePhase` does that on its own once `stage`
        // is `'none'` and `facts.update` is still non-null, same as a real failed download.
        cell.stage = 'none'
        cell.progress = null
        cell.emit({ ...cell.facts, error: { key: updateDownloadErrorKey(scenario.reason) } })
        return

      case 'upToDate':
        // the same facts a real "up to date" check produces - `resolveUpdatePhase` returns
        // `idle` once `update` is null and `status` is not `checking`/`error`, which is what makes
        // the control disappear.
        cell.stage = 'none'
        cell.progress = null
        cell.dismissed = false
        cell.emit({
          status: 'upToDate',
          update: null,
          error: null,
          lastCheckedAt: completedAt,
          lastSuccessAt: completedAt,
          supported: cell.supported,
        })
        return

      case 'checkFailed':
        // Story 099: a failed *check*, mirroring `runAttempt()`'s own real failure branch in
        // check.ts - a failed check never erases what is already known and never touches
        // `lastSuccessAt`, it only moves `lastCheckedAt` and reports the reason.
        cell.emit({
          status: 'error',
          update: cell.facts.update,
          error: { key: updateErrorKey(scenario.reason) },
          lastCheckedAt: completedAt,
          lastSuccessAt: cell.facts.lastSuccessAt,
          supported: cell.supported,
        })
        return
    }
  }
}
