#!/usr/bin/env node
// Story 133 D1 spike: proves the launcher can steer a Q2PRO engine playing a demo
// (pause / seek / timescale) and read back playback position, purely through console
// commands funneled via a self-rescheduling cfg + a polled control file -- no native
// code, no engine patch. Throwaway harness, run by hand on Windows with a real
// q2pro.exe and demo; not imported by src/, not wired into any build or test.
//
// -----------------------------------------------------------------------------------
// EXACTLY-ONCE MECHANISM (read this before touching sendCommand/pollLog below)
// -----------------------------------------------------------------------------------
// spike133.cfg (see spike133.cfg.template) installs an alias that re-execs a small
// "control file" every --wait frames, forever:
//   alias spike133_loop "exec <control file>; wait <N>; spike133_loop"
// That means whatever the control file contains gets re-run on every tick, which
// would double-fire a command if we just left it in place. The guard therefore
// lives *inside* the engine: the pinned Q2PRO build (r3834) has a console `if`
// command (`if <expr> <op> <expr> [then] <command>`, verified in the binary), so
// the COMMAND shape of the control file is
//
//   if $spike133_seq != <seq> then "<command>; set spike133_seq <seq>; echo ACK <seq>"
//
// The first exec runs the command and bumps the `spike133_seq` cvar in the same
// buffer pass; every later re-exec of the same file sees the cvar already at <seq>
// and does nothing. Exactly-once is thus an engine-side guarantee, not a race
// against the harness. (A harness-side-only idle swap was tried first and fired
// every command 2-8 times: the loop ticks every ~40ms at 125fps, faster than the
// harness can observe the ACK and swap the file.)
//
// The control file has two shapes, always written atomically (temp file +
// fs.renameSync in the same directory, so `exec` never sees a half-written file):
//
//   1. IDLE shape: only the position readback echo.
//   2. COMMAND shape: the idle echo PLUS the guarded command line above.
//
// After observing `ACK <seq>` the harness still swaps back to IDLE (hygiene only),
// and still reports any repeated `ACK <seq>` as a DUPLICATE -- with the guard in
// place that list should stay empty; a non-empty one means the guard failed.
//
// Position readback: `$cl_demopos` (a Q2PRO macro, verified in the binary; format
// m:ss.f) is echoed under the `POS` prefix.
// -----------------------------------------------------------------------------------

import { spawn, execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const SPIKE_DIR = fileURLToPath(new URL('.', import.meta.url))

const CONTROL_FILE_NAME = 'spike133_ctl.cfg'
const LOOP_CFG_NAME = 'spike133.cfg'
const DEFAULT_WAIT_FRAMES = 5

// --- CLI parsing (argv only, no dependency) -----------------------------------------

function parseArgs(argv) {
  const args = { wait: DEFAULT_WAIT_FRAMES, run: 'scripted' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--q2pro':
        args.q2pro = argv[++i]
        break
      case '--game':
        args.game = argv[++i]
        break
      case '--demo':
        args.demo = argv[++i]
        break
      case '--wait':
        args.wait = Number.parseInt(argv[++i], 10)
        break
      case '--run':
        args.run = argv[++i]
        break
      default:
        console.error(`Unknown argument: ${arg}`)
        process.exit(1)
    }
  }
  return args
}

function printUsageAndExit() {
  console.error(
    'Usage: node harness.mjs --q2pro <path to q2pro.exe> --game <gamedir> --demo <filename in <gamedir>/demos/> ' +
      '[--wait <frames per tick, default 5>] [--run scripted|interactive]',
  )
  process.exit(1)
}

