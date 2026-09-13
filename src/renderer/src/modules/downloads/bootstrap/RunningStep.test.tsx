// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DownloadDiagnostics, DownloadFailure } from '@shared/modules/downloads'
import type { Job } from '@shared/types'
import { initI18n } from '../../../i18n'
import { RunningStep } from './RunningStep'

/**
 * Story 078 D7 (AC4): `RunningStep` is presentational for the cause detail - it just mounts the
 * shared `FailureCauseDetail` with whatever `failure` `BootstrapWizard` hands it (that fetch-once
 * behaviour is covered separately in `BootstrapWizard.test.tsx`). Mirrors
 * `FailureLogEntry.test.tsx`'s conventions for asserting the closed `<details>`.
 */

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    moduleId: 'downloads',
    kind: 'bootstrap-install',
    labelKey: 'downloads.job.bootstrap',
    status: 'running',
    progress: { ratio: 0.5, bytesDone: 500_000, bytesTotal: 1_000_000 },
    cancellable: false,
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

const diagnostics: DownloadDiagnostics = {
  jobId: 'job-1',
  kind: 'bootstrap',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  errorKey: 'downloads.error.installationNotPlayable',
  packages: [
    {
      id: 'demo-data',
      url: 'https://mirror.test/demo.zip',
      sizeBytes: 2_000_000,
      verified: true,
      extracted: true,
      contributed: false,
    },
  ],
  target: {
    targetPath: 'D:\\Games\\Quake II',
    verdict: 'invalid',
    missingChecks: [{ id: 'base-paks', messageKey: 'validation.pak0Missing' }],
  },
  logTail: [],
}

function makeFailure(overrides: Partial<DownloadFailure> = {}): DownloadFailure {
  return {
    id: 'failure-1',
    jobId: 'job-1',
    labelKey: 'downloads.job.bootstrap',
    error: { key: 'downloads.error.installationNotPlayable' },
    createdAt: Date.now(),
    ...overrides,
  }
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('RunningStep', () => {
  it('a failed job renders the same cause detail as the Downloads tab', () => {
    render(
      createElement(RunningStep, {
        job: makeJob({ status: 'failed', error: { key: 'downloads.error.installationNotPlayable' } }),
        failure: makeFailure({ diagnostics }),
      }),
    )

    // The existing single-line error stays.
    expect(
      screen.getByText('The files were downloaded, but the result was not a usable Quake II installation.'),
    ).toBeTruthy()

    // The same shared detail as `FailureLogEntry` mounts, closed by default, with the same content.
    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details).toBeTruthy()
    expect(details.hasAttribute('open')).toBe(false)
    details.open = true
    expect(
      screen.getByText(
        'demo-data: downloaded, verified and extracted, but did not contribute to the installation',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Not playable')).toBeTruthy()
  })

  it('a failed job with no matching/diagnostics-less failure entry keeps just the error line', () => {
    render(
      createElement(RunningStep, {
        job: makeJob({ status: 'failed', error: { key: 'downloads.error.installationNotPlayable' } }),
        failure: undefined,
      }),
    )

    expect(
      screen.getByText('The files were downloaded, but the result was not a usable Quake II installation.'),
    ).toBeTruthy()
    expect(document.querySelector('details')).toBeNull()
  })

  it('a running job renders no error line and no detail (BootstrapWizard never passes a failure for it)', () => {
    render(
      createElement(RunningStep, {
        job: makeJob({ status: 'running' }),
        failure: undefined,
      }),
    )

    expect(document.querySelector('details')).toBeNull()
    expect(screen.queryByText(/not a usable Quake II installation/)).toBeNull()
  })

  it('a succeeded job renders no error line and no detail', () => {
    render(
      createElement(RunningStep, {
        job: makeJob({ status: 'succeeded' }),
        failure: undefined,
      }),
    )

    expect(document.querySelector('details')).toBeNull()
    expect(screen.queryByText(/not a usable Quake II installation/)).toBeNull()
  })
})
