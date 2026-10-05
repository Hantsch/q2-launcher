import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ok, type LaunchState, type Outcome } from '@shared/types'
import { createPlaybackControl } from './playback-control'
import type { EngineIo, PlaybackChannel } from './playback-channel/types'

/** Story 164 D4: the playback control owns one channel per demo game and pushes its state to the renderer. */

const NO_SESSION = { ok: false, error: { key: 'replays.playback.error.noSession' } }

function fakeChannel(name: string, order: string[]) {
  const finished = new Set<() => void>()
  let closeResolve: (() => void) | null = null
  const state = { positionMs: 0 as number | null, deferClose: false }
  const displayCbs = new Set<(d: 'stage' | 'fullscreen') => void>()
  const channel = {
    argsBeforeDemo: [`+before-${name}`],
    argsAfterDemo: [`+after-${name}`],
    start: vi.fn(async () => undefined),
    send: vi.fn((): Outcome<void> => ok(undefined)),
    latest: vi.fn(() => ({ positionMs: state.positionMs, finished: false })),
    onFinished: vi.fn((cb: () => void) => {
      finished.add(cb)
      return () => finished.delete(cb)
    }),
    enterFullscreen: vi.fn((): Outcome<void> => ok(undefined)),
    display: vi.fn(() => 'stage' as const),
    onDisplayChange: vi.fn((cb: (d: 'stage' | 'fullscreen') => void) => {
      displayCbs.add(cb)
      return () => displayCbs.delete(cb)
    }),
    close: vi.fn(() => {
      order.push('close')
      if (!state.deferClose) return Promise.resolve()
      return new Promise<void>((resolve) => {
        closeResolve = resolve
      })
    }),
  }
  return {
    channel: channel as PlaybackChannel & typeof channel,
    state,
    fireDisplay: (d: 'stage' | 'fullscreen') => displayCbs.forEach((cb) => cb(d)),
    fireFinished: () => finished.forEach((cb) => cb()),
    resolveClose: () => closeResolve?.(),
  }
}

function fakeLaunch() {
  const stateListeners = new Set<(s: LaunchState) => void>()
  const releaseListeners = new Set<() => void>()
  return {
    launch: {
      onStateChange: (l: (s: LaunchState) => void) => {
        stateListeners.add(l)
        return () => stateListeners.delete(l)
      },
      onBeforePlaybackRelease: (l: () => void) => {
        releaseListeners.add(l)
        return () => releaseListeners.delete(l)
      },
    },
    exit: (phase: LaunchState['phase'] = 'exited') =>
      stateListeners.forEach((l) => l({ phase, installationId: 'a' } as LaunchState)),
    release: () => releaseListeners.forEach((l) => l()),
    liveListeners: () => ({ state: stateListeners.size, release: releaseListeners.size }),
  }
}

const IO: EngineIo = { writeLine: () => undefined, onLine: () => () => undefined }

type Ev = { type: string; payload: unknown }

function setup(
  platform: string,
  cinema?: Parameters<typeof createPlaybackControl>[0]['cinema'],
  stageNotice?: Parameters<typeof createPlaybackControl>[0]['stageNotice'],
) {
  const order: string[] = []
  const win = fakeChannel('win', order)
  const lin = fakeChannel('lin', order)
  const events: Ev[] = []
  const emit = (type: string, payload: unknown): void => {
    events.push({ type, payload })
    order.push(type)
  }
  const fl = fakeLaunch()
  const makeWindows = vi.fn(() => win.channel)
  const makeLinux = vi.fn(() => lin.channel)
  const control = createPlaybackControl({
    emit,
    launch: fl.launch,
    platform,
    makeWindows,
    makeLinux,
    cinema,
    stageNotice,
  })
  return { control, events, order, win, lin, fl, makeWindows, makeLinux }
}

