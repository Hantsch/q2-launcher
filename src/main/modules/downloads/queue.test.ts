import { describe, expect, it } from 'vitest'
import { createDownloadQueue } from './queue'

/**
 * Story 071 D4, AC2.
 *
 * The queue is tested through its own seam - work functions - which is why it has one: real
 * downloads would make "at most N run at once" a statement about network timing instead of about
 * admission. Everything here is asserted from the outside: which work functions were actually
 * *called*, and how many are still waiting. Nothing inspects the queue's internals.
 */

/** A work function whose completion the test controls, and that records when it was called. */
function gated(started: string[], id: string): { work: () => Promise<string>; finish: () => void } {
  let finish = (): void => {}
  const work = (): Promise<string> => {
    started.push(id)
    return new Promise<string>((resolve) => {
      finish = () => resolve(id)
    })
  }
  return { work, finish: () => finish() }
}

/** Lets every already-queued microtask run. */
const settleMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('createDownloadQueue', () => {
  it('at most the configured number of jobs run, the rest stay queued', async () => {
    const limit = { value: 2 }
    const queue = createDownloadQueue({ getConcurrency: () => limit.value })
    const started: string[] = []

    const jobs = ['a', 'b', 'c', 'd'].map((id) => {
      const { work, finish } = gated(started, id)
      return { id, finish, done: queue.enqueue(id, work) }
    })

    await settleMicrotasks()

    // Two admitted, two waiting - and the two that are waiting have not been *called*, which is
    // the only observation that distinguishes "queued" from "running but slow".
    expect(started).toEqual(['a', 'b'])
    expect(queue.stats()).toEqual({ running: 2, pending: 2 })

    // A freed slot goes to the head of the queue, in order.
    jobs[0].finish()
    expect(await jobs[0].done).toEqual({ ran: true, value: 'a' })
    await settleMicrotasks()
    expect(started).toEqual(['a', 'b', 'c'])
    expect(queue.stats()).toEqual({ running: 2, pending: 1 })

    jobs[1].finish()
    jobs[2].finish()
    await Promise.all([jobs[1].done, jobs[2].done])
    await settleMicrotasks()
    expect(started).toEqual(['a', 'b', 'c', 'd'])

    jobs[3].finish()
    expect(await jobs[3].done).toEqual({ ran: true, value: 'd' })
    expect(queue.stats()).toEqual({ running: 0, pending: 0 })
  })

  it('the limit is read at every admission, not captured once', async () => {
    // [[072]] lets the user change `concurrentJobs` mid-session, so a queue that cached the value
    // at construction would keep admitting one job at a time for the rest of the session.
    const limit = { value: 1 }
    const queue = createDownloadQueue({ getConcurrency: () => limit.value })
    const started: string[] = []

    const first = gated(started, 'a')
    void queue.enqueue('a', first.work)
    void queue.enqueue('b', gated(started, 'b').work)
    await settleMicrotasks()
    expect(started).toEqual(['a'])

    limit.value = 3
    void queue.enqueue('c', gated(started, 'c').work)
    await settleMicrotasks()

    // The raised limit admitted the *waiting* job too, not only the new one.
    expect(started).toEqual(['a', 'b', 'c'])
    expect(queue.stats()).toEqual({ running: 3, pending: 0 })
  })

  it('an unreadable or nonsensical limit falls back to the default instead of stalling', async () => {
    // A `0` (or a getter that throws over a damaged state file) must not mean "admit nothing,
    // ever" - a queue that can never start anything is a job stuck `queued` forever.
    const zeroQueue = createDownloadQueue({ getConcurrency: () => 0 })
    const zeroStarted: string[] = []
    void zeroQueue.enqueue('a', gated(zeroStarted, 'a').work)

    const throwingQueue = createDownloadQueue({
      getConcurrency: () => {
        throw new Error('state.json is damaged')
      },
    })
    const throwingStarted: string[] = []
    void throwingQueue.enqueue('a', gated(throwingStarted, 'a').work)
    void throwingQueue.enqueue('b', gated(throwingStarted, 'b').work)

    await settleMicrotasks()

    expect(zeroStarted).toEqual(['a'])
    // The default is 2, so both are admitted and nothing is left waiting.
    expect(throwingStarted).toEqual(['a', 'b'])
    expect(throwingQueue.stats().pending).toBe(0)
  })

  it('a dropped entry never runs and gives its place to the next one', async () => {
    const queue = createDownloadQueue({ getConcurrency: () => 1 })
    const started: string[] = []

    const running = gated(started, 'a')
    const runningDone = queue.enqueue('a', running.work)
    const droppedDone = queue.enqueue('b', gated(started, 'b').work)
    const nextDone = queue.enqueue('c', gated(started, 'c').work)
    await settleMicrotasks()
    expect(started).toEqual(['a'])

    expect(queue.drop('b')).toBe(true)
    expect(await droppedDone).toEqual({ ran: false })
    // Dropping does not admit anything by itself - the running slot is still taken.
    expect(started).toEqual(['a'])

    running.finish()
    await runningDone
    await settleMicrotasks()

    // 'b' was never called at all; 'c' got the freed slot.
    expect(started).toEqual(['a', 'c'])
    expect(nextDone).toBeInstanceOf(Promise)

    // An already-admitted (or unknown) id cannot be dropped - the caller has to stop it the hard
    // way, which is what the pipeline's abort/kill path is for.
    expect(queue.drop('a')).toBe(false)
    expect(queue.drop('nope')).toBe(false)
  })

  it('failing work frees its slot too', async () => {
    const queue = createDownloadQueue({ getConcurrency: () => 1 })
    const started: string[] = []

    const boom = queue.enqueue('a', () => {
      started.push('a')
      return Promise.reject(new Error('boom'))
    })
    const next = gated(started, 'b')
    const nextDone = queue.enqueue('b', next.work)

    await expect(boom).rejects.toThrow('boom')
    await settleMicrotasks()

    expect(started).toEqual(['a', 'b'])
    next.finish()
    expect(await nextDone).toEqual({ ran: true, value: 'b' })
    expect(queue.stats()).toEqual({ running: 0, pending: 0 })
  })
})
