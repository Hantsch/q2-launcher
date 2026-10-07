import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'

const handlers = vi.hoisted(() => ({
  position: null as null | ((p: { positionMs: number | null; durationMs: number | null }) => void),
  state: null as null | ((s: { state: 'playing' | 'finished' | 'ended' }) => void),
  offPosition: vi.fn(),
  offState: vi.fn(),
  display: null as null | ((p: Record<string, unknown>) => void),
  timeline: vi.fn(),
}))

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    playbackCinema: vi.fn(),
    playbackDisplayRead: () => new Promise(() => {}),
    playbackTimeline: (a: unknown) => handlers.timeline(a),
    onPlaybackPosition: (l: unknown) => {
      handlers.position = l as typeof handlers.position
      return handlers.offPosition
    },
    onPlaybackState: (l: typeof handlers.state) => {
      handlers.state = l
      return handlers.offState
    },
    onPlaybackDisplay: (l: unknown) => {
      handlers.display = l as typeof handlers.display
      return () => {}
    },
  }),
)

import { usePlaybackStore } from './playback-store'
import { expected } from './optimistic-timeline'

const okResult = { ok: true, value: undefined }
const refused = { ok: false, error: { key: 'replays.timeline.refused' } }

beforeEach(() => {
  usePlaybackStore.getState().endSession()
  handlers.offPosition.mockClear()
  handlers.offState.mockClear()
  handlers.timeline.mockReset()
  handlers.timeline.mockResolvedValue(okResult)
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
      fullscreen: false,
    })
  })

  it('applyDisplay flips the session fullscreen flag', () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    handlers.display?.({ fullscreen: true })
    expect(usePlaybackStore.getState().session?.fullscreen).toBe(true)
    handlers.display?.({ fullscreen: false })
    expect(usePlaybackStore.getState().session?.fullscreen).toBe(false)
  })

  it('a display event with a stage notice shows it as the stage reason, and a null notice clears it', () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    handlers.display?.({ fullscreen: false, stageNotice: { key: 'replays.stage.notOnTop.x11' } })
    expect(usePlaybackStore.getState().stageReason).toEqual({ key: 'replays.stage.notOnTop.x11' })
    handlers.display?.({ fullscreen: false, stageNotice: null })
    expect(usePlaybackStore.getState().stageReason).toBeNull()
  })

  it('a null stage notice keeps the Wayland refusal from demo.play', () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    usePlaybackStore.getState().setStageReason({ key: 'replays.stage.unavailable.wayland' })
    handlers.display?.({ fullscreen: false, stageNotice: null })
    expect(usePlaybackStore.getState().stageReason).toEqual({
      key: 'replays.stage.unavailable.wayland',
    })
  })

  it('the display event sets mode, speed and cinema availability', () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    expect(usePlaybackStore.getState().session).toMatchObject({
      mode: 'preview',
      cinemaAvailability: { available: true },
    })
    const off = {
      available: false,
      reason: { key: 'replays.cinema.unavailable.notPrimaryDisplay' },
    }
    handlers.display?.({ fullscreen: false, cinema: true, speed: 2, cinemaAvailability: off })
    expect(usePlaybackStore.getState().session).toMatchObject({
      mode: 'cinema',
      speed: 2,
      cinemaAvailability: off,
    })
    handlers.display?.({
      fullscreen: true,
      cinema: false,
      speed: 2,
      cinemaAvailability: { available: true },
    })
    expect(usePlaybackStore.getState().session).toMatchObject({
      mode: 'fullscreen',
      fullscreen: true,
      cinemaAvailability: { available: true },
    })
  })

  it('a display event speed becomes the speed the timeline shows', () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    handlers.display?.({ fullscreen: false, cinema: true, speed: 2 })
    const session = usePlaybackStore.getState().session!
    expect(session.speed).toBe(2)
    expect(expected(session.optimistic, Date.now()).speed).toBe(2)
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

describe('optimistic timeline in the store (story 184 D2)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const sess = () => usePlaybackStore.getState().session!
  const now = () => Date.now()

  it('a disagreeing position event replaces the expected position', async () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    handlers.position?.({ positionMs: 10_000, durationMs: 90_000 })
    await usePlaybackStore.getState().sendTimeline({ kind: 'seekTo', seconds: 60 })
    expect(expected(sess().optimistic, now()).positionMs).toBe(60_000)
    handlers.position?.({ positionMs: 20_000, durationMs: 90_000 })
    expect(expected(sess().optimistic, now()).positionMs).toBe(20_000)
    expect(sess().optimistic.position).toHaveLength(0)
  })

  it('waiting appears after 1 s and clears on give-up after 5 s', async () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    handlers.position?.({ positionMs: 10_000, durationMs: 90_000 })
    await usePlaybackStore.getState().sendTimeline({ kind: 'seekTo', seconds: 60 })
    vi.advanceTimersByTime(999)
    expect(sess().waiting.has('position')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(sess().waiting.has('position')).toBe(true)
    expect(sess().waiting.has('pause')).toBe(false)
    vi.advanceTimersByTime(4000)
    expect(sess().waiting.size).toBe(0)
    expect(sess().optimistic.position).toHaveLength(0)
  })

  it('a refused speed reverts to the confirmed speed', async () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    handlers.timeline.mockResolvedValue(refused)
    const error = await usePlaybackStore.getState().sendTimeline({ kind: 'speed', value: 4 })
    expect(error).toEqual({ key: 'replays.timeline.refused' })
    expect(expected(sess().optimistic, now()).speed).toBe(1)
    expect(sess().speed).toBe(1)
  })

  it('a confirmed speed becomes the session speed', async () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    expect(await usePlaybackStore.getState().sendTimeline({ kind: 'speed', value: 2 })).toBeNull()
    expect(expected(sess().optimistic, now()).speed).toBe(2)
    expect(sess().speed).toBe(2)
  })

  it('a refused position jump reverts to the confirmed position; a throw reports the generic error', async () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    handlers.position?.({ positionMs: 10_000, durationMs: 90_000 })
    handlers.timeline.mockResolvedValue({ ok: false, error: { key: 'replays.timeline.refused' } })
    expect(await usePlaybackStore.getState().sendTimeline({ kind: 'jump', deltaS: 10 })).toEqual({
      key: 'replays.timeline.refused',
    })
    expect(expected(sess().optimistic, now()).positionMs).toBe(10_000)
    handlers.timeline.mockRejectedValue(new Error('boom'))
    expect(await usePlaybackStore.getState().sendTimeline({ kind: 'jump', deltaS: 10 })).toEqual({
      key: 'replays.timeline.error',
    })
    expect(expected(sess().optimistic, now()).positionMs).toBe(10_000)
  })

  it('fullscreen bypasses the chains', async () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000)
    await usePlaybackStore.getState().sendTimeline({ kind: 'fullscreen' })
    expect(handlers.timeline).toHaveBeenCalledWith({ kind: 'fullscreen' })
    expect(sess().optimistic.nextId).toBe(1)
  })
})

