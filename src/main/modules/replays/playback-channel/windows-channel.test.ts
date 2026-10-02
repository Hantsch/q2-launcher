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
  BACK_TO_WINDOW_CFG,
  buildBackToWindowCfg,
  buildControlFile,
  buildEnterFullscreenLines,
  buildLoopCfg,
  buildStopFile,
  commandCfgName,
  CONTROL_CFG_NAME,
  LOG_FILE_NAME,
  LOG_POLL_MS,
  LOOP_CFG_NAME,
  QUEUE_CAP,
} from './protocol'
import type { PlaybackChannel } from './types'
import { createWindowsChannel } from './windows-channel'

/**
 * Records every completed rename (the channel's atomic write: a file becomes visible to the engine)
 * and every delete, by file name, so a test can check the order the engine would see them in.
 */
const fsEvents = vi.hoisted(() => [] as string[])
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const name = (p: unknown): string => String(p).split(/[\\/]/).pop() ?? ''
  return {
    ...real,
    renameSync: (from: string, to: string) => {
      real.renameSync(from, to)
      fsEvents.push(`write ${name(to)}`)
    },
    unlinkSync: (p: string) => {
      real.unlinkSync(p)
      fsEvents.push(`delete ${name(p)}`)
    },
  }
})

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

const GUARD =
  /^if \$q2l_seq < (\d+) then "exec (q2l_cmd_\d+\.cfg); set q2l_seq (\d+); echo ACK (\d+)"$/

/**
 * Stands in for Q2PRO running `q2l_loop`: every tick it re-execs the control file from disk,
 * evaluates each `$q2l_seq` guard, top to bottom, against its own cvar as the previous guards left
 * it, execs the command file a firing guard names, and
 * appends its echoes to the logfile - every third write cut mid-line and finished by the next one.
 */
