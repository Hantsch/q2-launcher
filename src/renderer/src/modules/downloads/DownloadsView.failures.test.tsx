// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ArchiveCacheStatus, DownloadDiagnostics, DownloadFailure } from '@shared/modules/downloads'
import type { Job } from '@shared/types'
import type { AppInfo } from '@shared/types/common'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'
import { DownloadsView } from './DownloadsView'

/**
 * Story 073 D4 (AC2). Mirrors `DownloadsView.test.tsx`'s mocking setup: `./client` is stubbed so
 * the failure log's fetch/dismiss/restore calls are controlled exactly, and the real Zustand
 * store seeds `jobs` directly since that is what the view's refetch effect depends on.
 */

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

const stubCacheStatus: ArchiveCacheStatus = { totalBytes: 0, itemCount: 0 }
const getArchiveCacheStatus = vi.fn(async () => ({ ok: true, value: stubCacheStatus }))

function makeFailure(overrides: Partial<DownloadFailure> = {}): DownloadFailure {
  return {
    id: 'failure-1',
    jobId: 'job-1',
    labelKey: 'downloads.job.download',
    labelParams: { name: 'Base game' },
    error: { key: 'downloads.error.network' },
    createdAt: Date.now(),
    ...overrides,
  }
}

const stubAppInfo: AppInfo = {
  appVersion: '1.2.3',
  electronVersion: '30.0.0',
  chromeVersion: '124.0.0',
  nodeVersion: '20.10.0',
  platform: 'win32',
  userDataPath: 'C:\\ProgramData\\Q2 Launcher',
  logPath: 'C:\\ProgramData\\Q2 Launcher\\logs\\main.log',
  isDev: false,
  isPackaged: true,
  osVersion: '10.0.26200',
}

const stubDiagnostics: DownloadDiagnostics = {
  jobId: 'job-1',
  kind: 'bootstrap',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  errorKey: 'downloads.error.notPlayable',
  packages: [],
  logTail: [],
}

let currentFailures: DownloadFailure[] = []

const getDownloadFailures = vi.fn(async () => ({ ok: true, value: currentFailures }))
const dismissDownloadFailure = vi.fn(async (id: string) => {
  currentFailures = currentFailures.map((failure) =>
    failure.id === id ? { ...failure, dismissedAt: Date.now() } : failure,
  )
  return { ok: true, value: currentFailures }
})
const restoreDownloadFailure = vi.fn(async (id: string) => {
  currentFailures = currentFailures.map((failure) =>
    failure.id === id ? { ...failure, dismissedAt: undefined } : failure,
  )
  return { ok: true, value: currentFailures }
})

vi.mock('./client', () => ({
  getArchiveCacheStatus: (...args: unknown[]) => getArchiveCacheStatus(...(args as [])),
  getDownloadFailures: (...args: unknown[]) => getDownloadFailures(...(args as [])),
  dismissDownloadFailure: (...args: unknown[]) => dismissDownloadFailure(...(args as [string])),
  restoreDownloadFailure: (...args: unknown[]) => restoreDownloadFailure(...(args as [string])),
}))

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
  currentFailures = []
  useLauncher.setState({ jobs: [], appInfo: null })
})

