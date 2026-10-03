import {
  REPLAYS_EVENTS,
  type DemoFormat,
  type ReplaysPlaybackDisplay,
  type ReplaysPlaybackPosition,
  type ReplaysPlaybackState,
} from '@shared/modules/replays'
import type { CinemaAvailability } from '@shared/replays/cinema'
import { fail, type LaunchState, type Outcome } from '@shared/types'
import { scopedLogger } from '../../lib/logger'
import { createLinuxChannel } from './playback-channel/linux-channel'
import { POSITION_PUSH_MS } from './playback-channel/protocol'
import type { EngineIo, PlaybackChannel } from './playback-channel/types'
import {
  createWindowsChannel,
  type WindowsChannelOptions,
} from './playback-channel/windows-channel'

/**
 * Story 164: the one owner of the running demo's playback channel. `prepare` picks the platform's
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
  makeLinux?: (deps: {
    io: EngineIo
    log: ReturnType<typeof scopedLogger>
    gameDirPath: string
  }) => PlaybackChannel
  /** Story 187: whether the cinema overlay is open and whether cinema could run now - read each
   * time a display event is built. Defaults to no cinema (tests that do not care). */
  cinema?: () => { open: boolean; availability: CinemaAvailability }
  /** Why the staged game is not kept on top, read each time a display event is built (default none). */
  stageNotice?: () => { key: string } | null
}

export interface PlaybackPrepared {
  argsBeforeDemo: string[]
  argsAfterDemo: string[]
}

export interface PlaybackControl {
  /** Picks the channel; on Windows also starts it (writes its files) so they exist before the game is spawned. */
  prepare(input: {
    gameDirPath: string
    durationMs: number | null
    format: DemoFormat
  }): Promise<PlaybackPrepared>
  /** The game is up: start the channel on Linux (it needs the engine's pipes); Windows started in `prepare`. */
  attach(io?: EngineIo): Promise<void>
  /** Drops a prepared channel whose launch never started - no events. */
  cancel(): Promise<void>
  send(line: string): Outcome<void>
  /** Story 187: every line sent so far has run in the game (see `PlaybackChannel.settled`). */
  settled(): Promise<void>
  /** Format of the demo in the current session, or null with no live session (story 165). */
  currentFormat(): DemoFormat | null
  /** Story 172: switch the running demo to fullscreen; no session is `NO_SESSION`. */
  enterFullscreen(): Outcome<void>
  /** Story 172: the running demo went fullscreen (true) or came back to the stage (false). */
  onDisplayChange(cb: (fullscreen: boolean) => void): () => void
  /** Story 187: every `playback.state` push (`playing`, `finished`, `ended`), after it went out. */
  onStateChange(cb: (state: ReplaysPlaybackState['state']) => void): () => void
  /** Story 187: the display as a `playback.display` push would carry it now. */
  display(): ReplaysPlaybackDisplay
  /** Story 187: pushes `playback.display` now (cinema entered/left, availability changed). */
  emitDisplay(): void
  /** Story 187: a `speed` timeline action reached the game - main holds the speed. */
  setSpeed(speed: number): void
  /**
   * Module shutdown: drops the launch subscriptions and closes whatever channel is still open. At
   * quit the playback release has usually ended the session already; that close is awaited, never
   * repeated.
   */
  dispose(): Promise<void>
}

interface Prepared {
  channel: PlaybackChannel
  durationMs: number | null
  format: DemoFormat
  bindIo: (io: EngineIo | undefined) => void
  /** The channel was started in `prepare` (Windows): `attach` must not start it again. */
  startedEarly: boolean
}

interface Session extends Prepared {
  timer: ReturnType<typeof setInterval> | null
  finished: boolean
  offFinished: () => void
  offDisplay: () => void
  fullscreen: boolean
  ending: boolean
  speed: number
}

