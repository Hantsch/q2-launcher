// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
import { initI18n } from '../../../i18n'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})
const readPlaybackMode = vi.fn()
const setPlaybackMode = vi.fn()
vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    readPlaybackMode: (...args: unknown[]) => readPlaybackMode(...args),
    setPlaybackMode: (...args: unknown[]) => setPlaybackMode(...args),
    onPlaybackPosition: () => () => {},
    onPlaybackState: () => () => {},
    onPlaybackDisplay: () => () => {},
    playbackDisplayRead: () => new Promise(() => {}),
  }),
)

import { usePlaybackModeStore } from '../playback-mode-store'
import { usePlaybackStore } from '../playback-store'
import { PlaybackModeSwitch } from './PlaybackModeSwitch'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  usePlaybackStore.getState().endSession()
})

beforeEach(() => {
  readPlaybackMode.mockReset()
  setPlaybackMode.mockReset()
  usePlaybackModeStore.setState({ mode: 'engine', loaded: false, busy: false, error: null })
  usePlaybackStore.setState({ session: null })
})

describe('PlaybackModeSwitch', () => {
  it('shows the stored mode pressed and stores the other one on click', async () => {
    readPlaybackMode.mockResolvedValue({ ok: true, value: 'integrated' })
    setPlaybackMode.mockResolvedValue({ ok: true, value: 'engine' })
    render(<PlaybackModeSwitch testIdPrefix="mode" />)
    await waitFor(() =>
      expect(screen.getByTestId('mode-integrated').getAttribute('aria-pressed')).toBe('true'),
    )
    expect(screen.getByTestId('mode-engine').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByTestId('mode-engine'))
    expect(setPlaybackMode).toHaveBeenCalledWith('engine')
    await waitFor(() =>
      expect(screen.getByTestId('mode-engine').getAttribute('aria-pressed')).toBe('true'),
    )
  })

  it('is disabled with visible text while a demo plays', async () => {
    readPlaybackMode.mockResolvedValue({ ok: true, value: 'engine' })
    render(<PlaybackModeSwitch testIdPrefix="mode" />)
    act(() => usePlaybackStore.getState().beginSession('a.dm2', 60_000))
    expect((screen.getByTestId('mode-engine') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('mode-integrated') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('mode-locked').textContent).toBe('Stop the demo to switch')
  })
})
