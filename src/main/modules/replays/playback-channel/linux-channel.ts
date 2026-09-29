import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail, ok, type Outcome } from '@shared/types'
import type { Logger } from '../../../lib/logger'
import {
  BACK_TO_WINDOW_CFG,
  buildBackToWindowCfg,
  checkLine,
  LINUX_POLL_MS,
  linuxLaunchArgs,
  parseEngineLine,
  POLL_LINE,
  toCfgText,
} from './protocol'
import type { EngineIo, PlaybackChannel } from './types'

/**
 * Story 164 D3: the Linux playback channel - console over the game's own stdin/stdout pipes
 * (`+set sys_console 1`). A 100 ms timer asks the engine for its position and fullscreen flag.
 *
 * Story 172 D5: the fullscreen switch is a plain `vid_fullscreen 1` over stdin; the display follows
 * the `FS` flag of every `pos` line both ways. The only file is `q2l_back.cfg` (the Back to window
 * bind's target), written at `start` and removed at `close`.
 */
export function createLinuxChannel(deps: {
  io: EngineIo
  log: Pick<Logger, 'debug' | 'warn'>
  gameDirPath: string
}): PlaybackChannel {
  const { io, log } = deps
  const backCfgPath = join(deps.gameDirPath, BACK_TO_WINDOW_CFG)
  let display: 'stage' | 'fullscreen' = 'stage'
  const displayCbs = new Set<(d: 'stage' | 'fullscreen') => void>()
  const args = linuxLaunchArgs()
  let unsubscribe: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let positionMs: number | null = null
  let finished = false
  let closed = false
  const finishedCbs = new Set<() => void>()

  function stopPoll(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  function safeWrite(line: string): void {
    try {
      io.writeLine(line)
    } catch (e) {
      log.debug('playback: write failed', e)
    }
  }

  function handle(raw: string): void {
    const parsed = parseEngineLine(raw)
    if (parsed.kind === 'pos') {
      positionMs = parsed.positionMs
      if (!finished && parsed.fullscreen !== null) {
        const next = parsed.fullscreen ? 'fullscreen' : 'stage'
        if (next !== display) {
          display = next
          for (const cb of [...displayCbs]) {
            try {
              cb(next)
            } catch (e) {
              log.warn('playback: onDisplayChange listener threw', e)
            }
          }
        }
      }
    } else if (parsed.kind === 'finished' && !finished) {
      finished = true
      stopPoll()
      for (const cb of [...finishedCbs]) cb()
    }
  }

  return {
    argsBeforeDemo: args.argsBeforeDemo,
    argsAfterDemo: args.argsAfterDemo,
    async start() {
      if (unsubscribe || closed) return
      try {
        writeFileSync(backCfgPath, toCfgText(buildBackToWindowCfg('linux')), 'utf8')
      } catch (e) {
        log.warn('playback: could not write q2l_back.cfg', e)
      }
      unsubscribe = io.onLine(handle)
      timer = setInterval(() => safeWrite(POLL_LINE), LINUX_POLL_MS)
    },
    enterFullscreen(): Outcome<void> {
      if (finished || closed) return fail('replays.playback.error.noSession')
      if (display === 'fullscreen') return fail('replays.playback.error.fullscreen')
      safeWrite('vid_fullscreen 1')
      return ok(undefined)
    },
    display() {
      return display
    },
    onDisplayChange(cb) {
      displayCbs.add(cb)
      return () => displayCbs.delete(cb)
    },
    send(line): Outcome<void> {
      if (finished || closed) return fail('replays.playback.error.noSession')
      if (display === 'fullscreen') return fail('replays.playback.error.fullscreen')
      const checked = checkLine(line)
      if (!checked.ok) return checked
      safeWrite(line)
      return ok(undefined)
    },
    latest: () => ({ positionMs, finished }),
    onFinished(cb) {
      finishedCbs.add(cb)
      return () => finishedCbs.delete(cb)
    },
    async close() {
      if (closed) return
      closed = true
      stopPoll()
      unsubscribe?.()
      unsubscribe = null
      displayCbs.clear()
      try {
        unlinkSync(backCfgPath)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('playback: could not remove q2l_back.cfg', e)
      }
      // SIGPIPE: when the launcher quits, the game's stdout is closed while the engine keeps running.
      // An engine that does not ignore SIGPIPE could die on its next print. While the session is still
      // ask it (best effort) to stop using the console pipes - also after `Demo finished`, when the game
      // stays alive; a write to a dead pipe is harmless.
      safeWrite('set sys_console 0')
    },
  }
}
