import { fail, ok, type Outcome } from '@shared/types'
import type { Logger } from '../../../lib/logger'
import { checkLine, LINUX_POLL_MS, linuxLaunchArgs, parseEngineLine } from './protocol'
import type { EngineIo, PlaybackChannel } from './types'

/**
 * Story 164 D3: the Linux playback channel - console over the game's own stdin/stdout pipes
 * (`+set sys_console 1`). No files are created; a 100 ms timer asks the engine for its position.
 */
export function createLinuxChannel(deps: { io: EngineIo; log: Pick<Logger, 'debug' | 'warn'> }): PlaybackChannel {
  const { io, log } = deps
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
    if (parsed.kind === 'pos') positionMs = parsed.positionMs
    else if (parsed.kind === 'finished' && !finished) {
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
      unsubscribe = io.onLine(handle)
      timer = setInterval(() => safeWrite('echo POS $cl_demopos'), LINUX_POLL_MS)
    },
    send(line): Outcome<void> {
      if (finished || closed) return fail('replays.playback.error.noSession')
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
      // SIGPIPE: when the launcher quits, the game's stdout is closed while the engine keeps running.
      // An engine that does not ignore SIGPIPE could die on its next print. While the session is still
      // ask it (best effort) to stop using the console pipes - also after `Demo finished`, when the game
      // stays alive; a write to a dead pipe is harmless.
      safeWrite('set sys_console 0')
    },
  }
}
