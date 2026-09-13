import { describe, expect, it, vi } from 'vitest'
import { IDLE_LAUNCH_STATE, type Job, type LaunchState } from '@shared/types'
import { JobsService } from './jobs'
import { InstallationWriteGuard, isWriteCancelled, type LaunchHost } from './write-guard'

/**
 * Story 091 D2. This is the only genuinely concurrent code in the launcher, so the
 * suite is built around the two things that would be invisible until they deadlock
 * the whole session: the launch observer must be gone after *every* exit, and the
 * write lock must be released on *every* exit that took it.
 *
 * The launch host is a fake (a real `LaunchService` would need a child process),
 * but `JobsService` is the real one - `'waiting'`, `writeLock` and the transition
 * back to `'running'` are exactly what AC1/AC3 are about, and asserting them
 * against the real job list is what makes those tests non-tautological. The fake
 * launch host exposes `listenerCount`, which is how "unsubscribes on all four
 * exits" is actually checked rather than assumed.
 */

const INSTALLATION = 'inst-1'
const OTHER_INSTALLATION = 'inst-2'

function runningState(installationId: string): LaunchState {
  return { phase: 'running', installationId, startedAt: '2026-09-12T10:00:00.000Z' }
}

function exitedState(installationId: string): LaunchState {
  return { phase: 'exited', installationId, exitedAt: '2026-09-12T10:30:00.000Z', exitCode: 0 }
}

function fakeLaunch(initial: LaunchState = IDLE_LAUNCH_STATE): {
  host: LaunchHost
  set: (next: LaunchState) => void
  listenerCount: () => number
} {
  let state = initial
  const listeners = new Set<(next: LaunchState) => void>()
  const host: LaunchHost = {
    getState: () => state,
    onStateChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    host,
    set: (next) => {
      state = next
      for (const listener of [...listeners]) listener(next)
    },
    listenerCount: () => listeners.size,
  }
}

function setUp(initial: LaunchState = IDLE_LAUNCH_STATE): {
  launch: ReturnType<typeof fakeLaunch>
  jobs: JobsService
  guard: InstallationWriteGuard
  jobId: string
  job: () => Job
} {
  const launch = fakeLaunch(initial)
  const jobs = new JobsService(() => {})
  const guard = new InstallationWriteGuard({ launch: launch.host, jobs })
  const created = jobs.create({
    moduleId: 'downloads',
    kind: 'retail-upgrade',
    labelKey: 'downloads.job.upgrade',
    installationId: INSTALLATION,
  })
  return {
    launch,
    jobs,
    guard,
    jobId: created.id,
    job: () => jobs.list().find((entry) => entry.id === created.id)!,
  }
}

/** A write function whose completion the test decides. */
function deferredWrite(): {
  fn: () => Promise<void>
  calls: () => number
  resolve: () => void
  reject: (error: Error) => void
} {
  let calls = 0
  let settle: { resolve: () => void; reject: (error: Error) => void } | undefined
  return {
    fn: () => {
      calls += 1
      return new Promise<void>((resolve, reject) => {
        settle = { resolve, reject }
      })
    },
    calls: () => calls,
    resolve: () => settle?.resolve(),
    reject: (error) => settle?.reject(error),
  }
}

describe('InstallationWriteGuard.isBlockedFor', () => {
  it('is true only for the installation whose own game is starting or running', () => {
    const { launch, guard } = setUp()

    expect(guard.isBlockedFor(INSTALLATION)).toBe(false)

    launch.set({ phase: 'starting', installationId: INSTALLATION })
    expect(guard.isBlockedFor(INSTALLATION)).toBe(true)
    // Another installation's game is none of this installation's business.
    expect(guard.isBlockedFor(OTHER_INSTALLATION)).toBe(false)

    launch.set(runningState(INSTALLATION))
    expect(guard.isBlockedFor(INSTALLATION)).toBe(true)

    launch.set(exitedState(INSTALLATION))
    expect(guard.isBlockedFor(INSTALLATION)).toBe(false)

    launch.set({ phase: 'failed', installationId: INSTALLATION, error: { key: 'x' } })
    expect(guard.isBlockedFor(INSTALLATION)).toBe(false)
  })
})

