import type { DemoPlayEngine } from '@shared/replays/demo-play'

export interface PlaybackChannelPlan {
  kind: 'engine-less' | 'windows' | 'pipes'
  /** The channel starts in `prepare`, before the game exists (Windows q2pro). */
  startsEarly: boolean
  /** The channel talks over the game's stdio pipes, so the launch must expose a playback session. */
  usesPipes: boolean
}

/** The one place that turns engine + platform into a playback channel shape. */
export function playbackChannelPlan(platform: string, engine: DemoPlayEngine): PlaybackChannelPlan {
  if (engine === 'r1q2') return { kind: 'engine-less', startsEarly: false, usesPipes: false }
  if (platform === 'win32') return { kind: 'windows', startsEarly: true, usesPipes: false }
  return { kind: 'pipes', startsEarly: false, usesPipes: true }
}
