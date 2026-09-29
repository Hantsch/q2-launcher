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
}))

let ConsoleCommandField: typeof import('./ConsoleCommandField').ConsoleCommandField
let usePlaybackStore: typeof import('../playback-store').usePlaybackStore

beforeAll(async () => {
  await initI18n('en')
  ;({ ConsoleCommandField } = await import('./ConsoleCommandField'))
  ;({ usePlaybackStore } = await import('../playback-store'))
})

beforeEach(() => {
  consoleSend.mockResolvedValue({ ok: true, value: undefined })
})

afterEach(() => {
  cleanup()
  usePlaybackStore.getState().endSession()
  consoleSend.mockReset()
})

function begin(): void {
  act(() => usePlaybackStore.getState().beginSession('a.dm2', 60_000))
}

const input = (): HTMLInputElement => screen.getByTestId('replays-console-input') as HTMLInputElement
const send = (): HTMLButtonElement => screen.getByTestId('replays-console-send') as HTMLButtonElement

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

  it('without a session the field is disabled with a visible reason', () => {
    render(createElement(ConsoleCommandField))
    expect(input().disabled).toBe(true)
    expect(send().disabled).toBe(true)
    expect(screen.getByTestId('replays-console-reason').textContent).toContain('no demo is playing')
    expect(consoleSend).not.toHaveBeenCalled()
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
})
