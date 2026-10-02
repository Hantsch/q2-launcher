#!/usr/bin/env node
// Story 174 spike (D1): with con_notifylines 0 (set on the command line, while the game's q2config.cfg
// says `seta con_notifylines "4"`), does the real Q2PRO still draw chat in the chat HUD during demo
// playback, with no notify lines at the top? Throwaway probe, run by hand on Windows; nothing imports it.
// Usage: node probe.mjs [q2pro.exe] [game] [demo]
// Ends the game with WM_CLOSE (CloseMainWindow), never a kill: the logfile only flushes on a clean exit.

import { spawn, execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SPIKE_DIR = fileURLToPath(new URL('.', import.meta.url))
const WIN_PROBE = join(SPIKE_DIR, '..', '169-windowed-stage', 'win-probe.ps1')
const Q2PRO = process.argv[2] ?? 'C:/Games/Q2Pro/q2pro.exe'
const GAME = process.argv[3] ?? 'opentdm'
const DEMO = process.argv[4] ?? 'PFAU_20221127-053327_q2dm1.mvd2' // contains "lamb shanker: gl" (svc_print level 3)
const ROOT = join(Q2PRO, '..')
const GAME_DIR = join(ROOT, GAME)
const CONFIG = join(GAME_DIR, 'q2config.cfg')
const BACKUP = join(SPIKE_DIR, 'results', 'q2config.cfg.bak')
const LOOP_CFG = 'q2l_probe_loop.cfg'
const CTL_CFG = 'q2l_probe_ctl.cfg'
const LOG_NAME = 'q2l_probe.log'
const LOG_PATH = join(GAME_DIR, 'logs', LOG_NAME)
const SHOTS = [4, 7, 10, 13, 16] // seconds after launch

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const ps = (args) =>
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
    encoding: 'utf-8',
  }).trim()

function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf-8')
  renameSync(tmp, path)
}

function capture(client, out) {
  const cmd = `Add-Type -AssemblyName System.Drawing; Add-Type 'using System.Runtime.InteropServices; public static class D { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'; [void][D]::SetProcessDPIAware(); $b = New-Object System.Drawing.Bitmap ${client.w}, ${client.h}; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${client.x}, ${client.y}, 0, 0, $b.Size); $b.Save('${out.split('/').join(String.fromCharCode(92))}', [System.Drawing.Imaging.ImageFormat]::Png)`
  ps(['-Command', cmd])
}

async function main() {
  mkdirSync(join(GAME_DIR, 'logs'), { recursive: true })
  mkdirSync(join(SPIKE_DIR, 'results'), { recursive: true })
  rmSync(LOG_PATH, { force: true })
  const before = sha(CONFIG)
  copyFileSync(CONFIG, BACKUP)
  const result = { demo: DEMO, game: GAME, shots: [] }
  try {
    const original = readFileSync(CONFIG, 'utf-8')
    writeFileSync(CONFIG, `${original.replace(/\s*$/, '')}\nseta con_notifylines "4"\n`)
    writeAtomic(join(GAME_DIR, CTL_CFG), 'echo POS $cl_demopos\n')
    writeAtomic(
      join(GAME_DIR, LOOP_CFG),
      `alias q2l_probe_loop "exec ${CTL_CFG}; wait 5; q2l_probe_loop"\nq2l_probe_loop\n`,
    )
    const args = [
      '+set',
      'game',
      GAME,
      '+set',
      'vid_fullscreen',
      '0',
      '+set',
      'vid_geometry',
      '800x600+100+100',
      '+set',
      'win_alwaysontop',
      '1',
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
      'con_notifylines',
      '0',
      '+set',
      'scr_chathud',
      '1',
      '+demo',
      DEMO,
      '+exec',
      LOOP_CFG,
    ]
    console.log('launch', args.join(' '))
    const child = spawn(Q2PRO, args, { cwd: ROOT, stdio: 'ignore' })
    let exited = false
    child.on('exit', () => (exited = true))
    const t0 = Date.now()
    await sleep(2500)
    const geo = JSON.parse(ps(['-File', WIN_PROBE, '-ProcessId', String(child.pid)]))
    result.geometry = geo
    // From here on the control file also reads back the two cvars once per loop pass.
    writeAtomic(
      join(GAME_DIR, CTL_CFG),
      'echo POS $cl_demopos\necho NL $con_notifylines CH $scr_chathud\n',
    )
    for (const s of SHOTS) {
      await sleep(Math.max(0, t0 + s * 1000 - Date.now()))
      const out = join(SPIKE_DIR, 'results', `shot-${s}s.png`)
      capture(geo.client, out)
      result.shots.push(out)
    }
    ps(['-Command', `[void](Get-Process -Id ${child.pid}).CloseMainWindow()`])
    for (let i = 0; i < 100 && !exited; i++) await sleep(100)
    result.exitedCleanly = exited
    if (!exited) console.error('game did not exit on WM_CLOSE; NOT killing (log stays buffered)')
  } finally {
    // q2pro rewrites q2config.cfg on exit; put the original back byte-exact.
    for (let i = 0; i < 20; i++) {
      try {
        copyFileSync(BACKUP, CONFIG)
        break
      } catch {
        await sleep(250)
      }
    }
    result.configRestored = sha(CONFIG) === before
    for (const f of [LOOP_CFG, CTL_CFG]) rmSync(join(GAME_DIR, f), { force: true })
    if (result.configRestored) rmSync(BACKUP, { force: true })
  }
  const text = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'latin1') : ''
  const lines = text.split('\n').map((l) => l.replace(/^\[[^\]]*\] /, '').replace(/\r$/, ''))
  result.nlLines = [...new Set(lines.filter((l) => l.startsWith('NL ')))]
  result.chatSeenInLog = lines.filter((l) => /lamb shanker/.test(l)).slice(0, 3)
  result.posSamples = lines
    .filter((l) => l.startsWith('POS '))
    .filter((_, i, a) => i % Math.ceil(a.length / 8) === 0)
  writeFileSync(join(SPIKE_DIR, 'results', 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