export function createPlaybackControl(deps: PlaybackControlDeps): PlaybackControl {
  const { emit, launch } = deps
  const makeWindows = deps.makeWindows ?? createWindowsChannel
  const makeLinux = deps.makeLinux ?? createLinuxChannel
  let prepared: Prepared | null = null
  let session: Session | null = null
  const displayListeners = new Set<(fullscreen: boolean) => void>()
  const stateListeners = new Set<(state: ReplaysPlaybackState['state']) => void>()
  const cinema =
    deps.cinema ??
    (() => ({ open: false, availability: { available: true } as CinemaAvailability }))

  const pushState = (state: ReplaysPlaybackState['state']): void => {
    emit(REPLAYS_EVENTS.playbackState, { state } satisfies ReplaysPlaybackState)
    for (const cb of [...stateListeners]) cb(state)
  }

  const display = (): ReplaysPlaybackDisplay => {
    const live = session && !session.ending ? session : null
    const fullscreen = live?.fullscreen ?? false
    const c = cinema()
    return {
      fullscreen,
      cinema: !fullscreen && c.open,
      speed: live?.speed ?? 1,
      cinemaAvailability: c.availability,
      stageNotice: deps.stageNotice?.() ?? null,
    }
  }

  const emitDisplay = (): void => {
    emit(REPLAYS_EVENTS.playbackDisplay, display() satisfies ReplaysPlaybackDisplay)
  }

  const startTimer = (s: Session): void => {
    s.timer = setInterval(() => {
      const { positionMs, paused } = s.channel.latest()
      emit(REPLAYS_EVENTS.playbackPosition, {
        positionMs,
        durationMs: s.durationMs,
        paused,
      } satisfies ReplaysPlaybackPosition)
    }, POSITION_PUSH_MS)
  }

  const stopTimer = (s: Session): void => {
    if (s.timer !== null) clearInterval(s.timer)
    s.timer = null
  }

  // Ends whose channel close is still running, so `dispose` can wait for them instead of closing again.
  const endings = new Set<Promise<void>>()

  /** Closes the channel, then - and only then - announces the end. Idempotent per session. */
  const end = (s: Session): Promise<void> => {
    if (s.ending) return Promise.resolve()
    const done = closeAndAnnounce(s).finally(() => endings.delete(done))
    endings.add(done)
    return done
  }

  // Everything up to the first `await` runs synchronously, so the close starts within `end`'s caller.
  const closeAndAnnounce = async (s: Session): Promise<void> => {
    s.ending = true
    stopTimer(s)
    s.offFinished()
    s.offDisplay()
    if (session === s) session = null
    try {
      await s.channel.close()
    } catch (error) {
      log.warn(`playback channel close failed: ${String(error)}`)
    }
    pushState('ended')
  }

  // Subscribed on first use, so a module that never plays a demo never touches the launch service.
  // Stays true after `dispose`, so a late `prepare` cannot subscribe again.
  let subscribed = false
  let unsubscribers: Array<() => void> = []
  const subscribe = (): void => {
    if (subscribed) return
    subscribed = true
    const offState = launch.onStateChange((state) => {
      if (state.phase !== 'exited' && state.phase !== 'failed') return
      if (session) void end(session)
    })
    // Launcher quit: the Linux channel's last sys_console 0 write must land while stdin is still
    // open, so the close is started synchronously, before the session's pipes end.
    const offRelease = launch.onBeforePlaybackRelease(() => {
      if (session) void end(session)
    })
    unsubscribers = [offState, offRelease]
  }

  return {
    async prepare({ gameDirPath, durationMs, format }) {
      subscribe()
      if (prepared) void prepared.channel.close().catch(() => undefined)
      let channel: PlaybackChannel
      let bound: EngineIo | undefined
      const bindIo: Prepared['bindIo'] = (io) => {
        bound = io
      }
      // platform-read: injectable default, tests pass their own
      const platform = deps.platform ?? process.platform
      if (platform === 'win32') {
        channel = makeWindows({ gameDirPath, log })
      } else {
        const lateIo: EngineIo = {
          writeLine: (line) => bound?.writeLine(line),
          onLine: (cb) => bound?.onLine(cb) ?? (() => undefined),
        }
        channel = makeLinux({ io: lateIo, log, gameDirPath })
      }
      const startedEarly = platform === 'win32'
      prepared = { channel, durationMs, format, bindIo, startedEarly }
      if (startedEarly) await channel.start()
      return { argsBeforeDemo: channel.argsBeforeDemo, argsAfterDemo: channel.argsAfterDemo }
    },

    async attach(io) {
      const p = prepared
      if (!p) return
      prepared = null
      p.bindIo(io)
      const s: Session = {
        ...p,
        timer: null,
        finished: false,
        offFinished: () => undefined,
        offDisplay: () => undefined,
        fullscreen: false,
        ending: false,
        speed: 1,
      }
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
      s.offDisplay = p.channel.onDisplayChange((display) => {
        const fullscreen = display === 'fullscreen'
        if (s.ending || s.fullscreen === fullscreen) return
        s.fullscreen = fullscreen
        emitDisplay()
        if (fullscreen) stopTimer(s)
        else if (s.timer === null && !s.finished) startTimer(s)
        for (const cb of [...displayListeners]) cb(fullscreen)
      })
      pushState('playing')
      startTimer(s)
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

    settled() {
      return session ? session.channel.settled() : Promise.resolve()
    },

    enterFullscreen() {
      if (!session || session.finished) return fail(NO_SESSION)
      return session.channel.enterFullscreen()
    },

    onDisplayChange(cb) {
      displayListeners.add(cb)
      return () => displayListeners.delete(cb)
    },

    onStateChange(cb) {
      stateListeners.add(cb)
      return () => stateListeners.delete(cb)
    },

    display,
    emitDisplay,

    setSpeed(speed) {
      if (!session || session.ending || session.speed === speed) return
      session.speed = speed
      emitDisplay()
    },

    currentFormat() {
      return session && !session.finished ? session.format : null
    },

    async dispose() {
      subscribed = true
      for (const off of unsubscribers) off()
      unsubscribers = []
      const p = prepared
      prepared = null
      // `end` cleared `session` synchronously when the release started it; only that close is awaited.
      const pending = [...endings]
      if (session) pending.push(end(session))
      if (p) {
        pending.push(
          p.channel.close().catch((error: unknown) => {
            log.warn(`playback channel close failed: ${String(error)}`)
          }),
        )
      }
      await Promise.all(pending)
    },
  }
}
