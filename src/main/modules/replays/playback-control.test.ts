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
  }
}

const IO: EngineIo = { writeLine: () => undefined, onLine: () => () => undefined }

type Ev = { type: string; payload: unknown }

function setup(platform: string) {
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
  const control = createPlaybackControl({ emit, launch: fl.launch, platform, makeWindows, makeLinux })
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
    expect(await w.control.prepare({ gameDirPath: 'C:/q2/baseq2', durationMs: null, format: 'dm2' })).toEqual({
      argsBeforeDemo: ['+before-win'],
      argsAfterDemo: ['+after-win'],
    })
    expect(w.makeWindows).toHaveBeenCalledWith(expect.objectContaining({ gameDirPath: 'C:/q2/baseq2' }))
    expect(w.makeLinux).not.toHaveBeenCalled()
    // Windows writes its files in prepare, before the game is spawned; Linux waits for the engine's pipes.
    expect(w.win.channel.start).toHaveBeenCalledTimes(1)

    const l = setup('linux')
    expect((await l.control.prepare({ gameDirPath: '/q2/baseq2', durationMs: null, format: 'dm2' })).argsAfterDemo).toEqual(['+after-lin'])
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

  it('cancel drops a prepared channel without events and closes it', async () => {
    const t = setup('win32')
    await t.control.prepare({ gameDirPath: 'g', durationMs: null, format: 'dm2' })
    await t.control.cancel()
    expect(t.win.channel.close).toHaveBeenCalledTimes(1)
    expect(t.events).toHaveLength(0)
  })
})
