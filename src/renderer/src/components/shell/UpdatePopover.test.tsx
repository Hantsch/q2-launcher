// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import { initI18n } from '../../i18n'

/**
 * Story 098 D3: one primary action per phase (Decisions) - `available` -> "Download",
 * `downloading` -> progress + "Cancel", `downloaded` -> "Restart and install", `error` -> the
 * check-failure reason, and a `downloaded` restart refused by main's guard (AC6) -> the refusal
 * reason instead of a second action. Plus AC5: dismissing removes only the attention marker, the
 * control stays in the DOM.
 *
 * Same stubbing convention as `useLauncher.update.test.ts`: `window.q2` is resolved at *module*
 * scope by `lib/bridge.ts`, so the bridge stub must exist before the store (and anything that
 * imports it) is imported.
 */

const IDLE_UPDATE_STATE: UpdateState = {
  status: 'idle',
  phase: 'idle',
  update: null,
  error: null,
  progress: null,
  dismissed: false,
  lastCheckedAt: null,
  lastSuccessAt: null,
  supported: true,
}

const AVAILABLE_STATE: UpdateState = {
  ...IDLE_UPDATE_STATE,
  status: 'available',
  phase: 'available',
  update: { version: '1.2.3', notes: '', releasedAt: null },
}

const AVAILABLE_WITH_ERROR_STATE: UpdateState = {
  ...AVAILABLE_STATE,
  error: { key: 'appUpdate.error.offline' },
}

const DOWNLOADING_STATE: UpdateState = {
  ...AVAILABLE_STATE,
  phase: 'downloading',
  progress: { ratio: 0.42, bytesDone: 420_000, bytesTotal: 1_000_000, bytesPerSecond: 50_000 },
}

const DOWNLOADED_STATE: UpdateState = {
  ...AVAILABLE_STATE,
  phase: 'downloaded',
}

const CHECK_ERROR_STATE: UpdateState = {
  ...IDLE_UPDATE_STATE,
  status: 'error',
  phase: 'error',
  update: null,
  error: { key: 'update.error.network' },
}

const bridge = vi.hoisted(() => {
  const responses = new Map<string, unknown>()
  const invoke = vi.fn((channel: string) => Promise.resolve(responses.get(channel)))
  const on = vi.fn(() => () => {})
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on }
  return { responses, invoke }
})

const { useLauncher } = await import('../../store/useLauncher')
const { UpdateButton } = await import('./UpdateButton')
const { UpdatePopover } = await import('./UpdatePopover')

const PRIMARY_ACTION_TESTIDS = [
  'update-popover-download',
  'update-popover-cancel',
  'update-popover-restart',
] as const

function renderedPrimaryActions(): string[] {
  return PRIMARY_ACTION_TESTIDS.filter((testId) => screen.queryByTestId(testId) !== null)
}

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  bridge.invoke.mockClear()
  bridge.responses.clear()
  useLauncher.setState({ update: IDLE_UPDATE_STATE })
})

describe('UpdatePopover phases', () => {
  it('available: exactly one primary action, "Download"', () => {
    useLauncher.setState({ update: AVAILABLE_STATE })
    render(<UpdatePopover onClose={() => {}} />)

    expect(renderedPrimaryActions()).toEqual(['update-popover-download'])
    expect(screen.queryByTestId('update-popover-download-error')).toBeNull()
  })

  it('available with a carried-over download error still offers "Download" (AC7)', () => {
    useLauncher.setState({ update: AVAILABLE_WITH_ERROR_STATE })
    render(<UpdatePopover onClose={() => {}} />)

    expect(renderedPrimaryActions()).toEqual(['update-popover-download'])
    expect(screen.getByTestId('update-popover-download-error').textContent).toBe(
      'Could not download the update. Check your internet connection.',
    )
  })

  it('downloading: progress plus exactly one primary action, "Cancel"', () => {
    useLauncher.setState({ update: DOWNLOADING_STATE })
    render(<UpdatePopover onClose={() => {}} />)

    expect(renderedPrimaryActions()).toEqual(['update-popover-cancel'])
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('downloaded: exactly one primary action, "Restart and install"', () => {
    useLauncher.setState({ update: DOWNLOADED_STATE })
    render(<UpdatePopover onClose={() => {}} />)

    expect(renderedPrimaryActions()).toEqual(['update-popover-restart'])
  })

  it('error: no primary action, only the check-failure reason', () => {
    useLauncher.setState({ update: CHECK_ERROR_STATE })
    render(<UpdatePopover onClose={() => {}} />)

    expect(renderedPrimaryActions()).toEqual([])
    expect(screen.getByTestId('update-popover-check-error').textContent).toBe(
      'Could not reach the update server. Check your internet connection.',
    )
  })

  it('refused: a restart refused by main shows the reason, not a second action (AC6)', async () => {
    useLauncher.setState({ update: DOWNLOADED_STATE })
    bridge.responses.set('update:installAndRestart', {
      ok: false,
      error: { key: 'appUpdate.error.gameRunning' },
    })
    render(<UpdatePopover onClose={() => {}} />)

    fireEvent.click(screen.getByTestId('update-popover-restart'))

    const refusal = await screen.findByTestId('update-popover-refusal')
    expect(refusal.textContent).toBe(
      'Quake II is still running. Close it before installing the update.',
    )
    expect(renderedPrimaryActions()).toEqual([])
  })
})

describe('"what changed" scrolls Settings -> About into view', () => {
  it('scrolls the settings-about anchor into view once Settings has mounted', async () => {
    useLauncher.setState({ update: AVAILABLE_STATE })
    // Stands in for SettingsView's real `settings-about` panel (099's anchor) - this test only
    // covers UpdatePopover's own scroll-after-navigate behaviour, not SettingsView's layout.
    const anchor = document.createElement('div')
    anchor.setAttribute('data-testid', 'settings-about')
    const scrollIntoView = vi.fn()
    anchor.scrollIntoView = scrollIntoView
    document.body.appendChild(anchor)

    const onClose = vi.fn()
    render(<UpdatePopover onClose={onClose} />)
    fireEvent.click(screen.getByTestId('update-popover-whatchanged'))

    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }))

    anchor.remove()
  })
})

describe('dismissing keeps the control', () => {
  it('removes the attention marker but leaves the button in the DOM (AC5)', async () => {
    useLauncher.setState({ update: AVAILABLE_STATE })
    bridge.responses.set('update:dismiss', { ok: true, value: { ...AVAILABLE_STATE, dismissed: true } })
    render(<UpdateButton />)

    expect(screen.getByTestId('nav-update')).toBeTruthy()
    expect(screen.getByTestId('nav-update-attention')).toBeTruthy()

    fireEvent.click(screen.getByTestId('nav-update'))
    fireEvent.click(screen.getByTestId('update-popover-dismiss'))

    await waitFor(() => expect(screen.queryByTestId('nav-update-attention')).toBeNull())
    expect(screen.getByTestId('nav-update')).toBeTruthy()
  })
})
