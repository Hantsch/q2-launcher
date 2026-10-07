import { ok, type Outcome } from '@shared/types'
import type { PlaybackControl } from './playback-control'

/**
 * `playback.volume` - sets the running game's `s_volume`. A slider drag fires many calls, so at most
 * one volume line is unsettled at a time: a newer value only replaces the pending one, and the latest
 * is sent once the channel has run the line before it. Mute sends 0 but the level still travels, so
 * main keeps it. With no live session the channel's own no-session error is returned unchanged.
 */
export interface Volume {
  percent: number
  muted: boolean
}

export interface PlaybackVolume {
  set(volume: Volume): Outcome<void>
}

export function createPlaybackVolume(deps: {
  playback: Pick<PlaybackControl, 'send' | 'settled' | 'setVolume'>
}): PlaybackVolume {
  const { playback } = deps
  let inFlight = false
  let pending: Volume | null = null

  const transmit = (volume: Volume): Outcome<void> => {
    const sent = playback.send(`s_volume ${volume.muted ? 0 : volume.percent / 100}`)
    if (!sent.ok) {
      pending = null
      return sent
    }
    playback.setVolume(volume)
    inFlight = true
    const release = (resend: boolean): void => {
      inFlight = false
      const next = resend ? pending : null
      pending = null
      if (next) transmit(next)
    }
    playback.settled().then(
      () => release(true),
      () => release(false),
    )
    return sent
  }

  return {
    set(volume) {
      if (inFlight) {
        pending = volume
        return ok(undefined)
      }
      return transmit(volume)
    },
  }
}
