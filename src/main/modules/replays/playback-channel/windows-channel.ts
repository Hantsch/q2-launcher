import {
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fail, ok, type Outcome } from '@shared/types'
import type { Logger } from '../../../lib/logger'
import {
  ACK_TIMEOUT_MS,
  BACK_TO_WINDOW_CFG,
  buildBackToWindowCfg,
  buildControlFile,
  buildEnterFullscreenLines,
  buildLoopCfg,
  buildStopFile,
  checkLine,
  commandCfgName,
  CONTROL_CFG_NAME,
  type EngineLine,
  LOG_FILE_RELATIVE,
  LOG_POLL_MS,
  LOOP_CFG_NAME,
  parseEngineLine,
  QUEUE_CAP,
  toCfgText,
  windowsLaunchArgs,
} from './protocol'
import type { PlaybackChannel } from './types'

/**
 * Story 164 D2: the Windows playback channel. Q2PRO on Windows has no usable stdin, so the launcher
 * talks to it through files in the game dir: the engine re-executes `q2l_ctl.cfg` every loop tick
 * (the guard `if $q2l_seq != N` makes each command run once), and its answers (`POS`, `ACK`,
 * `Demo finished`) arrive in the dedicated logfile, which this channel tails.
 *
 * Story 166 D3: command N's console line lives alone in its own `q2l_cmd_N.cfg`, which the guard
 * execs, so a free line never sits inside the guard's quoted string. That file is always on disk
 * before the control file that names it, and is removed once its ACK is seen (or on close).
 *
 * Every file operation is synchronous so a poll tick can never interleave with another tick, a send
 * or close; nothing a timer runs can reject.
 *
 * Story 172 D4: the fullscreen switch is one internal guarded command whose cfg runs
 * `vid_fullscreen 1` (unless the user already switched) and redefines `q2l_loop`, so the engine's
 * loop ends on its next call. `stage -> entering -> fullscreen`: once fullscreen, the control file
 * is rewritten idle - `exec q2l_loop.cfg` (Back to window) resets `q2l_seq` to 0, which would make
 * the switch's guard fire again - and only a `POS … FS 0` read after the switch's last pre-stop
 * line brings the channel back to the stage.
 */

const FILE_PREFIX = 'q2l_'
const READ_CHUNK_BYTES = 64 * 1024
const CLOSE_RETRY_MS = 200

export interface WindowsChannelOptions {
  gameDirPath: string
  log: Logger
}

type Display = 'stage' | 'fullscreen'

interface QueuedCommand {
  /** The command cfg's lines: one checked console line, or the internal fullscreen switch. */
  lines: string[]
  fullscreenSwitch: boolean
}

