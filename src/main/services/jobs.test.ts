import { describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/types'
import { JobsService } from './jobs'

/**
 * Story 073 D2: `JobsService` grew a multi-listener `onChange(listener)` next to the single
 * broadcast callback the shell hands it at construction (`context.ts` wires that one to
 * `jobs:changed`, which every job surface in the UI reads).
 *
 * The point of this suite is the *seam*, not the job lifecycle: the broadcast is the mechanism the
 * action bar's download readout depends on, and it has no test of its own that would notice it
 * being wrapped, delayed, dropped or fired twice. So the assertions here are deliberately about
 * call counts, payloads and ordering rather than about job state - the states themselves are
 * exercised by `main/modules/downloads/pipeline.test.ts`.
 */

function service(): { jobs: JobsService; broadcast: ReturnType<typeof vi.fn> } {
  const broadcast = vi.fn<(jobs: Job[]) => void>()
  return { jobs: new JobsService(broadcast), broadcast }
}

function create(jobs: JobsService, moduleId: Job['moduleId'] = 'downloads'): string {
  return jobs.create({ moduleId, kind: 'download', labelKey: 'downloads.job.download' }).id
}

describe('JobsService broadcast (unchanged by story 073 D2)', () => {
  it('fires exactly once per change, with the full list', () => {
    const { jobs, broadcast } = service()

    const id = create(jobs)
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ id, status: 'queued' })])

    jobs.progress(id, { ratio: 0.5, bytesDone: 50, bytesTotal: 100 })
    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(broadcast.mock.calls[1]?.[0]?.[0]).toMatchObject({
      status: 'running',
      progress: { ratio: 0.5, bytesDone: 50, bytesTotal: 100 },
    })

    jobs.finish(id, { status: 'failed', error: { key: 'downloads.error.network' } })
    expect(broadcast).toHaveBeenCalledTimes(3)
    expect(broadcast.mock.calls[2]?.[0]?.[0]).toMatchObject({
      status: 'failed',
      error: { key: 'downloads.error.network' },
    })

    jobs.clearFinished()
    expect(broadcast).toHaveBeenCalledTimes(4)
  })

  it('an unknown job id changes nothing and broadcasts nothing', () => {
    const { jobs, broadcast } = service()

    jobs.progress('nope', { ratio: 1 })
    jobs.finish('nope', { status: 'succeeded' })
    const outcome = jobs.cancel('nope')

    expect(broadcast).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(false)
  })

  it('still fires exactly once per change with listeners attached', () => {
    const { jobs, broadcast } = service()
    jobs.onChange(vi.fn())
    jobs.onChange(vi.fn())

    const id = create(jobs)
    jobs.finish(id, { status: 'succeeded' })

    // Two changes, two broadcasts - a listener must not double-broadcast or suppress one.
    expect(broadcast).toHaveBeenCalledTimes(2)
  })

  it('is delivered even when a listener throws, and before the listeners run', () => {
    const { jobs, broadcast } = service()
    const order: string[] = []
    broadcast.mockImplementation(() => {
      order.push('broadcast')
    })
    jobs.onChange(() => {
      order.push('throwing listener')
      throw new Error('listener is broken')
    })
    const healthy = vi.fn(() => {
      order.push('healthy listener')
    })
    jobs.onChange(healthy)

    expect(() => create(jobs)).not.toThrow()

    expect(broadcast).toHaveBeenCalledTimes(1)
    // A broken listener costs neither the broadcast nor its siblings, and the broadcast goes
    // first, so nothing a listener does can hold up `jobs:changed`.
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['broadcast', 'throwing listener', 'healthy listener'])
  })
})

/**
 * Story 074 D4: `playableAtRatio` became settable after creation, because the bootstrap job's
 * threshold is decided by `inspectInstallation` reading the real target folder mid-job - it cannot
 * be known at `create()` time. The assertions below are about exactly that: the value is visible
 * in `list()` and in the next emission, and recording it changes nothing else about the job.
 */
