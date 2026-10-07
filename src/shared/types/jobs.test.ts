import { describe, expect, it } from 'vitest'
import { makeJob } from '../../test-support/fixtures'
import { countActiveJobs, type Job, type JobStatus } from './jobs'

function jobIn(moduleId: Job['moduleId'], status: JobStatus, idSuffix: string): Job {
  return makeJob({
    id: `job-${idSuffix}`,
    moduleId,
    kind: 'test-kind',
    labelKey: 'test.label',
    labelParams: undefined,
    status,
    progress: { ratio: null },
    startedAt: new Date(0).toISOString(),
  })
}

describe('countActiveJobs', () => {
  it('excludes jobs owned by other modules even when active', () => {
    const jobs = [jobIn('downloads', 'running', '1'), jobIn('mods', 'running', '2')]
    expect(countActiveJobs(jobs, 'downloads')).toBe(1)
  })

  it('counts queued, running and paused jobs', () => {
    const jobs = [
      jobIn('downloads', 'queued', '1'),
      jobIn('downloads', 'running', '2'),
      jobIn('downloads', 'paused', '3'),
    ]
    expect(countActiveJobs(jobs, 'downloads')).toBe(3)
  })

  it('does not count succeeded, failed or cancelled jobs', () => {
    const jobs = [
      jobIn('downloads', 'succeeded', '1'),
      jobIn('downloads', 'failed', '2'),
      jobIn('downloads', 'cancelled', '3'),
    ]
    expect(countActiveJobs(jobs, 'downloads')).toBe(0)
  })

  it('returns 0 when there are no matching active jobs', () => {
    expect(countActiveJobs([], 'downloads')).toBe(0)
  })
})