export function createWindowsChannel({ gameDirPath, log }: WindowsChannelOptions): PlaybackChannel {
  const loopCfgPath = join(gameDirPath, LOOP_CFG_NAME)
  const backCfgPath = join(gameDirPath, BACK_TO_WINDOW_CFG)
  const controlPath = join(gameDirPath, CONTROL_CFG_NAME)
  const logPath = join(gameDirPath, ...LOG_FILE_RELATIVE.split('/'))
  const { argsBeforeDemo, argsAfterDemo } = windowsLaunchArgs()
  const tail = createLogTail(logPath)
  const listeners = new Set<() => void>()
  const displayListeners = new Set<(display: Display) => void>()
  /** Commands waiting for their turn; the one being executed is `inFlight`, not in here. */
  const queue: QueuedCommand[] = []

  let started = false
  let closed = false
  let finished = false
  let positionMs: number | null = null
  let nextSeq = 1
  let inFlight: { seq: number; sentAt: number; fullscreenSwitch: boolean } | null = null
  /** `entering`: the switch is queued or in flight; the demo still shows on the stage. */
  let mode: 'stage' | 'entering' | 'fullscreen' = 'stage'
  /** Whether the pending switch sets `vid_fullscreen 1` itself (false: the user already switched). */
  let enteringSwitchesMode = false
  /**
   * Fullscreen was reached without the switch's ACK (timeout, or the user's own switch): its seq,
   * until that ACK shows up. Lines logged before it are pre-stop, however late they flush.
   */
  let unackedSwitchSeq: number | null = null
  /**
   * Content not yet on disk: a rename can lose a race with the engine's own read. `command` is the
   * command file the control text execs; it is written first, and the control never without it.
   */
  let pending: { command: { path: string; text: string } | null; control: string } | null = null
  /** Command files this session wrote and has not removed yet. */
  const commandPaths = new Set<string>()
  let controlWriteFailing = false
  let tempCounter = 0
  let timer: ReturnType<typeof setInterval> | null = null

  /** Temp file in the same dir, then rename over the target: the engine never execs a half-written cfg. */
  function writeAtomic(destPath: string, text: string): void {
    tempCounter += 1
    const tempPath = `${destPath}.${process.pid}.${tempCounter}.tmp`
    writeFileSync(tempPath, text, 'utf8')
    try {
      renameSync(tempPath, destPath)
    } catch (err) {
      removeFile(tempPath)
      throw err
    }
  }

  function writeControl(control: string, command: { path: string; text: string } | null = null): void {
    pending = { command, control }
    flushControl()
  }

  function flushControl(): void {
    if (!pending) return
    try {
      if (pending.command) {
        commandPaths.add(pending.command.path)
        writeAtomic(pending.command.path, pending.command.text)
        // On disk now: a retry after a failed control write must not rewrite it.
        pending.command = null
      }
      writeAtomic(controlPath, pending.control)
      pending = null
      controlWriteFailing = false
    } catch (err) {
      if (!controlWriteFailing) log.warn(`control file write failed, retrying on the next poll: ${describe(err)}`)
      controlWriteFailing = true
    }
  }

  /** Hand the next queued line to the engine with a fresh seq, or go idle when there is none. */
  function dispatchNext(): void {
    const next = queue.shift()
    if (next === undefined) {
      inFlight = null
      writeControl(toCfgText(buildControlFile(null)))
      return
    }
    const seq = nextSeq
    nextSeq += 1
    inFlight = { seq, sentAt: Date.now(), fullscreenSwitch: next.fullscreenSwitch }
    writeControl(toCfgText(buildControlFile(seq)), {
      path: join(gameDirPath, commandCfgName(seq)),
      text: toCfgText(next.lines),
    })
  }

  function emitDisplay(display: Display): void {
    for (const cb of [...displayListeners]) {
      try {
        cb(display)
      } catch (err) {
        log.warn(`onDisplayChange listener threw: ${describe(err)}`)
      }
    }
  }

  /** Queue the internal switch; commands already queued still run first, later ones are dropped. */
  function beginEntering(switchMode: boolean): void {
    mode = 'entering'
    enteringSwitchesMode = switchMode
    queue.push({ lines: buildEnterFullscreenLines({ switchMode }), fullscreenSwitch: true })
    if (started && !inFlight) dispatchNext()
  }

  /** `ackedSeq`: the switch's seq when its ACK is what got us here, else null. */
  function reachFullscreen(ackedSeq: number | null): void {
    const switchSeq = inFlight?.fullscreenSwitch ? inFlight.seq : null
    const dropped = queue.filter((c) => !c.fullscreenSwitch).length + (inFlight && !inFlight.fullscreenSwitch ? 1 : 0)
    if (dropped > 0) log.warn(`demo went fullscreen: dropping ${dropped} unsent command(s)`)
    mode = 'fullscreen'
    queue.length = 0
    inFlight = null
    unackedSwitchSeq = ackedSeq === null ? switchSeq : null
    // Idle, so the loop's `set q2l_seq 0` on Back to window finds no guard to re-fire.
    writeControl(toCfgText(buildControlFile(null)))
    if (ackedSeq !== null) removeCommandFile(ackedSeq)
    emitDisplay('fullscreen')
  }

  /** After its ACK: `$q2l_seq` already equals seq, so the guard can never exec this file again. */
  function removeCommandFile(seq: number): void {
    const path = join(gameDirPath, commandCfgName(seq))
    const failure = removeFile(path)
    if (failure) {
      log.warn(`could not remove ${commandCfgName(seq)}, retrying on close: ${failure}`)
      return
    }
    commandPaths.delete(path)
  }

  function finish(): void {
    finished = true
    queue.length = 0
    inFlight = null
    writeControl(toCfgText(buildStopFile()))
    for (const cb of [...listeners]) {
      try {
        cb()
      } catch (err) {
        log.warn(`onFinished listener threw: ${describe(err)}`)
      }
    }
  }

  /** `batch[index]` is the line to handle; the rest of the batch tells a late-flushed line apart. */
  function handleLine(batch: EngineLine[], index: number): void {
    const parsed = batch[index]!
    if (parsed.kind === 'pos') {
      if (mode === 'fullscreen') {
        if (finished || parsed.fullscreen !== false) return
        // The switch's ACK still to come in this batch: this FS 0 was logged before the loop stopped.
        const switchSeq = unackedSwitchSeq
        if (switchSeq !== null && batch.some((l, i) => i > index && l.kind === 'ack' && l.seq === switchSeq)) return
        mode = 'stage'
        unackedSwitchSeq = null
        positionMs = parsed.positionMs
        emitDisplay('stage')
        return
      }
      positionMs = parsed.positionMs
      if (finished || parsed.fullscreen !== true) return
      if (mode === 'stage') beginEntering(false)
      // An FS 1 while our own switch is pending means it ran; when the user switched, FS 1 is old news.
      else if (enteringSwitchesMode) reachFullscreen(null)
    } else if (parsed.kind === 'ack') {
      if (finished) return
      if (mode === 'fullscreen') {
        if (parsed.seq === unackedSwitchSeq) {
          unackedSwitchSeq = null
          removeCommandFile(parsed.seq)
        }
        return
      }
      // Only the ACK of the command in flight counts: a late ACK of a timed-out seq must not
      // acknowledge its successor.
      if (!inFlight || parsed.seq !== inFlight.seq) return
      const acked = inFlight.seq
      log.debug(`seq ${acked} acknowledged after ${Date.now() - inFlight.sentAt} ms`)
      if (inFlight.fullscreenSwitch) {
        reachFullscreen(acked)
        return
      }
      dispatchNext()
      removeCommandFile(acked)
    } else if (parsed.kind === 'finished' && !finished) {
      finish()
    }
  }

  function tick(): void {
    try {
      flushControl()
      const batch = tail.readLines().map(parseEngineLine)
      for (let i = 0; i < batch.length; i++) handleLine(batch, i)
      if (inFlight && Date.now() - inFlight.sentAt >= ACK_TIMEOUT_MS) {
        if (inFlight.fullscreenSwitch) {
          log.warn(`no ACK for the fullscreen switch (seq ${inFlight.seq}) within ${ACK_TIMEOUT_MS} ms, assuming fullscreen`)
          reachFullscreen(null)
        } else {
          log.warn(`no ACK for seq ${inFlight.seq} within ${ACK_TIMEOUT_MS} ms, moving on`)
          dispatchNext()
        }
      }
    } catch (err) {
      log.warn(`playback channel poll failed: ${describe(err)}`)
    }
  }

  function removeStale(): void {
    let names: string[] = []
    try {
      names = readdirSync(gameDirPath)
    } catch (err) {
      log.warn(`could not list ${gameDirPath} for stale channel files: ${describe(err)}`)
    }
    for (const name of names) {
      if (!name.startsWith(FILE_PREFIX)) continue
      const failure = removeFile(join(gameDirPath, name))
      if (failure) log.warn(`could not remove stale ${name}: ${failure}`)
    }
    const failure = removeFile(logPath)
    // Not fatal: the tail starts at the log's current end, so its old bytes are never parsed.
    if (failure) log.warn(`could not remove stale ${LOG_FILE_RELATIVE}: ${failure}`)
  }

  return {
    argsBeforeDemo,
    argsAfterDemo,

    async start() {
      if (started || closed) return
      removeStale()
      writeAtomic(backCfgPath, toCfgText(buildBackToWindowCfg('win32')))
      writeAtomic(loopCfgPath, toCfgText(buildLoopCfg()))
      writeAtomic(controlPath, toCfgText(buildControlFile(null)))
      tail.startAtEnd()
      started = true
      timer = setInterval(tick, LOG_POLL_MS)
      if (queue.length > 0 && !inFlight) dispatchNext()
    },

    send(line: string): Outcome<void> {
      const valid = checkLine(line)
      if (!valid.ok) return valid
      if (finished || closed) return fail('replays.playback.error.noSession')
      if (mode === 'fullscreen') return fail('replays.playback.error.fullscreen')
      // The cap counts every unacknowledged command, the one in flight included.
      if (queue.length + (inFlight ? 1 : 0) >= QUEUE_CAP) return fail('replays.playback.error.busy')
      queue.push({ lines: [line], fullscreenSwitch: false })
      if (started && !inFlight) dispatchNext()
      return ok(undefined)
    },

    latest() {
      return { positionMs, finished }
    },

    enterFullscreen(): Outcome<void> {
      if (finished || closed) return fail('replays.playback.error.noSession')
      if (mode !== 'stage') return fail('replays.playback.error.fullscreen')
      beginEntering(true)
      return ok(undefined)
    },
    display() {
      return mode === 'fullscreen' ? 'fullscreen' : 'stage'
    },
    onDisplayChange(cb) {
      displayListeners.add(cb)
      return () => {
        displayListeners.delete(cb)
      }
    },
    onFinished(cb) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },

    async close() {
      if (closed) return
      closed = true
      if (timer) clearInterval(timer)
      timer = null
      tail.close()
      listeners.clear()
      displayListeners.clear()
      queue.length = 0
      inFlight = null
      pending = null
      if (!started) return
      // The game may still hold a file for a moment after it exits (Windows locks): retry once.
      // Command files still here are the ones never acknowledged (timed out, or cut off by the end).
      const left = [controlPath, loopCfgPath, backCfgPath, logPath, ...commandPaths].filter(
        (p) => removeFile(p) !== null,
      )
      commandPaths.clear()
      if (left.length === 0) return
      await new Promise((resolve) => setTimeout(resolve, CLOSE_RETRY_MS))
      for (const p of left) {
        const failure = removeFile(p)
        if (failure) log.warn(`could not remove ${p} on close: ${failure}`)
      }
    },
  }
}