describe('JobsService.markPlayable', () => {
  it('sets playableAtRatio after creation and emits the new value', () => {
    const { jobs, broadcast } = service()
    const id = create(jobs)
    expect(jobs.list()[0]?.playableAtRatio).toBeUndefined()

    jobs.markPlayable(id, 0.9)

    expect(jobs.list()[0]?.playableAtRatio).toBe(0.9)
    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(broadcast.mock.calls[1]?.[0]?.[0]).toMatchObject({ id, playableAtRatio: 0.9 })
  })

  it('leaves the job otherwise untouched - it is not a progress report', () => {
    const { jobs } = service()
    const id = create(jobs)
    jobs.progress(id, { ratio: 0.5, bytesDone: 50, bytesTotal: 100 })
    jobs.finish(id, { status: 'succeeded' })
    const before = jobs.list()[0]!

    jobs.markPlayable(id, 0.9)

    // A finished job stays finished: recording the marker must not resurrect it to `running`.
    expect(jobs.list()[0]).toEqual({ ...before, playableAtRatio: 0.9 })
  })

  it('an unknown job id changes nothing and broadcasts nothing', () => {
    const { jobs, broadcast } = service()

    jobs.markPlayable('nope', 0.9)

    expect(jobs.list()).toEqual([])
    expect(broadcast).not.toHaveBeenCalled()
  })
})

describe('JobsService.onChange', () => {
  it('notifies every listener with the same list the broadcast got', () => {
    const { jobs, broadcast } = service()
    const first = vi.fn<(jobs: Job[]) => void>()
    const second = vi.fn<(jobs: Job[]) => void>()
    jobs.onChange(first)
    jobs.onChange(second)

    const id = create(jobs)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first.mock.calls[0]?.[0]).toEqual(broadcast.mock.calls[0]?.[0])
    expect(first.mock.calls[0]?.[0]?.[0]?.id).toBe(id)
  })

  it('notifies listeners for every kind of change', () => {
    const { jobs } = service()
    const listener = vi.fn<(jobs: Job[]) => void>()
    jobs.onChange(listener)

    const id = create(jobs)
    jobs.progress(id, { ratio: 0.25 })
    jobs.finish(id, { status: 'failed' })
    jobs.clearFinished()

    expect(listener).toHaveBeenCalledTimes(4)
    expect(listener.mock.calls.map((call) => call[0][0]?.status)).toEqual([
      'queued',
      'running',
      'failed',
      // `clearFinished()` keeps a failed job on purpose - only succeeded/cancelled ones go.
      'failed',
    ])
  })

  it('the returned unsubscribe removes only that listener', () => {
    const { jobs, broadcast } = service()
    const removed = vi.fn<(jobs: Job[]) => void>()
    const kept = vi.fn<(jobs: Job[]) => void>()
    const unsubscribe = jobs.onChange(removed)
    jobs.onChange(kept)

    create(jobs)
    unsubscribe()
    create(jobs)
    // Unsubscribing twice is not an error and does not affect anyone else.
    unsubscribe()
    create(jobs)

    expect(removed).toHaveBeenCalledTimes(1)
    expect(kept).toHaveBeenCalledTimes(3)
    expect(broadcast).toHaveBeenCalledTimes(3)
  })

  it('a listener unsubscribing during delivery does not skip its siblings', () => {
    const { jobs } = service()
    const later = vi.fn<(jobs: Job[]) => void>()
    let unsubscribe: () => void = () => {}
    unsubscribe = jobs.onChange(() => unsubscribe())
    jobs.onChange(later)

    create(jobs)

    expect(later).toHaveBeenCalledTimes(1)
  })

  it('the same listener registered twice is notified once', () => {
    const { jobs } = service()
    const listener = vi.fn<(jobs: Job[]) => void>()
    jobs.onChange(listener)
    jobs.onChange(listener)

    create(jobs)

    // A `Set`, so a double registration is one subscription - a module that sets up twice cannot
    // silently log a failure twice.
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
