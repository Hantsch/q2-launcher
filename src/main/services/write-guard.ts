import type { Job, LaunchState } from '@shared/types'
import { scopedLogger } from '../lib/logger'

const log = scopedLogger('write-guard')

/**
 * The `LaunchService` surface the guard reads. `LaunchService` satisfies it
 * structurally, so nothing here imports it - which is also what keeps the
 * dependency one-way while `LaunchService` asks the guard back (`isWriting`).
 */
export interface LaunchHost {
  getState(): LaunchState
  onStateChange(listener: (state: LaunchState) => void): () => void
}

/** The `JobsService` surface the guard writes. `JobsService` satisfies it structurally. */
export interface WriteGuardJobsHost {
  setWaiting(id: string, reason: NonNullable<Job['waitingReason']>): void
  setWriteLock(id: string, holding: boolean): void
}

/**
 * What `LaunchService` needs from the guard - the inverse direction of the same
 * fact, kept to one method so the launch side cannot reach into lock bookkeeping.
 */
export interface WriteLockReader {
  isWriting(installationId: string): boolean
}

/** `Job.waitingReason.key` for the one wait this story introduces (INST-J7). */
export const WAITING_REASON_GAME_RUNNING = 'jobs.waiting.gameRunning'

/**
 * Thrown by `runWrite` when the job's signal aborts while the write is still
 * deferred. Named `AbortError`, the platform's own convention, so a caller can
 * recognise it with the same check it would use for a `fetch` abort.
 */
export class WriteCancelledError extends Error {
  constructor() {
    super('the installation write was cancelled')
    this.name = 'AbortError'
  }
}

/** True for both `WriteCancelledError` and the `DOMException` a bare `abort()` produces. */
export function isWriteCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * `AbortSignal.throwIfAborted()`'s semantics: the caller's own reason wins when it
 * is an `Error` (a `DOMException` named `AbortError` for a bare `abort()`), so a
 * module that aborts with something meaningful still sees it downstream.
 */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new WriteCancelledError()
}

/**
 * Story 091: no job writes into an installation while that installation's own
 * Quake II process is running - and, in the inverse direction, that process
 * cannot be started while a job is writing (AC1/AC5, INST-J7).
 *
 * It sits between two shell services rather than inside a module because it
 * arbitrates between them: `LaunchService` owns the process, `JobsService` owns
 * the job the user sees waiting, and every writing job of every module goes
 * through the one `runWrite` seam.
 *
 * ## The four exits
 *
 * `runWrite` is the only genuinely concurrent code in the launcher, so its
 * correctness is stated as an invariant rather than left to reading: the launch
 * observer is subscribed *only* inside `waitUntilUnblocked`, and every way out of
 * that promise - resume, abort, and the synchronous already-unblocked recheck -
 * goes through the single `settle()` path, which unsubscribes the observer *and*
 * removes the abort listener before resolving or rejecting. The lock is taken
 * after the wait, never before, and released in a `finally`, so:
 *
 *  - **resume then success** - lock taken, `fn` awaited, lock released;
 *  - **resume then failure** - same, and the error propagates unswallowed;
 *  - **abort while waiting** - `fn` is never called and no lock was ever taken,
 *    so there is nothing to release (AC6);
 *  - **immediate path** - no observer is ever created.
 *
 * A leaked subscription or an unreleased lock would deadlock every writing job
 * for the rest of the session, which is why release and unsubscribe are each
 * written exactly once, on a path no branch can skip.
 */
export class InstallationWriteGuard implements WriteLockReader {
  private readonly launch: LaunchHost
  private readonly jobs: WriteGuardJobsHost
  /**
   * Installation id -> the job ids currently writing into it.
   *
   * A set rather than a single id: nothing in the job pipeline stops two jobs
   * from targeting one installation (this story deliberately adds no admission
   * control), and with a single slot the first writer's release would clear the
   * lock out from under the second - re-opening the launch refusal mid-write.
   */
  private readonly writers = new Map<string, Set<string>>()

  constructor(deps: { launch: LaunchHost; jobs: WriteGuardJobsHost }) {
    this.launch = deps.launch
    this.jobs = deps.jobs
  }

  /** True while this installation's own process is starting or running. */
  isBlockedFor(installationId: string): boolean {
    const state = this.launch.getState()
    if (state.installationId !== installationId) return false
    return state.phase === 'starting' || state.phase === 'running'
  }

  /** True strictly between a `runWrite` acquiring the lock and releasing it. */
  isWriting(installationId: string): boolean {
    return (this.writers.get(installationId)?.size ?? 0) > 0
  }

  /**
   * Runs `fn` with the installation's write lock held, deferring it for as long
   * as that installation's game is running.
   *
   * Wrapped around the write phase only: downloading, verifying and extracting
   * into `userData/cache/downloads/` stay outside it, which is what AC4 asks for.
   */
  async runWrite(
    installationId: string,
    jobId: string,
    signal: AbortSignal,
    fn: () => Promise<void>,
  ): Promise<void> {
    // A job cancelled before its write phase even begins must not write either.
    if (signal.aborted) throw abortReason(signal)

    // A loop, not an `if`: the game can be started again in the gap between the
    // wait resolving and this continuation running, and resuming into a
    // now-running game is the exact hazard this guard exists to prevent.
    while (this.isBlockedFor(installationId)) {
      this.jobs.setWaiting(jobId, { key: WAITING_REASON_GAME_RUNNING })
      log.info(`job ${jobId} waits for the game of installation ${installationId} to exit`)
      await this.waitUntilUnblocked(installationId, signal)
    }

    // The wait can resolve via `settle(resolve)` in the same microtask an abort
    // was scheduled in; re-check here so a cancelled job never takes the lock.
    if (signal.aborted) throw abortReason(signal)

    this.acquire(installationId, jobId)
    // Also the transition out of `'waiting'` (D1): the reason no longer applies.
    this.jobs.setWriteLock(jobId, true)
    try {
      await fn()
    } finally {
      this.release(installationId, jobId)
      this.jobs.setWriteLock(jobId, false)
    }
  }

  /**
   * Resolves the moment the installation is no longer blocked, rejects the moment
   * the signal aborts - whichever happens first, exactly once, with both the
   * launch observer and the abort listener removed before either happens.
   */
  private waitUntilUnblocked(installationId: string, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let unsubscribe: (() => void) | undefined

      const settle = (outcome: () => void): void => {
        if (settled) return
        settled = true
        unsubscribe?.()
        unsubscribe = undefined
        signal.removeEventListener('abort', onAbort)
        outcome()
      }

      const onAbort = (): void => {
        settle(() => reject(abortReason(signal)))
      }

      const onLaunchState = (): void => {
        if (!this.isBlockedFor(installationId)) settle(resolve)
      }

      signal.addEventListener('abort', onAbort, { once: true })
      unsubscribe = this.launch.onStateChange(onLaunchState)

      // Both are subscribed now, so this recheck closes the gap in which the
      // process could have exited (or the job been cancelled) between the
      // caller's `isBlockedFor` test and this subscription - a change nobody was
      // listening for yet would otherwise leave the job waiting forever.
      if (signal.aborted) onAbort()
      else onLaunchState()
    })
  }

  private acquire(installationId: string, jobId: string): void {
    const held = this.writers.get(installationId)
    if (held) held.add(jobId)
    else this.writers.set(installationId, new Set([jobId]))
  }

  private release(installationId: string, jobId: string): void {
    const held = this.writers.get(installationId)
    if (!held) return
    held.delete(jobId)
    if (held.size === 0) this.writers.delete(installationId)
  }
}
