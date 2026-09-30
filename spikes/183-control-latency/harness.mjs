#!/usr/bin/env node
// Story 183 spike (D1): where does demo-control latency on Windows come from? Throwaway harness, run
// by hand on Windows with a real q2pro.exe; not imported by src/, not wired into any build or test.
//
// The baseline is production: the loop cfg, control file, command cfg, stop file and launch args come
// unmodified from src/main/modules/replays/playback-channel/protocol.ts (loaded through jiti). Every
// other configuration changes exactly one lever (or, for combo-N, a few) on top of it:
//   L1 loop wait frames (wait5/wait2/wait1)
//   L2 forced log flush (flush<N>, logtoggle, pad)
//   L3 no-wait dispatch (multiseq: several guarded seqs in one control file; coalesce: queued lines in one command cfg)
//   L4 ACK via an engine-written file instead of the log (fileack)
//
// The effect time comes ONLY from an engine-written marker: every command line is sent as
// `<command>; writeconfig q2l_mk_<id>`, so the marker file is written by the engine in the same guarded
// exec as the command, and the host polls for it. Log lines are never used as the effect time.
//
// Pitfalls honoured (spikes 133/169/174): the logfile is buffered, so the game is ended with WM_CLOSE
// (CloseMainWindow), never killed, and the log is read after exit; `+demo` precedes `+exec`; no free
// line ever sits inside the guard's quoted string; the log is deleted before each run; every file the
// harness writes is removed afterwards and q2config.cfg is restored byte-exact.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync, openSync, readSync, fstatSync, closeSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createJiti } from 'jiti'

const SPIKE_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO = resolve(SPIKE_DIR, '..', '..')
const RESULTS = join(SPIKE_DIR, 'results')
const WIN_PROBE = join(SPIKE_DIR, '..', '169-windowed-stage', 'win-probe.ps1')
const PROTOCOL_TS = join(REPO, 'src', 'main', 'modules', 'replays', 'playback-channel', 'protocol.ts')

const jiti = createJiti(import.meta.url, { alias: { '@shared': join(REPO, 'src', 'shared') } })
const P = await jiti.import(PROTOCOL_TS)
const {
  ACK_TIMEOUT_MS, CONTROL_CFG_NAME, LOG_FILE_NAME, LOG_FILE_RELATIVE, LOG_POLL_MS, LOOP_CFG_NAME, LOOP_WAIT_FRAMES,
  buildControlFile, buildLoopCfg, buildStopFile, commandCfgName, encodeControlCommand, parseEngineLine, toCfgText,
  windowsLaunchArgs,
} = P

const TAIL_POLL_MS = 10
const STARTUP_MS = 4000
const SINGLE_SPACING_MS = 1000
const SINGLE_JITTER_MS = 400 // > two production ticks (~200 ms each)
const BURST_GAP_MS = 100 // 3 commands within 300 ms
const CPU_WINDOW_MS = 30000
const MARKER_PREFIX = 'q2l_mk_'
const AFTERARG = 'S183_AFTERARG'
const GEOMETRY = '960x540+80+80'
const FLUSH_CANDIDATES = [0, 2, 3, 1] // ends on production's 1
const SINGLE_MIX = ['pause', 'pause', 'seek +10', 'seek -10', 'timescale 2', 'timescale 1']
const BURST_MIX = ['pause', 'seek -10', 'pause']
/** The test demo is ~40 s long: rewind (housekeeping, excluded from the stats) before it can end. */
const REWIND_ABOVE_MS = 20000

/** Production: wait 13, logfile 2, logfile_flush 1, one command in flight, next only on the log ACK. */
const BASE = { waitFrames: LOOP_WAIT_FRAMES, flush: null, logToggle: false, pad: false, dispatch: 'serial', ackVia: 'log' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10) / 10)
const ps = (args) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf-8' }).trim()
const d = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : a - b)

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return { n: 0, p50: null, p95: null, max: null }
  const at = (p) => v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))]
  return { n: v.length, p50: r1(at(50)), p95: r1(at(95)), max: r1(v[v.length - 1]) }
}

function parseArgs(argv) {
  const o = { config: 'baseline', all: false, exe: 'C:/Games/Q2Pro/q2pro.exe', game: 'opentdm', demo: 'test-demo-for-launcher.dm2', samples: 30, bursts: 10 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      return argv[++i]
    }
    if (a === '--config') o.config = v()
    else if (a === '--all') o.all = true
    else if (a === '--exe') o.exe = v()
    else if (a === '--game') o.game = v()
    else if (a === '--demo') o.demo = v()
    else if (a === '--samples') o.samples = Number(v())
    else if (a === '--bursts') o.bursts = Number(v())
    else throw new Error(`unknown argument ${a}`)
  }
  if (!(o.samples >= 1) || !(o.bursts >= 0)) throw new Error('--samples must be >= 1, --bursts >= 0')
  return o
}

function q2proRunning() {
  return /q2pro\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq q2pro.exe', '/NH'], { encoding: 'utf-8' }))
}

function winProbe(pid) {
  return JSON.parse(ps(['-File', WIN_PROBE, '-ProcessId', String(pid)]))
}

/** Spike 174's DPI-aware client-area capture. */
function capture(client, out) {
  const cmd = `Add-Type -AssemblyName System.Drawing; Add-Type 'using System.Runtime.InteropServices; public static class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'; [void][D]::SetProcessDPIAware(); $b = New-Object System.Drawing.Bitmap ${client.w}, ${client.h}; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${client.x}, ${client.y}, 0, 0, $b.Size); $b.Save('${out.split('/').join('\\')}', [System.Drawing.Imaging.ImageFormat]::Png)`
  ps(['-Command', cmd])
}

/** Ticks are culture-independent (a German Windows prints `CPU` with a decimal comma). */
function cpuSeconds(pid) {
  return Number(ps(['-Command', `(Get-Process -Id ${pid}).TotalProcessorTime.Ticks`])) / 1e7
}

