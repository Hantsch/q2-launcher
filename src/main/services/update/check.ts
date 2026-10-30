import type { UpdateState } from '@shared/types'
import {
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_CHECK_WINDOW_MS,
  updateErrorKey,
  type UpdateCheckOutcome,
  type UpdateServiceLog,
  type UpdateServiceOptions,
} from './service'
import { describeError, type UpdateFacts, type UpdateStateCell } from './state'
import { UpdateCheckStore, type UpdateCheckStoreData } from './store'

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

/**
 * The check half of the update service: restoring the persisted record once, the 24h window, the
 * checker raced against its timeout, and the single in-flight attempt every caller joins.
 */
export class UpdateChecks {
  private readonly cell: UpdateStateCell
  private readonly options: UpdateServiceOptions
  private readonly now: () => Date
  private readonly timeoutMs: number
  private readonly log: UpdateServiceLog | undefined
  private storeInstance: Pick<UpdateCheckStore, 'load' | 'save'> | undefined
  private restoring: Promise<void> | undefined
  private inFlight: Promise<UpdateState> | undefined

  constructor(cell: UpdateStateCell, options: UpdateServiceOptions, now: () => Date) {
    this.cell = cell
    this.options = options
    this.now = now
    this.timeoutMs = options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS
    this.log = options.log
  }

  private store(): Pick<UpdateCheckStore, 'load' | 'save'> {
    if (this.options.store !== undefined) return this.options.store
    if (this.storeInstance === undefined) {
      const created = new UpdateCheckStore(this.log !== undefined ? { log: this.log } : {})
      this.options.persistence?.register('update-check', created)
      this.storeInstance = created
    }
    return this.storeInstance
  }

  /** Restores the persisted record exactly once, before any check can run. */
  ensureRestored(): Promise<void> {
    // An unpackaged build knows nothing and stores nothing - it does not even read the file.
    if (!this.cell.supported) return Promise.resolve()
    this.restoring ??= this.restore()
    return this.restoring
  }

  /** Counts the restore as done without reading the record, so a later `ensureRestored()` cannot
   * overwrite facts that were written without one. */
  markRestored(): void {
    this.restoring ??= Promise.resolve()
  }

  private async restore(): Promise<void> {
    let data: UpdateCheckStoreData
    try {
      data = await this.store().load()
    } catch (error) {
      // `UpdateCheckStore.load()` degrades a damaged file to "nothing known" on its own, so this
      // is the belt to that braces: one wasted check beats a service that cannot start.
      this.log?.warn(`update: the check record could not be read (${describeError(error)})`)
      return
    }
    // The record outlives the update it announced: after "Restart and install" the new build
    // restores a record that still offers itself, and with the 24h window closed nothing would
    // re-check. Dropping the release *and* the success stamp clears the offer and reopens the
    // window, so the startup check replaces the record right away.
    const restored: UpdateCheckStoreData =
      data.update !== null && data.update.version === this.options.currentVersion
        ? { ...data, update: null, lastSuccessAt: null }
        : data
    this.cell.emit({
      status: restoredStatus(restored),
      update: restored.update,
      error: null,
      lastCheckedAt: restored.lastCheckedAt,
      lastSuccessAt: restored.lastSuccessAt,
      supported: this.cell.supported,
    })
  }

  /** True when a check should run now: nothing known yet, the last success is 24h old, or the
   * stored timestamp cannot be trusted (unparseable, or in the future after a clock correction). */
  private isWindowOpen(): boolean {
    const last = this.cell.state.lastSuccessAt
    if (last === null) return true
    const lastMs = Date.parse(last)
    if (Number.isNaN(lastMs)) return true
    const elapsed = this.now().getTime() - lastMs
    if (elapsed < 0) return true
    return elapsed >= UPDATE_CHECK_WINDOW_MS
  }