function createFakeEngine(dir: string, opts: { ack?: boolean; buffered?: boolean } = {}) {
  const controlPath = join(dir, CONTROL_CFG_NAME)
  const logPath = join(dir, 'logs', LOG_FILE_NAME)
  const state = {
    q2lSeq: 0,
    posMs: 0,
    lastPosMs: null as number | null,
    executed: [] as string[],
    executions: new Map<number, number>(),
    evaluations: new Map<number, number>(),
    /** Seqs whose guard fired while their command file was not on disk. */
    missing: [] as number[],
    /** `q2l_loop` no longer re-execs the control file. */
    stopped: false,
    /** `$vid_fullscreen`. */
    fullscreen: false,
  }
  let carry = ''
  let writes = 0
  let finishPending = false
  let paused = false
  /** Story 172: a buffered logfile holds its lines back until `flush()`. */
  let buffered = opts.buffered === true
  let held = ''

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
    // Redefining the loop alias takes effect on the loop's next call: this pass still runs through.
    let loopRedefined = false
    for (const line of control.split(/\r?\n/)) {
      if (line === 'echo POS $cl_demopos FS $vid_fullscreen P $cl_paused') {
        out.push(`POS ${formatDemoPos(state.posMs)} FS ${state.fullscreen ? 1 : 0} P 0`)
        state.lastPosMs = Math.floor(state.posMs / 100) * 100
      }
      const guard = GUARD.exec(line)
      if (guard) {
        const n = Number(guard[1])
        state.evaluations.set(n, (state.evaluations.get(n) ?? 0) + 1)
        if (state.q2lSeq < n) {
          state.executions.set(n, (state.executions.get(n) ?? 0) + 1)
          let command: string
          try {
            command = readFileSync(join(dir, guard[2]), 'utf8')
          } catch {
            command = '' // Q2PRO: "couldn't exec" - the command is lost, the guard still advances
            state.missing.push(n)
          }
          for (const cmd of command.split(/\r?\n/).filter((l) => l.length > 0)) {
            state.executed.push(cmd)
            const seek = /^seek (\d+)$/.exec(cmd)
            if (seek) state.posMs = Number(seek[1]) * 1000
            if (cmd === 'vid_fullscreen 1') state.fullscreen = true
            if (cmd.startsWith('alias q2l_loop ') && !cmd.includes(`exec ${CONTROL_CFG_NAME}`))
              loopRedefined = true
          }
          state.q2lSeq = Number(guard[3])
          if (opts.ack !== false) out.push(`ACK ${guard[4]}`)
        }
      }
      if (line === 'alias q2l_loop ""') state.stopped = true
    }
    if (loopRedefined) state.stopped = true
    if (finishPending) {
      out.push('Demo finished')
      finishPending = false
    }
    const payload = carry + out.map((l) => `${PREFIX}${l}\n`).join('')
    writes += 1
    if (buffered) {
      held += payload
      carry = ''
    } else if (state.stopped) {
      // The last pass before the loop ends: nothing would ever finish a cut line.
      append(payload)
      carry = ''
    } else if (writes % 3 === 0) {
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
    /** A buffered logfile finally writes out everything it held, in one go; later lines go straight out. */
    flush: () => {
      append(held)
      held = ''
      buffered = false
    },
    /**
     * The user presses Back to window: `exec q2l_back.cfg` as the channel wrote it. (Its session and
     * moved-position guards hold here: the demo runs inside a launcher playback and time went on.)
     */
    back: () => {
      const cfg = readFileSync(join(dir, BACK_TO_WINDOW_CFG), 'utf8')
      const go = /^alias q2l_back_go "(.*)"$/m.exec(cfg)
      if (!go) throw new Error(`no q2l_back_go in ${BACK_TO_WINDOW_CFG}`)
      for (const cmd of go[1]!.split(';').map((c) => c.trim())) {
        if (cmd === 'vid_fullscreen 0') state.fullscreen = false
        if (cmd !== `exec ${LOOP_CFG_NAME}`) continue
        for (const line of readFileSync(join(dir, LOOP_CFG_NAME), 'utf8').split(/\r?\n/)) {
          const set = /^set q2l_seq (\d+)$/.exec(line)
          if (set) state.q2lSeq = Number(set[1])
          if (line.startsWith('alias q2l_loop ') && line.includes(`exec ${CONTROL_CFG_NAME}`))
            state.stopped = false
        }
      }
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
const commandFile = (seq: number): string => readFileSync(join(dir, commandCfgName(seq)), 'utf8')
const commandFiles = (): string[] => readdirSync(dir).filter((n) => /^q2l_cmd_\d+\.cfg$/.test(n))

describe('createWindowsChannel', () => {
  it('the command file is written before the control file and removed after ACK', async () => {
    const { ch } = makeChannel()
    await ch.start()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    fsEvents.length = 0

    const line = 'say x; echo //y $q2l_seq'
    expect(ch.send(line).ok).toBe(true)
    // Nothing else becomes visible in between: the engine can only ever see the control file
    // naming seq 1 once the command file it execs is complete on disk.
    expect(fsEvents).toEqual([`write ${commandCfgName(1)}`, `write ${CONTROL_CFG_NAME}`])
    expect(commandFile(1)).toBe(`${line}\n`)
    expect(controlFile()).toBe(
      `echo POS $cl_demopos FS $vid_fullscreen P $cl_paused\nif $q2l_seq < 1 then "exec q2l_cmd_1.cfg; set q2l_seq 1; echo ACK 1"\n`,
    )

    // Unacknowledged: the command file stays, however many polls pass.
    vi.advanceTimersByTime(LOG_POLL_MS * 10)
    expect(commandFiles()).toEqual([commandCfgName(1)])
    expect(fsEvents).toHaveLength(2)

    // Not behind seq 1: its own file goes out at once, again before the control file naming it.
    expect(ch.send('seek 5').ok).toBe(true)
    expect(fsEvents.slice(2)).toEqual([`write ${commandCfgName(2)}`, `write ${CONTROL_CFG_NAME}`])
    expect(commandFile(2)).toBe('seek 5\n')
    expect(controlFile()).toBe(asFile(buildControlFile([1, 2])))

    appendFileSync(logPath(), `${PREFIX}ACK 1\n`)
    vi.advanceTimersByTime(LOG_POLL_MS)
    // The control file stops naming seq 1 before its command file goes.
    expect(fsEvents.slice(4)).toEqual([`write ${CONTROL_CFG_NAME}`, `delete ${commandCfgName(1)}`])
    expect(commandFiles()).toEqual([commandCfgName(2)])
    expect(controlFile()).toBe(asFile(buildControlFile([2])))

    appendFileSync(logPath(), `${PREFIX}ACK 2\n`)
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(fsEvents.slice(6)).toEqual([`write ${CONTROL_CFG_NAME}`, `delete ${commandCfgName(2)}`])
    expect(commandFiles()).toEqual([])
    expect(controlFile()).toBe(asFile(buildControlFile([])))
  })

  it('settled resolves only once every sent command is acknowledged', async () => {
    const { ch } = makeChannel()
    await ch.start()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    let settled = false
    await ch.settled()

    expect(ch.send('first').ok).toBe(true)
    expect(ch.send('second').ok).toBe(true)
    void ch.settled().then(() => (settled = true))

    appendFileSync(logPath(), `${PREFIX}ACK 1\n`)
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS)
    expect(settled).toBe(false)

    appendFileSync(logPath(), `${PREFIX}ACK 2\n`)
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS)
    expect(settled).toBe(true)
  })

  it('three quick sends are all in the control file before any ACK', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir, { ack: false })

    expect(ch.send('seek 10').ok).toBe(true)
    expect(ch.send('seek 20').ok).toBe(true)
    expect(ch.send('seek 30').ok).toBe(true)
    expect(controlFile()).toBe(asFile(buildControlFile([1, 2, 3])))
    expect([1, 2, 3].map(commandFile)).toEqual(['seek 10\n', 'seek 20\n', 'seek 30\n'])

    // A single engine pass runs all three, in order: none of them waited for an earlier ACK.
    engine.run()
    vi.advanceTimersByTime(ENGINE_TICK_MS)
    expect(engine.state.executed).toEqual(['seek 10', 'seek 20', 'seek 30'])
    expect(engine.state.missing).toEqual([])
  })

  it('each of several in-flight commands runs exactly once, in order', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir)
    engine.run()
    vi.advanceTimersByTime(200)

    // Sent between engine passes: each later control file is re-read after the earlier seqs ran,
    // while their ACKs are still on the way to the channel.
    expect(ch.send('seek 10').ok).toBe(true)
    vi.advanceTimersByTime(ENGINE_TICK_MS)
    expect(ch.send('seek 20').ok).toBe(true)
    expect(controlFile()).toBe(asFile(buildControlFile([1, 2])))
    vi.advanceTimersByTime(ENGINE_TICK_MS)
    expect(ch.send('seek 30').ok).toBe(true)
    expect(ch.send('seek 40').ok).toBe(true)
    vi.advanceTimersByTime(1000)

    expect(engine.state.executed).toEqual(['seek 10', 'seek 20', 'seek 30', 'seek 40'])
    expect([...engine.state.executions]).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ])
    for (const seq of [1, 2, 3, 4]) expect(engine.state.evaluations.get(seq)).toBeGreaterThan(1)
    expect(engine.state.missing).toEqual([])
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(commandFiles()).toEqual([])
  })

  it('a control file re-read after seq N+1 ran does not re-run seq N', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir, { ack: false })
    engine.run()
    expect(ch.send('first').ok).toBe(true)
    expect(ch.send('second').ok).toBe(true)

    // No ACK reaches the channel: the file keeps naming both seqs and the engine re-reads it often.
    vi.advanceTimersByTime(ACK_TIMEOUT_MS - 100)
    expect(controlFile()).toBe(asFile(buildControlFile([1, 2])))
    expect(engine.state.evaluations.get(1)).toBeGreaterThan(10)
    expect(engine.state.executed).toEqual(['first', 'second'])
    expect([...engine.state.executions]).toEqual([
      [1, 1],
      [2, 1],
    ])

    // Only ACK 2 arrives (ACK 1 lost): seq 1 can no longer run, so it is retired with seq 2.
    engine.pause()
    appendFileSync(logPath(), `${PREFIX}ACK 2\n`)
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(commandFiles()).toEqual([])
  })

  it('one timed-out seq does not block the ones after it', async () => {
    const { ch, log } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir)
    expect(ch.send('first').ok).toBe(true)
    vi.advanceTimersByTime(ACK_TIMEOUT_MS - 500)
    expect(ch.send('second').ok).toBe(true)
    expect(controlFile()).toBe(asFile(buildControlFile([1, 2])))

    // Seq 1 times out on its own clock and leaves the file; seq 2's clock is still running.
    vi.advanceTimersByTime(600)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('seq 1'))
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('seq 2'))
    expect(controlFile()).toBe(asFile(buildControlFile([2])))

    engine.run()
    vi.advanceTimersByTime(200)
    expect(engine.state.executed).toEqual(['second'])
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    // The timed-out seq's file stays until close; the acknowledged one is gone.
    expect(commandFiles()).toEqual([commandCfgName(1)])
    vi.advanceTimersByTime(ACK_TIMEOUT_MS)
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('seq 2'))
  })

  it('close removes command files that were never acknowledged', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir, { ack: false })
    engine.run()
    expect(ch.send('first').ok).toBe(true)
    expect(ch.send('second').ok).toBe(true)
    vi.advanceTimersByTime(ACK_TIMEOUT_MS + 100)
    engine.pause()
    // A timed-out seq keeps its file until close; it is never reused, so it can never re-fire.
    expect(commandFiles()).toEqual([commandCfgName(1), commandCfgName(2)])

    await ch.close()
    expect(commandFiles()).toEqual([])
    expect(engine.state.executed).toEqual(['first', 'second'])
    expect(engine.state.missing).toEqual([])
  })

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
    expect(engine.state.missing).toEqual([])
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(commandFiles()).toEqual([])

    engine.pause()
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(engine.state.lastPosMs).toBeGreaterThanOrEqual(30_000)
    expect(ch.latest()).toEqual({
      positionMs: engine.state.lastPosMs,
      paused: false,
      finished: false,
    })
  })

  it('does not act on a line until its newline arrives', async () => {
    const { ch } = makeChannel()
    await ch.start()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    expect(ch.send('pause').ok).toBe(true)
    const guarded = asFile(buildControlFile([1]))

    appendFileSync(logPath(), `${PREFIX}POS 0:12.3\n${PREFIX}ACK 1`) // really "ACK 12", cut mid-line
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(ch.latest().positionMs).toBe(12_300)
    expect(controlFile()).toBe(guarded)

    appendFileSync(logPath(), '2\n')
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(controlFile()).toBe(guarded)
    expect(commandFile(1)).toBe('pause\n')

    appendFileSync(logPath(), `${PREFIX}ACK 1\n`)
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(commandFiles()).toEqual([])
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
    expect(ch.send('third')).toEqual({
      ok: false,
      error: { key: 'replays.playback.error.noSession' },
    })

    // Both went out at once and ran once; the unacknowledged seqs were dropped at the end, so no ACK
    // timeout rewrites the control file over the stop file or brings either command back.
    vi.advanceTimersByTime(ACK_TIMEOUT_MS * 2)
    expect(engine.state.executed).toEqual(['first', 'second'])
    expect([...engine.state.executions]).toEqual([
      [1, 1],
      [2, 1],
    ])
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
    expect(ch.send('seek 6')).toEqual({
      ok: false,
      error: { key: 'replays.playback.error.noSession' },
    })
  })

  it('close removes every file it created with several commands still in flight', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir)
    expect(ch.send('seek 5').ok).toBe(true)
    expect(ch.send('seek 6').ok).toBe(true)
    expect(ch.send('seek 7').ok).toBe(true)
    // One engine pass runs them; close comes before the channel has read a single ACK.
    engine.run()
    vi.advanceTimersByTime(ENGINE_TICK_MS)
    engine.pause()
    expect(commandFiles()).toEqual([1, 2, 3].map(commandCfgName))

    await ch.close()
    expect(readdirSync(dir).filter((n) => n.startsWith('q2l_'))).toEqual([])
    expect(existsSync(logPath())).toBe(false)
    expect(engine.state.executed).toEqual(['seek 5', 'seek 6', 'seek 7'])
  })

  it('replaces stale files from a previous run and never parses pre-existing log bytes', async () => {
    writeFileSync(join(dir, CONTROL_CFG_NAME), asFile(buildControlFile([1])))
    writeFileSync(join(dir, commandCfgName(1)), 'quit\n')
    writeFileSync(join(dir, LOOP_CFG_NAME), 'garbage\n')
    writeFileSync(join(dir, BACK_TO_WINDOW_CFG), 'garbage\n')
    writeFileSync(join(dir, `${CONTROL_CFG_NAME}.999.1.tmp`), 'half a file')
    writeFileSync(join(dir, 'autoexec.cfg'), 'bind x quit\n')
    mkdirSync(join(dir, 'logs'), { recursive: true })
    writeFileSync(logPath(), `${PREFIX}POS 9:59.0\n${PREFIX}ACK 1\n${PREFIX}Demo finished\n`)

    const { ch } = makeChannel()
    await ch.start()
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(readFileSync(join(dir, LOOP_CFG_NAME), 'utf8')).toBe(asFile(buildLoopCfg()))
    expect(readFileSync(join(dir, BACK_TO_WINDOW_CFG), 'utf8')).toBe(
      asFile(buildBackToWindowCfg('win32')),
    )
    expect(existsSync(join(dir, `${CONTROL_CFG_NAME}.999.1.tmp`))).toBe(false)
    expect(commandFiles()).toEqual([])
    expect(existsSync(join(dir, 'autoexec.cfg'))).toBe(true)

    const engine = createFakeEngine(dir, { ack: false })
    engine.run()
    expect(ch.send('pause').ok).toBe(true)
    vi.advanceTimersByTime(500)
    engine.pause()
    vi.advanceTimersByTime(LOG_POLL_MS)

    expect(ch.latest()).toEqual({
      positionMs: engine.state.lastPosMs,
      paused: false,
      finished: false,
    })
    expect(ch.latest().positionMs).toBeLessThan(599_000)
    // The old "ACK 1" did not acknowledge this run's seq 1.
    expect(controlFile()).toBe(asFile(buildControlFile([1])))
    // This run's seq 1 execs this run's line, not the old run's command file of the same name.
    expect(engine.state.executed).toEqual(['pause'])
  })

  it('refuses a send once QUEUE_CAP commands are in flight or queued', async () => {
    const BUSY = { ok: false, error: { key: 'replays.playback.error.busy' } }
    const { ch } = makeChannel()
    await ch.start()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    const seqs = Array.from({ length: QUEUE_CAP }, (_, i) => i + 1)
    for (const seq of seqs) expect(ch.send(`cmd${seq}`).ok).toBe(true)
    // All of them in flight at once, none queued.
    expect(controlFile()).toBe(asFile(buildControlFile(seqs)))
    expect(ch.send('one too many')).toEqual(BUSY)
    expect(ch.send('bad\nline')).toEqual({
      ok: false,
      error: { key: 'replays.playback.error.invalidCommand' },
    })

    // The last seq's ACK retires every seq: room for new commands again.
    appendFileSync(logPath(), `${PREFIX}ACK ${QUEUE_CAP}\n`)
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(controlFile()).toBe(asFile(buildControlFile([])))

    // In flight and queued count together: one command and the switch in flight, the rest queued behind it.
    expect(ch.send('in flight').ok).toBe(true)
    expect(ch.enterFullscreen().ok).toBe(true)
    for (let i = 2; i < QUEUE_CAP; i++) expect(ch.send(`queued${i}`).ok).toBe(true)
    expect(controlFile()).toBe(asFile(buildControlFile([QUEUE_CAP + 1, QUEUE_CAP + 2])))
    expect(ch.send('one too many')).toEqual(BUSY)
  })

  it('an ACK timeout logs a warning and drops the seq from the control file', async () => {
    const { ch, log } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir, { ack: false })
    engine.run()
    expect(ch.send('first').ok).toBe(true)
    expect(ch.send('second').ok).toBe(true)

    vi.advanceTimersByTime(ACK_TIMEOUT_MS - 100)
    expect(controlFile()).toBe(asFile(buildControlFile([1, 2])))
    expect(commandFile(1)).toBe('first\n')
    expect(commandFile(2)).toBe('second\n')
    expect(log.warn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('seq 1'))
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('seq 2'))
    vi.advanceTimersByTime(100)
    expect(engine.state.executed).toEqual(['first', 'second'])
    expect(engine.state.executions.get(1)).toBe(1)
    expect(engine.state.evaluations.get(1)).toBeGreaterThan(100)
  })
})