/** Reads what the engine appended since the last call; whole lines only. */
function createTail(path) {
  const buffer = Buffer.alloc(256 * 1024)
  let position = 0
  let partial = ''
  return {
    read() {
      let fd
      try {
        fd = openSync(path, 'r')
      } catch {
        return { lines: [], bytes: 0 }
      }
      let text = ''
      let bytes = 0
      try {
        // logtoggle reopens the file in append mode; a smaller file means it was replaced.
        if (fstatSync(fd).size < position) {
          position = 0
          partial = ''
        }
        for (;;) {
          const n = readSync(fd, buffer, 0, buffer.length, position)
          if (n === 0) break
          position += n
          bytes += n
          text += buffer.toString('latin1', 0, n)
        }
      } finally {
        closeSync(fd)
      }
      if (!text) return { lines: [], bytes: 0 }
      const lines = (partial + text).split(/\r?\n/)
      partial = lines.pop() ?? ''
      return { lines: lines.filter(Boolean), bytes }
    },
  }
}

function makeEnv(opts) {
  const root = resolve(opts.exe, '..')
  const gameDir = join(root, opts.game)
  return {
    exe: opts.exe,
    root,
    game: opts.game,
    demo: opts.demo,
    gameDir,
    // `writeconfig <name>` writes `<gamedir>/configs/<name>.cfg`; the engine creates the dir if needed.
    markerDir: join(gameDir, 'configs'),
    markerDirExisted: existsSync(join(gameDir, 'configs')),
    logPath: join(gameDir, ...LOG_FILE_RELATIVE.split('/')),
    controlPath: join(gameDir, CONTROL_CFG_NAME),
    loopPath: join(gameDir, LOOP_CFG_NAME),
    padLines: [],
    padBytes: null,
  }
}

function listQ2l(env) {
  const dirs = [...new Set([env.gameDir, env.markerDir])]
  const found = []
  for (const dir of dirs) {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) if (name.startsWith('q2l_')) found.push(join(dir, name))
  }
  return found
}

/**
 * One game launch under one configuration. `driver(api)` issues the commands; the session tails the
 * log and polls the markers every TAIL_POLL_MS, dispatches per the configuration's L3/L4 levers, and
 * afterwards measures CPU, ends the game with WM_CLOSE, reads the log and removes its files.
 */