describe('start position', () => {
  it('a pending start seek is sent once after the first position', () => {
    usePlaybackStore
      .getState()
      .beginSession('a.dm2', 90_000, { id: 'd1', archived: false, startAtS: 41 })
    expect(usePlaybackStore.getState().session).toMatchObject({ demoId: 'd1', pendingSeekS: 41 })

    // A sample without a position says nothing about the engine taking commands yet.
    handlers.position?.({ positionMs: null, durationMs: null })
    expect(handlers.timeline).not.toHaveBeenCalled()

    handlers.position?.({ positionMs: 0, durationMs: 90_000 })
    handlers.position?.({ positionMs: 250, durationMs: 90_000 })

    expect(handlers.timeline).toHaveBeenCalledTimes(1)
    expect(handlers.timeline).toHaveBeenCalledWith({ kind: 'seekTo', seconds: 41 })
    expect(usePlaybackStore.getState().session?.pendingSeekS).toBeNull()
  })

  it('a session without a start position sends nothing on its positions', () => {
    usePlaybackStore.getState().beginSession('a.dm2', 90_000, { id: 'd1', archived: true })
    handlers.position?.({ positionMs: 0, durationMs: 90_000 })

    expect(handlers.timeline).not.toHaveBeenCalled()
    expect(usePlaybackStore.getState().session).toMatchObject({ demoId: 'd1', archived: true })
  })
})
