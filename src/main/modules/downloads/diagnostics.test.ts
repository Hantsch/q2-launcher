import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/types'
import {
  createDiagnosticsCollector,
  DIAGNOSTICS_LOG_TAIL_LINES,
  diagnosticsFor,
  diagnosticsRegistrySize,
  dropDiagnostics,
  HOME_PLACEHOLDER,
  redactHome,
  UNKNOWN_DOWNLOAD_FAILURE_KEY,
} from './diagnostics'
import {
  downloadFailureWithDiagnostics,
  FIXTURE_ACCOUNT_NAME,
  FIXTURE_HOME_DIR,
  FIXTURE_RAW_TARGET_PATH,
} from '../../../../scripts/lib/download-failures.mjs'
import {
  HOME_PLACEHOLDER as mirrorPlaceholder,
  redactHome as mirrorRedactHome,
} from '../../../../scripts/lib/redact-home.mjs'

/**
 * Story 075 D2. `redactHome` is reviewed at the hard tier specifically for AC4 - a silent
 * under-match here ships a real Windows account name into a public GitHub issue - so every case
 * the story names gets its own assertion rather than being folded into a table.
 */
describe('redactHome', () => {
  const home = 'C:\\Users\\bob'

  it('replaces the home prefix with the placeholder', () => {
    expect(redactHome('C:\\Users\\bob\\AppData\\Roaming\\Q2 Launcher', home)).toBe(
      `${HOME_PLACEHOLDER}\\AppData\\Roaming\\Q2 Launcher`,
    )
  })

  it('replaces the home directory itself with exactly the placeholder', () => {
    expect(redactHome('C:\\Users\\bob', home)).toBe(HOME_PLACEHOLDER)
  })

  it('is case-insensitive on win32 (drive letter / path casing differences)', () => {
    // This repo is Windows-first (CLAUDE.md) and the suite runs on win32, so `process.platform`
    // is already what this case needs to prove - no stubbing required.
    expect(process.platform).toBe('win32')
    expect(redactHome('c:\\USERS\\BOB\\AppData', home)).toBe(`${HOME_PLACEHOLDER}\\AppData`)
  })

  it('leaves a path outside the home directory byte-identical', () => {
    const outside = 'D:\\Games\\Quake2\\baseq2'
    expect(redactHome(outside, home)).toBe(outside)
  })

  it('never partially matches a sibling directory sharing the prefix', () => {
    // C:\Users\bobby is not inside C:\Users\bob - the literal AC4 case.
    const sibling = 'C:\\Users\\bobby\\AppData'
    expect(redactHome(sibling, home)).toBe(sibling)
  })

  it('does not match a path that only shares an unrelated prefix', () => {
    expect(redactHome('C:\\Users\\bobsled', home)).toBe('C:\\Users\\bobsled')
  })

  // `tee()` feeds `redactHome` arbitrary prose log lines, where a home path is followed by
  // whatever the sentence around it happens to put there - a boundary that only accepts a
  // separator or end-of-string leaks the account name in every case below.
  it.each([
    ['a colon', 'target: C:\\Users\\bob: not writable', `target: ${HOME_PLACEHOLDER}: not writable`],
    ['a closing paren', 'cleanup (C:\\Users\\bob) done', `cleanup (${HOME_PLACEHOLDER}) done`],
    ['a comma', 'roots: C:\\Users\\bob, D:\\Games', `roots: ${HOME_PLACEHOLDER}, D:\\Games`],
    ['a newline', 'root\nC:\\Users\\bob\nend', `root\n${HOME_PLACEHOLDER}\nend`],
  ])('redacts a home path followed by %s', (_label, input, expected) => {
    expect(redactHome(input, home)).toBe(expected)
  })

  it('redacts the forward-slash form of the same home directory', () => {
    expect(redactHome('C:/Users/bob/AppData/Roaming', home)).toBe(`${HOME_PLACEHOLDER}/AppData/Roaming`)
  })

  it('redacts the JSON-escaped double-backslash form', () => {
    expect(redactHome('{"path":"C:\\\\Users\\\\bob\\\\AppData"}', home)).toBe(
      `{"path":"${HOME_PLACEHOLDER}\\\\AppData"}`,
    )
  })

  it('still refuses a sibling directory when the boundary is broadened', () => {
    // The four cases above must not have been bought by dropping the AC4 sibling guarantee.
    expect(redactHome('C:\\Users\\bobby, C:\\Users\\bob2 and C:\\Users\\bob-old', home)).toBe(
      'C:\\Users\\bobby, C:\\Users\\bob2 and C:\\Users\\bob-old',
    )
  })
})