async function runSession(env, name, cfg, driver, { cpu = true } = {}) {
  const r = { name, levers: cfg, cfgTexts: {}, notes: [], sideEffects: { screenshot: null } }
  const written = new Set()
  const spin = new Int32Array(new SharedArrayBuffer(4))
  let tmpN = 0
  let renameRetries = 0
  function writeAtomic(path, text) {
    tmpN += 1
    const tmp = `${path}.${process.pid}.${tmpN}.tmp`
    written.add(tmp)
    writeFileSync(tmp, text, 'utf8')
    for (let i = 0; ; i++) {
      try {
        renameSync(tmp, path)
        break
      } catch (e) {
        // The engine may be reading the target this very moment (Windows share lock).
        if (i >= 50) throw e
        renameRetries += 1
        Atomics.wait(spin, 0, 0, 2)
      }
    }
    written.delete(tmp)
    written.add(path)
  }
  const extras = [...(cfg.logToggle ? ['logfile 0', 'logfile 2'] : []), ...(cfg.pad ? env.padLines : [])]
  const withExtras = (text) => (extras.length ? text + toCfgText(extras) : text)
  const keep = (key, text) => {
    if (!(key in r.cfgTexts)) r.cfgTexts[key] = text
  }
  const idleText = withExtras(toCfgText(buildControlFile([])))
  const writeControl = (text, key) => {
    keep(key, text)
    writeAtomic(env.controlPath, text)
  }

  const stale = listQ2l(env)
  for (const p of stale) rmSync(p, { force: true })
  r.staleAtStart = stale.map((p) => basename(p))
  mkdirSync(dirname(env.logPath), { recursive: true })
  rmSync(env.logPath, { force: true })
  const configPath = join(env.gameDir, 'q2config.cfg')
  const configBackup = existsSync(configPath) ? readFileSync(configPath) : null

  const loopText = toCfgText(buildLoopCfg(cfg.waitFrames))
  keep('loop', loopText)
  writeAtomic(env.loopPath, loopText)
  writeControl(idleText, 'controlIdle')
  r.cfgTexts.stop = toCfgText(buildStopFile())

  const { argsBeforeDemo, argsAfterDemo } = windowsLaunchArgs()
  const args = [
    '+set', 'game', env.game,
    '+set', 'vid_fullscreen', '0', '+set', 'vid_geometry', GEOMETRY, '+set', 'win_alwaysontop', '1',
    ...argsBeforeDemo,
    ...(cfg.flush !== null ? ['+set', 'logfile_flush', String(cfg.flush)] : []),
    '+demo', env.demo,
    ...argsAfterDemo,
    '+echo', AFTERARG,
  ]
  r.launch = { exe: env.exe, cwd: env.root, args, argsBeforeDemo, argsAfterDemo }

  const samples = []
  const batches = []
  const sizeJumps = []
  const ticks = []
  const blocked = []
  const tickErrors = []
  const queue = []
  const pending = new Map()
  let inFlight = null
  let nextSeq = 1
  let nextId = 1
  let demoFinished = false
  let latestPos = null
  let exited = false
  let draining = false
  let exitAt = null
  let stopAt = null
  const tail = createTail(env.logPath)
  const markerPath = (s) => join(env.markerDir, `${MARKER_PREFIX}${s.id}.cfg`)
  const lineFor = (s) => `${s.cmd}; writeconfig ${MARKER_PREFIX}${s.id}`
  const entries = () => (cfg.dispatch === 'multiseq' ? [...pending.values()] : inFlight ? [inFlight] : [])

  function sendSerial() {
    if (inFlight || queue.length === 0) return
    const batch = cfg.dispatch === 'coalesce' ? queue.splice(0) : [queue.shift()]
    const seq = nextSeq++
    const enc =
      batch.length === 1
        ? encodeControlCommand(seq, lineFor(batch[0]))
        : { controlText: toCfgText(buildControlFile([seq])), commandText: toCfgText(batch.map(lineFor)) }
    const cmdPath = join(env.gameDir, commandCfgName(seq))
    if (!r.firstCommand && batch.length === 1) r.firstCommand = { seq, line: lineFor(batch[0]) }
    keep('commandFirst', enc.commandText)
    writeAtomic(cmdPath, enc.commandText)
    writeControl(withExtras(enc.controlText), 'controlFirstCommand')
    const at = performance.now()
    for (const s of batch) Object.assign(s, { seq, writtenAt: at, batchSize: batch.length })
    inFlight = { seq, batch, sentAt: at, cmdPath }
  }

  function writeMulti() {
    const lines = buildControlFile([])
    for (const seq of [...pending.keys()].sort((a, b) => a - b)) {
      // Monotonic guard: every pending seq runs once, several in the same tick.
      lines.push(`if $q2l_seq < ${seq} then "exec ${commandCfgName(seq)}; set q2l_seq ${seq}; echo ACK ${seq}"`)
    }
    writeControl(withExtras(toCfgText(lines)), pending.size ? 'controlFirstCommand' : 'controlIdle')
  }

  function sendMulti(s) {
    const seq = nextSeq++
    const enc = encodeControlCommand(seq, lineFor(s))
    const cmdPath = join(env.gameDir, commandCfgName(seq))
    keep('commandFirst', enc.commandText)
    writeAtomic(cmdPath, enc.commandText)
    const entry = { seq, batch: [s], sentAt: 0, cmdPath }
    pending.set(seq, entry)
    writeMulti()
    entry.sentAt = performance.now()
    Object.assign(s, { seq, writtenAt: entry.sentAt, batchSize: 1 })
  }

  function settle(entry, now, how) {
    for (const s of entry.batch) {
      s.done = true
      s.doneHow = how
      if (how === 'timeout') s.timedOut = true
      if (how === 'file') s.fileAckAt = now
    }
    // Like production: only an acknowledged command file goes now (its guard can never fire again);
    // a timed-out one may still be exec'd late and is removed at the end.
    if (how !== 'timeout') rmSync(entry.cmdPath, { force: true })
    if (cfg.dispatch === 'multiseq') {
      pending.delete(entry.seq)
      writeMulti()
    } else {
      inFlight = null
      if (queue.length) sendSerial()
      else writeControl(idleText, 'controlIdle')
    }
  }

  function onLogAck(seq, now) {
    for (const s of samples) {
      if (s.seq !== seq) continue
      s.logAckLive += 1
      if (s.logAckAt === null) {
        s.logAckAt = now
        s.logAckAfterExit = draining
      }
    }
    if (draining || cfg.ackVia !== 'log') return
    const entry = entries().find((x) => x.seq === seq)
    if (entry) settle(entry, now, 'log')
  }

  function tick() {
    const now = performance.now()
    if (precise && !draining) ticks.push(now) // hostPollIntervals: the sampling phase only
    try {
      const { lines, bytes } = tail.read()
      if (bytes > 0) sizeJumps.push({ t: now, bytes })
      let posAck = 0
      for (const raw of lines) {
        const e = parseEngineLine(raw)
        if (e.kind === 'pos') {
          posAck += 1
          if (e.positionMs !== null) latestPos = e.positionMs
        } else if (e.kind === 'ack') {
          posAck += 1
          onLogAck(e.seq, now)
        } else if (e.kind === 'finished') demoFinished = true
      }
      if (posAck > 0) batches.push({ t: now, lines: posAck, afterExit: draining })
      const clockOffset = Date.now() - now
      for (const s of samples) {
        if (s.markerSeenAt !== null && now - s.markerSeenAt > 5000) continue
        const st = statSync(markerPath(s), { throwIfNoEntry: false })
        if (!st) continue
        if (s.lastMtime === null || Math.abs(st.mtimeMs - s.lastMtime) > 5) {
          s.markerWrites += 1
          s.lastMtime = st.mtimeMs
        }
        if (s.markerSeenAt === null) {
          s.markerSeenAt = now
          s.markerMtimeAt = st.mtimeMs - clockOffset
        }
      }
      if (draining) return
      for (const entry of entries()) {
        if (cfg.ackVia === 'file' && entry.batch.every((s) => s.markerSeenAt !== null)) settle(entry, now, 'file')
        else if (now - entry.sentAt >= ACK_TIMEOUT_MS) settle(entry, now, 'timeout')
      }
    } catch (e) {
      if (tickErrors.length < 20) tickErrors.push(String(e.message))
    }
  }

  function block(fn) {
    const a = performance.now()
    try {
      return fn()
    } finally {
      blocked.push([a, performance.now()])
    }
  }

  function request(cmd, kind = 'single', burst = null) {
    const s = {
      id: nextId++, kind, burst, cmd, requestedAt: performance.now(), seq: null, writtenAt: null, batchSize: null,
      markerSeenAt: null, markerMtimeAt: null, markerWrites: 0, lastMtime: null,
      logAckAt: null, logAckLive: 0, logAckAfterExit: false, fileAckAt: null, done: false, doneHow: null, timedOut: false,
    }
    samples.push(s)
    if (cfg.dispatch === 'multiseq') sendMulti(s)
    else {
      queue.push(s)
      sendSerial()
    }
    return s
  }

  async function until(pred, timeoutMs) {
    const t0 = performance.now()
    while (!pred() && !exited && performance.now() - t0 < timeoutMs) await sleep(TAIL_POLL_MS)
    return pred()
  }

  const launchAt = performance.now()
  console.log(`[${name}] launch ${env.exe} ${args.join(' ')}`)
  const child = spawn(env.exe, args, { cwd: env.root, stdio: 'ignore' })
  child.on('exit', () => {
    exited = true
    exitAt = performance.now()
  })
  // Node timers on Windows fire at the ~15.6 ms system tick, so a 10 ms poll needs a yielding spin
  // (setImmediate: timers and I/O still run). It costs the harness one core, not q2pro; the CPU
  // windows switch back to plain timers.
  let polling = true
  let precise = true
  const immediate = () => new Promise((res) => setImmediate(res))
  const pollLoop = (async () => {
    let next = performance.now()
    while (polling) {
      tick()
      next = Math.max(next + TAIL_POLL_MS, performance.now() - TAIL_POLL_MS)
      if (!precise) await sleep(TAIL_POLL_MS)
      else while (polling && performance.now() < next) await immediate()
    }
  })()
  const api = {
    request,
    until,
    sleep,
    latestPos: () => latestPos,
    probe: () => block(() => winProbe(child.pid)),
    screenshot(out) {
      try {
        const geo = block(() => winProbe(child.pid))
        block(() => capture(geo.client, out))
        r.sideEffects.screenshot = relative(SPIKE_DIR, out).split('\\').join('/')
      } catch (e) {
        r.notes.push(`screenshot failed: ${String(e.message).slice(0, 200)}`)
      }
    },
  }

  try {
    await sleep(STARTUP_MS)
    if (exited) throw new Error('q2pro exited during startup')
    await driver(api)
  } catch (e) {
    r.driverError = String(e.stack ?? e)
  }
  const driverEndAt = performance.now()

  precise = false
  if (!exited) {
    queue.length = 0
    pending.clear()
    inFlight = null
    writeControl(idleText, 'controlIdle')
    if (cpu) {
      const c0 = block(() => cpuSeconds(child.pid))
      const t0 = performance.now()
      await sleep(CPU_WINDOW_MS)
      const c1 = block(() => cpuSeconds(child.pid))
      const t1 = performance.now()
      writeControl(toCfgText(buildStopFile()), 'stop')
      stopAt = performance.now()
      await sleep(1000)
      const c2 = block(() => cpuSeconds(child.pid))
      const t2 = performance.now()
      await sleep(CPU_WINDOW_MS)
      const c3 = block(() => cpuSeconds(child.pid))
      const t3 = performance.now()
      const running = (c1 - c0) / ((t1 - t0) / 1000)
      const stopped = (c3 - c2) / ((t3 - t2) / 1000)
      r.sideEffects.cpu = { loopRunningCpuSecPerSec: Math.round(running * 10000) / 10000, afterStopCpuSecPerSec: Math.round(stopped * 10000) / 10000, runningCpuSec: Math.round((c1 - c0) * 1000) / 1000, stoppedCpuSec: Math.round((c3 - c2) * 1000) / 1000, raw: { c0, c1, c2, c3, t0, t1, t2, t3 } }
      r.sideEffects.cpuDeltaPct = stopped > 0 ? r1(((running - stopped) / stopped) * 100) : null
    } else {
      writeControl(toCfgText(buildStopFile()), 'stop')
      stopAt = performance.now()
      await sleep(500)
    }
    block(() => ps(['-Command', `[void](Get-Process -Id ${child.pid}).CloseMainWindow()`]))
    const closeAt = performance.now()
    while (!exited && performance.now() - closeAt < 10000) await sleep(50)
  }
  r.exitedCleanly = exited
  if (!exited) r.notes.push('game did not exit on WM_CLOSE; NOT killed (the log stays buffered) - end it by hand')
  polling = false
  await pollLoop
  draining = true
  tick()

  const logText = existsSync(env.logPath) ? readFileSync(env.logPath, 'latin1') : ''
  const logLines = logText.split(/\r?\n/).filter(Boolean)

  // Cleanup: every file this session wrote, every marker, the log; then scan for anything left.
  const toRemove = [...written, ...samples.map(markerPath), env.logPath]
  let left = []
  for (let attempt = 0; attempt < 5; attempt++) {
    left = []
    for (const p of toRemove) {
      try {
        rmSync(p, { force: true })
      } catch {
        left.push(p)
      }
    }
    if (left.length === 0) break
    await sleep(300)
  }
  let markerDirRemoved = false
  if (!env.markerDirExisted && existsSync(env.markerDir) && readdirSync(env.markerDir).length === 0) {
    rmdirSync(env.markerDir)
    markerDirRemoved = true
  }
  let configRestored = configBackup === null
  if (configBackup !== null && exited) {
    for (let i = 0; i < 20 && !configRestored; i++) {
      try {
        writeFileSync(configPath, configBackup)
        configRestored = readFileSync(configPath).equals(configBackup)
      } catch {
        await sleep(250)
      }
    }
  }
  r.cleanup = {
    filesWritten: toRemove.length,
    removeFailed: left.map((p) => basename(p)),
    leftover: listQ2l(env).map((p) => basename(p)),
    logLeft: existsSync(env.logPath),
    markerDirRemoved,
    markerDirLeft: !env.markerDirExisted && existsSync(env.markerDir),
    configRestored,
  }

  Object.assign(r, summarize({ cfg, samples, batches, sizeJumps, ticks, blocked, launchAt, stopAt: stopAt ?? driverEndAt, logLines }))
  r.demoFinished = demoFinished
  r.renameRetries = renameRetries
  r.tickErrors = tickErrors
  r.timing = { launchAt: 0, stopAt: r1(d(stopAt, launchAt)), exitAt: r1(d(exitAt, launchAt)) }
  const rel = (x) => r1(d(x, launchAt))
  r.samples = samples.map((s) => ({
    id: s.id, kind: s.kind, burst: s.burst, cmd: s.cmd, seq: s.seq, batchSize: s.batchSize,
    requestedAt: rel(s.requestedAt), writtenAt: rel(s.writtenAt), markerSeenAt: rel(s.markerSeenAt), markerMtimeAt: rel(s.markerMtimeAt),
    logAckAt: rel(s.logAckAt), logAckAfterExit: s.logAckAfterExit, fileAckAt: rel(s.fileAckAt), doneHow: s.doneHow, timedOut: s.timedOut,
    markerMtimeChanges: s.markerWrites, logAckLines: s.logAckLines, markerLogLines: s.markerLogLines,
    tookEffect: s.tookEffect, effectCheck: s.effectCheck, effectDetail: s.effectDetail ?? null, exactlyOnce: s.exactlyOnce,
  }))
  r.batches = batches.map((b) => ({ t: rel(b.t), lines: b.lines, afterExit: b.afterExit }))
  // Not persisted: the raw log (the preflight reads it).
  Object.defineProperty(r, 'logLines', { value: logLines, enumerable: false })
  Object.defineProperty(r, 'sizeJumpsRaw', { value: sizeJumps.map((j) => ({ t: j.t, bytes: j.bytes })), enumerable: false })
  return r
}

