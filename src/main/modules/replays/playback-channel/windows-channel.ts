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
  buildControlFile,
  buildLoopCfg,
  buildStopFile,
  checkLine,
  CONTROL_CFG_NAME,
  LOG_FILE_RELATIVE,
  LOG_POLL_MS,
  LOOP_CFG_NAME,
  parseEngineLine,
  QUEUE_CAP,
  windowsLaunchArgs,
} from './protocol'
import type { PlaybackChannel } from './types'

/**
 * Story 164 D2: the Windows playback channel. Q2PRO on Windows has no usable stdin, so the launcher
 * talks to it through files in the game dir: the engine re-executes `q2l_ctl.cfg` every loop tick
 * (the guard `if $q2l_seq != N` makes each command run once), and its answers (`POS`, `ACK`,
 * `Demo finished`) arrive in the dedicated logfile, which this channel tails.
 *
 * Every file operation is synchronous so a poll tick can never interleave with another tick, a send
 * or close; nothing a timer runs can reject.
 */

const FILE_PREFIX = 'q2l_'
const READ_CHUNK_BYTES = 64 * 1024
const CLOSE_RETRY_MS = 200

export interface WindowsChannelOptions {
  gameDirPath: string
  log: Logger
}

export function createWindowsChannel({ gameDirPath, log }: WindowsChannelOptions): PlaybackChannel {
  const loopCfgPath = join(gameDirPath, LOOP_CFG_NAME)
  const controlPath = join(gameDirPath, CONTROL_CFG_NAME)
  const logPath = join(gameDirPath, ...LOG_FILE_RELATIVE.split('/'))
  const { argsBeforeDemo, argsAfterDemo } = windowsLaunchArgs()
  const tail = createLogTail(logPath)
  const listeners = new Set<() => void>()
  /** Lines waiting for their turn; the one being executed is `inFlight`, not in here. */
  const queue: string[] = []

  let started = false
  let closed = false
  let finished = false
  let positionMs: number | null = null
  let nextSeq = 1
  let inFlight: { seq: number; sentAt: number } | null = null
  /** Control-file content not yet on disk: a rename can lose a race with the engine's own read. */
  let pendingControl: string[] | null = null
  let controlWriteFailing = false
  let tempCounter = 0
  let timer: ReturnType<typeof setInterval> | null = null

  /** Temp file in the same dir, then rename over the target: the engine never execs a half-written cfg. */
  function writeAtomic(destPath: string, lines: string[]): void {
    tempCounter += 1
    const tempPath = `${destPath}.${process.pid}.${tempCounter}.tmp`
    writeFileSync(tempPath, `${lines.join('\n')}\n`, 'utf8')
    try {
      renameSync(tempPath, destPath)
    } catch (err) {
      removeFile(tempPath)
      throw err
    }
  }

  function writeControl(lines: string[]): void {
    pendingControl = lines
    flushControl()
  }

  function flushControl(): void {
    if (!pendingControl) return
    try {
      writeAtomic(controlPath, pendingControl)
      pendingControl = null
      controlWriteFailing = false
    } catch (err) {
      if (!controlWriteFailing) log.warn(`control file write failed, retrying on the next poll: ${describe(err)}`)
      controlWriteFailing = true
    }
  }

  /** Hand the next queued line to the engine with a fresh seq, or go idle when there is none. */
  function dispatchNext(): void {
    const line = queue.shift()
    if (line === undefined) {
      inFlight = null
      writeControl(buildControlFile(null))
      return
    }
    inFlight = { seq: nextSeq, sentAt: Date.now() }
    nextSeq += 1
    writeControl(buildControlFile({ seq: inFlight.seq, line }))
  }

  function finish(): void {
    finished = true
    queue.length = 0
    inFlight = null
    writeControl(buildStopFile())
    for (const cb of [...listeners]) {
      try {
        cb()
      } catch (err) {
        log.warn(`onFinished listener threw: ${describe(err)}`)
      }
    }
  }

  function handleLine(raw: string): void {
    const parsed = parseEngineLine(raw)
    if (parsed.kind === 'pos') {
      positionMs = parsed.positionMs
    } else if (parsed.kind === 'ack') {
      // Only the ACK of the command in flight counts: a late ACK of a timed-out seq must not
      // acknowledge its successor.
      if (finished || !inFlight || parsed.seq !== inFlight.seq) return
      log.debug(`seq ${inFlight.seq} acknowledged after ${Date.now() - inFlight.sentAt} ms`)
      dispatchNext()
    } else if (parsed.kind === 'finished' && !finished) {
      finish()
    }
  }

  function tick(): void {
    try {
      flushControl()
      for (const line of tail.readLines()) handleLine(line)
      if (inFlight && Date.now() - inFlight.sentAt >= ACK_TIMEOUT_MS) {
        log.warn(`no ACK for seq ${inFlight.seq} within ${ACK_TIMEOUT_MS} ms, moving on`)
        dispatchNext()
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
      writeAtomic(loopCfgPath, buildLoopCfg())
      writeAtomic(controlPath, buildControlFile(null))
      tail.startAtEnd()
      started = true
      timer = setInterval(tick, LOG_POLL_MS)
      if (queue.length > 0 && !inFlight) dispatchNext()
    },

    send(line: string): Outcome<void> {
      const valid = checkLine(line)
      if (!valid.ok) return valid
      if (finished || closed) return fail('replays.playback.error.noSession')
      // The cap counts every unacknowledged command, the one in flight included.
      if (queue.length + (inFlight ? 1 : 0) >= QUEUE_CAP) return fail('replays.playback.error.busy')
      queue.push(line)
      if (started && !inFlight) dispatchNext()
      return ok(undefined)
    },

    latest() {
      return { positionMs, finished }
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
      queue.length = 0
      inFlight = null
      pendingControl = null
      if (!started) return
      // The game may still hold a file for a moment after it exits (Windows locks): retry once.
      const left = [controlPath, loopCfgPath, logPath].filter((p) => removeFile(p) !== null)
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
