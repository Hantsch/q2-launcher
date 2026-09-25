import { Worker } from 'node:worker_threads'
import { WATCHLIST_REGEX_BUDGET_MS } from '@shared/modules/servers'
import { matchRegexNames } from './watchlist-matcher'

/**
 * Story 131 D3: the only place a user-supplied watchlist regex is ever executed. A pattern like
 * `(a+)+$` against a 31-character name backtracks for billions of steps, so it must never run on
 * Electron's main thread - it runs inside one long-lived `worker_threads` worker, under a hard
 * per-job time budget. When the budget expires the worker is terminated (which interrupts the
 * running match), the job resolves `'too-slow'`, and a fresh worker is spawned lazily for the next
 * queued job.
 *
 * There is deliberately no host-side fast path: this module never calls `RegExp#test`/`exec`.
 */

export type RegexMatchOutcome =
  | { ok: true; hits: boolean[] }
  | { ok: false; reason: 'too-slow' | 'worker-error' }

export interface RegexHost {
  /** Runs `pattern` against every one of `names` in the worker. Jobs are serialised FIFO: one
   * `match()` call is one job, and a call made while another is in flight waits its turn. */
  match(entryId: string, pattern: string, names: string[]): Promise<RegexMatchOutcome>
  /** Terminates the worker and resolves every in-flight/queued job `'worker-error'`. Idempotent. */
  dispose(): void
}

export interface RegexHostOptions {
  budgetMs?: number
  /** Injection seam for tests; defaults to `createRegexWorker`. */
  createWorker?: () => Worker
}

/** Message host -> worker. The worker only echoes `jobId`; it never sees the entry id. */
interface RegexJobRequest {
  jobId: number
  pattern: string
  names: string[]
}

/** Message worker -> host. `ok: false` means the pattern threw inside the worker (e.g. invalid). */
type RegexJobReply = { jobId: number; ok: true; hits: boolean[] } | { jobId: number; ok: false }

/**
 * The worker's whole program, as CommonJS source for `new Worker(src, { eval: true })` - an eval
 * worker needs no separate bundle entry, so this runs the same under vitest and in the packaged
 * CJS main bundle. `matchRegexNames` is inlined from its own `.toString()`; it is self-contained by
 * contract (see its doc comment), and nothing host-side is interpolated here - the pattern, names
 * and job id only ever arrive through the message payload.
 */
export const REGEX_WORKER_SOURCE = `'use strict'
const { parentPort } = require('node:worker_threads')
const matchRegexNames = ${matchRegexNames.toString()}
parentPort.on('message', (msg) => {
  let reply
  try {
    reply = { jobId: msg.jobId, ok: true, hits: matchRegexNames(msg.pattern, msg.names) }
  } catch {
    reply = { jobId: msg.jobId, ok: false }
  }
  parentPort.postMessage(reply)
})
`

export function createRegexWorker(): Worker {
  return new Worker(REGEX_WORKER_SOURCE, { eval: true })
}

interface Job {
  jobId: number
  entryId: string
  pattern: string
  names: string[]
  resolve: (outcome: RegexMatchOutcome) => void
}

export function createRegexHost({
  budgetMs = WATCHLIST_REGEX_BUDGET_MS,
  createWorker = createRegexWorker,
}: RegexHostOptions = {}): RegexHost {
  const queue: Job[] = []
  let worker: Worker | null = null
  /** Whether `worker` has started executing JS. The budget clock only starts once it has, so a slow
   * worker spawn is never counted against (and blamed on) the job that happened to trigger it. */
  let workerOnline = false
  let current: { job: Job; timer: ReturnType<typeof setTimeout> | null } | null = null
  let nextJobId = 1
  let disposed = false

  function spawn(): Worker {
    const w = createWorker()
    worker = w
    workerOnline = false
    // Every listener checks `w === worker` first: once a worker has been retired (timeout, crash,
    // dispose) its late events - a reply that raced the timer, the `exit` that follows
    // `terminate()` - must not touch whichever job is current by then.
    w.on('online', () => {
      if (w !== worker) return
      workerOnline = true
      armBudget()
    })
    w.on('message', (reply: RegexJobReply) => {
      if (w !== worker) return
      onReply(reply)
    })
    w.on('error', () => {
      if (w !== worker) return
      failCurrentAndRetire('worker-error')
    })
    w.on('exit', () => {
      if (w !== worker) return
      failCurrentAndRetire('worker-error')
    })
    return w
  }

  function retireWorker(): void {
    const w = worker
    worker = null
    workerOnline = false
    if (w !== null) {
      w.terminate().catch(() => undefined)
    }
  }

  function armBudget(): void {
    if (current === null || current.timer !== null || !workerOnline) return
    const { job } = current
    current.timer = setTimeout(() => {
      if (current?.job !== job) return
      failCurrentAndRetire('too-slow')
    }, budgetMs)
  }

  function finishCurrent(outcome: RegexMatchOutcome): void {
    if (current === null) return
    const { job, timer } = current
    if (timer !== null) clearTimeout(timer)
    current = null
    job.resolve(outcome)
  }

  /** Resolves the in-flight job (if any) with `reason`, drops the worker it was running on, and
   * moves the queue on - the next job, if there is one, spawns a fresh worker. */
  function failCurrentAndRetire(reason: 'too-slow' | 'worker-error'): void {
    retireWorker()
    finishCurrent({ ok: false, reason })
    pump()
  }

  function onReply(reply: RegexJobReply): void {
    if (current === null || reply.jobId !== current.job.jobId) return
    finishCurrent(reply.ok ? { ok: true, hits: reply.hits } : { ok: false, reason: 'worker-error' })
    pump()
  }

  function pump(): void {
    while (!disposed && current === null && queue.length > 0) {
      const job = queue.shift()!
      let w: Worker
      try {
        w = worker ?? spawn()
      } catch {
        retireWorker()
        job.resolve({ ok: false, reason: 'worker-error' })
        continue
      }
      current = { job, timer: null }
      const request: RegexJobRequest = { jobId: job.jobId, pattern: job.pattern, names: job.names }
      try {
        w.postMessage(request)
      } catch {
        failCurrentAndRetire('worker-error')
        return
      }
      armBudget()
    }
  }

  return {
    match(entryId, pattern, names) {
      if (disposed) {
        return Promise.resolve({ ok: false, reason: 'worker-error' })
      }
      return new Promise<RegexMatchOutcome>((resolve) => {
        queue.push({ jobId: nextJobId++, entryId, pattern, names, resolve })
        pump()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      retireWorker()
      finishCurrent({ ok: false, reason: 'worker-error' })
      for (const job of queue.splice(0)) {
        job.resolve({ ok: false, reason: 'worker-error' })
      }
    },
  }
}
