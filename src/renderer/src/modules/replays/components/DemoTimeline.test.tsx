// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'

/** Story 165 D3. Stubbed client, real store - same idiom as `DemoPlayAction.test.tsx`. */
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const playbackTimeline = vi.fn()
vi.mock('../client', () => ({
  playbackTimeline: (...args: unknown[]) => playbackTimeline(...args),
  onPlaybackPosition: () => () => {},
  onPlaybackState: () => () => {},
}))

let DemoTimeline: typeof import('./DemoTimeline').DemoTimeline
let usePlaybackStore: typeof import('../playback-store').usePlaybackStore

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoTimeline } = await import('./DemoTimeline'))
  ;({ usePlaybackStore } = await import('../playback-store'))
})

beforeEach(() => {
  playbackTimeline.mockResolvedValue({ ok: true, value: { ok: true, value: undefined } })
})

afterEach(() => {
  cleanup()
  usePlaybackStore.getState().endSession()
  playbackTimeline.mockReset()
})

function begin(durationMs: number | null, positionMs?: number): void {
  act(() => {
    usePlaybackStore.getState().beginSession('a.dm2', durationMs)
    if (positionMs !== undefined) usePlaybackStore.getState().applyPosition(positionMs, null)
  })
}

const testid = (id: string): HTMLElement => screen.getByTestId(`replays-timeline-${id}`)

describe('DemoTimeline (story 165 D3)', () => {
  it('is absent without a session', () => {
    render(createElement(DemoTimeline))
    expect(screen.queryByTestId('replays-timeline')).toBeNull()
  })

  it('shows name, position and duration text and the slider values', () => {
    begin(125_000, 65_000)
    render(createElement(DemoTimeline))
    expect(screen.getByTestId('replays-timeline').textContent).toContain('a.dm2')
    expect(testid('position').textContent).toBe('1:05')
    expect(testid('duration').textContent).toBe('2:05')
    const seek = testid('seek')
    expect(seek.getAttribute('role')).toBe('slider')
    expect(seek.getAttribute('tabindex')).toBe('0')
    expect(seek.getAttribute('aria-valuemin')).toBe('0')
    expect(seek.getAttribute('aria-valuemax')).toBe('125')
    expect(seek.getAttribute('aria-valuenow')).toBe('65')
    expect(seek.getAttribute('aria-valuetext')).toBe('1:05 of 2:05')
    expect(screen.queryByTestId('replays-timeline-seek-reason')).toBeNull()
  })

  it('the transport buttons send toggle, back and forward', () => {
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    fireEvent.click(testid('toggle'))
    fireEvent.click(testid('back'))
    fireEvent.click(testid('forward'))
    expect(playbackTimeline.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'togglePause' },
      { kind: 'jump', deltaS: -10 },
      { kind: 'jump', deltaS: 10 },
    ])
  })

  it('the toggle label flips with the inferred paused state', () => {
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    expect(testid('toggle').getAttribute('aria-label')).toBe('Pause')
    expect(testid('state').textContent).toBe('Playing')
    act(() => usePlaybackStore.getState().applyPosition(1000, null))
    expect(testid('toggle').getAttribute('aria-label')).toBe('Pause')
    act(() => usePlaybackStore.getState().applyPosition(1000, null))
    expect(testid('toggle').getAttribute('aria-label')).toBe('Play')
    expect(testid('state').textContent).toBe('Paused')
  })

  it('a click on the seek bar seeks to the matching second', () => {
    begin(100_000, 0)
    render(createElement(DemoTimeline))
    const seek = testid('seek')
    seek.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
    fireEvent.click(seek, { clientX: 50 })
    expect(playbackTimeline).toHaveBeenCalledWith({ kind: 'seekTo', seconds: 25 })
  })

  it('slider keys jump, page and seek to the ends', () => {
    begin(100_000, 0)
    render(createElement(DemoTimeline))
    const seek = testid('seek')
    for (const key of ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']) {
      fireEvent.keyDown(seek, { key })
    }
    expect(playbackTimeline.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'jump', deltaS: -10 },
      { kind: 'jump', deltaS: 10 },
      { kind: 'jump', deltaS: 60 },
      { kind: 'jump', deltaS: -60 },
      { kind: 'seekTo', seconds: 0 },
      { kind: 'seekTo', seconds: 100 },
    ])
  })

  it('the speed select shows the current step and sends the chosen one', () => {
    begin(60_000)
    render(createElement(DemoTimeline))
    const speed = testid('speed') as HTMLSelectElement
    expect(speed.value).toBe('1')
    expect(Array.from(speed.options).map((o) => o.value)).toEqual(['0.25', '0.5', '1', '2', '4'])
    fireEvent.change(speed, { target: { value: '2' } })
    expect(playbackTimeline).toHaveBeenCalledWith({ kind: 'speed', value: 2 })
    expect((testid('speed') as HTMLSelectElement).value).toBe('2')
  })

  it('without a duration the seek bar is disabled and says why', () => {
    begin(null, 0)
    render(createElement(DemoTimeline))
    const seek = testid('seek')
    expect(seek.getAttribute('aria-disabled')).toBe('true')
    expect(testid('seek-reason').textContent).toBe("Seeking by click needs the demo's length")
    seek.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
    fireEvent.click(seek, { clientX: 50 })
    fireEvent.keyDown(seek, { key: 'ArrowRight' })
    expect(playbackTimeline).not.toHaveBeenCalled()
  })

  it('a refusal or a rejected call shows an inline alert and does not throw', async () => {
    begin(60_000, 0)
    render(createElement(DemoTimeline))
    playbackTimeline.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, error: { key: 'replays.timeline.error' } },
    })
    fireEvent.click(testid('toggle'))
    expect((await screen.findByTestId('replays-timeline-error')).textContent).toContain('could not')
    playbackTimeline.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(testid('back'))
    await vi.waitFor(() => expect(screen.getByTestId('replays-timeline-error')).toBeTruthy())
  })
})
