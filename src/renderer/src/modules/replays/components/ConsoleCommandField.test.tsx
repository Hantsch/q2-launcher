// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'

/** Story 166 D4. Stubbed client, real store - same idiom as `DemoTimeline.test.tsx`. */
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const consoleSend = vi.fn()
vi.mock('../client', () => ({
  consoleSend: (...args: unknown[]) => consoleSend(...args),
  playbackTimeline: vi.fn(),
  onPlaybackPosition: () => () => {},
  onPlaybackState: () => () => {},
  onPlaybackDisplay: () => () => {},
  playbackDisplayRead: () => new Promise(() => {}),
}))

let ConsoleCommandField: typeof import('./ConsoleCommandField').ConsoleCommandField
let usePlaybackStore: typeof import('../playback-store').usePlaybackStore
let useLauncher: typeof import('../../../store/useLauncher').useLauncher

beforeAll(async () => {
  await initI18n('en')
  ;({ ConsoleCommandField } = await import('./ConsoleCommandField'))
  ;({ usePlaybackStore } = await import('../playback-store'))
  ;({ useLauncher } = await import('../../../store/useLauncher'))
})

beforeEach(() => {
  consoleSend.mockResolvedValue({ ok: true, value: undefined })
})

afterEach(() => {
  cleanup()
  useLauncher.setState({ appInfo: null })
  usePlaybackStore.getState().endSession()
  consoleSend.mockReset()
})

function begin(): void {
  act(() => usePlaybackStore.getState().beginSession('a.dm2', 60_000))
}

const input = (): HTMLInputElement =>
  screen.getByTestId('replays-console-input') as HTMLInputElement
const send = (): HTMLButtonElement =>
  screen.getByTestId('replays-console-send') as HTMLButtonElement

describe('ConsoleCommandField (story 166 D4)', () => {
  it('a rejected line is not sent and shows its reason', () => {
    begin()
    render(createElement(ConsoleCommandField))
    fireEvent.change(input(), { target: { value: 'say héllo' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(consoleSend).not.toHaveBeenCalled()
    const reason = screen.getByTestId('replays-console-reason')
    expect(reason.textContent).toBe('Only plain ASCII characters are allowed.')
    expect(input().getAttribute('aria-describedby')).toBe(reason.id)
    expect(input().value).toBe('say héllo')
  })

  it('Enter sends a valid line and clears the field', async () => {
    begin()
    render(createElement(ConsoleCommandField))
    expect(send().disabled).toBe(true)
    expect(screen.queryByTestId('replays-console-reason')).toBeNull()
    fireEvent.change(input(), { target: { value: 'fov 110' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(consoleSend).toHaveBeenCalledWith('fov 110')
    await waitFor(() => expect(input().value).toBe(''))
  })

  it('without a session the field is hidden and names no reason', () => {
    const { container } = render(createElement(ConsoleCommandField))
    const section = screen.getByTestId('replays-console-field')
    expect(section.getAttribute('aria-hidden')).toBe('true')
    expect(section.hasAttribute('inert')).toBe(true)
    expect(container.textContent).not.toContain('no demo is playing')
    expect(consoleSend).not.toHaveBeenCalled()
  })

  it('a finished demo hides the field', () => {
    begin()
    render(createElement(ConsoleCommandField))
    act(() => usePlaybackStore.getState().applyState('finished'))
    expect(screen.getByTestId('replays-console-field').getAttribute('aria-hidden')).toBe('true')
  })

  it('the field hides again when the session ends', () => {
    begin()
    render(createElement(ConsoleCommandField))
    expect(screen.getByTestId('replays-console-field').getAttribute('aria-hidden')).toBeNull()
    act(() => usePlaybackStore.getState().applyState('ended'))
    expect(screen.getByTestId('replays-console-field').getAttribute('aria-hidden')).toBe('true')
  })

  it('a main failure keeps the text and shows the reason', async () => {
    begin()
    consoleSend.mockResolvedValue({ ok: false, error: { key: 'replays.console.error.noSession' } })
    render(createElement(ConsoleCommandField))
    fireEvent.change(input(), { target: { value: 'fov 110' } })
    fireEvent.click(send())
    await waitFor(() => expect(screen.getByTestId('replays-console-reason')).toBeTruthy())
    expect(input().value).toBe('fov 110')
  })

  describe('stage input hint (story 173 D4)', () => {
    const hint = (): HTMLElement | null => screen.queryByTestId('replays-console-stage-hint')
    const platform = (p: string): void =>
      useLauncher.setState({ appInfo: { platform: p } as never })

    it('on Windows the stage hint names the alternatives', () => {
      platform('win32')
      begin()
      render(createElement(ConsoleCommandField))
      const text = hint()?.textContent ?? ''
      expect(text).toContain('console field')
      expect(text).toContain('fullscreen')
      expect(text).toContain('Alt+F4')
    })

    it('on Linux the stage hint is not shown', () => {
      platform('linux')
      begin()
      render(createElement(ConsoleCommandField))
      expect(hint()).toBeNull()
    })

    it('the hint is gone once the demo finished or in fullscreen', () => {
      platform('win32')
      begin()
      render(createElement(ConsoleCommandField))
      expect(hint()).not.toBeNull()
      act(() => usePlaybackStore.getState().applyDisplay({ fullscreen: true }))
      expect(hint()).toBeNull()
      act(() => usePlaybackStore.getState().applyDisplay({ fullscreen: false }))
      expect(hint()).not.toBeNull()
      act(() => usePlaybackStore.getState().applyState('finished'))
      expect(hint()).toBeNull()
    })
  })
})
