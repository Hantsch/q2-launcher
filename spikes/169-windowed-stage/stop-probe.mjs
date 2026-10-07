#!/usr/bin/env node
// Story 169 spike: which way of ending the story-164 control loop lets the command buffer drain?
// Usage: node stop-probe.mjs <plain|empty|noop|unalias|next> - launches Q2PRO windowed, lets the
// loop run 4 s, writes that variant's stop into the control file, then reports whether the stop's
// own `echo STOPPED` and the `+echo AFTERARG` queued behind the loop ever ran, and whether the
// engine stayed responsive.
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'

const ROOT = 'C:/Games/Q2Pro'
const G = `${ROOT}/opentdm`
const L = `${G}/logs/q2l_s169.log`
const variant = process.argv[2] ?? 'empty'

// `next`: the loop re-arms through a second alias, so a stop redefines that one, not the running one.
const loopCfg =
  variant === 'next' || variant === 'restart'
    ? [
        'set q2l_s169_seq 0',
        'alias q2l_s169_next q2l_s169_loop',
        'alias q2l_s169_loop "exec q2l_s169_ctl.cfg; wait 5; q2l_s169_next"',
        'q2l_s169_loop',
      ]
    : [
        'set q2l_s169_seq 0',
        'alias q2l_s169_loop "exec q2l_s169_ctl.cfg; wait 5; q2l_s169_loop"',
        'q2l_s169_loop',
      ]
const stops = {
  plain: ['echo STOPPED'],
  empty: ['alias q2l_s169_loop ""', 'echo STOPPED'],
  noop: ['alias q2l_s169_loop "echo LOOPEND"', 'echo STOPPED'],
  unalias: ['unalias q2l_s169_loop', 'echo STOPPED'],
  next: ['alias q2l_s169_next "echo LOOPEND"', 'echo STOPPED'],
  // restart: after the stop, the queued `+exec q2l_s169_restart.cfg` (where a bind's text lands) re-arms
  // the loop; the control file then answers MARK_RESTARTED only if the loop runs again.
  restart: ['alias q2l_s169_next "echo LOOPEND"', 'echo STOPPED'],
}

rmSync(L, { force: true })
writeFileSync(
  `${G}/q2l_s169_restart.cfg`,
  'echo RESTARTING\nwait 150\nalias q2l_s169_next q2l_s169_loop\nq2l_s169_loop\n',
)
writeFileSync(`${G}/q2l_s169_loop.cfg`, `${loopCfg.join('\n')}\n`)
writeFileSync(`${G}/q2l_s169_ctl.cfg`, 'echo POS $cl_demopos\n')
const args = [
  '+set',
  'game',
  'opentdm',
  '+set',
  'logfile',
  '2',
  '+set',
  'logfile_flush',
  '1',
  '+set',
  'logfile_name',
  'q2l_s169.log',
  '+set',
  'vid_fullscreen',
  '0',
  '+set',
  'vid_geometry',
  '960x540+200+150',
  '+demo',
  'test.dm2',
  '+exec',
  'q2l_s169_loop.cfg',
  '+echo',
  'AFTERARG',
  ...(variant === 'restart' ? ['+exec', 'q2l_s169_restart.cfg'] : []),
]
const c = spawn(`${ROOT}/q2pro.exe`, args, { cwd: ROOT, stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const state = () =>
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$p=Get-Process -Id ${c.pid}; Add-Type -Name H -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool IsHungAppWindow(System.IntPtr h);'; "cpuMs=$([int]$p.TotalProcessorTime.TotalMilliseconds) hung=$([U.H]::IsHungAppWindow($p.MainWindowHandle))"`,
    ],
    { encoding: 'utf8' },
  ).trim() + ` logBytes=${statSync(L).size}`

await sleep(4000)
console.log('before ', state())
writeFileSync(`${G}/q2l_s169_ctl.cfg`, `${stops[variant].join('\n')}\n`)
// A bind fires later than the stop; wait 150 frames (~3 s) stands in for that gap, in which the
// launcher swaps the stop back to the idle control file.
await sleep(700)
if (variant === 'restart')
  writeFileSync(`${G}/q2l_s169_ctl.cfg`, 'echo POS $cl_demopos\necho MARK_RESTARTED\n')
await sleep(1300)
console.log('after2s', state())
await sleep(2000)
console.log('after4s', state())
// A graceful close (WM_CLOSE) makes the engine flush its logfile; a kill would drop the tail.
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `[void](Get-Process -Id ${c.pid}).CloseMainWindow()`,
])
const tClose = Date.now()
while (c.exitCode === null && Date.now() - tClose < 5000) await sleep(100)
const closedGracefully = c.exitCode !== null
const t = readFileSync(L, 'latin1')
console.log(
  JSON.stringify({
    variant,
    closedGracefully,
    STOPPED: t.includes('STOPPED'),
    LOOPEND: t.includes('LOOPEND'),
    AFTERARG: t.includes('AFTERARG'),
    RESTARTING: t.includes('RESTARTING'),
    MARK_RESTARTED: t.includes('MARK_RESTARTED'),
  }),
)
c.kill()
rmSync(`${G}/q2l_s169_loop.cfg`)
rmSync(`${G}/q2l_s169_ctl.cfg`)
rmSync(`${G}/q2l_s169_restart.cfg`)