function summarize({ cfg, samples, batches, sizeJumps, ticks, blocked, launchAt, stopAt, logLines }) {
  const out = {}
  const entries = logLines.map((raw) => ({ ...parseEngineLine(raw), line: raw.replace(/^\[[^\]]*\] /, '') }))

  // Exactly-once: the guard echoes `ACK <seq>` each time it fires; writeconfig names the marker.
  const ackLines = new Map()
  const markerLines = new Map()
  for (const e of entries) {
    if (e.kind === 'ack') ackLines.set(e.seq, (ackLines.get(e.seq) ?? 0) + 1)
    for (const m of e.line.matchAll(/q2l_mk_(\d+)\b/g)) markerLines.set(Number(m[1]), (markerLines.get(Number(m[1])) ?? 0) + 1)
  }
  judgeEffects(entries, samples, cfg.waitFrames)
  for (const s of samples) {
    s.logAckLines = s.seq === null ? 0 : ackLines.get(s.seq) ?? 0
    s.markerLogLines = markerLines.get(s.id) ?? 0
    // Authoritative: the engine's own lines (`ACK <seq>` per guard firing, `Wrote configs/q2l_mk_<id>.cfg.`
    // per marker write). Host-seen mtime changes are informational only (a write in progress can show two).
    s.exactlyOnce = s.markerSeenAt !== null && s.logAckLines === 1 && s.markerLogLines === 1
    s.tookEffect = s.markerSeenAt === null ? false : s.effectCheck === false ? false : true
  }
  const measured = samples.filter((s) => s.kind !== 'housekeeping')
  const singles = measured.filter((s) => s.kind === 'single')
  const logAck = (s) => (s.logAckAfterExit ? null : s.logAckAt)
  const configAck = (s) => (cfg.ackVia === 'file' ? s.fileAckAt : logAck(s))
  const grid = (t) => (t === null ? null : launchAt + Math.ceil((t - launchAt) / LOG_POLL_MS) * LOG_POLL_MS)

  // AC1a: effect = host request -> engine-written marker seen by the host (10 ms poll).
  out.effect = stats(singles.map((s) => d(s.markerSeenAt, s.requestedAt)))
  out.effectMtime = stats(singles.map((s) => d(s.markerMtimeAt, s.requestedAt)))
  out.ack = stats(singles.map((s) => d(configAck(s), s.requestedAt)))
  out.ackAtProductionPoll = stats(singles.map((s) => d(grid(configAck(s)), s.requestedAt)))
  out.logAck = stats(singles.map((s) => d(logAck(s), s.requestedAt)))
  out.controlToMarker = stats(singles.map((s) => d(s.markerSeenAt, s.writtenAt))) // tick share
  out.markerToAck = stats(singles.map((s) => d(logAck(s), s.markerSeenAt))) // flush + poll share
  out.markerToAckAtProductionPoll = stats(singles.map((s) => d(grid(logAck(s)), s.markerSeenAt)))

  const groups = new Map()
  for (const s of measured.filter((x) => x.kind === 'burst')) groups.set(s.burst, [...(groups.get(s.burst) ?? []), s])
  const lastOf = (g, f) => (g.some((s) => f(s) === null || f(s) === undefined) ? null : Math.max(...g.map(f)) - Math.min(...g.map((s) => s.requestedAt)))
  const lastAck = stats([...groups.values()].map((g) => lastOf(g, configAck)))
  out.burst = {
    n: groups.size,
    lastAck,
    lastEffect: stats([...groups.values()].map((g) => lastOf(g, (s) => s.markerSeenAt))),
    lastAckVsSingleMs: r1(d(lastAck.p50, out.ack.p50)),
  }

  // Flush intervals: arrival of read batches holding new POS/ACK lines, while the loop ran, without
  // gaps caused by the harness's own blocking PowerShell calls.
  const live = batches.filter((b) => !b.afterExit && b.t >= launchAt + STARTUP_MS && b.t <= stopAt)
  const intervals = []
  for (let i = 1; i < live.length; i++) {
    const a = live[i - 1].t
    const b = live[i].t
    if (!blocked.some(([x, y]) => x < b && y > a)) intervals.push(b - a)
  }
  out.flushIntervals = stats(intervals)
  out.linesPerBatch = stats(live.map((b) => b.lines))
  const buckets = [...new Set(live.map((b) => Math.ceil((b.t - launchAt) / LOG_POLL_MS)))]
  const intervals50 = []
  for (let i = 1; i < buckets.length; i++) {
    const a = launchAt + buckets[i - 1] * LOG_POLL_MS
    const b = launchAt + buckets[i] * LOG_POLL_MS
    if (!blocked.some(([x, y]) => x < b && y > a)) intervals50.push(b - a)
  }
  out.flushIntervalsAtProductionPoll = stats(intervals50)
  out.bytesPerFlush = stats(sizeJumps.filter((j) => j.t <= stopAt).map((j) => j.bytes))
  const tickGaps = []
  for (let i = 1; i < ticks.length; i++) tickGaps.push(ticks[i] - ticks[i - 1])
  out.hostPollIntervals = stats(tickGaps)

  out.tookEffect = {
    yes: measured.filter((s) => s.tookEffect).length,
    no: measured.filter((s) => !s.tookEffect).length,
    stateConfirmed: measured.filter((s) => s.effectCheck === true).length,
    stateContradicted: measured.filter((s) => s.effectCheck === false).length,
    stateUnknown: measured.filter((s) => s.effectCheck === null).length,
  }
  out.exactlyOnce = {
    ok: measured.filter((s) => s.exactlyOnce).length,
    total: measured.length,
    duplicates: measured.filter((s) => s.logAckLines > 1 || s.markerLogLines > 1).map((s) => s.id),
  }
  const quiet = /^(Execing |PAD|Wrote configs\/q2l_mk_)/
  out.notableLines = [...new Set(entries.filter((e) => e.kind === 'other' && !quiet.test(e.line)).map((e) => e.line))].slice(0, 60)
  out.timeouts = measured.filter((s) => s.timedOut).length

  // Side effects: launcher lines per second while the loop lived, by kind; starvation probe.
  let lastPos = -1
  let firstPos = -1
  entries.forEach((e, i) => {
    if (e.kind === 'pos') {
      lastPos = i
      if (firstPos < 0) firstPos = i
    }
  })
  const kinds = { Execing: 0, POS: 0, ACK: 0, PAD: 0, other: 0 }
  for (let i = 0; i <= lastPos; i++) {
    const e = entries[i]
    if (e.line.startsWith('Execing')) kinds.Execing++
    else if (e.kind === 'pos') kinds.POS++
    else if (e.kind === 'ack') kinds.ACK++
    else if (e.line.startsWith('PAD')) kinds.PAD++
    else kinds.other++
  }
  const loopSeconds = (stopAt - launchAt) / 1000
  const afterIdx = entries.findIndex((e) => e.line === AFTERARG)
  out.sideEffectsPartial = {
    linesPerSec: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, r1(v / loopSeconds)])),
    linesTotalWhileLoop: kinds,
    starved: !(afterIdx >= 0 && afterIdx < lastPos),
    afterArg: { seen: afterIdx >= 0, lineIndex: afterIdx, firstPosIndex: firstPos, lastPosIndex: lastPos },
  }
  out.logLineCount = entries.length
  return out
}