function validateArgs(args) {
  if (!args.q2pro || !args.game || !args.demo) {
    printUsageAndExit()
  }
  if (!Number.isFinite(args.wait) || args.wait <= 0) {
    console.error(`--wait must be a positive integer, got: ${args.wait}`)
    process.exit(1)
  }
  if (args.run !== 'scripted' && args.run !== 'interactive') {
    console.error(`--run must be "scripted" or "interactive", got: ${args.run}`)
    process.exit(1)
  }

  const exePath = resolve(args.q2pro)
  if (!existsSync(exePath)) {
    console.error(`q2pro executable not found: ${exePath}`)
    process.exit(1)
  }

  const gameDir = resolve(args.game)
  if (!existsSync(gameDir)) {
    console.error(`Game directory not found: ${gameDir}`)
    process.exit(1)
  }

  const demoPath = join(gameDir, 'demos', args.demo)
  if (!existsSync(demoPath)) {
    console.error(`Demo file not found: ${demoPath}`)
    process.exit(1)
  }

  return { exePath, gameDir, demoName: args.demo, waitFrames: args.wait, runMode: args.run }
}

// --- cfg generation ------------------------------------------------------------------

/** Mirrors spike133.cfg.template -- see its header comment. Kept inline so the
 * harness has no runtime dependency on reading its own sibling file. */
function buildLoopCfg(waitFrames) {
  return [
    // Must be numeric before the first guarded `if` runs, or `!=` rejects it.
    'set spike133_seq 0',
    `alias spike133_loop "exec ${CONTROL_FILE_NAME}; wait ${waitFrames}; spike133_loop"`,
    'spike133_loop',
    '',
  ].join('\n')
}

/** IDLE shape (no pending command) or COMMAND shape (pending command with seq). See
 * the exactly-once mechanism comment at the top of this file. */
function buildControlFile(pending) {
  const lines = []
  lines.push('echo POS $cl_demopos')
  if (pending) {
    const { command, seq } = pending
    lines.push(
      `if $spike133_seq != ${seq} then "${command}; set spike133_seq ${seq}; echo ACK ${seq}"`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

/** Atomic write: temp file in the same directory, then renameSync over the real
 * path, so the engine's `exec` (which polls this same file) never reads a partial
 * write. Never write the destination path directly. */
function writeFileAtomic(destPath, content) {
  const tempPath = `${destPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, content, 'utf-8')
  renameSync(tempPath, destPath)
}

// --- logfile tailing -------------------------------------------------------------------

/** Polls file size + reads only the newly appended bytes. Windows has no cheap
 * inotify-equivalent among Node builtins, so this is a plain poll loop. */
function createLogTailer(logPath) {
  // Start at the current end: `logfile 2` appends, so the file still holds ACK lines
  // from earlier runs that would otherwise be mistaken for this run's ACKs.
  let offset = existsSync(logPath) ? statSync(logPath).size : 0
  // A read can land mid-line while the engine is still writing it; hold the
  // unterminated tail back until its newline arrives.
  let partial = ''
  return {
    /** Returns any newly appended lines since the last call, or [] if the file
     * doesn't exist yet (the engine may not have created it at the first poll). */
    readNewLines() {
      if (!existsSync(logPath)) return []
      const size = statSync(logPath).size
      if (size < offset) {
        offset = 0 // truncated/recreated by the engine
        partial = ''
      }
      if (size <= offset) return []
      const fd = openSync(logPath, 'r')
      try {
        const length = size - offset
        const buffer = Buffer.alloc(length)
        readSync(fd, buffer, 0, length, offset)
        offset = size
        const lines = (partial + buffer.toString('utf-8')).split(/\r?\n/)
        partial = lines.pop()
        return lines.filter(Boolean)
      } finally {
        closeSync(fd)
      }
    },
    currentSize() {
      return existsSync(logPath) ? statSync(logPath).size : 0
    },
  }
}

// Q2PRO prefixes every logfile line with `logfile_prefix` (default "[YYYY-MM-DD HH:MM] ").
const LOG_PREFIX = /^\[[^\]]*\]\s*/
const ACK_LINE = /^ACK (\d+)$/
const POS_LINE = /^POS (.+)$/

// --- CPU sampling (Windows-only helper, best-effort) ------------------------------------

/** Shells out to PowerShell via execFile (argv array, no shell string) to read a
 * process's CPU-seconds counter. Best-effort: on failure (process exited, PowerShell
 * unavailable, non-Windows box) resolves to null rather than throwing, since CPU
 * sampling is a nice-to-have for the spike's report, not load-bearing. */
function sampleCpuSeconds(pid) {
  return new Promise((resolvePromise) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid} | Select-Object -ExpandProperty CPU)`],
      { windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolvePromise(null)
          return
        }
        const value = Number.parseFloat(String(stdout).trim())
        resolvePromise(Number.isFinite(value) ? value : null)
      },
    )
  })
}