/** Reads what the engine appended to its logfile since the last call, whole lines only. */
function createLogTail(path: string): {
  startAtEnd(): void
  readLines(): string[]
  close(): void
} {
  const buffer = Buffer.alloc(READ_CHUNK_BYTES)
  let fd: number | null = null
  let ino = 0
  let position = 0
  let decoder = new StringDecoder('utf8')
  // A read can land mid-line while the engine is still writing it; hold the unterminated tail back.
  let partial = ''

  function reset(): void {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // already gone - nothing to release
      }
    }
    fd = null
    position = 0
    partial = ''
    decoder = new StringDecoder('utf8')
  }

  function open(fromEnd: boolean): boolean {
    try {
      fd = openSync(path, 'r')
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return false
      throw err
    }
    const stats = fstatSync(fd)
    ino = stats.ino
    position = fromEnd ? stats.size : 0
    return true
  }

  /** Nothing new: has the file been truncated, replaced or deleted under our fd? */
  function checkReplaced(): void {
    let stats
    try {
      stats = statSync(path)
    } catch (err) {
      if (errorCode(err) === 'ENOENT') {
        reset()
        return
      }
      throw err
    }
    if (stats.ino !== ino || stats.size < position) {
      reset()
      open(false)
    }
  }

  return {
    startAtEnd() {
      reset()
      // A log that exists now (its deletion failed) holds earlier runs' lines: skip them.
      open(true)
    },
    readLines() {
      // A log that appears after start is entirely this session's.
      if (fd === null && !open(false)) return []
      let text = ''
      for (;;) {
        const read = readSync(fd as number, buffer, 0, buffer.length, position)
        if (read === 0) break
        position += read
        text += decoder.write(buffer.subarray(0, read))
      }
      if (text.length === 0) {
        checkReplaced()
        return []
      }
      const lines = (partial + text).split(/\r?\n/)
      partial = lines.pop() ?? ''
      return lines.filter((l) => l.length > 0)
    },
    close() {
      reset()
    },
  }
}

/** Deletes a file; null when it is gone (or never existed), otherwise the failure. */
function removeFile(path: string): string | null {
  try {
    unlinkSync(path)
    return null
  } catch (err) {
    return errorCode(err) === 'ENOENT' ? null : describe(err)
  }
}

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