/**
 * Does the log show the command's effect? Compares the POS line of the tick that ran the command
 * with the next one; null when it cannot tell (another ACK in the same span, coalesced, no position).
 */
function judgeEffects(entries, samples, waitFrames) {
  const posIdx = []
  const ackIdx = new Map()
  entries.forEach((e, i) => {
    if (e.kind === 'pos') posIdx.push(i)
    if (e.kind === 'ack' && !ackIdx.has(e.seq)) ackIdx.set(e.seq, i)
  })
  for (const s of samples) {
    s.effectCheck = null
    const i = s.seq === null ? undefined : ackIdx.get(s.seq)
    if (i === undefined || s.batchSize !== 1) continue
    let k = -1
    for (let j = 0; j < posIdx.length && posIdx[j] < i; j++) k = j
    if (k < 0 || k + 1 >= posIdx.length) continue
    let other = false
    for (let j = posIdx[k] + 1; j < posIdx[k + 1]; j++) if (entries[j].kind === 'ack' && j !== i) other = true
    if (other) continue
    const res = checkEffect(s.cmd, entries, posIdx, k, waitFrames)
    s.effectCheck = res.ok
    s.effectDetail = res.detail
  }
}

function checkEffect(cmd, entries, posIdx, k, waitFrames) {
  const pre = entries[posIdx[k]]
  const post = entries[posIdx[k + 1]]
  const detail = { prePos: pre.positionMs, postPos: post.positionMs, prePaused: pre.paused, postPaused: post.paused }
  const res = (ok, extra = {}) => ({ ok, detail: { ...detail, ...extra } })
  if (cmd === 'pause') return res(pre.paused === null || post.paused === null ? null : pre.paused !== post.paused)
  if (pre.positionMs === null || post.positionMs === null) return res(null)
  const delta = post.positionMs - pre.positionMs
  if (cmd === 'seek +10') return res(delta >= 7000 && delta <= 14000)
  if (cmd === 'seek -10') return res((delta <= -7000 && delta >= -14000) || (delta < 0 && post.positionMs <= 1000))
  const ts = /^timescale (\S+)$/.exec(cmd)
  if (!ts) return res(null)
  // Demo-time advance per tick before vs after, over a window of ~0.8 s wall time.
  const W = Math.max(4, Math.ceil(52 / waitFrames))
  if (k - W < 0 || k + 1 + W >= posIdx.length) return res(null)
  const at = (j) => entries[posIdx[j]].positionMs
  const [a, b, c, e] = [at(k - W), at(k), at(k + 1), at(k + 1 + W)]
  if ([a, b, c, e].some((x) => x === null)) return res(null)
  const before = (b - a) / W
  const after = (e - c) / W
  const extra = { windowTicks: W, msPerTickBefore: r1(before), msPerTickAfter: r1(after) }
  if (before <= 0 || after < 0) return res(null, extra)
  return res(Number(ts[1]) > 1 ? after / before > 1.4 : after / before < 0.75, extra)
}

