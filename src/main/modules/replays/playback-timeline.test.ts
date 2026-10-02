import { describe, expect, it, vi } from 'vitest'
import { ok, type Outcome } from '@shared/types'
import { demoSeekCommand } from '@shared/replays/demo-control'
import { timelineActionSchema, type TimelineAction } from '@shared/replays/timeline'
import type { DemoFormat } from '@shared/modules/replays'
import { createPlaybackTimeline } from './playback-timeline'

const realSeek = vi.hoisted(() => ({ fn: null as unknown }))
vi.mock('@shared/replays/demo-control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/replays/demo-control')>()
  realSeek.fn = actual.demoSeekCommand
  return { ...actual, demoSeekCommand: vi.fn(actual.demoSeekCommand) }
})

/** Story 165 D2: `playback.timeline` sends exactly the D1 command for the playing demo's format. */

const NO_SESSION = { ok: false, error: { key: 'replays.playback.error.noSession' } }

function setup(format: DemoFormat | null) {
  const send = vi.fn((): Outcome<void> => (format ? ok(undefined) : (NO_SESSION as Outcome<void>)))
  const enterFullscreen = vi.fn((): Outcome<void> => ok(undefined))
  const timeline = createPlaybackTimeline({
    playback: { send, currentFormat: () => format, enterFullscreen },
  })
  return { send, enterFullscreen, timeline }
}

describe('playback timeline', () => {
  it.each<[TimelineAction, string]>([
    [{ kind: 'togglePause' }, 'pause'],
    [{ kind: 'jump', deltaS: -60 }, 'seek -60'],
    [{ kind: 'jump', deltaS: -10 }, 'seek -10'],
    [{ kind: 'jump', deltaS: 10 }, 'seek +10'],
    [{ kind: 'jump', deltaS: 60 }, 'seek +60'],
    [{ kind: 'seekTo', seconds: 95 }, 'seek 95'],
    [{ kind: 'speed', value: 0.25 }, 'timescale 0.25'],
    [{ kind: 'speed', value: 4 }, 'timescale 4'],
  ])('%j reaches sendCommand as %s', (action, line) => {
    const t = setup('dm2')
    expect(t.timeline.run(action)).toEqual({ ok: true, value: undefined })
    expect(t.send).toHaveBeenCalledWith(line)
  })

  it('an mvd2 session sends the literal seek command', () => {
    const t = setup('mvd2')
    t.timeline.run({ kind: 'jump', deltaS: -10 })
    expect(t.send).toHaveBeenCalledWith('seek -10')
  })

  it('the session format is what reaches demoSeekCommand', () => {
    const spy = vi.mocked(demoSeekCommand)
    spy.mockImplementation((format) => `verb-${format} 1`)
    try {
      const mvd2 = setup('mvd2')
      mvd2.timeline.run({ kind: 'jump', deltaS: 10 })
      expect(spy).toHaveBeenLastCalledWith('mvd2', expect.anything())
      expect(mvd2.send).toHaveBeenCalledWith(expect.stringMatching(/^verb-mvd2 /))
      const dm2 = setup('dm2')
      dm2.timeline.run({ kind: 'jump', deltaS: 10 })
      expect(spy).toHaveBeenLastCalledWith('dm2', expect.anything())
      expect(dm2.send).toHaveBeenCalledWith(expect.stringMatching(/^verb-dm2 /))
    } finally {
      spy.mockImplementation(realSeek.fn as typeof demoSeekCommand)
    }
  })

  it('no session rejects with the typed no-session error and sends nothing', () => {
    const t = setup(null)
    expect(t.timeline.run({ kind: 'togglePause' })).toEqual(NO_SESSION)
    expect(t.send).not.toHaveBeenCalled()
  })

  it('the fullscreen action enters fullscreen instead of sending a line', () => {
    const t = setup('dm2')
    expect(t.timeline.run({ kind: 'fullscreen' })).toEqual({ ok: true, value: undefined })
    expect(t.enterFullscreen).toHaveBeenCalledTimes(1)
    expect(t.send).not.toHaveBeenCalled()
  })

  it('an off-list speed is refused', () => {
    expect(timelineActionSchema.safeParse({ kind: 'speed', value: 3 }).success).toBe(false)
    expect(timelineActionSchema.safeParse({ kind: 'speed', value: 2 }).success).toBe(true)
  })

  it('fractional seconds are refused', () => {
    expect(timelineActionSchema.safeParse({ kind: 'seekTo', seconds: 1.5 }).success).toBe(false)
  })
})
