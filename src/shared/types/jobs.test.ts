import { describe, expect, it } from 'vitest'
import { countActiveJobs, type Job, type JobStatus } from './jobs'

function makeJob(moduleId: Job['moduleId'], status: JobStatus, idSuffix: string): Job {
  return {
    id: `job-${idSuffix}`,
    moduleId,
    kind: 'test-kind',
    labelKey: 'test.label',
    status,
    progress: { ratio: null },
    cancellable: true,
    startedAt: new Date(0).toISOString(),
  }
}

describe('countActiveJobs', () => {
  it('excludes jobs owned by other modules even when active', () => {
    const jobs = [makeJob('downloads', 'running', '1'), makeJob('mods', 'running', '2')]
    expect(countActiveJobs(jobs, 'downloads')).toBe(1)
  })

  it('counts queued, running and paused jobs', () => {
    const jobs = [
      makeJob('downloads', 'queued', '1'),
      makeJob('downloads', 'running', '2'),
      makeJob('downloads', 'paused', '3'),
    ]
    expect(countActiveJobs(jobs, 'downloads')).toBe(3)
  })

  it('does not count succeeded, failed or cancelled jobs', () => {
    const jobs = [
      makeJob('downloads', 'succeeded', '1'),
      makeJob('downloads', 'failed', '2'),
      makeJob('downloads', 'cancelled', '3'),
    ]
    expect(countActiveJobs(jobs, 'downloads')).toBe(0)
  })

  it('returns 0 when there are no matching active jobs', () => {
    expect(countActiveJobs([], 'downloads')).toBe(0)
  })
})
