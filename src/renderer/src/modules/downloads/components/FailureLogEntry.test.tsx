// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DownloadDiagnostics, DownloadFailure } from '@shared/modules/downloads'
import type { AppInfo } from '@shared/types/common'
import { i18next, initI18n } from '../../../i18n'
import { useLauncher } from '../../../store/useLauncher'
import { FailureLogEntry } from './FailureLogEntry'

/**
 * Story 075 D6. Covers the failure card's two diagnostic actions: copy (only rendered when
 * `diagnostics` is present - AC6's pre-story-entry compatibility path) and reveal-log (always
 * rendered, gated on `appInfo` having loaded - AC5, mirroring `SettingsView.tsx`'s existing
 * reveal-log-path pattern). AC7: no diagnostics string is ever rendered as card text.
 */

const invokeMock = vi.fn(async (..._args: [string, ...unknown[]]) => ({ ok: true }))

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(),
    on: vi.fn(() => () => {}),
  }
})

vi.mock('../../../lib/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, ...unknown[]])),
}))

const appInfo: AppInfo = {
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

const diagnostics: DownloadDiagnostics = {
  jobId: 'job-1',
  kind: 'bootstrap',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  errorKey: 'downloads.error.notPlayable',
  packages: [
    {
      id: 'demo-data',
      url: 'https://mirror.test/very-secret-log-line-marker.zip',
      sizeBytes: 12_000_000,
      verified: true,
      extracted: false,
    },
  ],
  target: {
    targetPath: 'D:\\Games\\Quake II',
    verdict: 'invalid',
    missingChecks: [{ id: 'base-paks', messageKey: 'validation.pak0Missing' }],
  },
  logTail: ['a raw developer log line that must never render as card text'],
}

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

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useLauncher.setState({ toasts: [] })
})

function renderEntry(failure: DownloadFailure, info: AppInfo | null = appInfo) {
  return render(
    createElement(FailureLogEntry, {
      failure,
      dismissed: false,
      onDismiss: vi.fn(),
      onRestore: vi.fn(),
      appInfo: info,
    }),
  )
}

describe('FailureLogEntry diagnostic actions', () => {
  it('an entry with diagnostics shows both the copy and reveal actions', () => {
    renderEntry(makeFailure({ diagnostics }))

    expect(screen.getByTestId('downloads-failure-copy-failure-1')).toBeTruthy()
    expect(screen.getByTestId('downloads-failure-reveal-failure-1')).toBeTruthy()
  })

  it('an entry without diagnostics shows no copy action and no disabled stub', () => {
    renderEntry(makeFailure())

    expect(screen.queryByTestId('downloads-failure-copy-failure-1')).toBeNull()
    expect(screen.getByTestId('downloads-failure-reveal-failure-1')).toBeTruthy()
  })

  it('the reveal action invokes app:revealPath with the launcher\'s log path', () => {
    renderEntry(makeFailure({ diagnostics }))

    fireEvent.click(screen.getByTestId('downloads-failure-reveal-failure-1'))

    expect(invokeMock).toHaveBeenCalledWith('app:revealPath', appInfo.logPath)
  })

  it('the reveal action is disabled until AppInfo has loaded', () => {
    renderEntry(makeFailure({ diagnostics }), null)

    const reveal = screen.getByTestId('downloads-failure-reveal-failure-1') as HTMLButtonElement
    expect(reveal.disabled).toBe(true)

    fireEvent.click(reveal)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('copy invokes app:copyText with exactly buildFailureReport\'s output and confirms visibly', async () => {
    renderEntry(makeFailure({ diagnostics }))

    fireEvent.click(screen.getByTestId('downloads-failure-copy-failure-1'))

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('app:copyText', expect.any(String)))
    const [, report] = invokeMock.mock.calls[0] as [string, string]
    expect(report).toContain('## Packages')
    expect(report).toContain('demo-data')
    expect(report).toContain('## Verdict')

    await waitFor(() => {
      expect(useLauncher.getState().toasts.some((toast) => toast.level === 'success')).toBe(true)
    })
  })

  it('a failed copy surfaces an error toast rather than nothing at all', async () => {
    // `app:copyText` can reject the report (the schema caps its length), and a user who gets no
    // feedback pastes whatever was on the clipboard before into a public issue.
    invokeMock.mockResolvedValueOnce({
      ok: false,
      error: { key: 'ipc.error.invalidPayload' },
    } as unknown as { ok: true })
    renderEntry(makeFailure({ diagnostics }))

    fireEvent.click(screen.getByTestId('downloads-failure-copy-failure-1'))

    await waitFor(() => {
      const toasts = useLauncher.getState().toasts
      expect(toasts.some((toast) => toast.level === 'error')).toBe(true)
    })
    const errorToast = useLauncher.getState().toasts.find((toast) => toast.level === 'error')!
    expect(errorToast.messageKey).toBe('downloads.failures.copyReportError')
    // The key must be real copy, not a raw key leaking into the UI.
    expect(i18next.t(errorToast.messageKey)).not.toBe(errorToast.messageKey)
    expect(useLauncher.getState().toasts.some((toast) => toast.level === 'success')).toBe(false)
  })

  it('no diagnostics value is rendered as card text', () => {
    renderEntry(makeFailure({ diagnostics }))

    const card = screen.getByTestId('downloads-failure-failure-1')
    expect(card.textContent).not.toContain('very-secret-log-line-marker')
    expect(card.textContent).not.toContain('a raw developer log line that must never render as card text')
    expect(card.textContent).not.toContain('D:\\Games\\Quake II')
  })
})
