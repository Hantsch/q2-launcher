#!/usr/bin/env node
// Story 169 spike: can Q2PRO play a demo as a borderless, positioned window the launcher lays over
// its own "stage" - and does the Windows control loop from story 164 starve commands the user types?
// Throwaway harness, run by hand on Windows with a real q2pro.exe; not imported by src/, not wired
// into any build or test. Same control-file mechanism as spike 133 / story 164 (guarded `if` on a
// sequence cvar, `echo POS $cl_demopos` readback), under its own file names.
//
// Probes, in one run:
//   P1 launch windowed at a given geometry (vid_geometry + win_noborder + win_alwaysontop)
//   P2 do commands appended after the loop (`+echo` after `+exec`, a line after the loop call)
//      ever run? - the same position a typed console line or a key bind lands in
//   P3 does the client answer a local out-of-band `cmd` packet (a transport that needs no loop)?
//   P4 does a live `set vid_geometry` move/resize the window?
//   P5 does playback keep running and the window stay topmost while another window has focus?
//   P6 does `vid_fullscreen 1` and back to 0 work live, and where does the window land after?
//   P7 console spam rate: `Execing` / `POS` lines per second
//   P8 does `quit` sent through the control file end the game?

import { spawn, execFileSync } from 'node:child_process'
import { createSocket } from 'node:dgram'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SPIKE_DIR = fileURLToPath(new URL('.', import.meta.url))
const Q2PRO = process.argv[2] ?? 'C:/Games/Q2Pro/q2pro.exe'
const GAME = process.argv[3] ?? 'opentdm'
const DEMO = process.argv[4] ?? 'test.dm2'
const ROOT = join(Q2PRO, '..')
const GAME_DIR = join(ROOT, GAME)
const LOOP_CFG = 'q2l_s169_loop.cfg'
const CTL_CFG = 'q2l_s169_ctl.cfg'
const LOG_NAME = 'q2l_s169.log'
const LOG_PATH = join(GAME_DIR, 'logs', LOG_NAME)
const CLIENT_PORT = 27969
const GEOMETRY_1 = '960x540+200+150'
const GEOMETRY_2 = '800x450+400+300'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf-8')
  renameSync(tmp, path)
}

function ctlFile(seq, command) {
  const lines = ['echo POS $cl_demopos']
  if (seq !== null)
    lines.push(
      `if $q2l_s169_seq != ${seq} then "${command}; set q2l_s169_seq ${seq}; echo ACK ${seq}"`,
    )
  return `${lines.join('\n')}\n`
}

let logOffset = 0
const log = []
function pollLog() {
  if (!existsSync(LOG_PATH)) return
  const text = readFileSync(LOG_PATH, 'latin1')
  if (text.length < logOffset) logOffset = 0
  const fresh = text.slice(logOffset)
  const cut = fresh.lastIndexOf('\n')
  if (cut < 0) return
  logOffset += cut + 1
  for (const raw of fresh.slice(0, cut).split('\n')) {
    log.push({ t: Date.now(), line: raw.replace(/^\[[^\]]*\] /, '').replace(/\r$/, '') })
  }
}

let seq = 0
async function send(command, timeoutMs = 3000) {
  seq += 1
  const mine = seq
  const sentAt = Date.now()
  // Story 166's route: the line sits alone in its own cfg, the guard only execs it.
  writeAtomic(
    join(GAME_DIR, `q2l_s169_cmd_${mine}.cfg`),
    `${command}
`,
  )
  writeAtomic(join(GAME_DIR, CTL_CFG), ctlFile(mine, `exec q2l_s169_cmd_${mine}.cfg`))
  while (Date.now() - sentAt < timeoutMs) {
    pollLog()
    if (log.some((l) => l.t >= sentAt && l.line === `ACK ${mine}`)) {
      writeAtomic(join(GAME_DIR, CTL_CFG), ctlFile(null))
      return { command, acked: true, ms: Date.now() - sentAt }
    }
    await sleep(50)
  }
  return { command, acked: false }
}

function probe(pid, activate = 0) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(SPIKE_DIR, 'win-probe.ps1'),
    '-ProcessId',
    String(pid),
  ]
  if (activate) args.push('-Activate', String(activate))
  try {
    return JSON.parse(execFileSync('powershell.exe', args, { encoding: 'utf-8' }).trim())
  } catch (e) {
    return { error: String(e.message).slice(0, 200) }
  }
}

/** Position samples in a window: how far the demo clock moved per wall-clock second. */
function posRate(fromT, toT) {
  const pos = log
    .filter((l) => l.t >= fromT && l.t <= toT && l.line.startsWith('POS '))
    .map((l) => ({ t: l.t, p: parsePos(l.line.slice(4)) }))
    .filter((s) => s.p !== null)
  if (pos.length < 2) return { samples: pos.length }
  const a = pos[0]
  const b = pos[pos.length - 1]
  return {
    samples: pos.length,
    demoSecondsPerSecond: +((b.p - a.p) / ((b.t - a.t) / 1000)).toFixed(2),
    from: a.p,
    to: b.p,
  }
}

function parsePos(text) {
  const m = /^(\d+):(\d{2})\.(\d)$/.exec(text.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10 : null
}

function sendUdp(payload) {
  return new Promise((resolve) => {
    const sock = createSocket('udp4')
    sock.send(payload, CLIENT_PORT, '127.0.0.1', () => {
      sock.close()
      resolve()
    })
  })
}

function otherWindowPid() {
  // Any other visible top-level window will do: prefer VS Code, else Explorer.
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -match '^(Code|explorer|WindowsTerminal)$' } | Select-Object -First 1).Id",
    ],
    { encoding: 'utf-8' },
  ).trim()
  return Number(out) || 0
}

