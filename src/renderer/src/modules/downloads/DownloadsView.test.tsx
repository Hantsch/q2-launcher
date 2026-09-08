// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ArchiveCacheStatus } from '@shared/modules/downloads'
import type { Job } from '@shared/types'
import { initI18n } from '../../i18n'
import { formatBytes, formatSpeed } from '../../lib/format'
import { useLauncher } from '../../store/useLauncher'
import { DownloadsView } from './DownloadsView'

/**
 * Story 073 D3. Mirrors `DownloadsSettingsSection.test.tsx`'s conventions: the client module is
 * stubbed via `vi.mock('./client', ...)` so the cache-status figure is controlled exactly, and
 * the real Zustand store (`useLauncher.setState`) seeds the `jobs` slice directly - the same
 * pattern `SetInstallationIconDialog.test.tsx` uses - since `DownloadsView` reads jobs from the
 * store's mirror, not a dedicated IPC call (Decisions (Sprint)).
 */

// `useLauncher`'s `cancelJob` action calls `lib/bridge.ts`'s `invoke`, which resolves `window.q2`
// at *module* scope (mirrors `SetInstallationIconDialog.test.tsx`) - stubbed via `vi.hoisted` so
// it exists before `../../store/useLauncher` is imported below; the actual cancel path in these
// tests goes through the mocked store action instead.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

const stubCacheStatus: ArchiveCacheStatus = { totalBytes: 3 * 1024 * 1024, itemCount: 4 }

const getArchiveCacheStatus = vi.fn(async () => ({ ok: true, value: stubCacheStatus }))
const getDownloadFailures = vi.fn(async () => ({ ok: true, value: [] }))

vi.mock('./client', () => ({
  getArchiveCacheStatus: (...args: unknown[]) => getArchiveCacheStatus(...(args as [])),
  getDownloadFailures: (...args: unknown[]) => getDownloadFailures(...(args as [])),
  dismissDownloadFailure: vi.fn(async () => ({ ok: true, value: [] })),
  restoreDownloadFailure: vi.fn(async () => ({ ok: true, value: [] })),
}))

const { cancelJobMock } = vi.hoisted(() => ({ cancelJobMock: vi.fn(async () => {}) }))

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    moduleId: 'downloads',
    kind: 'download-game',
    labelKey: 'downloads.job.download',
    labelParams: { name: 'Base game' },
    status: 'running',
    progress: { ratio: 0.42, bytesDone: 420_000, bytesTotal: 1_000_000, bytesPerSecond: 50_000 },
    cancellable: true,
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  useLauncher.setState({ jobs: [] })
})

describe('DownloadsView', () => {
  it('AC1: a running job renders its label, progress bar, bytes, speed and ETA', async () => {
    useLauncher.setState({
      jobs: [makeJob({ progress: { ...makeJob().progress, etaSeconds: 30 } })],
    })

    render(createElement(DownloadsView))

    const row = await screen.findByTestId('downloads-job-job-1')
    expect(row.textContent).toContain('Base game')
    expect(row.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(row.textContent).toContain(formatBytes(420_000))
    expect(row.textContent).toContain(formatBytes(1_000_000))
    expect(row.textContent).toContain(formatSpeed(50_000))
    expect(row.textContent).toContain('30s')
  })

  it('a queued job renders without progress figures', async () => {
    useLauncher.setState({
      jobs: [
        makeJob({
          id: 'job-2',
          status: 'queued',
          progress: { ratio: null },
          cancellable: false,
        }),
      ],
    })

    render(createElement(DownloadsView))

    const row = await screen.findByTestId('downloads-job-job-2')
    expect(row.querySelector('[role="progressbar"]')).toBeNull()
    expect(row.textContent).not.toContain('KB/s')
  })

  it('a cancellable job offers cancel, wired to the store action', async () => {
    useLauncher.setState({ jobs: [makeJob({ cancellable: true })], cancelJob: cancelJobMock })

    render(createElement(DownloadsView))

    const cancelButton = await screen.findByTestId('downloads-job-cancel-job-1')
    fireEvent.click(cancelButton)

    await waitFor(() => expect(cancelJobMock).toHaveBeenCalledWith('job-1'))
  })

  it('a succeeded job eventually leaves the list', async () => {
    vi.useFakeTimers()
    useLauncher.setState({ jobs: [makeJob({ id: 'job-3', status: 'succeeded' })] })

    render(createElement(DownloadsView))

    expect(screen.getByTestId('downloads-job-job-3')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(2100)

    expect(screen.queryByTestId('downloads-job-job-3')).toBeNull()
  })

  it('a succeeded job still fades out on schedule even if other jobs change while it fades', async () => {
    vi.useFakeTimers()
    useLauncher.setState({
      jobs: [
        makeJob({ id: 'job-3', status: 'succeeded' }),
        makeJob({ id: 'job-4', status: 'running' }),
      ],
    })

    render(createElement(DownloadsView))

    expect(screen.getByTestId('downloads-job-job-3')).toBeTruthy()

    // Another job's `jobs` store slice change lands while job-3 is still fading - this used to
    // clear job-3's in-flight fade timer without rescheduling it, leaving it stuck forever.
    await vi.advanceTimersByTimeAsync(500)
    useLauncher.setState({
      jobs: [
        makeJob({ id: 'job-3', status: 'succeeded' }),
        makeJob({
          id: 'job-4',
          status: 'running',
          progress: { ratio: 0.9, bytesDone: 900_000, bytesTotal: 1_000_000, bytesPerSecond: 60_000 },
        }),
      ],
    })

    await vi.advanceTimersByTimeAsync(500)
    useLauncher.setState({
      jobs: [
        makeJob({ id: 'job-3', status: 'succeeded' }),
        makeJob({ id: 'job-4', status: 'succeeded' }),
      ],
    })

    await vi.advanceTimersByTimeAsync(1200)

    expect(screen.queryByTestId('downloads-job-job-3')).toBeNull()
  })

  it('AC3: the cache size renders as a KeyValue', async () => {
    useLauncher.setState({ jobs: [] })

    render(createElement(DownloadsView))

    await waitFor(() => expect(getArchiveCacheStatus).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByText(formatBytes(stubCacheStatus.totalBytes), { exact: false })).toBeTruthy(),
    )
  })

  it('zero jobs renders EmptyState', async () => {
    useLauncher.setState({ jobs: [] })

    render(createElement(DownloadsView))

    expect(await screen.findByText('Nothing downloading')).toBeTruthy()
  })
})