// --- main ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { exePath, gameDir, demoName, waitFrames, runMode } = validateArgs(args)

  const loopCfgPath = join(gameDir, LOOP_CFG_NAME)
  const controlFilePath = join(gameDir, CONTROL_FILE_NAME)
  // Q2PRO writes the console log under <gamedir>/logs/, not the gamedir root.
  const logFilePath = join(gameDir, 'logs', 'qconsole.log')

  writeFileAtomic(loopCfgPath, buildLoopCfg(waitFrames))
  writeFileAtomic(controlFilePath, buildControlFile(null))

  const resultsDir = join(SPIKE_DIR, 'results')
  mkdirSync(resultsDir, { recursive: true })

  // Keep the extension: without one, `demo` assumes .dm2 and fails on .mvd2 files.
  // With it, Q2PRO's `demo` hands .mvd2 files over to `mvdplay` itself.
  const demoFile = basename(demoName)

  // logfile 2 = flush-per-line (conventional q2pro/quake2-derived cvar values;
  // exact behaviour not verified against a live install -- see header comment).
  const spawnArgs = [
    '+set',
    'game',
    basename(gameDir),
    '+set',
    'logfile',
    '2',
    '+set',
    'logfile_flush',
    '1',
    '+set',
    'logfile_name',
    'qconsole.log',
    // `+demo` MUST precede `+exec`: the loop alias re-inserts itself at the front of
    // the command buffer every tick, so anything queued after it never runs.
    '+demo',
    demoFile,
    '+exec',
    LOOP_CFG_NAME,
  ]

  console.log(`Launching: ${exePath} ${spawnArgs.join(' ')}`)
  // NEVER shell:true -- always argv array, per repo/spike convention.
  const child = spawn(exePath, spawnArgs, { cwd: gameDir, shell: false, stdio: 'ignore' })

  const results = {
    startedAt: new Date().toISOString(),
    exePath,
    gameDir,
    demoName,
    waitFrames,
    runMode,
    commands: [],
    posSamples: [],
    cpuSamples: {},
    logGrowth: {},
    duplicates: [],
  }

  let exiting = false
  const cleanup = () => {
    if (exiting) return
    exiting = true
    console.log('\nCleaning up spike cfg/control files (logfile is left in place)...')
    try {
      rmSync(loopCfgPath, { force: true })
    } catch {
      // best-effort
    }
    try {
      rmSync(controlFilePath, { force: true })
    } catch {
      // best-effort
    }
  }

  const tailer = createLogTailer(logFilePath)

  process.on('SIGINT', () => {
    results.logGrowth.endBytes = tailer.currentSize()
    cleanup()
    writeResults(resultsDir, results)
    process.exit(0)
  })

  child.on('exit', (code) => {
    console.log(`q2pro exited (code ${code}).`)
    results.logGrowth.endBytes = tailer.currentSize()
    cleanup()
    writeResults(resultsDir, results)
    process.exit(0)
  })

  let nextSeq = 1
  const pendingAcks = new Map() // seq -> { command, sentAt }
  const ackedSeqs = new Set()

  results.logGrowth.startBytes = tailer.currentSize()
  results.cpuSamples.baseline = await sampleCpuSeconds(child.pid)

  /** Sends one command: writes the COMMAND-shape control file with a fresh seq,
   * then resolves once the matching ACK is observed in the logfile (or times out). */
  function sendCommand(command, timeoutMs = 10000) {
    const seq = nextSeq++
    const sentAt = Date.now()
    let lastPosBefore = results.posSamples.length
      ? results.posSamples[results.posSamples.length - 1].value
      : null

    writeFileAtomic(controlFilePath, buildControlFile({ command, seq }))
    pendingAcks.set(seq, { command, sentAt, posBefore: lastPosBefore })

    return new Promise((resolvePromise) => {
      const start = Date.now()
      const interval = setInterval(() => {
        drainLog()
        const acked = ackedSeqs.has(seq) && results.commands.find((c) => c.seq === seq)?.ackedAt
        if (acked) {
          clearInterval(interval)
          resolvePromise(true)
          return
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval)
          console.warn(`Timed out waiting for ACK ${seq} (command: ${command})`)
          results.commands.push({
            seq,
            command,
            sentAt,
            ackedAt: null,
            latencyMs: null,
            posBefore: lastPosBefore,
            posAfter: null,
          })
          // Swap back to idle even on timeout so the engine stops re-firing the command.
          writeFileAtomic(controlFilePath, buildControlFile(null))
          resolvePromise(false)
        }
      }, 50)
    })
  }

  /** Polls the logfile once, parses ACK/POS lines, updates results in place. */
  function drainLog() {
    for (const rawLine of tailer.readNewLines()) {
      const line = rawLine.replace(LOG_PREFIX, '')
      const ackMatch = ACK_LINE.exec(line)
      if (ackMatch) {
        const seq = Number.parseInt(ackMatch[1], 10)
        if (ackedSeqs.has(seq)) {
          results.duplicates.push({ seq, observedAt: new Date().toISOString() })
          console.warn(`DUPLICATE ACK observed for seq ${seq}`)
          continue
        }
        ackedSeqs.add(seq)
        const pending = pendingAcks.get(seq)
        if (pending) {
          const ackedAt = Date.now()
          const posAfter = results.posSamples.length
            ? results.posSamples[results.posSamples.length - 1].value
            : null
          results.commands.push({
            seq,
            command: pending.command,
            sentAt: pending.sentAt,
            ackedAt,
            latencyMs: ackedAt - pending.sentAt,
            posBefore: pending.posBefore,
            posAfter,
          })
          pendingAcks.delete(seq)
          // Swap the control file back to idle now that the command has fired once.
          writeFileAtomic(controlFilePath, buildControlFile(null))
        }
        continue
      }
      const posMatch = POS_LINE.exec(line)
      if (posMatch) {
        results.posSamples.push({ t: Date.now(), value: posMatch[1] })
      }
    }
  }

  // Background poll so POS samples accumulate continuously, independent of sendCommand calls.
  const backgroundPoll = setInterval(drainLog, 100)

  if (runMode === 'scripted') {
    await runScripted({ sendCommand, results, child, isMvd: /\.mvd2$/i.test(demoFile) })
    clearInterval(backgroundPoll)
    results.logGrowth.endBytes = tailer.currentSize()
    cleanup()
    writeResults(resultsDir, results)
    printSummary(results)
    child.kill()
    process.exit(0)
  } else {
    await runInteractive({ sendCommand, results })
    clearInterval(backgroundPoll)
    results.logGrowth.endBytes = tailer.currentSize()
    cleanup()
    writeResults(resultsDir, results)
    printSummary(results)
    child.kill()
    process.exit(0)
  }
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Longer MVD script, paced so each step can be watched in the game window. The
 * `cmd` prefix forwards spectator commands to the MVD server explicitly; the engine
 * answers them with "[MVD] ..." lines in the log. */
