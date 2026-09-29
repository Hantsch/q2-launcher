import type { Outcome } from '@shared/types'
import { fail } from '@shared/types'
import { demoSeekCommand } from '@shared/replays/demo-control'
import { buildTimelineCommand, type TimelineAction } from '@shared/replays/timeline'
import { NO_SESSION, type PlaybackControl } from './playback-control'

/**
 * Story 165 D2: `playback.timeline` - turns a validated timeline action into the one console line
 * it stands for and sends it down the running demo's playback channel. The seek verb comes from
 * story 162's per-format `demoSeekCommand`, never decided here; with no live session the channel's
 * own typed no-session error is returned unchanged.
 */
export interface PlaybackTimeline {
  run(action: TimelineAction): Outcome<void>
}

export function createPlaybackTimeline(deps: {
  playback: Pick<PlaybackControl, 'send' | 'currentFormat'>
}): PlaybackTimeline {
  return {
    run(action) {
      const format = deps.playback.currentFormat()
      if (format === null) return fail(NO_SESSION)
      const seekVerb = demoSeekCommand(format, { kind: 'relative', seconds: 1 }).split(' ')[0]
      return deps.playback.send(buildTimelineCommand(action, seekVerb))
    },
  }
}
