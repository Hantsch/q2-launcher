import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../../lib/logger'
import {
  ACK_TIMEOUT_MS,
  buildControlFile,
  buildLoopCfg,
  buildStopFile,
  CONTROL_CFG_NAME,
  LOG_FILE_NAME,
  LOG_POLL_MS,
  LOOP_CFG_NAME,
  QUEUE_CAP,
} from './protocol'
import type { PlaybackChannel } from './types'
import { createWindowsChannel } from './windows-channel'

/** Q2PRO's default `logfile_prefix`. */
const PREFIX = '[2026-09-29 12:00] '
const ENGINE_TICK_MS = 10

const asFile = (lines: string[]): string => `${lines.join('\n')}\n`

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

function formatDemoPos(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`
}

const GUARD = /^if \$q2l_seq != (\d+) then "(.*); set q2l_seq (\d+); echo ACK (\d+)"$/

/**
 * Stands in for Q2PRO running `q2l_loop`: every tick it re-execs the control file from disk,
 * evaluates the `$q2l_seq` guard against its own cvar, and appends its echoes to the logfile -
 * every third write cut mid-line and finished by the next one.
 */
function createFakeEngine(dir: string, opts: { ack?: boolean } = {}) {
  const controlPath = join(dir, CONTROL_CFG_NAME)
  const logPath = join(dir, 'logs', LOG_FILE_NAME)
  const state = {
    q2lSeq: 0,
    posMs: 0,
    lastPosMs: null as number | null,
    executed: [] as string[],
    executions: new Map<number, number>(),
    evaluations: new Map<number, number>(),
    stopped: false,
  }
  let carry = ''
  let writes = 0
  let finishPending = false
  let paused = false

  function append(text: string): void {
    if (text.length === 0) return
    mkdirSync(join(dir, 'logs'), { recursive: true })
    appendFileSync(logPath, text)
  }

  function tick(): void {
    if (paused || state.stopped) return
    let control: string
    try {
      control = readFileSync(controlPath, 'utf8')
    } catch {
      return
    }
    state.posMs += 100
    const out: string[] = []
    for (const line of control.split(/\r?\n/)) {
      if (line === 'echo POS $cl_demopos') {
        out.push(`POS ${formatDemoPos(state.posMs)}`)
        state.lastPosMs = Math.floor(state.posMs / 100) * 100
      }
      const guard = GUARD.exec(line)
      if (guard) {
        const n = Number(guard[1])
        state.evaluations.set(n, (state.evaluations.get(n) ?? 0) + 1)
        if (state.q2lSeq !== n) {
          state.executions.set(n, (state.executions.get(n) ?? 0) + 1)
          state.executed.push(guard[2])
          const seek = /^seek (\d+)$/.exec(guard[2])
          if (seek) state.posMs = Number(seek[1]) * 1000
          state.q2lSeq = Number(guard[3])
          if (opts.ack !== false) out.push(`ACK ${guard[4]}`)
        }
      }
      if (line === 'alias q2l_loop ""') state.stopped = true
    }
    if (finishPending) {
      out.push('Demo finished')
      finishPending = false
    }
    const payload = carry + out.map((l) => `${PREFIX}${l}\n`).join('')
    writes += 1
    if (writes % 3 === 0) {
      let cut = Math.floor(payload.length / 2)
      if (payload[cut - 1] === '\n') cut -= 1
      append(payload.slice(0, cut))
      carry = payload.slice(cut)
    } else {
      append(payload)
      carry = ''
    }
  }

  return {
    state,
    logPath,
    run: () => setInterval(tick, ENGINE_TICK_MS),
    finish: () => {
      finishPending = true
    },
    /** Stop ticking and write out any half-written line, so the log is whole. */
    pause: () => {
      paused = true
      append(carry)
      carry = ''
    },
  }
}

let dir: string
let open: PlaybackChannel[] = []

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'q2l-channel-'))
})

afterEach(async () => {
  for (const ch of open) await ch.close()
  open = []
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function makeChannel(): { ch: PlaybackChannel; log: Logger } {
  const log = fakeLogger()
  const ch = createWindowsChannel({ gameDirPath: dir, log })
  open.push(ch)
  return { ch, log }
}

const controlFile = (): string => readFileSync(join(dir, CONTROL_CFG_NAME), 'utf8')
const logPath = (): string => join(dir, 'logs', LOG_FILE_NAME)

describe('createWindowsChannel', () => {
  it('a command runs exactly once through the control file and position is read from the logfile', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir)
    engine.run()
    vi.advanceTimersByTime(200)

    expect(ch.send('seek 10').ok).toBe(true)
    expect(ch.send('seek 20').ok).toBe(true)
    expect(ch.send('seek 30').ok).toBe(true)
    vi.advanceTimersByTime(1000)

    expect(engine.state.executed).toEqual(['seek 10', 'seek 20', 'seek 30'])
    expect([...engine.state.executions]).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ])
    // The engine re-execed each guarded file several times; the guard is what kept it to one run.
    for (const seq of [1, 2, 3]) expect(engine.state.evaluations.get(seq)).toBeGreaterThan(1)
    expect(controlFile()).toBe(asFile(buildControlFile(null)))

    engine.pause()
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(engine.state.lastPosMs).toBeGreaterThanOrEqual(30_000)
    expect(ch.latest()).toEqual({ positionMs: engine.state.lastPosMs, finished: false })
  })

  it('does not act on a line until its newline arrives', async () => {
    const { ch } = makeChannel()
    await ch.start()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    expect(ch.send('pause').ok).toBe(true)
    const guarded = asFile(buildControlFile({ seq: 1, line: 'pause' }))

    appendFileSync(logPath(), `${PREFIX}POS 0:12.3\n${PREFIX}ACK 1`) // really "ACK 12", cut mid-line
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(ch.latest().positionMs).toBe(12_300)
    expect(controlFile()).toBe(guarded)

    appendFileSync(logPath(), '2\n')
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(controlFile()).toBe(guarded)

    appendFileSync(logPath(), `${PREFIX}ACK 1\n`)
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(controlFile()).toBe(asFile(buildControlFile(null)))
  })

  it('reopens the log when the engine truncates or replaces it', async () => {
    const { ch } = makeChannel()
    await ch.start()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    appendFileSync(logPath(), `${PREFIX}POS 0:05.0\n${PREFIX}POS 0:06.0\n`)
    vi.advanceTimersByTime(LOG_POLL_MS * 2)
    expect(ch.latest().positionMs).toBe(6000)

    writeFileSync(logPath(), `${PREFIX}POS 0:01.0\n`) // truncated: shorter than what was read
    vi.advanceTimersByTime(LOG_POLL_MS * 3)
    expect(ch.latest().positionMs).toBe(1000)

    // Deleted and recreated under the held fd, same size: only the file identity tells them apart.
    // (A rename over the held-open log is refused by Windows with EPERM; Q2PRO never does that.)
    unlinkSync(logPath())
    writeFileSync(logPath(), `${PREFIX}POS 0:02.0\n`)
    vi.advanceTimersByTime(LOG_POLL_MS * 3)
    expect(ch.latest().positionMs).toBe(2000)
  })

  it('on Demo finished writes the stop file, fires onFinished and refuses later sends', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir, { ack: false })
    engine.run()
    const onFinished = vi.fn()
    ch.onFinished(onFinished)
    expect(ch.send('first').ok).toBe(true)
    expect(ch.send('second').ok).toBe(true)
    vi.advanceTimersByTime(100)

    engine.finish()
    vi.advanceTimersByTime(200)
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(ch.latest().finished).toBe(true)
    expect(controlFile()).toBe(asFile(buildStopFile()))
    expect(engine.state.stopped).toBe(true)
    expect(ch.send('third')).toEqual({ ok: false, error: { key: 'replays.playback.error.noSession' } })

    // The queue was dropped: no ACK timeout brings "second" back or overwrites the stop file.
    vi.advanceTimersByTime(ACK_TIMEOUT_MS * 2)
    expect(engine.state.executed).toEqual(['first'])
    expect(controlFile()).toBe(asFile(buildStopFile()))
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('close removes the control, loop and log files it created', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir)
    engine.run()
    expect(ch.send('seek 5').ok).toBe(true)
    vi.advanceTimersByTime(300)
    engine.pause()
    expect(existsSync(join(dir, CONTROL_CFG_NAME))).toBe(true)
    expect(existsSync(join(dir, LOOP_CFG_NAME))).toBe(true)
    expect(existsSync(logPath())).toBe(true)

    await ch.close()
    expect(existsSync(join(dir, CONTROL_CFG_NAME))).toBe(false)
    expect(existsSync(join(dir, LOOP_CFG_NAME))).toBe(false)
    expect(existsSync(logPath())).toBe(false)
    expect(readdirSync(dir).filter((n) => n.startsWith('q2l_'))).toEqual([])
    expect(ch.send('seek 6')).toEqual({ ok: false, error: { key: 'replays.playback.error.noSession' } })
  })

  it('replaces stale files from a previous run and never parses pre-existing log bytes', async () => {
    writeFileSync(join(dir, CONTROL_CFG_NAME), asFile(buildControlFile({ seq: 1, line: 'quit' })))
    writeFileSync(join(dir, LOOP_CFG_NAME), 'garbage\n')
    writeFileSync(join(dir, `${CONTROL_CFG_NAME}.999.1.tmp`), 'half a file')
    writeFileSync(join(dir, 'autoexec.cfg'), 'bind x quit\n')
    mkdirSync(join(dir, 'logs'), { recursive: true })
    writeFileSync(logPath(), `${PREFIX}POS 9:59.0\n${PREFIX}ACK 1\n${PREFIX}Demo finished\n`)

    const { ch } = makeChannel()
    await ch.start()
    expect(controlFile()).toBe(asFile(buildControlFile(null)))
    expect(readFileSync(join(dir, LOOP_CFG_NAME), 'utf8')).toBe(asFile(buildLoopCfg()))
    expect(existsSync(join(dir, `${CONTROL_CFG_NAME}.999.1.tmp`))).toBe(false)
    expect(existsSync(join(dir, 'autoexec.cfg'))).toBe(true)

    const engine = createFakeEngine(dir, { ack: false })
    engine.run()
    expect(ch.send('pause').ok).toBe(true)
    vi.advanceTimersByTime(500)
    engine.pause()
    vi.advanceTimersByTime(LOG_POLL_MS)

    expect(ch.latest()).toEqual({ positionMs: engine.state.lastPosMs, finished: false })
    expect(ch.latest().positionMs).toBeLessThan(599_000)
    // The old "ACK 1" did not acknowledge this run's seq 1.
    expect(controlFile()).toBe(asFile(buildControlFile({ seq: 1, line: 'pause' })))
  })

  it(`refuses a send once ${QUEUE_CAP} commands are unacknowledged`, async () => {
    const { ch } = makeChannel()
    await ch.start()
    for (let i = 0; i < QUEUE_CAP; i++) expect(ch.send(`cmd${i}`).ok).toBe(true)
    expect(ch.send('one too many')).toEqual({ ok: false, error: { key: 'replays.playback.error.busy' } })
    expect(ch.send('bad "quote"')).toEqual({ ok: false, error: { key: 'replays.playback.error.invalidCommand' } })
  })

  it('an ACK timeout logs a warning and advances the queue', async () => {
    const { ch, log } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir, { ack: false })
    engine.run()
    expect(ch.send('first').ok).toBe(true)
    expect(ch.send('second').ok).toBe(true)

    vi.advanceTimersByTime(ACK_TIMEOUT_MS - 100)
    expect(controlFile()).toBe(asFile(buildControlFile({ seq: 1, line: 'first' })))
    expect(log.warn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(controlFile()).toBe(asFile(buildControlFile({ seq: 2, line: 'second' })))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('seq 1'))
    vi.advanceTimersByTime(100)
    expect(engine.state.executed).toEqual(['first', 'second'])
    expect(engine.state.executions.get(1)).toBe(1)
    expect(engine.state.evaluations.get(1)).toBeGreaterThan(100)
  })
})