const positions = (events: Ev[]): Ev[] => events.filter((e) => e.type === 'playback.position')
const endedCount = (events: Ev[]): number =>
  events.filter((e) => (e.payload as { state?: string }).state === 'ended').length

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('playback control', () => {
  it('picks the Windows channel on win32 and the Linux channel on linux', async () => {
    const w = setup('win32')
    expect(
      await w.control.prepare({ gameDirPath: 'C:/q2/baseq2', durationMs: null, format: 'dm2' }),
    ).toEqual({
      argsBeforeDemo: ['+before-win'],
      argsAfterDemo: ['+after-win'],
    })
    expect(w.makeWindows).toHaveBeenCalledWith(
      expect.objectContaining({ gameDirPath: 'C:/q2/baseq2' }),
    )
    expect(w.makeLinux).not.toHaveBeenCalled()
    // Windows writes its files in prepare, before the game is spawned; Linux waits for the engine's pipes.
    expect(w.win.channel.start).toHaveBeenCalledTimes(1)

    const l = setup('linux')
    expect(
      (await l.control.prepare({ gameDirPath: '/q2/baseq2', durationMs: null, format: 'dm2' }))
        .argsAfterDemo,
    ).toEqual(['+after-lin'])
    expect(l.makeLinux).toHaveBeenCalledTimes(1)
    expect(l.makeWindows).not.toHaveBeenCalled()
    expect(l.lin.channel.start).not.toHaveBeenCalled()
  })

  it('on win32 attach does not start the channel a second time', async () => {
    const t = setup('win32')
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach()
    expect(t.win.channel.start).toHaveBeenCalledTimes(1)
  })

  it('on linux attach starts the channel once', async () => {
    const t = setup('linux')
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach(IO)
    expect(t.lin.channel.start).toHaveBeenCalledTimes(1)
  })

  it('pushes playback.position every 250 ms while the demo plays', async () => {
    const t = setup('win32')
    await t.control.prepare({ gameDirPath: 'g', durationMs: 90_000, format: 'dm2' })
    await t.control.attach()
    expect(t.win.channel.start).toHaveBeenCalled()
    expect(t.events[0]).toEqual({ type: 'playback.state', payload: { state: 'playing' } })
    t.win.state.positionMs = 1234
    vi.advanceTimersByTime(750)
    expect(positions(t.events).map((e) => e.payload)).toEqual([
      { positionMs: 1234, durationMs: 90_000 },
      { positionMs: 1234, durationMs: 90_000 },
      { positionMs: 1234, durationMs: 90_000 },
    ])
  })

  it('finished stops the position pushes and refuses sends', async () => {
    const t = setup('win32')
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach()
    vi.advanceTimersByTime(250)
    t.win.fireFinished()
    const before = positions(t.events).length
    vi.advanceTimersByTime(1000)
    expect(positions(t.events)).toHaveLength(before)
    expect(t.events.at(-1)).toEqual({ type: 'playback.state', payload: { state: 'finished' } })
    expect(t.control.send('demoseek 1')).toEqual(NO_SESSION)
  })

  it('game exit ends the session with a final playback.state ended, after the close settled', async () => {
    const t = setup('win32')
    t.win.state.deferClose = true
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach()
    t.fl.exit('exited')
    expect(t.win.channel.close).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(endedCount(t.events)).toBe(0)
    t.win.resolveClose()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.events.at(-1)).toEqual({ type: 'playback.state', payload: { state: 'ended' } })
    const count = t.events.length
    vi.advanceTimersByTime(1000)
    expect(t.events).toHaveLength(count)
    expect(t.order.indexOf('close')).toBeLessThan(t.order.lastIndexOf('playback.state'))
    expect(t.control.send('x')).toEqual(NO_SESSION)
  })

  it('send without a session fails with replays.playback.error.noSession, and forwards with one', async () => {
    const t = setup('linux')
    expect(t.control.send('pause')).toEqual(NO_SESSION)
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach(IO)
    expect(t.control.send('pause')).toEqual({ ok: true, value: undefined })
    expect(t.lin.channel.send).toHaveBeenCalledWith('pause')
  })

  it('launcher-quit release closes the channel before the session ends, then emits ended once', async () => {
    const t = setup('linux')
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach(IO)
    t.fl.release()
    expect(t.lin.channel.close).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.events.at(-1)).toEqual({ type: 'playback.state', payload: { state: 'ended' } })
    // The exit that follows the release does not end a second time.
    t.fl.exit('exited')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.lin.channel.close).toHaveBeenCalledTimes(1)
    expect(endedCount(t.events)).toBe(1)
  })

  it('currentFormat is null without a session', () => {
    expect(setup('win32').control.currentFormat()).toBeNull()
  })

  it('currentFormat returns the prepared format while the session is live', async () => {
    const t = setup('win32')
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'mvd2' })
    await t.control.attach()
    expect(t.control.currentFormat()).toBe('mvd2')
  })

  it('currentFormat is null after the session finished or was released', async () => {
    const finished = setup('win32')
    await finished.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'mvd2' })
    await finished.control.attach()
    finished.win.fireFinished()
    expect(finished.control.currentFormat()).toBeNull()

    const released = setup('linux')
    await released.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'mvd2' })
    await released.control.attach(IO)
    expect(released.control.currentFormat()).toBe('mvd2')
    released.fl.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(released.control.currentFormat()).toBeNull()
  })

  it('a display change is pushed as playback.display and pauses position pushes while fullscreen', async () => {
    const t = setup('win32')
    await t.control.prepare({ gameDirPath: 'g', durationMs: 90_000, format: 'dm2' })
    await t.control.attach()
    const seen: boolean[] = []
    t.control.onDisplayChange((f) => seen.push(f))
    vi.advanceTimersByTime(500)
    const before = positions(t.events).length
    expect(before).toBeGreaterThan(0)
    t.win.fireDisplay('fullscreen')
    expect(t.events.at(-1)).toEqual({
      type: 'playback.display',
      payload: expect.objectContaining({ fullscreen: true }),
    })
    vi.advanceTimersByTime(2000)
    expect(positions(t.events)).toHaveLength(before)
    t.win.fireDisplay('stage')
    expect(t.events.at(-1)).toEqual({
      type: 'playback.display',
      payload: expect.objectContaining({ fullscreen: false }),
    })
    vi.advanceTimersByTime(500)
    expect(positions(t.events).length).toBeGreaterThan(before)
    expect(seen).toEqual([true, false])
  })

  it('the display event carries cinema, speed and availability', async () => {
    const cinema = {
      open: false,
      availability: { available: true } as
        { available: true } | { available: false; reason: { key: string } },
    }
    const t = setup('win32', () => cinema)
    const states: string[] = []
    t.control.onStateChange((s) => states.push(s))
    // No session: the defaults, with what cinema says right now.
    expect(t.control.display()).toEqual({
      fullscreen: false,
      cinema: false,
      speed: 1,
      volume: { percent: 70, muted: false },
      cinemaAvailability: { available: true },
      stageNotice: null,
    })
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach()
    expect(states).toEqual(['playing'])
    const displays = () =>
      t.events.filter((e) => e.type === 'playback.display').map((e) => e.payload)

    t.control.setSpeed(2)
    cinema.open = true
    t.control.emitDisplay()
    expect(displays().at(-1)).toEqual({
      fullscreen: false,
      cinema: true,
      speed: 2,
      volume: { percent: 70, muted: false },
      cinemaAvailability: { available: true },
      stageNotice: null,
    })

    // Fullscreen wins over an open overlay; availability is read at push time.
    cinema.availability = {
      available: false,
      reason: { key: 'replays.cinema.unavailable.notPrimaryDisplay' },
    }
    t.win.fireDisplay('fullscreen')
    expect(displays().at(-1)).toEqual({
      fullscreen: true,
      cinema: false,
      speed: 2,
      volume: { percent: 70, muted: false },
      cinemaAvailability: {
        available: false,
        reason: { key: 'replays.cinema.unavailable.notPrimaryDisplay' },
      },
      stageNotice: null,
    })
    expect(t.control.display()).toEqual(displays().at(-1))

    t.win.fireFinished()
    t.fl.exit()
    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual(['playing', 'finished', 'ended'])
    // The next session starts at normal speed.
    expect(t.control.display().speed).toBe(1)
  })

  it('the display carries the session volume', async () => {
    const t = setup('win32')
    await t.control.prepare({
      gameDirPath: 'g',
      durationMs: null,
      format: 'dm2',
      volumePercent: 30,
    })
    await t.control.attach()
    expect(t.control.display().volume).toEqual({ percent: 30, muted: false })
    t.control.setVolume({ percent: 55, muted: true })
    expect(t.control.display().volume).toEqual({ percent: 55, muted: true })
    expect(t.events.filter((e) => e.type === 'playback.display').at(-1)?.payload).toMatchObject({
      volume: { percent: 55, muted: true },
    })
  })

  it('takeChangedVolume returns the last level once, after the session ended', async () => {
    const t = setup('win32')
    expect(t.control.takeChangedVolume()).toBeNull()
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach()
    t.control.setVolume({ percent: 20, muted: false })
    t.control.setVolume({ percent: 45, muted: true })
    t.fl.exit()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.control.takeChangedVolume()).toBe(45)
    expect(t.control.takeChangedVolume()).toBeNull()
  })

  it("a new session does not inherit the previous session's changed volume", async () => {
    const t = setup('win32')
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach()
    t.control.setVolume({ percent: 45, muted: false })
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    expect(t.control.takeChangedVolume()).toBeNull()
  })

  it('the display carries the stage notice, null when none is wired', () => {
    expect(setup('win32').control.display().stageNotice).toBeNull()
    let notice: { key: string } | null = null
    const t = setup('win32', undefined, () => notice)
    expect(t.control.display().stageNotice).toBeNull()
    notice = { key: 'replays.stage.notOnTop.x11' }
    t.control.emitDisplay()
    expect(t.events.at(-1)?.payload).toMatchObject({ stageNotice: notice })
  })

  it('enterFullscreen goes to the channel, and is NO_SESSION without a session', async () => {
    const t = setup('win32')
    expect(t.control.enterFullscreen()).toEqual(NO_SESSION)
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.attach()
    expect(t.control.enterFullscreen()).toEqual({ ok: true, value: undefined })
    expect(t.win.channel.enterFullscreen).toHaveBeenCalledTimes(1)
  })

  it('cancel drops a prepared channel without events and closes it', async () => {
    const t = setup('win32')
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.cancel()
    expect(t.win.channel.close).toHaveBeenCalledTimes(1)
    expect(t.events).toHaveLength(0)
  })
})