describe('InstallationWriteGuard.runWrite', () => {
  it('calls the write function immediately when nothing is running for that installation', async () => {
    const { launch, jobs, guard, jobId, job } = setUp()
    const setWaiting = vi.spyOn(jobs, 'setWaiting')
    const fn = vi.fn(async () => {})

    await guard.runWrite(INSTALLATION, jobId, new AbortController().signal, fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(setWaiting).not.toHaveBeenCalled()
    // The immediate path never subscribes at all - there is nothing to wait for.
    expect(launch.listenerCount()).toBe(0)
    expect(guard.isWriting(INSTALLATION)).toBe(false)
    expect(job().writeLock).toBe(false)
    expect(job().status).toBe('running')
  })

  it("is not blocked by another installation's running game", async () => {
    const { guard, jobId } = setUp(runningState(OTHER_INSTALLATION))
    const fn = vi.fn(async () => {})

    await guard.runWrite(INSTALLATION, jobId, new AbortController().signal, fn)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a write into a running installation is deferred and the job is marked waiting, without calling the write function', async () => {
    const { launch, guard, jobId, job } = setUp(runningState(INSTALLATION))
    const write = deferredWrite()

    const pending = guard.runWrite(INSTALLATION, jobId, new AbortController().signal, write.fn)
    // Several turns of the microtask queue: nothing here is waiting on a timer, so
    // if the write were going to start on its own it would have started by now.
    await Promise.resolve()
    await Promise.resolve()

    expect(write.calls()).toBe(0)
    expect(job().status).toBe('waiting')
    expect(job().waitingReason).toEqual({ key: 'jobs.waiting.gameRunning' })
    // No lock is taken while waiting, so the game it is waiting for is not itself
    // blocked from running by the job that waits for it.
    expect(guard.isWriting(INSTALLATION)).toBe(false)
    expect(job().writeLock).toBeUndefined()
    expect(launch.listenerCount()).toBe(1)

    // Leave nothing pending behind: the resume is a microtask, so the write
    // function only exists to be resolved one turn after the state change.
    launch.set(IDLE_LAUNCH_STATE)
    await Promise.resolve()
    write.resolve()
    await pending
  })

  it('the deferred write runs exactly once after the process exits', async () => {
    const { launch, guard, jobId, job } = setUp(runningState(INSTALLATION))
    const fn = vi.fn(async () => {})

    const pending = guard.runWrite(INSTALLATION, jobId, new AbortController().signal, fn)
    await Promise.resolve()
    expect(fn).not.toHaveBeenCalled()

    launch.set(exitedState(INSTALLATION))
    await pending

    expect(fn).toHaveBeenCalledTimes(1)
    // Holding the lock is the transition out of `waiting` (D1), and the reason goes with it.
    expect(job().status).toBe('running')
    expect(job().waitingReason).toBeUndefined()
    expect(launch.listenerCount()).toBe(0)

    // Every further state change finds no listener left: an observer that survived
    // its own resume would run the write again for a job that is already done.
    launch.set(IDLE_LAUNCH_STATE)
    launch.set(runningState(INSTALLATION))
    launch.set(exitedState(INSTALLATION))
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('waits again when the game is started once more in the gap before the write begins', async () => {
    const { launch, guard, jobId } = setUp(runningState(INSTALLATION))
    const fn = vi.fn(async () => {})

    const pending = guard.runWrite(INSTALLATION, jobId, new AbortController().signal, fn)
    await Promise.resolve()

    // Exit and immediate relaunch inside one turn: the resume is queued, but by the
    // time it runs the installation is busy again - resuming into that would be
    // precisely the hazard the guard exists to prevent.
    launch.set(exitedState(INSTALLATION))
    launch.set(runningState(INSTALLATION))
    await Promise.resolve()
    await Promise.resolve()

    expect(fn).not.toHaveBeenCalled()
    expect(launch.listenerCount()).toBe(1)

    launch.set(exitedState(INSTALLATION))
    await pending
    expect(fn).toHaveBeenCalledTimes(1)
    expect(launch.listenerCount()).toBe(0)
  })

  it('releases the lock and unsubscribes when the deferred write fails', async () => {
    const { launch, guard, jobId, job } = setUp(runningState(INSTALLATION))
    const boom = new Error('the copy failed')
    const fn = vi.fn(() => Promise.reject(boom))

    const pending = guard.runWrite(INSTALLATION, jobId, new AbortController().signal, fn)
    await Promise.resolve()
    launch.set(exitedState(INSTALLATION))

    // The failure is propagated, not swallowed: the job's own catch block is what
    // finishes it as `failed` and cleans up.
    await expect(pending).rejects.toBe(boom)
    expect(guard.isWriting(INSTALLATION)).toBe(false)
    expect(job().writeLock).toBe(false)
    expect(launch.listenerCount()).toBe(0)
  })

  it('releases the lock when an immediate write fails', async () => {
    const { guard, jobId, job } = setUp()
    const boom = new Error('the copy failed')

    await expect(
      guard.runWrite(INSTALLATION, jobId, new AbortController().signal, () => Promise.reject(boom)),
    ).rejects.toBe(boom)

    expect(guard.isWriting(INSTALLATION)).toBe(false)
    expect(job().writeLock).toBe(false)
  })

  it('an abort while waiting never calls the write function and releases nothing it never took', async () => {
    const { launch, jobs, guard, jobId, job } = setUp(runningState(INSTALLATION))
    const setWriteLock = vi.spyOn(jobs, 'setWriteLock')
    const fn = vi.fn(async () => {})
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = guard.runWrite(INSTALLATION, jobId, controller.signal, fn)
    await Promise.resolve()
    expect(launch.listenerCount()).toBe(1)

    controller.abort()

    await expect(pending).rejects.toSatisfy(isWriteCancelled)
    expect(fn).not.toHaveBeenCalled()
    // Never acquired, so nothing was released and nothing was reported as held -
    // the job is finished as `cancelled` by `JobsService.cancel()`, not from here.
    expect(setWriteLock).not.toHaveBeenCalled()
    expect(guard.isWriting(INSTALLATION)).toBe(false)
    expect(job().writeLock).toBeUndefined()
    // Both subscriptions are gone: the launch observer and the abort listener. A
    // surviving abort listener would accumulate one per wait on a long-lived signal.
    expect(launch.listenerCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))

    // A launch state change after the abort must not resurrect the write.
    launch.set(exitedState(INSTALLATION))
    await Promise.resolve()
    expect(fn).not.toHaveBeenCalled()
  })

  it('drops the abort listener when the write resumes instead', async () => {
    const { launch, guard, jobId } = setUp(runningState(INSTALLATION))
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = guard.runWrite(INSTALLATION, jobId, controller.signal, async () => {})
    await Promise.resolve()
    launch.set(exitedState(INSTALLATION))
    await pending

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('a signal that is already aborted never reaches the write function', async () => {
    const { jobs, guard, jobId } = setUp()
    const setWriteLock = vi.spyOn(jobs, 'setWriteLock')
    const fn = vi.fn(async () => {})
    const controller = new AbortController()
    controller.abort()

    await expect(guard.runWrite(INSTALLATION, jobId, controller.signal, fn)).rejects.toSatisfy(
      isWriteCancelled,
    )

    expect(fn).not.toHaveBeenCalled()
    expect(setWriteLock).not.toHaveBeenCalled()
    expect(guard.isWriting(INSTALLATION)).toBe(false)
  })

  it('propagates an abort that lands mid-write, after the lock was taken', async () => {
    const { guard, jobId, job } = setUp()
    const write = deferredWrite()
    const controller = new AbortController()

    const pending = guard.runWrite(INSTALLATION, jobId, controller.signal, write.fn)
    await Promise.resolve()
    expect(guard.isWriting(INSTALLATION)).toBe(true)

    // The write function is what observes the signal from here on; the guard's only
    // remaining duty is to release what it took.
    controller.abort()
    write.reject(new Error('aborted mid-copy'))

    await expect(pending).rejects.toThrow('aborted mid-copy')
    expect(guard.isWriting(INSTALLATION)).toBe(false)
    expect(job().writeLock).toBe(false)
  })
})

describe('InstallationWriteGuard.isWriting', () => {
  it('is true only between acquire and release', async () => {
    const { guard, jobId, job } = setUp()
    const write = deferredWrite()

    expect(guard.isWriting(INSTALLATION)).toBe(false)

    const pending = guard.runWrite(INSTALLATION, jobId, new AbortController().signal, write.fn)
    await Promise.resolve()

    expect(guard.isWriting(INSTALLATION)).toBe(true)
    expect(job().writeLock).toBe(true)
    // Per installation, not global: a write into one installation says nothing
    // about another one, whose game may start freely.
    expect(guard.isWriting(OTHER_INSTALLATION)).toBe(false)

    write.resolve()
    await pending

    expect(guard.isWriting(INSTALLATION)).toBe(false)
    expect(job().writeLock).toBe(false)
  })

  it('stays true while a second writer still holds the same installation', async () => {
    const { jobs, guard } = setUp()
    const first = deferredWrite()
    const second = deferredWrite()
    const jobA = jobs.create({ moduleId: 'downloads', kind: 'a', labelKey: 'a' }).id
    const jobB = jobs.create({ moduleId: 'downloads', kind: 'b', labelKey: 'b' }).id

    const pendingA = guard.runWrite(INSTALLATION, jobA, new AbortController().signal, first.fn)
    const pendingB = guard.runWrite(INSTALLATION, jobB, new AbortController().signal, second.fn)
    await Promise.resolve()

    first.resolve()
    await pendingA

    // Nothing admits two writers today, but if one arrives, the first one's release
    // must not unlock the installation out from under the second.
    expect(guard.isWriting(INSTALLATION)).toBe(true)

    second.resolve()
    await pendingB
    expect(guard.isWriting(INSTALLATION)).toBe(false)
  })
})
