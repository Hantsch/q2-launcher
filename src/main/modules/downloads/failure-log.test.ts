import { describe, expect, it } from 'vitest'
import type { DownloadFailure } from '@shared/modules/downloads'
import {
  appendFailure,
  dismissFailure,
  FAILURE_LOG_CAP,
  FAILURE_LOG_RETENTION_MS,
  pruneFailures,
  restoreFailure,
  type NewDownloadFailure,
} from './failure-log'

/**
 * Story 073 D1. Pure rules only - no I/O, no `StateStore` - so every scenario is plain
 * array-in/array-out against a fixed clock (`T0`), which is what lets the 7-day boundary be
 * asserted exactly rather than approximately.
 */

const T0 = Date.UTC(2026, 0, 8)

function newEntry(overrides: Partial<NewDownloadFailure> = {}): NewDownloadFailure {
  return {
    jobId: 'job-1',
    labelKey: 'downloads.job.engine',
    error: { key: 'downloads.error.network' },
    ...overrides,
  }
}

describe('appendFailure', () => {
  it('adds a fresh entry to the front of the list with a generated id and createdAt', () => {
    const log = appendFailure([], newEntry(), T0)

    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      jobId: 'job-1',
      labelKey: 'downloads.job.engine',
      error: { key: 'downloads.error.network' },
      createdAt: T0,
    })
    expect(log[0]?.id).toBeTruthy()
    expect(log[0]?.dismissedAt).toBeUndefined()
  })

  it('two appends never collide on id', () => {
    const first = appendFailure([], newEntry(), T0)
    const second = appendFailure(first, newEntry({ jobId: 'job-2' }), T0)

    expect(second[0]?.id).not.toBe(second[1]?.id)
  })

  it('keeps the list newest-first', () => {
    let log: DownloadFailure[] = []
    log = appendFailure(log, newEntry({ jobId: 'job-1' }), T0)
    log = appendFailure(log, newEntry({ jobId: 'job-2' }), T0 + 1000)
    log = appendFailure(log, newEntry({ jobId: 'job-3' }), T0 + 2000)

    expect(log.map((entry) => entry.jobId)).toEqual(['job-3', 'job-2', 'job-1'])
  })

  it('caps the list at FAILURE_LOG_CAP entries, dropping the oldest first', () => {
    let log: DownloadFailure[] = []
    for (let i = 0; i < FAILURE_LOG_CAP + 10; i++) {
      log = appendFailure(log, newEntry({ jobId: `job-${i}` }), T0 + i)
    }

    expect(log).toHaveLength(FAILURE_LOG_CAP)
    // The newest entries survive; the oldest ten (job-0..job-9) were dropped by the cap.
    expect(log[0]?.jobId).toBe(`job-${FAILURE_LOG_CAP + 9}`)
    expect(log.some((entry) => entry.jobId === 'job-0')).toBe(false)
    expect(log.some((entry) => entry.jobId === 'job-9')).toBe(false)
  })
})

describe('dismissFailure', () => {
  it('sets dismissedAt on the matching entry and leaves others untouched', () => {
    let log = appendFailure([], newEntry({ jobId: 'job-1' }), T0)
    log = appendFailure(log, newEntry({ jobId: 'job-2' }), T0 + 1000)
    const targetId = log.find((entry) => entry.jobId === 'job-1')?.id ?? ''

    const dismissed = dismissFailure(log, targetId, T0 + 2000)

    const target = dismissed.find((entry) => entry.jobId === 'job-1')
    const other = dismissed.find((entry) => entry.jobId === 'job-2')
    expect(target?.dismissedAt).toBe(T0 + 2000)
    expect(other?.dismissedAt).toBeUndefined()
  })

  it('is a no-op for an id that is not in the list', () => {
    const log = appendFailure([], newEntry(), T0)

    expect(dismissFailure(log, 'not-a-real-id', T0 + 1000)).toEqual(log)
  })
})

describe('restoreFailure', () => {
  it('clears dismissedAt, bringing the entry back out of the history', () => {
    let log = appendFailure([], newEntry(), T0)
    const id = log[0]?.id ?? ''
    log = dismissFailure(log, id, T0 + 1000)
    expect(log[0]?.dismissedAt).toBe(T0 + 1000)

    const restored = restoreFailure(log, id, T0 + 2000)

    expect(restored[0]?.dismissedAt).toBeUndefined()
  })

  it('is a no-op for an id that is not in the list', () => {
    const log = appendFailure([], newEntry(), T0)

    expect(restoreFailure(log, 'not-a-real-id', T0 + 1000)).toEqual(log)
  })
})

describe('pruneFailures - AC2 retention', () => {
  it('a dismissed failure is gone after 7 days, an undismissed one never', () => {
    let log = appendFailure([], newEntry({ jobId: 'dismissed-old' }), T0)
    log = appendFailure(log, newEntry({ jobId: 'dismissed-recent' }), T0)
    log = appendFailure(log, newEntry({ jobId: 'never-dismissed' }), T0)

    const oldId = log.find((entry) => entry.jobId === 'dismissed-old')?.id ?? ''
    const recentId = log.find((entry) => entry.jobId === 'dismissed-recent')?.id ?? ''

    // Dismissed right at T0 (long past its own 7 days by readAt), and again just 1000ms before
    // reading - well within its own 7-day window.
    log = dismissFailure(log, oldId, T0)
    const readAt = T0 + FAILURE_LOG_RETENTION_MS + 1000
    log = dismissFailure(log, recentId, readAt - 1000)

    const pruned = pruneFailures(log, readAt)

    expect(pruned.some((entry) => entry.jobId === 'dismissed-old')).toBe(false)
    // Dismissed only 1000ms before the read, well inside its own retention window - kept.
    expect(pruned.some((entry) => entry.jobId === 'dismissed-recent')).toBe(true)
    // Never dismissed at all: survives no matter how old `createdAt` is.
    expect(pruned.some((entry) => entry.jobId === 'never-dismissed')).toBe(true)
  })

  it('a dismissed entry exactly at the boundary is kept, one past it is dropped', () => {
    let log = appendFailure([], newEntry(), T0)
    const id = log[0]?.id ?? ''
    log = dismissFailure(log, id, T0)

    const atBoundary = pruneFailures(log, T0 + FAILURE_LOG_RETENTION_MS)
    const pastBoundary = pruneFailures(log, T0 + FAILURE_LOG_RETENTION_MS + 1)

    expect(atBoundary).toHaveLength(1)
    expect(pastBoundary).toHaveLength(0)
  })

  it('an undismissed entry survives arbitrarily far in the future', () => {
    const log = appendFailure([], newEntry(), T0)

    const pruned = pruneFailures(log, T0 + FAILURE_LOG_RETENTION_MS * 100)

    expect(pruned).toHaveLength(1)
  })
})
