import {
  REPLAYS_EVENTS,
  type ReplaysPlaybackPosition,
  type ReplaysPlaybackState,
} from '@shared/modules/replays'
import { fail, type LaunchState, type Outcome } from '@shared/types'
import { scopedLogger } from '../../lib/logger'
import { createLinuxChannel } from './playback-channel/linux-channel'
import { POSITION_PUSH_MS } from './playback-channel/protocol'
import type { EngineIo, PlaybackChannel } from './playback-channel/types'
import { createWindowsChannel, type WindowsChannelOptions } from './playback-channel/windows-channel'

/**
 * Story 164 D4: the one owner of the running demo's playback channel. `prepare` picks the platform's
 * channel and hands back the launch args it needs, `attach` starts it once the game is up and pushes
 * `playback.state` / `playback.position` to the renderer, `send` forwards a console line. The session
 * ends - with `playback.state ended` as the very last event - when the game exits or fails, or when the
 * launcher lets go of the game's pipes (quit).
 */

const log = scopedLogger('playback')

export const NO_SESSION = 'replays.playback.error.noSession'

/** The slice of `LaunchService` the control listens to - a fake stands in for it in tests. */
export interface PlaybackControlLaunch {
  onStateChange(listener: (state: LaunchState) => void): () => void
  onBeforePlaybackRelease(listener: () => void): () => void
}

export interface PlaybackControlDeps {
  emit: (type: string, payload: unknown) => void
  launch: PlaybackControlLaunch
  platform?: string
  makeWindows?: (options: WindowsChannelOptions) => PlaybackChannel
  makeLinux?: (deps: { io: EngineIo; log: ReturnType<typeof scopedLogger> }) => PlaybackChannel
}

export interface PlaybackPrepared {
  argsBeforeDemo: string[]
  argsAfterDemo: string[]
}

export interface PlaybackControl {
  /** Picks the channel; on Windows also starts it (writes its files) so they exist before the game is spawned. */
  prepare(input: { gameDirPath: string; durationMs: number | null }): Promise<PlaybackPrepared>
  /** The game is up: start the channel on Linux (it needs the engine's pipes); Windows started in `prepare`. */
  attach(io?: EngineIo): Promise<void>
  /** Drops a prepared channel whose launch never started - no events. */
  cancel(): Promise<void>
  send(line: string): Outcome<void>
}

interface Prepared {
  channel: PlaybackChannel
  durationMs: number | null
  bindIo: (io: EngineIo | undefined) => void
  /** The channel was started in `prepare` (Windows): `attach` must not start it again. */
  startedEarly: boolean
}

interface Session extends Prepared {
  timer: ReturnType<typeof setInterval> | null
  finished: boolean
  offFinished: () => void
  ending: boolean
}

export function createPlaybackControl(deps: PlaybackControlDeps): PlaybackControl {
  const { emit, launch } = deps
  const makeWindows = deps.makeWindows ?? createWindowsChannel
  const makeLinux = deps.makeLinux ?? createLinuxChannel
  let prepared: Prepared | null = null
  let session: Session | null = null

  const pushState = (state: ReplaysPlaybackState['state']): void => {
    emit(REPLAYS_EVENTS.playbackState, { state } satisfies ReplaysPlaybackState)
  }

  const stopTimer = (s: Session): void => {
    if (s.timer !== null) clearInterval(s.timer)
    s.timer = null
  }

  /** Closes the channel, then - and only then - announces the end. Idempotent per session. */
  const end = async (s: Session): Promise<void> => {
    if (s.ending) return
    s.ending = true
    stopTimer(s)
    s.offFinished()
    if (session === s) session = null
    try {
      await s.channel.close()
    } catch (error) {
      log.warn(`playback channel close failed: ${String(error)}`)
    }
    pushState('ended')
  }

  // Subscribed on first use, so a module that never plays a demo never touches the launch service.
  let subscribed = false
  const subscribe = (): void => {
    if (subscribed) return
    subscribed = true
    launch.onStateChange((state) => {
      if (state.phase !== 'exited' && state.phase !== 'failed') return
      if (session) void end(session)
    })
    // Launcher quit: the Linux channel's last sys_console 0 write must land while stdin is still
    // open, so the close is started synchronously, before the session's pipes end.
    launch.onBeforePlaybackRelease(() => {
      if (session) void end(session)
    })
  }

  return {
    async prepare({ gameDirPath, durationMs }) {
      subscribe()
      if (prepared) void prepared.channel.close().catch(() => undefined)
      let channel: PlaybackChannel
      let bound: EngineIo | undefined
      const bindIo: Prepared['bindIo'] = (io) => {
        bound = io
      }
      const platform = deps.platform ?? process.platform
      if (platform === 'win32') {
        channel = makeWindows({ gameDirPath, log })
      } else {
        const lateIo: EngineIo = {
          writeLine: (line) => bound?.writeLine(line),
          onLine: (cb) => bound?.onLine(cb) ?? (() => undefined),
        }
        channel = makeLinux({ io: lateIo, log })
      }
      const startedEarly = platform === 'win32'
      prepared = { channel, durationMs, bindIo, startedEarly }
      if (startedEarly) await channel.start()
      return { argsBeforeDemo: channel.argsBeforeDemo, argsAfterDemo: channel.argsAfterDemo }
    },

    async attach(io) {
      const p = prepared
      if (!p) return
      prepared = null
      p.bindIo(io)
      const s: Session = { ...p, timer: null, finished: false, offFinished: () => undefined, ending: false }
      session = s
      try {
        if (!p.startedEarly) await p.channel.start()
      } catch (error) {
        log.warn(`playback channel start failed: ${String(error)}`)
        if (session === s) await end(s)
        return
      }
      if (s.ending) return
      s.offFinished = p.channel.onFinished(() => {
        s.finished = true
        stopTimer(s)
        pushState('finished')
      })
      pushState('playing')
      s.timer = setInterval(() => {
        const { positionMs } = s.channel.latest()
        emit(REPLAYS_EVENTS.playbackPosition, {
          positionMs,
          durationMs: s.durationMs,
        } satisfies ReplaysPlaybackPosition)
      }, POSITION_PUSH_MS)
    },

    async cancel() {
      const p = prepared
      prepared = null
      if (!p) return
      try {
        await p.channel.close()
      } catch (error) {
        log.warn(`playback channel close failed: ${String(error)}`)
      }
    },

    send(line) {
      if (!session || session.finished) return fail(NO_SESSION)
      return session.channel.send(line)
    },
  }
}
