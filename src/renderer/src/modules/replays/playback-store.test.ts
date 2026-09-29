import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => ({
  position: null as null | ((p: { positionMs: number | null; durationMs: number | null }) => void),
  state: null as null | ((s: { state: 'playing' | 'finished' | 'ended' }) => void),
  offPosition: vi.fn(),
  offState: vi.fn(),
}))

vi.mock('./client', () => ({
  onPlaybackPosition: (l: typeof handlers.position) => {
    handlers.position = l
    return handlers.offPosition
  },
  onPlaybackState: (l: typeof handlers.state) => {
    handlers.state = l
    return handlers.offState
  },
}))

import { usePlaybackStore } from './playback-store'

beforeEach(() => {
  usePlaybackStore.getState().endSession()
  handlers.offPosition.mockClear()
  handlers.offState.mockClear()
})
afterEach(() => usePlaybackStore.getState().endSession())

describe('playback store (story 165 D3)', () => {
  it('has no session until one begins, then starts at 1x with no view', () => {
    expect(usePlaybackStore.getState().session).toBeNull()
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    expect(usePlaybackStore.getState().session).toMatchObject({
      demoName: 'a.dm2',
      knownDurationMs: 90_000,
      view: null,
      speed: 1,
    })
  })

  it('position events feed the reducer; the known duration wins, an unchanged position reads paused', () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    handlers.position?.({ positionMs: 1000, durationMs: 5000 })
    expect(usePlaybackStore.getState().session?.view).toMatchObject({
      positionMs: 1000,
      durationMs: 90_000,
      paused: false,
    })
    handlers.position?.({ positionMs: 1000, durationMs: 5000 })
    expect(usePlaybackStore.getState().session?.view?.paused).toBe(false)
    handlers.position?.({ positionMs: 1000, durationMs: 5000 })
    expect(usePlaybackStore.getState().session?.view?.paused).toBe(true)
  })

  it('falls back to the engine duration when the demo has no known one', () => {
    usePlaybackStore.getState().beginSession('a.dm2', null)
    handlers.position?.({ positionMs: 0, durationMs: 42_000 })
    expect(usePlaybackStore.getState().session?.view?.durationMs).toBe(42_000)
  })

  it('remembers the last speed set', () => {
    usePlaybackStore.getState().beginSession('a.dm2', null)
    usePlaybackStore.getState().setSpeed(4)
    expect(usePlaybackStore.getState().session?.speed).toBe(4)
  })

  it('finished marks the view ended and keeps the session; ended clears it and unsubscribes', () => {
    usePlaybackStore.getState().beginSession('a.dm2', 1000)
    handlers.state?.({ state: 'finished' })
    expect(usePlaybackStore.getState().session?.view?.ended).toBe(true)
    handlers.state?.({ state: 'ended' })
    expect(usePlaybackStore.getState().session).toBeNull()
    expect(handlers.offPosition).toHaveBeenCalled()
    expect(handlers.offState).toHaveBeenCalled()
  })

  it('ignores positions without a session and null positions', () => {
    usePlaybackStore.getState().applyPosition(500, null)
    expect(usePlaybackStore.getState().session).toBeNull()
    usePlaybackStore.getState().beginSession('a.dm2', null)
    handlers.position?.({ positionMs: null, durationMs: null })
    expect(usePlaybackStore.getState().session?.view).toBeNull()
  })

  it('a new session resets the speed', () => {
    usePlaybackStore.getState().beginSession('a.dm2', null)
    usePlaybackStore.getState().setSpeed(2)
    usePlaybackStore.getState().beginSession('b.dm2', null)
    expect(usePlaybackStore.getState().session?.speed).toBe(1)
  })
})
