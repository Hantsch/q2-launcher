// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import { initI18n } from '../../i18n'

/**
 * Story 099 D5. Same stubbing convention as `AboutPanel.update.test.tsx`/`UpdatePopover.test.tsx`:
 * `window.q2` is resolved at *module* scope by `lib/bridge.ts`, so the bridge stub must exist before
 * the store (and anything importing it) is imported, and a real `useLauncher.setState` drives every
 * state this component reads.
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

const bridge = vi.hoisted(() => {
  const responses = new Map<string, unknown>()
  const invoke = vi.fn((channel: string) => Promise.resolve(responses.get(channel)))
  const on = vi.fn(() => () => {})
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke, on }
  return { responses, invoke }
})

const { useLauncher } = await import('../../store/useLauncher')
const { UpdateCheckRow } = await import('./UpdateCheckRow')

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  bridge.invoke.mockClear()
  bridge.responses.clear()
  useLauncher.setState({ update: IDLE_UPDATE_STATE })
})

describe('UpdateCheckRow', () => {
  it('renders "never checked" when lastCheckedAt is null', () => {
    useLauncher.setState({ update: IDLE_UPDATE_STATE })
    render(createElement(UpdateCheckRow))

    expect(screen.getByTestId('about-update-last-checked').textContent).toBe(
      'Never checked for updates',
    )
  })

  it('renders a relative-time string when lastCheckedAt is a real timestamp', () => {
    useLauncher.setState({
      update: { ...IDLE_UPDATE_STATE, lastCheckedAt: new Date(Date.now() - 5 * 60_000).toISOString() },
    })
    render(createElement(UpdateCheckRow))

    const text = screen.getByTestId('about-update-last-checked').textContent ?? ''
    expect(text).not.toBe('Never checked for updates')
    expect(text).toMatch(/ago|minute/)
  })

  it('renders the failure reason under about-update-outcome when the last check errored', () => {
    useLauncher.setState({
      update: {
        ...IDLE_UPDATE_STATE,
        status: 'error',
        phase: 'error',
        error: { key: 'update.error.network' },
      },
    })
    render(createElement(UpdateCheckRow))

    expect(screen.getByTestId('about-update-outcome').textContent).toBe(
      'Could not reach the update server. Check your internet connection.',
    )
  })

  it('renders the found version under about-update-outcome when a release is available', () => {
    useLauncher.setState({
      update: {
        ...IDLE_UPDATE_STATE,
        status: 'available',
        phase: 'available',
        update: { version: '1.2.3', notes: '', releasedAt: null },
      },
    })
    render(createElement(UpdateCheckRow))

    expect(screen.getByTestId('about-update-outcome').textContent).toBe('Version 1.2.3 found.')
  })

  it('renders nothing under about-update-outcome when idle or checking', () => {
    useLauncher.setState({ update: IDLE_UPDATE_STATE })
    render(createElement(UpdateCheckRow))
    expect(screen.queryByTestId('about-update-outcome')).toBeNull()

    cleanup()
    useLauncher.setState({ update: { ...IDLE_UPDATE_STATE, status: 'checking' } })
    render(createElement(UpdateCheckRow))
    expect(screen.queryByTestId('about-update-outcome')).toBeNull()
  })

  it('disables the check-now button while a check is in flight', async () => {
    let resolveCheck: (() => void) | undefined
    bridge.invoke.mockImplementation((channel: string) => {
      if (channel === 'update:check') {
        return new Promise((resolve) => {
          resolveCheck = () => resolve(IDLE_UPDATE_STATE)
        })
      }
      return Promise.resolve(bridge.responses.get(channel))
    })

    render(createElement(UpdateCheckRow))
    const button = screen.getByTestId('about-update-check-now') as HTMLButtonElement
    expect(button.disabled).toBe(false)

    fireEvent.click(button)
    expect(button.disabled).toBe(true)

    resolveCheck?.()
    await waitFor(() => expect(button.disabled).toBe(false))
  })

  it('clicking check-now calls invoke("update:check") exactly once per click', async () => {
    bridge.responses.set('update:check', { ...IDLE_UPDATE_STATE, status: 'upToDate' })
    render(createElement(UpdateCheckRow))

    fireEvent.click(screen.getByTestId('about-update-check-now'))

    await waitFor(() =>
      expect(bridge.invoke.mock.calls.filter((call) => call[0] === 'update:check')).toHaveLength(1),
    )
  })
})
