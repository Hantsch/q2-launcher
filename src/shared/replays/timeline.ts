import { z } from 'zod'

/**
 * Timeline core for steering a running demo: the allowed actions, the console command each one
 * becomes, and the position/duration view derived from playback samples.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * IPC. The command builder only ever emits one of a fixed set of shapes, so renderer-supplied
 * input can never inject arbitrary console text.
 */

export const JUMP_STEP_S = 10
export const PAGE_STEP_S = 60
export const SPEED_STEPS = [0.25, 0.5, 1, 2, 4] as const

const speedSchema = z
  .number()
  .refine((v) => (SPEED_STEPS as readonly number[]).includes(v), 'speed must be one of the steps')

export const timelineActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('togglePause') }),
  z.strictObject({
    kind: z.literal('jump'),
    deltaS: z.union([
      z.literal(-PAGE_STEP_S),
      z.literal(-JUMP_STEP_S),
      z.literal(JUMP_STEP_S),
      z.literal(PAGE_STEP_S)
    ])
  }),
  z.strictObject({ kind: z.literal('seekTo'), seconds: z.number().int().min(0) }),
  z.strictObject({ kind: z.literal('speed'), value: speedSchema }),
  // Story 172: handled by the launcher (the channel switches the game), never a console line.
  z.strictObject({ kind: z.literal('fullscreen') })
])

export type TimelineAction = z.infer<typeof timelineActionSchema>

/** Console command for an action. `seekVerb` is the engine's relative/absolute seek command. */
export function buildTimelineCommand(action: TimelineAction, seekVerb: string): string {
  switch (action.kind) {
    case 'togglePause':
      return 'pause'
    case 'jump':
      return `${seekVerb} ${action.deltaS > 0 ? '+' : '-'}${Math.abs(action.deltaS)}`
    case 'seekTo':
      return `${seekVerb} ${action.seconds}`
    case 'speed':
      return `timescale ${action.value}`
    case 'fullscreen':
      throw new Error('fullscreen is not a console command')
  }
}

/** Whole second a click at `fraction` of the timeline maps to; never past the demo's end. */
export function seekSecondsForFraction(fraction: number, durationMs: number): number {
  const totalS = Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs / 1000) : 0
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return Math.min(totalS, Math.round(f * (durationMs > 0 ? durationMs / 1000 : 0)))
}

/** Position text: `0:00`, `m:ss`, `h:mm:ss`. Unlike formatDemoDuration, 0 is a real position. */
export function formatPlaybackPosition(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const pad = (n: number): string => String(n).padStart(2, '0')
  const seconds = totalSeconds % 60
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}:${pad(seconds)}`
  return `${Math.floor(totalSeconds / 3600)}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(seconds)}`
}

export type PlaybackSample = {
  positionMs: number
  engineDurationMs: number | null
  knownDurationMs: number | null
  ended: boolean
}

export type PlaybackView = {
  positionMs: number
  durationMs: number | null
  paused: boolean
  ended: boolean
  /** Consecutive samples whose position did not advance; feed the view back as `prev`. */
  stillCount: number
}

/**
 * Consecutive unchanged steps (a step = a sample equal to its predecessor) before the view reads as
 * paused. Positions are pushed every 250 ms and `$cl_demopos` resolves to 0.1 s, so at 0.25x speed
 * two consecutive pushes can legitimately be identical while playing; one unchanged step must not
 * flip to paused. Two unchanged steps (three samples at the same position) is a real pause.
 */
const STILL_SAMPLES_FOR_PAUSE = 2

const positive = (v: number | null): number | null => (v !== null && v > 0 ? v : null)

export function reducePlaybackView(prev: PlaybackView | null, sample: PlaybackSample): PlaybackView {
  const stillCount =
    prev !== null && sample.positionMs === prev.positionMs ? prev.stillCount + 1 : 0
  return {
    positionMs: sample.positionMs,
    durationMs: positive(sample.knownDurationMs) ?? positive(sample.engineDurationMs),
    paused: stillCount >= STILL_SAMPLES_FOR_PAUSE,
    ended: sample.ended,
    stillCount
  }
}