describe('DownloadsView failure log', () => {
  it("a failed job's reason renders translated, not the raw error key", async () => {
    currentFailures = [makeFailure()]

    render(createElement(DownloadsView))

    const entry = await screen.findByTestId('downloads-failure-failure-1')
    expect(entry.textContent).toContain('Base game')
    expect(entry.textContent).toContain('A network error interrupted the download.')
    expect(entry.textContent).not.toContain('downloads.error.network')
  })

  it('falls back to the unknown-error copy for an unrecognised error key', async () => {
    currentFailures = [makeFailure({ error: { key: 'downloads.error.somethingNew' } })]

    render(createElement(DownloadsView))

    const entry = await screen.findByTestId('downloads-failure-failure-1')
    expect(entry.textContent).toContain('The download failed for an unknown reason.')
  })

  it('persists across a remount: the view always fetches from the client rather than relying on transient local state', async () => {
    currentFailures = [makeFailure()]

    const { unmount } = render(createElement(DownloadsView))
    await screen.findByTestId('downloads-failure-failure-1')
    unmount()

    expect(getDownloadFailures).toHaveBeenCalledTimes(1)

    render(createElement(DownloadsView))
    await screen.findByTestId('downloads-failure-failure-1')

    expect(getDownloadFailures).toHaveBeenCalledTimes(2)
  })

  it('dismiss moves an entry into the collapsed dismissed disclosure', async () => {
    currentFailures = [makeFailure()]

    render(createElement(DownloadsView))
    await screen.findByTestId('downloads-failure-failure-1')

    fireEvent.click(screen.getByTestId('downloads-failure-dismiss-failure-1'))

    await waitFor(() => expect(dismissDownloadFailure).toHaveBeenCalledWith('failure-1'))
    await waitFor(() =>
      expect(screen.getByTestId('downloads-failure-restore-failure-1')).toBeTruthy(),
    )
    expect(screen.getByText('Dismissed (1)')).toBeTruthy()
  })

  it('restore brings a dismissed entry back to the visible list', async () => {
    currentFailures = [makeFailure({ dismissedAt: Date.now() })]

    render(createElement(DownloadsView))
    await screen.findByTestId('downloads-failure-restore-failure-1')

    fireEvent.click(screen.getByTestId('downloads-failure-restore-failure-1'))

    await waitFor(() => expect(restoreDownloadFailure).toHaveBeenCalledWith('failure-1'))
    await waitFor(() =>
      expect(screen.getByTestId('downloads-failure-dismiss-failure-1')).toBeTruthy(),
    )
  })

  it('refetches the failure log when the jobs store slice changes', async () => {
    currentFailures = []

    render(createElement(DownloadsView))
    await waitFor(() => expect(getDownloadFailures).toHaveBeenCalledTimes(1))

    useLauncher.setState({ jobs: [makeJob({ status: 'failed' })] })

    await waitFor(() => expect(getDownloadFailures.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('passes the store\'s appInfo down so a diagnostics entry offers the reveal-log action in its expanded detail', async () => {
    // Story 078 D6: reveal-log moved out of the always-visible header cluster into the
    // `FailureCauseDetail` footer, reachable only after expanding.
    useLauncher.setState({ appInfo: stubAppInfo })
    currentFailures = [makeFailure({ diagnostics: stubDiagnostics })]

    render(createElement(DownloadsView))

    await screen.findByTestId('downloads-failure-failure-1')
    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details).toBeTruthy()
    details.open = true

    const reveal = screen.getByTestId('downloads-failure-reveal-failure-1') as HTMLButtonElement
    expect(reveal.disabled).toBe(false)
    expect(screen.getByTestId('downloads-failure-copy-failure-1')).toBeTruthy()
  })

  it('an entry without diagnostics renders with no copy action and no detail affordance', async () => {
    useLauncher.setState({ appInfo: stubAppInfo })
    currentFailures = [makeFailure()]

    render(createElement(DownloadsView))

    await screen.findByTestId('downloads-failure-failure-1')
    expect(screen.queryByTestId('downloads-failure-copy-failure-1')).toBeNull()
    expect(document.querySelector('details')).toBeNull()
    expect(screen.queryByTestId('downloads-failure-reveal-failure-1')).toBeNull()
  })

  it('the reveal-log action is disabled until appInfo has loaded', async () => {
    useLauncher.setState({ appInfo: null })
    currentFailures = [makeFailure({ diagnostics: stubDiagnostics })]

    render(createElement(DownloadsView))

    await screen.findByTestId('downloads-failure-failure-1')
    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true

    const reveal = screen.getByTestId('downloads-failure-reveal-failure-1') as HTMLButtonElement
    expect(reveal.disabled).toBe(true)
  })
})