describe('playback control dispose', () => {
  const PREPARE = { gameDirPath: '/q2/baseq2', durationMs: null, format: 'dm2' as const }

  it('dispose unsubscribes and closes the channel once', async () => {
    const t = setup('linux')
    await t.control.prepare(PREPARE)
    await t.control.attach(IO)
    expect(t.fl.liveListeners()).toEqual({ state: 1, release: 1 })

    await t.control.dispose()

    expect(t.fl.liveListeners()).toEqual({ state: 0, release: 0 })
    expect(t.lin.channel.close).toHaveBeenCalledTimes(1)
    expect(endedCount(t.events)).toBe(1)
  })

  it('waits for the close the playback release started instead of closing again', async () => {
    const t = setup('linux')
    await t.control.prepare(PREPARE)
    await t.control.attach(IO)
    t.lin.state.deferClose = true

    t.fl.release()
    expect(t.lin.channel.close).toHaveBeenCalledTimes(1)
    let disposed = false
    const disposing = t.control.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)

    t.lin.resolveClose()
    await disposing
    expect(t.lin.channel.close).toHaveBeenCalledTimes(1)
    expect(t.lin.channel.start).toHaveBeenCalledTimes(1)
    expect(endedCount(t.events)).toBe(1)
  })

  it('dispose closes a prepared channel whose launch never started, without an ended push', async () => {
    const t = setup('win32')
    await t.control.prepare(PREPARE)

    await t.control.dispose()

    expect(t.win.channel.close).toHaveBeenCalledTimes(1)
    expect(endedCount(t.events)).toBe(0)
    expect(t.fl.liveListeners()).toEqual({ state: 0, release: 0 })
  })

  it('a prepare after dispose does not subscribe to the launch service again', async () => {
    const t = setup('linux')
    await t.control.prepare(PREPARE)
    await t.control.dispose()

    await t.control.prepare(PREPARE)

    expect(t.fl.liveListeners()).toEqual({ state: 0, release: 0 })
  })
})
