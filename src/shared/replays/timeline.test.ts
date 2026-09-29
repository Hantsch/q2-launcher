import { describe, expect, it } from 'vitest'
import {
  JUMP_STEP_S,
  PAGE_STEP_S,
  SPEED_STEPS,
  buildTimelineCommand,
  formatPlaybackPosition,
  reducePlaybackView,
  seekSecondsForFraction,
  timelineActionSchema,
  type PlaybackSample,
  type PlaybackView
} from './timeline'

const sample = (over: Partial<PlaybackSample> = {}): PlaybackSample => ({
  positionMs: 0,
  engineDurationMs: null,
  knownDurationMs: null,
  ended: false,
  ...over
})

describe('constants', () => {
  it('pins the step sizes and speed list', () => {
    expect(JUMP_STEP_S).toBe(10)
    expect(PAGE_STEP_S).toBe(60)
    expect([...SPEED_STEPS]).toEqual([0.25, 0.5, 1, 2, 4])
  })
})

describe('timelineActionSchema', () => {
  it('accepts every valid action', () => {
    for (const a of [
      { kind: 'togglePause' },
      { kind: 'jump', deltaS: -60 },
      { kind: 'jump', deltaS: -10 },
      { kind: 'jump', deltaS: 10 },
      { kind: 'jump', deltaS: 60 },
      { kind: 'seekTo', seconds: 0 },
      { kind: 'seekTo', seconds: 754 },
      { kind: 'fullscreen' },
      ...SPEED_STEPS.map((value) => ({ kind: 'speed', value }))
    ]) {
      expect(timelineActionSchema.safeParse(a).success).toBe(true)
    }
  })

  it('refuses a speed that is not on the list', () => {
    for (const value of [0, 3, 0.75, 8, -1, NaN]) {
      expect(timelineActionSchema.safeParse({ kind: 'speed', value }).success).toBe(false)
    }
  })

  it('refuses fractional or negative seek seconds', () => {
    for (const seconds of [1.5, -1, -0.5, NaN, Infinity, '3']) {
      expect(timelineActionSchema.safeParse({ kind: 'seekTo', seconds }).success).toBe(false)
    }
  })

  it('refuses a jump delta that is not in the list', () => {
    for (const deltaS of [0, 5, -30, 30, 120, 10.5]) {
      expect(timelineActionSchema.safeParse({ kind: 'jump', deltaS }).success).toBe(false)
    }
  })

  it('refuses extra keys, unknown kinds and missing fields', () => {
    expect(timelineActionSchema.safeParse({ kind: 'togglePause', extra: 1 }).success).toBe(false)
    expect(
      timelineActionSchema.safeParse({ kind: 'seekTo', seconds: 3, cmd: 'quit' }).success
    ).toBe(false)
    expect(timelineActionSchema.safeParse({ kind: 'quit' }).success).toBe(false)
    expect(timelineActionSchema.safeParse({ kind: 'jump' }).success).toBe(false)
    expect(timelineActionSchema.safeParse(null).success).toBe(false)
  })
})

describe('buildTimelineCommand', () => {
  it('builds seek -10 / +10 / -60 / +60', () => {
    expect(buildTimelineCommand({ kind: 'jump', deltaS: -10 }, 'seek')).toBe('seek -10')
    expect(buildTimelineCommand({ kind: 'jump', deltaS: 10 }, 'seek')).toBe('seek +10')
    expect(buildTimelineCommand({ kind: 'jump', deltaS: -60 }, 'seek')).toBe('seek -60')
    expect(buildTimelineCommand({ kind: 'jump', deltaS: 60 }, 'seek')).toBe('seek +60')
  })

  it('uses the given seek verb', () => {
    expect(buildTimelineCommand({ kind: 'jump', deltaS: 10 }, 'demoseek')).toBe('demoseek +10')
    expect(buildTimelineCommand({ kind: 'seekTo', seconds: 30 }, 'demoseek')).toBe('demoseek 30')
  })

  it('pins pause, absolute seek and timescale strings', () => {
    expect(buildTimelineCommand({ kind: 'togglePause' }, 'seek')).toBe('pause')
    expect(buildTimelineCommand({ kind: 'seekTo', seconds: 30 }, 'seek')).toBe('seek 30')
    expect(buildTimelineCommand({ kind: 'seekTo', seconds: 0 }, 'seek')).toBe('seek 0')
    expect(buildTimelineCommand({ kind: 'speed', value: 0.5 }, 'seek')).toBe('timescale 0.5')
    expect(buildTimelineCommand({ kind: 'speed', value: 4 }, 'seek')).toBe('timescale 4')
    expect(buildTimelineCommand({ kind: 'speed', value: 0.25 }, 'seek')).toBe('timescale 0.25')
  })
})

