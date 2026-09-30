import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchState, Outcome } from '@shared/types'
import { fail, ok } from '@shared/types'
import { NO_SESSION } from './playback-control'
import { STOP_EXIT_TIMEOUT_MS, createPlaybackStop } from './playback-stop'

/**
 * A fake of the launch slice that behaves like `LaunchService`: a playback launch "runs" until
 * `exit()`, which clears it first and then reports `exited` to every observer - the same order
 * `LaunchService`'s own `'exit'` handler uses.
 */
function harness(options: { quit?: Outcome<void> } = {}) {
  let running = true
  const listeners = new Set<(state: LaunchState) => void>()
  const send = vi.fn((_line: string): Outcome<void> => options.quit ?? ok(undefined))
  const terminatePlayback = vi.fn(() => running)
  const launch = {
    isPlaybackRunning: () => running,
    terminatePlayback,
    onStateChange: (listener: (state: LaunchState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const exit = (): void => {
    running = false
    const state = { phase: 'exited', installationId: 'inst-1', exitedAt: '', exitCode: null } as LaunchState
    for (const listener of [...listeners]) listener(state)
  }
  const relaunch = (): void => {
    running = true
  }
  return { send, terminatePlayback, exit, relaunch, stop: createPlaybackStop({ playback: { send }, launch }) }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createPlaybackStop', () => {
  it('stop sends quit and does not terminate when the game exits in time', () => {
    const t = harness()

    expect(t.stop.stop()).toEqual(ok(undefined))
    expect(t.send).toHaveBeenCalledWith('quit')
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS - 1)
    t.exit()
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS * 2)

    expect(t.terminatePlayback).not.toHaveBeenCalled()
  })

  it('stop terminates the game when it has not exited after the timeout', () => {
    const t = harness()

    t.stop.stop()
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS - 1)
    expect(t.terminatePlayback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(t.terminatePlayback).toHaveBeenCalledTimes(1)
  })

  it('a refused quit terminates at once', () => {
    const t = harness({ quit: fail(NO_SESSION) })

    expect(t.stop.stop()).toEqual(ok(undefined))

    expect(t.send).toHaveBeenCalledWith('quit')
    expect(t.terminatePlayback).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS * 2)
    expect(t.terminatePlayback).toHaveBeenCalledTimes(1)
  })

  it('a second stop while pending is a no-op', () => {
    const t = harness()

    t.stop.stop()
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS / 2)
    expect(t.stop.stop()).toEqual(ok(undefined))

    expect(t.send).toHaveBeenCalledTimes(1)
    // The first stop's timer is the only one: it fires once, on its own schedule.
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS / 2)
    expect(t.terminatePlayback).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS * 2)
    expect(t.terminatePlayback).toHaveBeenCalledTimes(1)
  })

  it('a timer from an exited launch never terminates a later one', () => {
    const t = harness()

    t.stop.stop()
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS - 10)
    t.exit()
    // A later playback launch is running by the time the old timer would have fired.
    t.relaunch()
    vi.advanceTimersByTime(STOP_EXIT_TIMEOUT_MS * 2)

    expect(t.terminatePlayback).not.toHaveBeenCalled()
    // And the exit cleared the pending stop, so the later launch can be stopped on its own.
    expect(t.stop.stop()).toEqual(ok(undefined))
    expect(t.send).toHaveBeenCalledTimes(2)
  })

  it('stop without a playback launch is the no-session error', () => {
    const t = harness()
    t.exit()

    expect(t.stop.stop()).toEqual(fail(NO_SESSION))

    expect(t.send).not.toHaveBeenCalled()
    expect(t.terminatePlayback).not.toHaveBeenCalled()
  })
})