describe('createWindowsChannel fullscreen (story 172)', () => {
  const SWITCH = buildEnterFullscreenLines({ switchMode: true })
  const FOLLOW = buildEnterFullscreenLines({ switchMode: false })
  const FULLSCREEN_ERROR = { ok: false, error: { key: 'replays.playback.error.fullscreen' } }
  const switches = (executed: string[]): number =>
    executed.filter((c) => c === 'vid_fullscreen 1').length

  function withDisplayLog(ch: PlaybackChannel): ReturnType<typeof vi.fn> {
    const onDisplay = vi.fn()
    ch.onDisplayChange(onDisplay)
    return onDisplay
  }

  it('fullscreen stops the loop and the switch runs exactly once', async () => {
    const { ch, log } = makeChannel()
    const onDisplay = withDisplayLog(ch)
    await ch.start()
    const engine = createFakeEngine(dir)
    engine.run()
    vi.advanceTimersByTime(200)

    expect(ch.send('seek 10').ok).toBe(true)
    expect(ch.enterFullscreen().ok).toBe(true)
    expect(ch.enterFullscreen()).toEqual(FULLSCREEN_ERROR)
    // Queued behind the switch: the loop is gone before it would run, so it is dropped.
    expect(ch.send('seek 20').ok).toBe(true)
    expect(ch.display()).toBe('stage')
    vi.advanceTimersByTime(1000)

    expect(engine.state.executed).toEqual(['seek 10', ...SWITCH])
    expect(engine.state.fullscreen).toBe(true)
    expect(engine.state.stopped).toBe(true)
    expect(ch.display()).toBe('fullscreen')
    expect(onDisplay.mock.calls).toEqual([['fullscreen']])
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(commandFiles()).toEqual([])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('dropping 1'))

    // Back to window: `exec q2l_loop.cfg` resets q2l_seq to 0 and the loop re-execs the control file.
    engine.back()
    expect(engine.state.q2lSeq).toBe(0)
    expect(engine.state.stopped).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(ch.display()).toBe('stage')
    expect(onDisplay.mock.calls).toEqual([['fullscreen'], ['stage']])
    expect(switches(engine.state.executed)).toBe(1)
    expect(engine.state.executions.get(2)).toBe(1)
    expect(engine.state.fullscreen).toBe(false)
    expect(engine.state.stopped).toBe(false)

    // The queue resumes with the next seq, which the reset q2l_seq 0 cannot match.
    expect(ch.send('seek 30').ok).toBe(true)
    vi.advanceTimersByTime(500)
    expect(engine.state.executed).toEqual(['seek 10', ...SWITCH, 'seek 30'])
    expect(engine.state.executions.get(3)).toBe(1)
    expect(engine.state.executions.get(2)).toBe(1)
    expect(controlFile()).toBe(asFile(buildControlFile([])))
  })

  it('several commands in flight ahead of the switch each run once, the switch last', async () => {
    const { ch, log } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir)
    engine.run()
    vi.advanceTimersByTime(200)

    expect(ch.send('seek 10').ok).toBe(true)
    expect(ch.send('seek 20').ok).toBe(true)
    expect(ch.enterFullscreen().ok).toBe(true)
    expect(ch.send('seek 30').ok).toBe(true)
    // The switch goes out with the commands before it; the one after it is held back.
    expect(controlFile()).toBe(asFile(buildControlFile([1, 2, 3])))
    vi.advanceTimersByTime(1000)

    expect(engine.state.executed).toEqual(['seek 10', 'seek 20', ...SWITCH])
    expect([...engine.state.executions]).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ])
    expect(ch.display()).toBe('fullscreen')
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(commandFiles()).toEqual([])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('dropping 1'))

    // Back to window resets q2l_seq to 0; no earlier guard is left in the file to re-fire.
    engine.back()
    vi.advanceTimersByTime(500)
    expect(ch.display()).toBe('stage')
    expect(ch.send('seek 40').ok).toBe(true)
    expect(ch.send('seek 50').ok).toBe(true)
    vi.advanceTimersByTime(500)
    expect(engine.state.executed).toEqual(['seek 10', 'seek 20', ...SWITCH, 'seek 40', 'seek 50'])
    expect(switches(engine.state.executed)).toBe(1)
    for (const seq of [1, 2, 3, 4, 5]) expect(engine.state.executions.get(seq)).toBe(1)
  })

  it('the channel returns to the stage only on a fresh FS 0 sample', async () => {
    const { ch } = makeChannel()
    const onDisplay = withDisplayLog(ch)
    await ch.start()
    const engine = createFakeEngine(dir, { buffered: true })
    engine.run()
    vi.advanceTimersByTime(200)

    expect(ch.enterFullscreen().ok).toBe(true)
    // The log holds everything back: the switch runs, but neither its ACK nor any POS arrives.
    vi.advanceTimersByTime(ACK_TIMEOUT_MS + 100)
    expect(engine.state.stopped).toBe(true)
    expect(ch.display()).toBe('fullscreen')
    expect(onDisplay.mock.calls).toEqual([['fullscreen']])
    const positionAtSwitch = ch.latest().positionMs

    // Late, in one flush: every pre-stop `POS … FS 0`, then the switch's ACK.
    engine.flush()
    const flushed = readFileSync(logPath(), 'utf8')
    expect(flushed).toContain(' FS 0 P 0\n')
    expect(flushed.endsWith(`${PREFIX}ACK 1\n`)).toBe(true)
    vi.advanceTimersByTime(LOG_POLL_MS)
    // Even later: stale lines of the other kinds.
    appendFileSync(logPath(), `${PREFIX}POS 0:01.0 FS 1\n${PREFIX}ACK 1\n${PREFIX}POS 0:01.0\n`)
    vi.advanceTimersByTime(LOG_POLL_MS * 3)
    expect(ch.display()).toBe('fullscreen')
    expect(onDisplay.mock.calls).toEqual([['fullscreen']])
    // Position lines update nothing while fullscreen.
    expect(ch.latest().positionMs).toBe(positionAtSwitch)

    engine.back()
    vi.advanceTimersByTime(200)
    expect(ch.display()).toBe('stage')
    expect(onDisplay.mock.calls).toEqual([['fullscreen'], ['stage']])
    engine.pause()
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(ch.latest().positionMs).toBe(engine.state.lastPosMs)
    expect(switches(engine.state.executed)).toBe(1)
  })

  it('a missing ACK still enters fullscreen after the timeout, and FS 0 samples bring it back', async () => {
    const { ch, log } = makeChannel()
    const onDisplay = withDisplayLog(ch)
    await ch.start()
    const engine = createFakeEngine(dir, { ack: false })
    engine.run()
    vi.advanceTimersByTime(200)

    expect(ch.enterFullscreen().ok).toBe(true)
    vi.advanceTimersByTime(ACK_TIMEOUT_MS - 100)
    expect(engine.state.stopped).toBe(true)
    // Entering still shows on the stage.
    expect(ch.display()).toBe('stage')
    expect(onDisplay).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(ch.display()).toBe('fullscreen')
    expect(onDisplay.mock.calls).toEqual([['fullscreen']])
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('fullscreen switch'))
    expect(controlFile()).toBe(asFile(buildControlFile([])))

    engine.back()
    vi.advanceTimersByTime(200)
    expect(ch.display()).toBe('stage')
    expect(onDisplay.mock.calls).toEqual([['fullscreen'], ['stage']])
    expect(engine.state.executed).toEqual(SWITCH)
    expect(ch.send('seek 5').ok).toBe(true)
    vi.advanceTimersByTime(200)
    expect(engine.state.executed).toEqual([...SWITCH, 'seek 5'])
  })

  it("an FS 1 sample on the stage follows the user's switch", async () => {
    const { ch } = makeChannel()
    const onDisplay = withDisplayLog(ch)
    await ch.start()
    const engine = createFakeEngine(dir)
    engine.run()
    vi.advanceTimersByTime(200)

    engine.state.fullscreen = true // Alt+Enter in the game
    vi.advanceTimersByTime(500)
    // Only the loop is stopped: the mode is already fullscreen.
    expect(engine.state.executed).toEqual(FOLLOW)
    expect(switches(engine.state.executed)).toBe(0)
    expect(engine.state.stopped).toBe(true)
    expect(ch.display()).toBe('fullscreen')
    expect(onDisplay.mock.calls).toEqual([['fullscreen']])
    expect(controlFile()).toBe(asFile(buildControlFile([])))

    engine.back()
    vi.advanceTimersByTime(500)
    expect(ch.display()).toBe('stage')
    expect(onDisplay.mock.calls).toEqual([['fullscreen'], ['stage']])
    expect(engine.state.executions.get(1)).toBe(1)
  })

  it('sends in fullscreen fail with replays.playback.error.fullscreen', async () => {
    const { ch } = makeChannel()
    await ch.start()
    const engine = createFakeEngine(dir)
    engine.run()
    const onFinished = vi.fn()
    ch.onFinished(onFinished)
    expect(ch.enterFullscreen().ok).toBe(true)
    vi.advanceTimersByTime(500)
    expect(ch.display()).toBe('fullscreen')

    expect(ch.send('seek 5')).toEqual(FULLSCREEN_ERROR)
    expect(ch.enterFullscreen()).toEqual(FULLSCREEN_ERROR)
    vi.advanceTimersByTime(500)
    expect(engine.state.executed).toEqual(SWITCH)
    expect(controlFile()).toBe(asFile(buildControlFile([])))
    expect(commandFiles()).toEqual([])

    // The demo ending while fullscreen behaves as on the stage.
    appendFileSync(logPath(), `${PREFIX}Demo finished\n`)
    vi.advanceTimersByTime(LOG_POLL_MS)
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(controlFile()).toBe(asFile(buildStopFile()))
    expect(ch.send('seek 5')).toEqual({
      ok: false,
      error: { key: 'replays.playback.error.noSession' },
    })
  })

  it('close removes q2l_back.cfg', async () => {
    const { ch } = makeChannel()
    await ch.start()
    expect(readFileSync(join(dir, BACK_TO_WINDOW_CFG), 'utf8')).toBe(
      asFile(buildBackToWindowCfg('win32')),
    )
    await ch.close()
    expect(existsSync(join(dir, BACK_TO_WINDOW_CFG))).toBe(false)
  })
})