// ---------------------------------------------------------------------------------------------------

async function preflight(env) {
  const pf = { marker: { kind: null }, logfileFlush: { tested: FLUSH_CANDIDATES, accepted: [], echoed: {} }, ifLessThan: null }
  let flushChangeAt = null
  let markerId = null
  const s = await runSession(
    env,
    'preflight',
    { ...BASE },
    async (api) => {
      const mk = api.request('echo S183_PF_MARKER')
      markerId = mk.id
      await api.until(() => mk.done, ACK_TIMEOUT_MS + 2000)
      await api.until(() => mk.markerSeenAt !== null, 1500)
      pf.marker.writeconfig = { seen: mk.markerSeenAt !== null, dir: mk.markerSeenAt !== null ? env.markerDir : null }
      if (mk.markerSeenAt === null) {
        // Another build may write elsewhere: use that dir from here on (this preflight's times are void).
        for (const dir of [env.gameDir, join(env.root, 'baseq2', 'configs'), join(env.root, 'baseq2'), env.root]) {
          const p = join(dir, `${MARKER_PREFIX}${mk.id}.cfg`)
          if (!existsSync(p)) continue
          rmSync(p, { force: true })
          Object.assign(pf.marker.writeconfig, { seen: true, dir, foundElsewhere: true })
          Object.assign(env, { markerDir: dir, markerDirExisted: true })
          break
        }
      }
      const lt = api.request('if 1 < 2 then "echo S183_LT_OK"')
      await api.until(() => lt.done, ACK_TIMEOUT_MS + 2000)
      flushChangeAt = performance.now()
      for (const v of FLUSH_CANDIDATES) {
        const x = api.request(`set logfile_flush ${v}; echo S183_LF ${v} $logfile_flush`)
        await api.until(() => x.done, ACK_TIMEOUT_MS + 2000)
      }
      if (!pf.marker.writeconfig.seen) {
        const g = api.request('set vid_geometry 640x480+120+120')
        await api.until(() => g.done, ACK_TIMEOUT_MS + 2000)
        await api.sleep(1500)
        const rect = api.probe()
        pf.marker.geometry = { asked: '640x480+120+120', got: rect, works: rect?.client?.w === 640 && rect?.client?.h === 480 }
      }
    },
    { cpu: false },
  )
  const lines = s.logLines.map((l) => l.replace(/^\[[^\]]*\] /, ''))
  pf.ifLessThan = lines.includes('S183_LT_OK')
  for (const l of lines) {
    const m = /^S183_LF (\d+) (\S*)$/.exec(l)
    if (!m) continue
    pf.logfileFlush.echoed[m[1]] = m[2]
    if (m[1] === m[2]) pf.logfileFlush.accepted.push(Number(m[1]))
  }
  pf.logfileFlush.semantics = 'Q2PRO logfile_open: 0 = CRT default buffering, 1 = setvbuf _IOLBF (full buffering on the MSVC CRT), >1 = _IONBF'
  pf.marker.kind = pf.marker.writeconfig?.seen ? 'writeconfig' : pf.marker.geometry?.works ? 'geometry' : null
  pf.marker.writeconfigLogLines = lines.filter((l) => l.includes(`${MARKER_PREFIX}${markerId}`))
  const jumps = s.sizeJumpsRaw.filter((j) => flushChangeAt === null || j.t < flushChangeAt).map((j) => j.bytes)
  pf.bufferBytes = { fromSizeJumpsAtFlush1: stats(jumps) }
  pf.session = { exitedCleanly: s.exitedCleanly, cleanup: s.cleanup, driverError: s.driverError ?? null, launch: s.launch, notes: s.notes }
  return pf
}

