// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
import { initI18n } from '../../../i18n'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const playbackTimeline = vi.fn()
const playbackCinema = vi.fn()
vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    playbackTimeline: (...args: unknown[]) => playbackTimeline(...args),
    playbackStop: vi.fn(),
    playbackCinema: (...args: unknown[]) => playbackCinema(...args),
    playbackDisplayRead: () => new Promise(() => {}),
    onPlaybackPosition: () => () => {},
    onPlaybackState: () => () => {},
    onPlaybackDisplay: () => () => {},
  }),
)

let CinemaOverlay: typeof import('./CinemaOverlay').CinemaOverlay
let usePlaybackStore: typeof import('../playback-store').usePlaybackStore

beforeAll(async () => {
  await initI18n('en')
  ;({ CinemaOverlay } = await import('./CinemaOverlay'))
  ;({ usePlaybackStore } = await import('../playback-store'))
})

beforeEach(() => {
  playbackTimeline.mockResolvedValue({ ok: true, value: { ok: true, value: undefined } })
  playbackCinema.mockResolvedValue({ ok: true, value: undefined })
  act(() => {
    usePlaybackStore.getState().beginSession('a.dm2', 100_000)
    usePlaybackStore.getState().applyPosition(10_000, null, false)
  })
})

afterEach(() => {
  cleanup()
  usePlaybackStore.getState().endSession()
  playbackTimeline.mockReset()
  playbackCinema.mockReset()
  vi.useRealTimers()
})

const sent = (): unknown[] => playbackTimeline.mock.calls.map((c) => c[0])

describe('CinemaOverlay (story 187 D7)', () => {
  it('each control sends its timeline action', () => {
    render(createElement(CinemaOverlay))
    fireEvent.click(screen.getByTestId('cinema-fullscreen'))
    fireEvent.click(screen.getByTestId('cinema-toggle'))
    fireEvent.click(screen.getByTestId('cinema-back'))
    fireEvent.click(screen.getByTestId('cinema-forward'))
    fireEvent.click(screen.getByTestId('cinema-back60'))
    fireEvent.click(screen.getByTestId('cinema-forward60'))
    fireEvent.change(screen.getByTestId('cinema-speed'), { target: { value: '2' } })
    const seek = screen.getByTestId('cinema-seek')
    seek.getBoundingClientRect = () => ({
      left: 0,
      width: 200,
      top: 0,
      height: 20,
      right: 200,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.click(seek, { clientX: 100 })
    expect(sent()).toEqual([
      { kind: 'fullscreen' },
      { kind: 'togglePause' },
      { kind: 'jump', deltaS: -10 },
      { kind: 'jump', deltaS: 10 },
      { kind: 'jump', deltaS: -60 },
      { kind: 'jump', deltaS: 60 },
      { kind: 'speed', value: 2 },
      { kind: 'seekTo', seconds: 50 },
    ])
    fireEvent.click(screen.getByTestId('cinema-leave'))
    expect(playbackCinema).toHaveBeenCalledWith(false)
  })

  it('keys go through the cinema key map and any key shows the controls', () => {
    render(createElement(CinemaOverlay))
    const root = screen.getByTestId('cinema-root')
    fireEvent.keyDown(root, { key: ' ', code: 'Space' })
    fireEvent.keyDown(root, { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(root, { key: 'q', code: 'KeyQ' })
    expect(sent()).toEqual([{ kind: 'togglePause' }, { kind: 'jump', deltaS: 60 }])
    fireEvent.keyDown(root, { key: 'Escape', code: 'Escape' })
    expect(playbackCinema).toHaveBeenCalledWith(false)
  })

  it('a click on the picture only shows the controls', () => {
    vi.useFakeTimers()
    render(createElement(CinemaOverlay))
    const root = screen.getByTestId('cinema-root')
    act(() => void vi.advanceTimersByTime(3500))
    expect(root.getAttribute('data-controls')).toBe('hidden')
    fireEvent.click(root)
    expect(root.getAttribute('data-controls')).toBe('visible')
    act(() => void vi.advanceTimersByTime(3500))
    expect(root.getAttribute('data-controls')).toBe('hidden')
    fireEvent.doubleClick(root)
    expect(root.getAttribute('data-controls')).toBe('visible')
    expect(playbackTimeline).not.toHaveBeenCalled()
    expect(playbackCinema).not.toHaveBeenCalled()
  })
})