const MVD_SCRIPT = [
  'pause',
  'pause',
  'seek +30',
  'seek -20',
  'seek 50%',
  'cmd invnext',
  'cmd invnext',
  'cmd invnext',
  'cmd invprev',
  'cmd chase',
  'cmd chase',
  'cmd chase q',
  'timescale 2',
  'timescale 1',
  'seek 10%',
]
const MVD_STEP_DELAY_MS = 3000

async function runScripted({ sendCommand, results, child, isMvd }) {
  console.log('Scripted run: warming up (3s)...')
  await delay(3000)

  if (isMvd) {
    for (const command of MVD_SCRIPT) {
      console.log(`Sending: ${command}`)
      await sendCommand(command)
      await delay(MVD_STEP_DELAY_MS)
    }
    console.log('Scripted run complete, sampling CPU under load...')
    results.cpuSamples.underLoad = await sampleCpuSeconds(child.pid)
    return
  }

  const script = [
    'pause',
    'pause',
    'seek +10',
    'seek -10',
    // Absolute seek: q2pro's `seek` command interprets a plain number as an absolute
    // second offset into the demo (not a percentage), per the spike's own assumption --
    // see header comment for the "not verified live" caveat that applies to console
    // command surface generally. Chosen here over "50%" for that reason.
    'seek 30',
    'timescale 2',
    'timescale 1',
  ]

  for (const command of script) {
    console.log(`Sending: ${command}`)
    await sendCommand(command)
    await delay(500)
  }

  console.log('Scripted run complete, sampling CPU under load...')
  results.cpuSamples.underLoad = await sampleCpuSeconds(child.pid)
}