function configFor(name, ctx) {
  if (name === 'baseline') return { ...BASE }
  const w = /^wait(\d+)$/.exec(name)
  if (w) return { ...BASE, waitFrames: Number(w[1]) }
  const f = /^flush(\d+)$/.exec(name)
  if (f) {
    if (!ctx.preflight.logfileFlush.accepted.includes(Number(f[1]))) throw new Error(`${name}: the build does not accept logfile_flush ${f[1]}`)
    return { ...BASE, flush: Number(f[1]) }
  }
  if (name === 'logtoggle') return { ...BASE, logToggle: true }
  if (name === 'pad') return { ...BASE, pad: true }
  if (name === 'multiseq') return { ...BASE, dispatch: 'multiseq' }
  if (name === 'coalesce') return { ...BASE, dispatch: 'coalesce' }
  if (name === 'fileack') return { ...BASE, ackVia: 'file' }
  const c = /^combo-([1234])$/.exec(name)
  if (c) {
    const parts = comboParts(ctx)[Number(c[1]) - 1]
    const merged = { ...BASE }
    for (const part of parts) {
      const lever = configFor(part, ctx)
      for (const k of Object.keys(BASE)) if (lever[k] !== BASE[k]) merged[k] = lever[k]
    }
    return { ...merged, composedOf: parts }
  }
  throw new Error(`unknown configuration ${name}`)
}

function loadEarlierConfigs(ownTs) {
  const merged = {}
  const files = existsSync(RESULTS) ? readdirSync(RESULTS).filter((f) => f.endsWith('.json') && f !== `${ownTs}.json`).sort() : []
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(RESULTS, f), 'utf8'))
      if (j.options && j.options.samples < 20) continue
      for (const [k, v] of Object.entries(j.configs ?? {})) if (!k.startsWith('combo-')) merged[k] = v
    } catch {}
  }
  return merged
}

/**
 * combo-1 = best L1 + best L2; combo-2 = + best L3; combo-3 = best L1 + L4 (fileack) + best L3;
 * combo-4 = flush3 + multiseq at the production wait (no L1 change).
 * "Best" comes from this run's results when they exist (--all runs combos last), else a static choice.
 */
function comboParts(ctx) {
  // Each invocation writes its own JSON, so a combo run also draws on earlier results files (this run wins).
  const res = { ...loadEarlierConfigs(ctx.ts), ...ctx.configs }
  const flushNames = ctx.preflight.logfileFlush.accepted.filter((v) => v !== 1).map((v) => `flush${v}`)
  const best = (names, metric, fallback) => {
    const scored = names.filter((n) => res[n] && metric(res[n]) !== null)
    return scored.length ? scored.sort((a, b) => metric(res[a]) - metric(res[b]))[0] : fallback
  }
  const l1 = best(['wait5', 'wait2', 'wait1'], (x) => x.effect.p50, 'wait2')
  const l2 = best([...flushNames, 'logtoggle', 'pad'], (x) => x.markerToAck.p50, flushNames.includes('flush2') ? 'flush2' : 'logtoggle')
  const l3 = best(['multiseq', 'coalesce'], (x) => x.burst.lastAck.p50, 'coalesce')
  return [[l1, l2], [l1, l2, l3], [l1, 'fileack', l3], ['flush3', 'multiseq']]
}

function allNames(pf) {
  const flush = pf.logfileFlush.accepted.filter((v) => v !== 1).map((v) => `flush${v}`)
  return ['baseline', 'wait5', 'wait2', 'wait1', ...flush, 'logtoggle', 'pad', 'multiseq', 'coalesce', 'fileack', 'combo-1', 'combo-2', 'combo-3', 'combo-4']
}

