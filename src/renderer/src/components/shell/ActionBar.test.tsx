// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Installation, Job } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { initI18n } from '../../i18n'
import { useLauncher } from '../../store/useLauncher'
import { ActionBar } from './ActionBar'

/**
 * Story 091 D3 (AC2, AC5's renderer half). Mirrors `DownloadsView.test.tsx`'s conventions: the
 * real Zustand store is seeded directly via `useLauncher.setState`, and `window.q2` is stubbed at
 * module scope (via `vi.hoisted`) since `lib/bridge.ts` resolves it eagerly.
 */

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

function makeInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst-1',
    name: 'Test Install',
    rootPath: 'C:\\Games\\Q2',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    moduleId: 'downloads',
    kind: 'download-game',
    labelKey: 'downloads.job.download',
    labelParams: { name: 'Base game' },
    installationId: 'inst-1',
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
  useLauncher.setState({
    jobs: [],
    installations: [],
    settings: { ...DEFAULT_SETTINGS },
  })
})

describe('ActionBar', () => {
  it('JobReadout renders a waiting job reason, not the generic download readout', async () => {
    useLauncher.setState({
      installations: [makeInstallation()],
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
      jobs: [
        makeJob({
          status: 'waiting',
          progress: { ratio: null },
          waitingReason: { key: 'jobs.waiting.gameRunning' },
        }),
      ],
    })

    render(createElement(ActionBar))

    expect(await screen.findByText('Waiting for the game to close')).toBeTruthy()
    expect(screen.queryByText(/Downloading/)).toBeNull()
  })

  it('resolvePrimaryAction disables Play with a reason while a job holds the write lock on this installation', async () => {
    useLauncher.setState({
      installations: [makeInstallation()],
      settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
      jobs: [makeJob({ status: 'running', writeLock: true })],
    })

    render(createElement(ActionBar))

    const playButton = await screen.findByTestId('actionbar-play')
    expect(playButton.hasAttribute('disabled')).toBe(true)
    expect(playButton.getAttribute('data-action')).toBe('busy')
    expect(playButton.textContent).toContain('Writing')
  })
})