  /** Calls the checker, never rejecting and never taking longer than the timeout. */
  private async callChecker(): Promise<UpdateCheckOutcome> {
    // Wrapped first, so the checker's promise cannot surface as an unhandled rejection when the
    // timeout wins the race below and nobody is awaiting it any more.
    const checking: Promise<UpdateCheckOutcome> = (async (): Promise<UpdateCheckOutcome> => {
      try {
        return await this.options.check()
      } catch (error) {
        this.log?.warn(`update: the check failed (${describeError(error)})`)
        return { ok: false, reason: 'unknown' }
      }
    })()

    let timer: ReturnType<typeof setTimeout> | undefined
    const timingOut = new Promise<UpdateCheckOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve({ ok: false, reason: 'timeout' })
      }, this.timeoutMs)
    })

    try {
      return await Promise.race([checking, timingOut])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  async persist(next: UpdateFacts): Promise<void> {
    try {
      await this.store().save({
        update: next.update,
        lastCheckedAt: next.lastCheckedAt,
        lastSuccessAt: next.lastSuccessAt,
      })
    } catch (error) {
      this.log?.warn(`update: the check record could not be written (${describeError(error)})`)
    }
  }

  private async runAttempt(): Promise<UpdateState> {
    const cell = this.cell
    // `update` is carried through deliberately: a check in progress does not un-know an update that
    // was already found. The error is cleared, because "checking" is not a state that has one.
    cell.emit({ ...cell.facts, status: 'checking', error: null })

    const outcome = await this.callChecker()
    const completedAt = this.now().toISOString()

    const next: UpdateFacts = outcome.ok
      ? {
          status: outcome.available ? 'available' : 'upToDate',
          // A successful "up to date" is the one thing that may clear a known update - the user
          // installed it.
          update: outcome.available ? outcome.update : null,
          error: null,
          lastCheckedAt: completedAt,
          lastSuccessAt: completedAt,
          supported: cell.supported,
        }
      : {
          status: 'error',
          update: cell.facts.update, // a failure never erases what is already known.
          error: { key: updateErrorKey(outcome.reason) },
          lastCheckedAt: completedAt,
          lastSuccessAt: cell.facts.lastSuccessAt, // untouched, so the window is not burnt.
          supported: cell.supported,
        }

    // Story 098: a *different* release than the one currently known is a new offer, so it undoes
    // this session's dismissal and un-stages an earlier download - "Restart and install" must never
    // be offered for a build that was never fetched. A download still in flight is left alone; it
    // finishes or fails on its own terms.
    if (next.update?.version !== cell.facts.update?.version) {
      cell.dismissed = false
      if (cell.stage !== 'downloading') {
        cell.stage = 'none'
        cell.progress = null
      }
    }

    cell.emit(next)
    await this.persist(next)
    return cell.state
  }

  /**
   * Starts an attempt, or joins the one already running (Decisions: "a manual check during a
   * running one joins it"). Synchronous up to the point where `inFlight` is assigned, so two calls
   * in the same tick cannot both start a check.
   */
  private beginAttempt(): Promise<UpdateState> {
    if (!this.cell.supported) return Promise.resolve(this.cell.state)
    if (this.inFlight !== undefined) return this.inFlight
    const attempt = this.runAttempt()
      .catch((error: unknown) => {
        // `runAttempt()` swallows everything it knows about; this keeps the promise this service
        // hands out from rejecting even if something unforeseen (a broken injected `now`) throws.
        this.log?.warn(`update: the check attempt failed unexpectedly (${describeError(error)})`)
        return this.cell.state
      })
      .finally(() => {
        this.inFlight = undefined
      })
    this.inFlight = attempt
    return attempt
  }

  async getState(): Promise<UpdateState> {
    await this.ensureRestored()
    return this.cell.state
  }

  async checkNow(): Promise<UpdateState> {
    await this.ensureRestored()
    return this.beginAttempt()
  }

  private async startupCheck(): Promise<UpdateState> {
    await this.ensureRestored()
    if (!this.isWindowOpen()) return this.cell.state
    return this.beginAttempt()
  }

  scheduleStartupCheck(): void {
    // Fire-and-forget on purpose: nothing awaits this, and `startupCheck()` cannot reject.
    void this.startupCheck().catch(() => undefined)
  }
}
