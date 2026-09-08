import {
  DEFAULT_DOWNLOADS_SETTINGS,
  MAX_CONCURRENT_DOWNLOAD_JOBS,
  MIN_CONCURRENT_DOWNLOAD_JOBS,
} from '@shared/modules/downloads'

/**
 * Story 071 D4, AC2: admission control for download jobs.
 *
 * The shell's `JobsService` deliberately does no admission control of its own - a job it creates
 * is `queued` and stays `queued` until somebody reports progress on it (Decisions (Sprint),
 * "Queue ownership": "admission is module-owned ... so `JobsService` and the shell need no
 * change"). This file is that owner, and it is deliberately ignorant of jobs, HTTP and 7-Zip: it
 * admits *work functions*, so its whole state machine can be tested with fast, gated or
 * never-resolving promises instead of real downloads (`queue.test.ts`).
 *
 * Three properties are worth naming, because each has a failure mode that shows up as a job the
 * user can never get rid of:
 *
 * **1. The limit is read per admission decision, never cached.** [[072]] lets the user change
 * `concurrentJobs` while downloads are in flight, so a value captured at startup would be a lie
 * for the rest of the session. It is also clamped into
 * `MIN_CONCURRENT_DOWNLOAD_JOBS`-`MAX_CONCURRENT_DOWNLOAD_JOBS` and defaulted when it cannot be
 * read at all: a `0` (or a `NaN`, or a getter that throws because `state.json` was damaged) would
 * otherwise mean "admit nothing, ever", which is exactly the stuck-forever queue this deliverable
 * has to avoid. Lowering the limit below the number of jobs already running never kills one - it
 * only stops the next admission until enough have finished.
 *
 * **2. A slot is freed by every way work can end.** Success, failure and cancellation all run
 * through the same `finally`, and the pump is re-entered from there. A slot leaked once is leaked
 * for the rest of the session.
 *
 * **3. A pending entry can be dropped before it ever starts.** That is what a cancel of a still
 * `queued` job needs: the work function must never be called at all, rather than started and then
 * torn down (AC6). `drop()` reports whether it actually removed something, so the caller can tell
 * "never started" from "already running, stop it the hard way".
 */

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`); kept minimal for the tests. */
export interface QueueLog {
  debug(message: string): void
  warn(message: string): void
}

/**
 * `{ ran: false }` means the entry was dropped before it started (`drop()`), so `work` was never
 * called - not that it ran and failed. Work that rejects rejects `enqueue()`.
 */
export type QueueRunResult<T> = { ran: true; value: T } | { ran: false }

export interface QueueStats {
  running: number
  pending: number
}

export interface DownloadQueueOptions {
  /**
   * The live limit, called at every admission decision - see property 1 above. In production this
   * is `app.state.getDownloadsSettings().concurrentJobs`.
   */
  getConcurrency: () => number
  log?: QueueLog
}

export interface DownloadQueue {
  /**
   * Queues `work` under `id` (FIFO) and resolves once it has run - or once it has been dropped.
   * Rejects only if `work` itself rejects; the slot is freed either way.
   */
  enqueue<T>(id: string, work: () => Promise<T>): Promise<QueueRunResult<T>>
  /**
   * Removes a still-pending entry so its `work` is never called. Returns `false` when there is no
   * such pending entry - it has already been admitted, or it never existed.
   */
  drop(id: string): boolean
  stats(): QueueStats
}

interface PendingEntry {
  id: string
  /** Admits the entry: takes the slot and runs the work. */
  start: () => void
  /** Resolves the caller's promise with `{ ran: false }` without ever calling the work. */
  cancel: () => void
}

export function createDownloadQueue(options: DownloadQueueOptions): DownloadQueue {
  const pending: PendingEntry[] = []
  let running = 0

  const concurrency = (): number => {
    let value: number
    try {
      value = options.getConcurrency()
    } catch (error) {
      options.log?.warn(
        `the download concurrency limit could not be read (${String(error)}); using ${DEFAULT_DOWNLOADS_SETTINGS.concurrentJobs}`,
      )
      return DEFAULT_DOWNLOADS_SETTINGS.concurrentJobs
    }
    if (!Number.isFinite(value)) {
      options.log?.warn(
        `the download concurrency limit was ${String(value)}; using ${DEFAULT_DOWNLOADS_SETTINGS.concurrentJobs}`,
      )
      return DEFAULT_DOWNLOADS_SETTINGS.concurrentJobs
    }
    return Math.min(
      MAX_CONCURRENT_DOWNLOAD_JOBS,
      Math.max(MIN_CONCURRENT_DOWNLOAD_JOBS, Math.floor(value)),
    )
  }

  const pump = (): void => {
    while (pending.length > 0 && running < concurrency()) {
      const entry = pending.shift()
      if (entry === undefined) return
      running += 1
      entry.start()
    }
  }

  const enqueue = <T>(id: string, work: () => Promise<T>): Promise<QueueRunResult<T>> =>
    new Promise<QueueRunResult<T>>((resolve, reject) => {
      pending.push({
        id,
        cancel: () => {
          options.log?.debug(`dropped queued download ${id} before it started`)
          resolve({ ran: false })
        },
        start: () => {
          // `work()` is called synchronously here, so nothing can interleave between taking the
          // slot and the work's own first statement - which is what lets the pipeline treat
          // "admitted" and "reported as running" as one indivisible step.
          void (async () => {
            try {
              resolve({ ran: true, value: await work() })
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)))
            } finally {
              running -= 1
              pump()
            }
          })()
        },
      })
      pump()
    })

  return {
    enqueue,
    drop: (id) => {
      const index = pending.findIndex((entry) => entry.id === id)
      if (index === -1) return false
      const [entry] = pending.splice(index, 1)
      entry.cancel()
      return true
    },
    stats: () => ({ running, pending: pending.length }),
  }
}
