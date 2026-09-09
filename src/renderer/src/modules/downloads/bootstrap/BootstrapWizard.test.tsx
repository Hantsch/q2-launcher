// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  BootstrapEngineOption,
  BootstrapSummary,
  BootstrapTargetVerdict,
  DownloadFailure,
} from '@shared/modules/downloads'
import type { Job } from '@shared/types'
import { initI18n } from '../../../i18n'
import { useLauncher } from '../../../store/useLauncher'
import { BootstrapWizard } from './BootstrapWizard'

/**
 * Story 078 D7 (AC4): `BootstrapWizard` fetches `getDownloadFailures()` once the running job
 * turns `failed` and matches on `jobId`, then hands the match to `RunningStep`
 * (`RunningStep.test.tsx` covers the presentational side of mounting `FailureCauseDetail`).
 *
 * The wizard has to be driven through its own steps to reach `running` - there is no shortcut
 * prop - so this mirrors `FailureLogEntry.test.tsx`/`DownloadsView.test.tsx`'s conventions for
 * stubbing `./client` and the `q2` bridge rather than inventing a new harness.
 */

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(),
    on: vi.fn(() => () => {}),
  }
})

const invokeMock = vi.fn(async (...args: [string, ...unknown[]]) => {
  if (args[0] === 'installations:pickFolder') return 'D:\\Games\\Quake II'
  return { ok: true }
})

vi.mock('../../../lib/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, ...unknown[]])),
}))

const engineOptions: BootstrapEngineOption[] = [
  { engine: 'q2pro', packageId: 'engine-q2pro', version: '1.0.0', sizeBytes: 1_000_000 },
]

const verdict: BootstrapTargetVerdict = {
  targetPath: 'D:\\Games\\Quake II',
  blocked: false,
  programFiles: false,
  notWritable: false,
  entries: [],
  alreadyInstalled: false,
}

const summary: BootstrapSummary = {
  targetPath: 'D:\\Games\\Quake II',
  engine: 'q2pro',
  totalSizeBytes: 3_000_000,
  packages: [{ id: 'demo-data', role: 'demo', version: '1.0', sizeBytes: 3_000_000 }],
  includeVideoAndPlayers: false,
}

const getDownloadFailures = vi.fn(async (): Promise<{ ok: true; value: DownloadFailure[] }> => ({
  ok: true,
  value: [],
}))

vi.mock('../client', () => ({
  getBootstrapEngineOptions: vi.fn(async () => ({ ok: true, value: engineOptions })),
  getBootstrapTargetVerdict: vi.fn(async () => ({ ok: true, value: verdict })),
  getBootstrapSummary: vi.fn(async () => ({ ok: true, value: summary })),
  startBootstrapInstall: vi.fn(async () => ({
    ok: true,
    value: { jobId: 'job-1', installationId: 'inst-1' },
  })),
  getDownloadFailures: (...args: unknown[]) => getDownloadFailures(...(args as [])),
}))

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

const diagnosticsFailure: DownloadFailure = {
  id: 'failure-1',
  jobId: 'job-1',
  labelKey: 'downloads.job.bootstrap',
  error: { key: 'downloads.error.installationNotPlayable' },
  createdAt: Date.now(),
  diagnostics: {
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
    logTail: [],
  },
}

/** Drives the wizard from `engine` through `confirm` and starts the job, landing on `running`. */
async function runToRunningStep(): Promise<void> {
  render(createElement(BootstrapWizard))

  await screen.findByTestId('bootstrap-engine-q2pro')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  await screen.findByTestId('bootstrap-target-path-input')
  fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
  await waitFor(() =>
    expect(
      (screen.getByTestId('bootstrap-target-path-input').querySelector('input') as HTMLInputElement)
        .value,
    ).toBe('D:\\Games\\Quake II'),
  )
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  await screen.findByTestId('bootstrap-confirm-total-size')
  await waitFor(() =>
    expect((screen.getByTestId('bootstrap-confirm-start') as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
  fireEvent.click(screen.getByTestId('bootstrap-confirm-start'))

  await screen.findByTestId('bootstrap-running-step')
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useLauncher.setState({ jobs: [] })
})

describe('BootstrapWizard failure fetch (story 078 D7, AC4)', () => {
  it('a running job triggers no fetch of getDownloadFailures at all', async () => {
    useLauncher.setState({ jobs: [makeJob({ status: 'running' })] })
    await runToRunningStep()

    expect(screen.getByTestId('bootstrap-running-step').dataset.status).toBe('running')
    expect(getDownloadFailures).not.toHaveBeenCalled()
  })

  it('a succeeded job triggers no fetch of getDownloadFailures at all', async () => {
    useLauncher.setState({ jobs: [makeJob({ status: 'running' })] })
    await runToRunningStep()

    act(() => {
      useLauncher.setState({ jobs: [makeJob({ status: 'succeeded', progress: { ratio: 1, bytesDone: 1, bytesTotal: 1 } })] })
    })

    await waitFor(() =>
      expect(screen.getByTestId('bootstrap-running-step').dataset.status).toBe('succeeded'),
    )
    expect(getDownloadFailures).not.toHaveBeenCalled()
  })

  it('a failed job fetches once, matches by jobId, and RunningStep shows the same cause detail', async () => {
    getDownloadFailures.mockResolvedValueOnce({ ok: true, value: [diagnosticsFailure] })
    useLauncher.setState({ jobs: [makeJob({ status: 'running' })] })
    await runToRunningStep()

    act(() => {
      useLauncher.setState({
        jobs: [
          makeJob({
            status: 'failed',
            error: { key: 'downloads.error.installationNotPlayable' },
          }),
        ],
      })
    })

    await waitFor(() => expect(getDownloadFailures).toHaveBeenCalledTimes(1))

    const details = await waitFor(() => document.querySelector('details') as HTMLDetailsElement)
    expect(details).toBeTruthy()
    expect(details.hasAttribute('open')).toBe(false)
    details.open = true
    expect(
      screen.getByText(
        'demo-data: downloaded, verified and extracted, but did not contribute to the installation',
      ),
    ).toBeTruthy()

    // Further `jobs:changed` ticks while the job stays `failed` (a fresh `Job` object each time,
    // same id/status) must not refetch - the fetch is keyed on the job id, not on effect deps
    // alone re-running.
    act(() => {
      useLauncher.setState({
        jobs: [
          makeJob({
            status: 'failed',
            error: { key: 'downloads.error.installationNotPlayable' },
            progress: { ratio: 1, bytesDone: 2, bytesTotal: 2 },
          }),
        ],
      })
    })

    await waitFor(() =>
      expect(screen.getByTestId('bootstrap-running-step').dataset.status).toBe('failed'),
    )
    expect(getDownloadFailures).toHaveBeenCalledTimes(1)
  })

  it('a failed job with no matching failure entry keeps just the single error line', async () => {
    getDownloadFailures.mockResolvedValueOnce({ ok: true, value: [] })
    useLauncher.setState({ jobs: [makeJob({ status: 'running' })] })
    await runToRunningStep()

    act(() => {
      useLauncher.setState({
        jobs: [
          makeJob({
            status: 'failed',
            error: { key: 'downloads.error.installationNotPlayable' },
          }),
        ],
      })
    })

    await waitFor(() => expect(getDownloadFailures).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByText('The files were downloaded, but the result was not a usable Quake II installation.'),
      ).toBeTruthy(),
    )
    expect(document.querySelector('details')).toBeNull()
  })
})