describe('seekSecondsForFraction', () => {
  it('a fraction maps to whole seconds within the length', () => {
    expect(seekSecondsForFraction(0, 100_000)).toBe(0)
    expect(seekSecondsForFraction(0.5, 100_000)).toBe(50)
    expect(seekSecondsForFraction(0.333, 100_000)).toBe(33)
    expect(seekSecondsForFraction(1, 100_000)).toBe(100)
    expect(seekSecondsForFraction(-0.4, 100_000)).toBe(0)
    expect(seekSecondsForFraction(7, 100_000)).toBe(100)
    // never past the end: 100.9 s long -> at most second 100
    expect(seekSecondsForFraction(1, 100_900)).toBe(100)
    expect(seekSecondsForFraction(0.9999, 100_900)).toBeLessThanOrEqual(100)
    expect(Number.isInteger(seekSecondsForFraction(0.123456, 98_765))).toBe(true)
  })

  it('degrades to 0 for an unusable length or fraction', () => {
    expect(seekSecondsForFraction(0.5, 0)).toBe(0)
    expect(seekSecondsForFraction(NaN, 100_000)).toBe(0)
    expect(seekSecondsForFraction(0.5, NaN)).toBe(0)
  })
})

describe('formatPlaybackPosition', () => {
  it('formats zero as 0:00', () => {
    expect(formatPlaybackPosition(0)).toBe('0:00')
  })

  it('formats m:ss and h:mm:ss', () => {
    expect(formatPlaybackPosition(41_000)).toBe('0:41')
    expect(formatPlaybackPosition(620_100)).toBe('10:20')
    expect(formatPlaybackPosition(3_599_000)).toBe('59:59')
    expect(formatPlaybackPosition(3_600_000)).toBe('1:00:00')
    expect(formatPlaybackPosition(3_725_000)).toBe('1:02:05')
  })

  it('clamps garbage to 0:00', () => {
    expect(formatPlaybackPosition(-5)).toBe('0:00')
    expect(formatPlaybackPosition(NaN)).toBe('0:00')
  })
})

describe('reducePlaybackView', () => {
  it('starts not paused on the first sample', () => {
    const v = reducePlaybackView(null, sample({ positionMs: 5000 }))
    expect(v.positionMs).toBe(5000)
    expect(v.paused).toBe(false)
    expect(v.ended).toBe(false)
  })

  it('position standing still for two samples reads as paused', () => {
    let v = reducePlaybackView(null, sample({ positionMs: 5000 }))
    expect(v.paused).toBe(false)
    v = reducePlaybackView(v, sample({ positionMs: 5000 }))
    expect(v.paused).toBe(false)
    v = reducePlaybackView(v, sample({ positionMs: 5000 }))
    expect(v.paused).toBe(true)
    v = reducePlaybackView(v, sample({ positionMs: 5000 }))
    expect(v.paused).toBe(true)
  })

  it('a single repeated sample followed by an advance never reads paused', () => {
    let v = reducePlaybackView(null, sample({ positionMs: 5000 }))
    v = reducePlaybackView(v, sample({ positionMs: 5000 }))
    expect(v.paused).toBe(false)
    v = reducePlaybackView(v, sample({ positionMs: 5100 }))
    expect(v.paused).toBe(false)
    v = reducePlaybackView(v, sample({ positionMs: 5100 }))
    expect(v.paused).toBe(false)
    v = reducePlaybackView(v, sample({ positionMs: 5200 }))
    expect(v.paused).toBe(false)
  })

  it('any advance clears paused', () => {
    let v: PlaybackView | null = null
    for (let i = 0; i < 3; i++) v = reducePlaybackView(v, sample({ positionMs: 5000 }))
    expect(v?.paused).toBe(true)
    v = reducePlaybackView(v, sample({ positionMs: 5250 }))
    expect(v.paused).toBe(false)
    expect(v.positionMs).toBe(5250)
  })

  it('the known duration wins over the engine\'s', () => {
    const both = reducePlaybackView(
      null,
      sample({ knownDurationMs: 90_000, engineDurationMs: 80_000 })
    )
    expect(both.durationMs).toBe(90_000)
    const engineOnly = reducePlaybackView(null, sample({ engineDurationMs: 80_000 }))
    expect(engineOnly.durationMs).toBe(80_000)
    expect(reducePlaybackView(null, sample()).durationMs).toBeNull()
  })

  it('carries the ended flag through', () => {
    expect(reducePlaybackView(null, sample({ ended: true })).ended).toBe(true)
  })
})
