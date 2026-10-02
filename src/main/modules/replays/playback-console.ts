import type { Outcome } from '@shared/types'
import { fail } from '@shared/types'
import { validateConsoleLine } from '@shared/replays/console-line'
import { NO_SESSION, type PlaybackControl } from './playback-control'

/**
 * Story 166 D2: `playback.consoleSend` - re-validates a user-typed console line in main (the renderer
 * is never trusted), then hands the trimmed line to the running demo's playback channel. A refused
 * line never reaches the channel; the channel's no-session error becomes the console's own typed
 * `noSession`; any other channel failure passes through unchanged.
 */
export interface PlaybackConsole {
  send(line: string): Outcome<void>
}

export function createPlaybackConsole(deps: {
  playback: Pick<PlaybackControl, 'send'>
}): PlaybackConsole {
  return {
    send(line) {
      const checked = validateConsoleLine(line)
      if (!checked.ok) return fail(`replays.console.error.${checked.reason}`)
      const result = deps.playback.send(checked.line)
      if (!result.ok && result.error.key === NO_SESSION)
        return fail('replays.console.error.noSession')
      return result
    },
  }
}