describe('the scripts/ mirror of redactHome', () => {
  // `scripts/lib/fixture.mjs` seeds the UI-verification fixture with redacted paths and cannot
  // import this module (plain Node ESM, outside both TS projects), so it uses the hand-kept mirror
  // in `scripts/lib/redact-home.mjs`. This is the check that keeps the copy honest - without it,
  // `scripts/flows/downloads-tab.mjs`'s AC4 assertion would prove a property of the fixture rather
  // than of the code under test.
  const cases: Array<[string, string]> = [
    ['C:\\Users\\bob\\AppData\\Roaming\\Q2 Launcher', 'C:\\Users\\bob'],
    ['C:\\Users\\bob', 'C:\\Users\\bob'],
    ['c:\\USERS\\BOB\\AppData', 'C:\\Users\\bob'],
    ['D:\\Games\\Quake2\\baseq2', 'C:\\Users\\bob'],
    ['C:\\Users\\bobby\\AppData', 'C:\\Users\\bob'],
    ['inspecting C:\\Users\\bob\\Games\\Q2: status invalid', 'C:\\Users\\bob'],
    ['C:/Users/bob/AppData/Roaming', 'C:\\Users\\bob'],
    ['{"path":"C:\\\\Users\\\\bob\\\\AppData"}', 'C:\\Users\\bob'],
    ['/home/bob/.local/share/q2launcher', '/home/bob'],
    // The fixture's own raw inputs, so a change to either side is caught where it matters.
    [`${FIXTURE_HOME_DIR}\\AppData\\Roaming\\Q2 Launcher\\installs\\Q2PRO Demo`, FIXTURE_HOME_DIR],
  ]

  it('produces byte-identical output to the real implementation', () => {
    expect(mirrorPlaceholder).toBe(HOME_PLACEHOLDER)
    for (const [value, homeDir] of cases) {
      expect(mirrorRedactHome(value, homeDir), `mirror diverged for ${JSON.stringify(value)}`).toBe(
        redactHome(value, homeDir),
      )
    }
  })

  it('the seeded fixture entry is what real redaction produces, and names no account', () => {
    const entry = downloadFailureWithDiagnostics()
    const expectedTargetPath = redactHome(FIXTURE_RAW_TARGET_PATH, FIXTURE_HOME_DIR)

    expect(entry.diagnostics.target.targetPath).toBe(expectedTargetPath)
    expect(expectedTargetPath).toContain(HOME_PLACEHOLDER)

    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain(FIXTURE_ACCOUNT_NAME)
    expect(serialized).not.toContain(FIXTURE_HOME_DIR)
    for (const line of entry.diagnostics.logTail) {
      expect(line).toBe(redactHome(line, FIXTURE_HOME_DIR))
    }
  })
})

function fakeLog(): { info: (message: string) => void; warn: (message: string) => void } {
  return { info: vi.fn<(message: string) => void>(), warn: vi.fn<(message: string) => void>() }
}

function terminalJob(overrides: Partial<Job> = {}): Job {
  return {
    id: randomUUID(),
    moduleId: 'downloads',
    kind: 'bootstrap',
    labelKey: 'downloads.job.bootstrap',
    status: 'failed',
    progress: { ratio: 1 },
    cancellable: false,
    startedAt: '2026-09-08T00:00:00.000Z',
    finishedAt: '2026-09-08T00:05:00.000Z',
    error: { key: 'downloads.error.installationNotPlayable' },
    ...overrides,
  }
}

