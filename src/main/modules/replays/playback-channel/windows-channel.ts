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
import { createListenerSet } from '../../../lib/listeners'
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
 * (the guard `if $q2l_seq < N` makes each command run once), and its answers (`POS`, `ACK`,
 * `Demo finished`) arrive in the dedicated logfile, which this channel tails.
 *
 * Story 185 D2: a command goes to the game at once, never behind an earlier command's ACK. Every
 * unacknowledged seq has its own guard in the control file; the guards are monotone, so they run in
 * seq order, each exactly once, and an ACK for N retires every seq up to N. Each seq times out on its
 * own and is dropped from the file without holding up the ones after it.
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

interface InFlightCommand {
  sentAt: number
  fullscreenSwitch: boolean
}

interface CommandFile {
  path: string
  text: string
}

export function createWindowsChannel({ gameDirPath, log }: WindowsChannelOptions): PlaybackChannel {
  const loopCfgPath = join(gameDirPath, LOOP_CFG_NAME)
  const backCfgPath = join(gameDirPath, BACK_TO_WINDOW_CFG)
  const controlPath = join(gameDirPath, CONTROL_CFG_NAME)
  const logPath = join(gameDirPath, ...LOG_FILE_RELATIVE.split('/'))
  const { argsBeforeDemo, argsAfterDemo } = windowsLaunchArgs()
  const tail = createLogTail(logPath)
  const listeners = createListenerSet(log, 'playback onFinished')
  const displayListeners = createListenerSet<Display>(log, 'playback onDisplayChange')
  /**
   * Commands not handed to the game yet: before `start`, and behind a pending fullscreen switch
   * (dropped once fullscreen). Everything else goes straight to `inFlight`.
   */
  const queue: QueuedCommand[] = []
  /** Seqs in the control file, not yet acknowledged or timed out; ascending, as seqs only grow. */
  const inFlight = new Map<number, InFlightCommand>()
  /** `settled()` callers waiting for the queue and the control file to run empty. */
  const settledWaiters: Array<() => void> = []

  let started = false
  let closed = false
  let finished = false
  let positionMs: number | null = null
  let paused: boolean | null = null
  let nextSeq = 1
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
   * Content not yet on disk: a rename can lose a race with the engine's own read. `pendingCommands`
   * are command files the control text execs; they are written first, in order, and the control
   * never while one of them is still missing.
   */
  const pendingCommands: CommandFile[] = []
  let pendingControl: string | null = null
  /** Command files this session wrote and has not removed yet. */
  const commandPaths = new Set<string>()
  let controlWriteFailing = false
  let tempCounter = 0
  let timer: ReturnType<typeof setInterval> | null = null

  // Not fs-utils' writeAtomic: synchronous, with a per-pid/per-call tmp name.
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

  function writeControl(control: string, commands: CommandFile[] = []): void {
    pendingCommands.push(...commands)
    pendingControl = control
    flushControl()
  }

  function flushControl(): void {
    if (pendingControl === null && pendingCommands.length === 0) return
    try {
      while (pendingCommands.length > 0) {
        const command = pendingCommands[0]!
        commandPaths.add(command.path)
        writeAtomic(command.path, command.text)
        // On disk now: a retry after a failed write must not rewrite it.
        pendingCommands.shift()
      }
      if (pendingControl !== null) writeAtomic(controlPath, pendingControl)
      pendingControl = null
      controlWriteFailing = false
    } catch (err) {
      if (!controlWriteFailing)
        log.warn(`control file write failed, retrying on the next poll: ${describe(err)}`)
      controlWriteFailing = true
    }
  }

  /** The control file naming every seq in flight (idle when there is none), after any new command files. */
  function writeInFlight(commands: CommandFile[] = []): void {
    writeControl(toCfgText(buildControlFile([...inFlight.keys()])), commands)
  }

  function switchInFlight(): number | null {
    for (const [seq, command] of inFlight) if (command.fullscreenSwitch) return seq
    return null
  }

  /**
   * Hand every queued command to the engine at once, each with a fresh seq - none waits for an
   * earlier ACK. A switch goes too, but nothing behind it: once it runs, the loop is gone.
   */
  function dispatchQueued(): void {
    if (!started) return
    const commands: CommandFile[] = []
    while (queue.length > 0 && switchInFlight() === null) {
      const next = queue.shift()!
      const seq = nextSeq
      nextSeq += 1
      inFlight.set(seq, { sentAt: Date.now(), fullscreenSwitch: next.fullscreenSwitch })
      commands.push({ path: join(gameDirPath, commandCfgName(seq)), text: toCfgText(next.lines) })
    }
    if (commands.length > 0) writeInFlight(commands)
  }

  function emitDisplay(display: Display): void {
    displayListeners.emit(display)
  }

  /**
   * Hand the internal switch over behind the commands already sent (lower seqs, so they run first);
   * commands sent after it wait in the queue and are dropped once fullscreen.
   */
  function beginEntering(switchMode: boolean): void {
    mode = 'entering'
    enteringSwitchesMode = switchMode
    queue.push({ lines: buildEnterFullscreenLines({ switchMode }), fullscreenSwitch: true })
    dispatchQueued()
  }

  /** `ackedSeq`: the switch's seq when its ACK is what got us here, else null. */
  function reachFullscreen(ackedSeq: number | null): void {
    const switchSeq = switchInFlight()
    const dropped =
      queue.filter((c) => !c.fullscreenSwitch).length +
      [...inFlight.values()].filter((c) => !c.fullscreenSwitch).length
    if (dropped > 0) log.warn(`demo went fullscreen: dropping ${dropped} unsent command(s)`)
    mode = 'fullscreen'
    queue.length = 0
    inFlight.clear()
    unackedSwitchSeq = ackedSeq === null ? switchSeq : null
    // Idle, so the loop's `set q2l_seq 0` on Back to window finds no guard to re-fire.
    writeInFlight()
    if (ackedSeq !== null) removeCommandFile(ackedSeq)
    emitDisplay('fullscreen')
  }

  /** After an ACK of seq or a later one: `$q2l_seq` is at least seq, so no guard can exec this file again. */
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
    inFlight.clear()
    writeControl(toCfgText(buildStopFile()))
    listeners.emit()
  }

  /** `batch[index]` is the line to handle; the rest of the batch tells a late-flushed line apart. */
  function handleLine(batch: EngineLine[], index: number): void {
    const parsed = batch[index]!
    if (parsed.kind === 'pos') {
      if (mode === 'fullscreen') {
        if (finished || parsed.fullscreen !== false) return
        // The switch's ACK still to come in this batch: this FS 0 was logged before the loop stopped.
        const switchSeq = unackedSwitchSeq
        if (
          switchSeq !== null &&
          batch.some((l, i) => i > index && l.kind === 'ack' && l.seq === switchSeq)
        )
          return
        mode = 'stage'
        unackedSwitchSeq = null
        positionMs = parsed.positionMs
        paused = parsed.paused
        emitDisplay('stage')
        return
      }
      positionMs = parsed.positionMs
      paused = parsed.paused
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
      // ACK N retires N and every lower seq still in flight: `$q2l_seq` is N now, so their monotone
      // guards can no longer fire. Higher seqs stay - a late ACK of a timed-out seq retires nothing
      // sent after it. A seq never issued (a torn or foreign line) must not retire anything.
      if (parsed.seq >= nextSeq) return
      const retired = [...inFlight].filter(([seq]) => seq <= parsed.seq)
      if (retired.length === 0) return
      let ackedSwitch: number | null = null
      for (const [seq, command] of retired) {
        inFlight.delete(seq)
        if (seq === parsed.seq)
          log.debug(`seq ${seq} acknowledged after ${Date.now() - command.sentAt} ms`)
        if (command.fullscreenSwitch) ackedSwitch = seq
      }
      // The control file drops them before their command files go (reachFullscreen removes the switch's).
      if (ackedSwitch !== null) reachFullscreen(ackedSwitch)
      else writeInFlight()
      for (const [seq, command] of retired) if (!command.fullscreenSwitch) removeCommandFile(seq)
    } else if (parsed.kind === 'finished' && !finished) {
      finish()
    }
  }

  /**
   * Each seq times out on its own and leaves the control file; the monotone guards let the ones
   * after it run regardless. Its command file stays until close: a late exec (a delayed read of the
   * old control file) still finds it, and its seq is never reused, so it can never re-fire.
   */
  function expireTimedOut(): void {
    const now = Date.now()
    let expired = false
    for (const [seq, command] of [...inFlight]) {
      if (now - command.sentAt < ACK_TIMEOUT_MS) continue
      if (command.fullscreenSwitch) {
        log.warn(
          `no ACK for the fullscreen switch (seq ${seq}) within ${ACK_TIMEOUT_MS} ms, assuming fullscreen`,
        )
        reachFullscreen(null)
        return
      }
      log.warn(
        `no ACK for seq ${seq} within ${ACK_TIMEOUT_MS} ms, dropping it from the control file`,
      )
      inFlight.delete(seq)
      expired = true
    }
    if (expired) writeInFlight()
  }

  function tick(): void {
    try {
      flushControl()
      const batch = tail.readLines().map(parseEngineLine)
      for (let i = 0; i < batch.length; i++) handleLine(batch, i)
      expireTimedOut()
    } catch (err) {
      log.warn(`playback channel poll failed: ${describe(err)}`)
    }
    releaseSettled()
  }

  function releaseSettled(): void {
    if (settledWaiters.length === 0) return
    if (!(finished || closed || mode === 'fullscreen') && (queue.length > 0 || inFlight.size > 0))
      return
    for (const resolve of settledWaiters.splice(0)) resolve()
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
      writeAtomic(controlPath, toCfgText(buildControlFile([])))
      tail.startAtEnd()
      started = true
      timer = setInterval(tick, LOG_POLL_MS)
      dispatchQueued()
    },

    send(line: string): Outcome<void> {
      const valid = checkLine(line)
      if (!valid.ok) return valid
      if (finished || closed) return fail('replays.playback.error.noSession')
      if (mode === 'fullscreen') return fail('replays.playback.error.fullscreen')
      // The cap counts every unacknowledged command: all in flight plus all still queued.
      if (queue.length + inFlight.size >= QUEUE_CAP) return fail('replays.playback.error.busy')
      queue.push({ lines: [line], fullscreenSwitch: false })
      dispatchQueued()
      return ok(undefined)
    },

    settled() {
      return new Promise<void>((resolve) => {
        settledWaiters.push(resolve)
        releaseSettled()
      })
    },

    latest() {
      return { positionMs, paused, finished }
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
      return displayListeners.add(cb)
    },
    onFinished(cb) {
      return listeners.add(cb)
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
      inFlight.clear()
      pendingCommands.length = 0
      pendingControl = null
      releaseSettled()
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