async function main() {
  mkdirSync(join(GAME_DIR, 'logs'), { recursive: true })
  rmSync(LOG_PATH, { force: true })
  writeAtomic(
    join(GAME_DIR, LOOP_CFG),
    [
      'set q2l_s169_seq 0',
      `alias q2l_s169_loop "exec ${CTL_CFG}; wait 5; q2l_s169_loop"`,
      'q2l_s169_loop',
      'echo AFTERLOOP',
      '',
    ].join('\n'),
  )
  writeAtomic(join(GAME_DIR, CTL_CFG), ctlFile(null))

  const args = [
    '+set',
    'game',
    GAME,
    '+set',
    'logfile',
    '2',
    '+set',
    'logfile_flush',
    '1',
    '+set',
    'logfile_name',
    LOG_NAME,
    '+set',
    'vid_fullscreen',
    '0',
    '+set',
    'win_noborder',
    '1',
    '+set',
    'win_notitle',
    '1',
    '+set',
    'win_alwaysontop',
    '1',
    '+set',
    'win_noresize',
    '1',
    '+set',
    'vid_geometry',
    GEOMETRY_1,
    '+set',
    'net_clientport',
    String(CLIENT_PORT),
    '+demo',
    DEMO,
    '+exec',
    LOOP_CFG,
    '+echo',
    'AFTERARG',
  ]
  console.log('launch', args.join(' '))
  const child = spawn(Q2PRO, args, { cwd: ROOT, stdio: 'ignore' })
  let exitedAt = null
  child.on('exit', () => (exitedAt = Date.now()))
  const r = { startedAt: new Date().toISOString(), args, probes: {} }

  await sleep(4000)
  pollLog()
  r.probes.P1_launchGeometry = { asked: GEOMETRY_1, got: probe(child.pid) }
  const tFocused = Date.now()
  await sleep(2500)
  pollLog()
  r.probes.P5a_focusedRate = posRate(tFocused, Date.now())

  r.probes.P2_appendedAfterLoop = {
    AFTERARG: log.some((l) => l.line === 'AFTERARG'),
    AFTERLOOP: log.some((l) => l.line === 'AFTERLOOP'),
  }

  const tUdp = Date.now()
  await sendUdp(
    Buffer.concat([
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.from('cmd\necho UDPHELLO1\0', 'latin1'),
    ]),
  )
  await sendUdp(
    Buffer.concat([
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.from('cmd echo UDPHELLO2\n', 'latin1'),
    ]),
  )
  await sleep(1500)
  pollLog()
  r.probes.P3_oobCmd = log
    .filter((l) => l.t >= tUdp && !/^(POS|Execing|ACK)/.test(l.line))
    .map((l) => l.line)
    .slice(0, 10)

  r.probes.P4_liveGeometry = { send: await send(`set vid_geometry ${GEOMETRY_2}`) }
  await sleep(1500)
  r.probes.P4_liveGeometry.asked = GEOMETRY_2
  r.probes.P4_liveGeometry.got = probe(child.pid)

  r.probes.P4b_liveTopmost = { off: await send('set win_alwaysontop 0') }
  await sleep(800)
  r.probes.P4b_liveTopmost.afterOff = probe(child.pid).topmost
  r.probes.P4b_liveTopmost.on = await send('set win_alwaysontop 1')
  await sleep(800)
  r.probes.P4b_liveTopmost.afterOn = probe(child.pid).topmost

  const other = otherWindowPid()
  const tUnfocused = Date.now()
  const afterActivate = probe(child.pid, other)
  await sleep(3000)
  pollLog()
  r.probes.P5b_unfocused = {
    otherPid: other,
    right_after_activate: afterActivate,
    rate: posRate(tUnfocused, Date.now()),
    later: probe(child.pid),
  }

  r.probes.P6_fullscreen = { on: await send('set vid_fullscreen 1', 5000) }
  await sleep(3000)
  r.probes.P6_fullscreen.whileOn = probe(child.pid)
  r.probes.P6_fullscreen.off = await send('set vid_fullscreen 0', 5000)
  await sleep(3000)
  r.probes.P6_fullscreen.afterOff = probe(child.pid)

  pollLog()
  const span = (log[log.length - 1].t - log[0].t) / 1000
  r.probes.P7_spam = {
    seconds: +span.toFixed(1),
    execingPerSecond: +(log.filter((l) => l.line.startsWith('Execing')).length / span).toFixed(1),
    posPerSecond: +(log.filter((l) => l.line.startsWith('POS')).length / span).toFixed(1),
  }

  const tQuit = Date.now()
  writeAtomic(join(GAME_DIR, CTL_CFG), ctlFile(++seq, 'quit'))
  while (exitedAt === null && Date.now() - tQuit < 5000) await sleep(50)
  r.probes.P8_quitViaControl = { exited: exitedAt !== null, ms: exitedAt ? exitedAt - tQuit : null }
  if (exitedAt === null) child.kill()

  r.notableLines = [
    ...new Set(log.map((l) => l.line).filter((l) => !/^(POS|Execing|ACK)/.test(l))),
  ].slice(0, 80)
  for (const f of [
    LOOP_CFG,
    CTL_CFG,
    ...Array.from({ length: seq + 1 }, (_, i) => `q2l_s169_cmd_${i}.cfg`),
  ])
    rmSync(join(GAME_DIR, f), { force: true })
  mkdirSync(join(SPIKE_DIR, 'results'), { recursive: true })
  const out = join(SPIKE_DIR, 'results', `${r.startedAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(out, JSON.stringify(r, null, 2))
  console.log(JSON.stringify(r.probes, null, 2))
  console.log('results:', out)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
