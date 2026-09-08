import { describe, expect, it } from 'vitest'
import type { DownloadDiagnostics, DownloadFailure } from '@shared/modules/downloads'
import {
  appendFailure,
  capDiagnostics,
  DIAGNOSTICS_SIZE_CAP_BYTES,
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

function newDiagnostics(overrides: Partial<DownloadDiagnostics> = {}): DownloadDiagnostics {
  return {
    jobId: 'job-1',
    kind: 'bootstrap',
    startedAt: '2026-01-08T00:00:00.000Z',
    finishedAt: '2026-01-08T00:01:00.000Z',
    errorKey: 'downloads.error.installationNotPlayable',
    packages: [
      { id: 'q2pro-win64', url: 'https://example.test/q2pro.zip', sizeBytes: 1234, verified: true, extracted: true },
      { id: 'demo', url: 'https://example.test/demo.zip', sizeBytes: 5678, verified: true, extracted: false },
    ],
    target: {
      targetPath: 'C:\\Users\\%HOME%\\Games\\Quake2',
      verdict: 'invalid',
      missingChecks: [{ id: 'base-paks', messageKey: 'installation.check.basePaks' }],
    },
    logTail: ['starting bootstrap', 'downloading q2pro', 'downloading demo', 'assembling target'],
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

  // Story 075 D1 (AC1/AC6).
  it('a diagnostics record round-trips through the log', () => {
    const diagnostics = newDiagnostics()
    const log = appendFailure([], newEntry({ diagnostics }), T0)

    expect(log[0]?.diagnostics).toEqual(diagnostics)
  })

  it('an entry with no diagnostics still round-trips with no diagnostics field', () => {
    const log = appendFailure([], newEntry(), T0)

    expect(log[0]?.diagnostics).toBeUndefined()
  })

  it('caps the 50-entry list unchanged when every entry also carries diagnostics', () => {
    let log: DownloadFailure[] = []
    for (let i = 0; i < FAILURE_LOG_CAP + 10; i++) {
      log = appendFailure(
        log,
        newEntry({ jobId: `job-${i}`, diagnostics: newDiagnostics({ jobId: `job-${i}` }) }),
        T0 + i,
      )
    }

    expect(log).toHaveLength(FAILURE_LOG_CAP)
    expect(log[0]?.diagnostics?.jobId).toBe(`job-${FAILURE_LOG_CAP + 9}`)
  })

  it('an oversized diagnostics record is trimmed to the cap and marked truncated when appended', () => {
    const oversized = newDiagnostics({ logTail: Array.from({ length: 5000 }, (_, i) => `line ${i}`) })
    const log = appendFailure([], newEntry({ diagnostics: oversized }), T0)

    const stored = log[0]?.diagnostics
    expect(stored).toBeDefined()
    expect(JSON.stringify(stored).length).toBeLessThanOrEqual(DIAGNOSTICS_SIZE_CAP_BYTES)
    expect(stored?.truncated).toBe(true)
  })
})

describe('capDiagnostics', () => {
  it('returns a within-budget record unchanged, with no truncated flag', () => {
    const diagnostics = newDiagnostics()

    expect(capDiagnostics(diagnostics)).toEqual(diagnostics)
  })

  it('trims logTail oldest-first before touching packages or target', () => {
    // "oldest" is padded far larger than "middle"/"newest" combined, so a budget just above what
    // dropping it alone would need cannot be satisfied by coincidence at any other trim point.
    const diagnostics = newDiagnostics({
      logTail: [`oldest-${'x'.repeat(500)}`, 'middle', 'newest'],
    })
    const sizeWithoutOldest = JSON.stringify({
      ...diagnostics,
      logTail: ['middle', 'newest'],
      truncated: true,
    }).length
    const budget = sizeWithoutOldest + 50

    const result = capDiagnostics(diagnostics, budget)

    expect(result?.logTail).toEqual(['middle', 'newest'])
    expect(result?.packages).toEqual(diagnostics.packages)
    expect(result?.target).toEqual(diagnostics.target)
    expect(result?.truncated).toBe(true)
  })

  it('keeps the last-processed packages when packages have to be trimmed', () => {
    // Packages are recorded in processing order, and a bootstrap run most often fails on the one
    // it processed last - that is the package AC2 exists to identify, so it must be the last to
    // go, not the first.
    const pad = 'x'.repeat(400)
    const diagnostics = newDiagnostics({ logTail: [] })
    diagnostics.packages = ['first', 'second', 'third', 'last'].map((id) => ({
      id,
      url: `https://example.invalid/${id}-${pad}.zip`,
      sizeBytes: 1,
      verified: true,
      extracted: true,
    }))

    const budget = JSON.stringify({
      ...diagnostics,
      truncated: true,
      packages: diagnostics.packages.slice(2),
    }).length

    const result = capDiagnostics(diagnostics, budget)

    expect(result?.packages.map((pkg) => pkg.id)).toEqual(['third', 'last'])
    expect(result?.truncated).toBe(true)
  })

  it('drops packages after logTail is exhausted, then target, then the whole record', () => {
    // Each piece is padded far larger than the others combined, so a budget "just above" what
    // dropping everything up to (and including) one piece would need cannot accidentally be
    // satisfied by a different trim point - including the ~18-byte overhead of the `truncated`
    // flag itself, which every trimmed result carries.
    const bigLine = (label: string): string => `${label}-${'x'.repeat(2000)}`
    const diagnostics = newDiagnostics({
      logTail: [bigLine('log')],
      target: {
        targetPath: bigLine('target'),
        verdict: 'invalid',
        missingChecks: [{ id: 'base-paks', messageKey: 'installation.check.basePaks' }],
      },
    })
    diagnostics.packages = [
      { id: 'p1', url: bigLine('p1'), sizeBytes: 1, verified: true, extracted: true },
    ]

    const withNoLogTail = { ...diagnostics, truncated: true, logTail: [] }
    const withNoPackages = { ...withNoLogTail, packages: [] }
    const withNoTarget = (({ target: _target, ...rest }) => rest)(withNoPackages)

    // Fits once logTail and packages are both gone, but not with just logTail gone (the huge
    // package URL alone still overshoots) - packages must go too.
    const packageTrimResult = capDiagnostics(diagnostics, JSON.stringify(withNoPackages).length + 50)
    expect(packageTrimResult?.logTail).toEqual([])
    expect(packageTrimResult?.packages).toEqual([])
    expect(packageTrimResult?.target).toEqual(diagnostics.target)
    expect(packageTrimResult?.truncated).toBe(true)

    // Fits once packages are also gone, but not with them present - target must go.
    const targetDroppedResult = capDiagnostics(diagnostics, JSON.stringify(withNoTarget).length + 50)
    expect(targetDroppedResult?.target).toBeUndefined()
    expect(targetDroppedResult?.truncated).toBe(true)

    // Too small even with nothing left to trim - the whole record is dropped.
    expect(capDiagnostics(diagnostics, JSON.stringify(withNoTarget).length - 1)).toBeUndefined()
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