describe('createDiagnosticsCollector / diagnosticsFor / dropDiagnostics', () => {
  it('recordPackage stores packages in order, with the url redacted', () => {
    const jobId = randomUUID()
    const collector = createDiagnosticsCollector(jobId, 'bootstrap', 'C:\\Users\\bob')

    collector.recordPackage({
      id: 'q2pro-1.0.0',
      url: 'C:\\Users\\bob\\AppData\\cache\\q2pro.zip',
      sizeBytes: 100,
      verified: true,
      extracted: true,
    })
    collector.recordPackage({
      id: 'demo-1.0.0',
      url: 'https://example.com/demo.zip',
      sizeBytes: 200,
      verified: true,
      extracted: false,
    })

    const diagnostics = diagnosticsFor(terminalJob({ id: jobId }))
    expect(diagnostics?.packages).toEqual([
      {
        id: 'q2pro-1.0.0',
        url: `${HOME_PLACEHOLDER}\\AppData\\cache\\q2pro.zip`,
        sizeBytes: 100,
        verified: true,
        extracted: true,
      },
      {
        id: 'demo-1.0.0',
        url: 'https://example.com/demo.zip',
        sizeBytes: 200,
        verified: true,
        extracted: false,
      },
    ])
  })

  it('recordTarget stores the target with a redacted path, and a later call replaces it', () => {
    const jobId = randomUUID()
    const collector = createDiagnosticsCollector(jobId, 'bootstrap', 'C:\\Users\\bob')

    collector.recordTarget({
      targetPath: 'C:\\Users\\bob\\Games\\Q2',
      verdict: 'invalid',
      missingChecks: [{ id: 'base-paks', messageKey: 'installations.checks.missingPak0' }],
    })
    collector.recordTarget({
      targetPath: 'D:\\Games\\Q2',
      verdict: 'missing',
      missingChecks: [],
    })

    const diagnostics = diagnosticsFor(terminalJob({ id: jobId }))
    expect(diagnostics?.target).toEqual({
      targetPath: 'D:\\Games\\Q2',
      verdict: 'missing',
      missingChecks: [],
    })
  })

  it('tee forwards every line to the wrapped logger and keeps a bounded, redacted ring', () => {
    const jobId = randomUUID()
    const collector = createDiagnosticsCollector(jobId, 'bootstrap', 'C:\\Users\\bob')
    const log = fakeLog()
    const teed = collector.tee(log)

    teed.info('starting bootstrap for C:\\Users\\bob\\AppData\\Roaming\\Q2 Launcher')
    teed.warn('mirror fired for q2pro.zip')

    expect(log.info).toHaveBeenCalledWith(
      'starting bootstrap for C:\\Users\\bob\\AppData\\Roaming\\Q2 Launcher',
    )
    expect(log.warn).toHaveBeenCalledWith('mirror fired for q2pro.zip')

    const diagnostics = diagnosticsFor(terminalJob({ id: jobId }))
    expect(diagnostics?.logTail).toEqual([
      `starting bootstrap for ${HOME_PLACEHOLDER}\\AppData\\Roaming\\Q2 Launcher`,
      'mirror fired for q2pro.zip',
    ])
  })

  it('tee bounds the ring to the last N lines, oldest dropped first', () => {
    const jobId = randomUUID()
    const collector = createDiagnosticsCollector(jobId, 'bootstrap', 'C:\\Users\\bob')
    const teed = collector.tee(fakeLog())

    const total = DIAGNOSTICS_LOG_TAIL_LINES + 10
    for (let i = 0; i < total; i += 1) teed.info(`line ${i}`)

    const diagnostics = diagnosticsFor(terminalJob({ id: jobId }))
    expect(diagnostics?.logTail).toHaveLength(DIAGNOSTICS_LOG_TAIL_LINES)
    expect(diagnostics?.logTail[0]).toBe('line 10')
    expect(diagnostics?.logTail[diagnostics.logTail.length - 1]).toBe(`line ${total - 1}`)
  })

  it('diagnosticsFor answers undefined for a job with no collector', () => {
    expect(diagnosticsFor(terminalJob({ id: randomUUID() }))).toBeUndefined()
  })

  it('diagnosticsFor mirrors the job\'s own startedAt/finishedAt/errorKey', () => {
    const jobId = randomUUID()
    createDiagnosticsCollector(jobId, 'bootstrap', 'C:\\Users\\bob')

    const diagnostics = diagnosticsFor(
      terminalJob({
        id: jobId,
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:10:00.000Z',
        error: { key: 'downloads.error.packageUnavailable' },
      }),
    )

    expect(diagnostics).toMatchObject({
      jobId,
      kind: 'bootstrap',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:10:00.000Z',
      errorKey: 'downloads.error.packageUnavailable',
    })
  })

  it('diagnosticsFor falls back to the unknown-failure key when the job carries no error', () => {
    const jobId = randomUUID()
    createDiagnosticsCollector(jobId, 'bootstrap', 'C:\\Users\\bob')

    const diagnostics = diagnosticsFor(terminalJob({ id: jobId, error: undefined }))

    expect(diagnostics?.errorKey).toBe(UNKNOWN_DOWNLOAD_FAILURE_KEY)
  })

  it('dropDiagnostics removes the entry, leaving the registry empty for that job', () => {
    const jobId = randomUUID()
    const before = diagnosticsRegistrySize()
    createDiagnosticsCollector(jobId, 'bootstrap', 'C:\\Users\\bob')
    expect(diagnosticsRegistrySize()).toBe(before + 1)

    dropDiagnostics(jobId)

    expect(diagnosticsRegistrySize()).toBe(before)
    expect(diagnosticsFor(terminalJob({ id: jobId }))).toBeUndefined()
  })

  it('dropDiagnostics on an id nothing was ever recorded for is a no-op', () => {
    const before = diagnosticsRegistrySize()
    expect(() => dropDiagnostics(randomUUID())).not.toThrow()
    expect(diagnosticsRegistrySize()).toBe(before)
  })
})
