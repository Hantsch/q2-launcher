import { fail } from '@shared/types'
import type { PlaybackChannel } from './types'

export const R1Q2_CONTROLS_UNAVAILABLE = 'replays.playback.unavailable.r1q2'

/** R1Q2 has no console pipe the launcher can steer, so the session carries no control channel. */
export function createEngineLessChannel(): PlaybackChannel {
  return {
    argsBeforeDemo: [],
    argsAfterDemo: [],
    start: () => Promise.resolve(),
    send: () => fail(R1Q2_CONTROLS_UNAVAILABLE),
    settled: () => Promise.resolve(),
    latest: () => ({ positionMs: null, paused: null, finished: false }),
    onFinished: () => () => undefined,
    enterFullscreen: () => fail(R1Q2_CONTROLS_UNAVAILABLE),
    display: () => 'stage',
    onDisplayChange: () => () => undefined,
    close: () => Promise.resolve(),
  }
}