function sampleDriver(opts, ts, name) {
  return async (api) => {
    const housekeeping = async (cmd) => {
      const h = api.request(cmd, 'housekeeping')
      await api.until(() => h.done, ACK_TIMEOUT_MS + 3000)
      await api.sleep(300)
    }
    const keepInRange = async () => {
      const p = api.latestPos()
      if (p !== null && p > REWIND_ABOVE_MS) await housekeeping('seek 5')
    }
    for (let i = 0; i < opts.samples; i++) {
      await keepInRange()
      const s = api.request(SINGLE_MIX[i % SINGLE_MIX.length], 'single')
      await api.until(() => s.done, ACK_TIMEOUT_MS + 3000)
      // Jitter: "done" is locked to a log flush, which is locked to the loop tick; without it every
      // request would land at the same tick phase and bias the effect time (seen in a 5-sample run).
      await api.sleep(SINGLE_SPACING_MS + Math.random() * SINGLE_JITTER_MS)
    }
    api.screenshot(join(RESULTS, `${ts}-${name}.png`))
    for (let b = 0; b < opts.bursts; b++) {
      await keepInRange()
      const group = []
      for (let j = 0; j < BURST_MIX.length; j++) {
        if (j > 0) await api.sleep(BURST_GAP_MS)
        group.push(api.request(BURST_MIX[j], 'burst', b))
      }
      await api.until(() => group.every((s) => s.done), BURST_MIX.length * ACK_TIMEOUT_MS + 3000)
      await api.sleep(SINGLE_SPACING_MS)
    }
    // Same demo state for both CPU windows (loop running / after stop), far from the demo's end.
    await housekeeping('timescale 1')
    await housekeeping('seek 0')
  }
}

function productionCheck(r, env) {
  const c = r.cfgTexts
  const enc = r.firstCommand ? encodeControlCommand(r.firstCommand.seq, r.firstCommand.line) : null
  const { argsBeforeDemo, argsAfterDemo } = windowsLaunchArgs()
  const joined = r.launch.args.join('\u0000')
  return {
    loop: c.loop === toCfgText(buildLoopCfg()),
    controlIdle: c.controlIdle === toCfgText(buildControlFile([])),
    controlFirstCommand: enc !== null && c.controlFirstCommand === enc.controlText,
    commandFirst: enc !== null && c.commandFirst === enc.commandText,
    stop: c.stop === toCfgText(buildStopFile()),
    launchArgs: joined.includes([...argsBeforeDemo, '+demo', env.demo, ...argsAfterDemo].join('\u0000')),
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (q2proRunning()) {
    console.error('q2pro.exe is running - refusing to start (end it first)')
    process.exit(2)
  }
  const env = makeEnv(opts)
  if (!existsSync(env.exe)) throw new Error(`no q2pro at ${env.exe}`)
  if (!existsSync(join(env.gameDir, 'demos', opts.demo))) throw new Error(`no demo ${opts.demo} in ${join(env.gameDir, 'demos')}`)
  mkdirSync(RESULTS, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = join(RESULTS, `${ts}.json`)
  const out = {
    ts,
    options: opts,
    protocol: { LOOP_CFG_NAME, CONTROL_CFG_NAME, LOG_FILE_NAME, LOG_FILE_RELATIVE, LOG_POLL_MS, ACK_TIMEOUT_MS, LOOP_WAIT_FRAMES },
    harness: { TAIL_POLL_MS, STARTUP_MS, SINGLE_SPACING_MS, SINGLE_JITTER_MS, BURST_GAP_MS, CPU_WINDOW_MS, SINGLE_MIX, BURST_MIX, REWIND_ABOVE_MS, GEOMETRY },
    preflight: null,
    configs: {},
  }
  const save = () => writeFileSync(outPath, JSON.stringify(out, null, 2))

  out.preflight = await preflight(env)
  save()
  if (!out.preflight.session.exitedCleanly) throw new Error(`preflight: game did not exit on WM_CLOSE - aborting (${outPath})`)
  if (out.preflight.marker.kind !== 'writeconfig') {
    // The geometry fallback is recorded by the preflight, but sampling needs a file marker.
    throw new Error(`preflight: writeconfig marker not usable (kind ${out.preflight.marker.kind}) - see ${outPath}`)
  }
  const buf = out.preflight.bufferBytes.fromSizeJumpsAtFlush1.p50 ?? 1024
  env.padBytes = Math.max(512, buf) + 64
  env.padLines = []
  for (let left = env.padBytes; left > 0; left -= 900) env.padLines.push(`echo PAD${'x'.repeat(Math.min(900, left))}`)
  out.preflight.padBytes = env.padBytes

  const names = opts.all ? allNames(out.preflight) : [opts.config]
  for (const name of names) {
    if (q2proRunning()) throw new Error(`q2pro.exe is running before ${name} - aborting`)
    const cfg = configFor(name, out)
    const res = await runSession(env, name, cfg, sampleDriver(opts, ts, name))
    res.sideEffects = { ...res.sideEffectsPartial, cpuDeltaPct: res.sideEffects.cpuDeltaPct ?? null, cpu: res.sideEffects.cpu ?? null, screenshot: res.sideEffects.screenshot }
    delete res.sideEffectsPartial
    if (name === 'baseline') res.productionUnmodified = productionCheck(res, env)
    if (cfg.pad) res.padBytes = env.padBytes
    out.configs[name] = res
    save()
    console.log(`[${name}] effect p50 ${res.effect.p50} ms, ack p50 ${res.ack.p50} ms, flush p50 ${res.flushIntervals.p50} ms, leftover ${res.cleanup.leftover.length}`)
    if (!res.exitedCleanly) throw new Error(`${name}: game did not exit on WM_CLOSE - aborting`)
  }
  out.q2proRunningAfter = q2proRunning()
  save()
  console.log('results:', outPath)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