async function runInteractive({ sendCommand, results }) {
  console.log('Interactive run: type a console command and press Enter (Ctrl+C to quit).')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  await new Promise((resolvePromise) => {
    rl.on('line', async (line) => {
      const command = line.trim()
      if (!command) return
      const ok = await sendCommand(command)
      const last = results.commands[results.commands.length - 1]
      console.log(ok ? `ACK ${last?.seq} latency=${last?.latencyMs}ms` : 'no ACK (timed out)')
    })
    rl.on('close', resolvePromise)
  })
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function writeResults(resultsDir, results) {
  results.finishedAt = new Date().toISOString()
  const path = join(resultsDir, `${results.startedAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(path, JSON.stringify(results, null, 2), 'utf-8')
  console.log(`Results written to ${path}`)
}

function printSummary(results) {
  const latencies = results.commands.map((c) => c.latencyMs).filter((v) => typeof v === 'number')
  const p95 = percentile(latencies, 95)

  const posGaps = []
  for (let i = 1; i < results.posSamples.length; i++) {
    posGaps.push(results.posSamples[i].t - results.posSamples[i - 1].t)
  }
  const avgPosInterval = posGaps.length
    ? posGaps.reduce((a, b) => a + b, 0) / posGaps.length
    : null

  const cpuDelta =
    results.cpuSamples.baseline != null && results.cpuSamples.underLoad != null
      ? results.cpuSamples.underLoad - results.cpuSamples.baseline
      : null

  console.log('\n=== Summary ===')
  console.log(`Commands sent: ${results.commands.length}`)
  console.log(`p95 ACK latency: ${p95 != null ? `${p95}ms` : 'n/a'}`)
  console.log(`POS samples: ${results.posSamples.length}, avg interval: ${avgPosInterval != null ? `${avgPosInterval.toFixed(0)}ms` : 'n/a'}`)
  console.log(`CPU (baseline -> under load): ${results.cpuSamples.baseline} -> ${results.cpuSamples.underLoad} (delta ${cpuDelta})`)
  console.log(`Logfile size: ${results.logGrowth.startBytes} -> ${results.logGrowth.endBytes ?? 'n/a'} bytes`)
  console.log(`Duplicates observed: ${results.duplicates.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
