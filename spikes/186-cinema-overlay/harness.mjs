// Story 186 spike: can a transparent frameless Electron overlay sit over a borderless, full-display
// Q2PRO ("cinema mode") and take all input? Throwaway harness; not imported by src/, not wired into
// any build or test. Run: npx electron spikes/186-cinema-overlay/harness.mjs [q2pro.exe] [game] [demo]
// Control-file mechanism copied from spike 169 (guarded `if` on a sequence cvar, `echo POS` readback).
// Every probe fails soft: an error is recorded under the probe and the run goes on.

import { app, BrowserWindow, screen } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SPIKE_DIR = fileURLToPath(new URL('.', import.meta.url))
const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const Q2PRO = args[0] ?? 'C:/Games/Q2Pro/q2pro.exe'
const GAME = args[1] ?? 'opentdm'
const DEMO = args[2] ?? 'test-demo-for-launcher.dm2'
const ROOT = join(Q2PRO, '..')
const GAME_DIR = join(ROOT, GAME)
const LOOP_CFG = 'q2l_s186_loop.cfg'
const CTL_CFG = 'q2l_s186_ctl.cfg'
const LOG_NAME = 'q2l_s186.log'
const LOG_PATH = join(GAME_DIR, 'logs', LOG_NAME)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const startedAt = new Date().toISOString()
const stamp = startedAt.replace(/[:.]/g, '-')
const RESULTS = join(SPIKE_DIR, 'results')
const r = {
  startedAt,
  electron: process.versions.electron,
  args: { Q2PRO, GAME, DEMO },
  probes: {},
}

// ---- Win32 probe process ---------------------------------------------------------------------
let ps = null
let psBuf = ''
const psWaiters = []
function startProbe() {
  ps = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(SPIKE_DIR, 'win-probe.ps1')],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  )
  ps.stdout.setEncoding('utf-8')
  ps.stdout.on('data', (d) => {
    psBuf += d
    let i
    while ((i = psBuf.indexOf('\n')) >= 0) {
      const line = psBuf.slice(0, i).trim()
      psBuf = psBuf.slice(i + 1)
      const w = psWaiters.shift()
      if (!w || !line) continue
      try {
        w(JSON.parse(line))
      } catch {
        w({ error: `unparsable: ${line.slice(0, 100)}` })
      }
    }
  })
}
const win = (cmd, timeoutMs = 15000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: `probe timeout: ${cmd}` }), timeoutMs)
    psWaiters.push((v) => {
      clearTimeout(t)
      resolve(v)
    })
    ps.stdin.write(`${cmd}\n`)
  })

// ---- Q2PRO control file ----------------------------------------------------------------------
function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf-8')
  renameSync(tmp, path)
}
function ctlFile(seq, command) {
  const lines = ['echo POS $cl_demopos', 'echo FPS $cl_fps']
  if (seq !== null)
    lines.push(
      `if $q2l_s186_seq != ${seq} then "${command}; set q2l_s186_seq ${seq}; echo ACK ${seq}"`,
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
  for (const raw of fresh.slice(0, cut).split('\n'))
    log.push({ t: Date.now(), line: raw.replace(/^\[[^\]]*\] /, '').replace(/\r$/, '') })
}
let seq = 0
async function send(command, timeoutMs = 3000) {
  const mine = ++seq
  const sentAt = Date.now()
  writeAtomic(join(GAME_DIR, `q2l_s186_cmd_${mine}.cfg`), `${command}\n`)
  writeAtomic(join(GAME_DIR, CTL_CFG), ctlFile(mine, `exec q2l_s186_cmd_${mine}.cfg`))
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
const parsePos = (t) => {
  const m = /^(\d+):(\d{2})\.(\d)$/.exec(t.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10 : null
}
/** Demo-clock rate vs wall clock, longest gap between POS lines and mean fps over a window. */
function measure(fromT, toT) {
  pollLog()
  const inWin = log.filter((l) => l.t >= fromT && l.t <= toT)
  const pos = inWin
    .filter((l) => l.line.startsWith('POS '))
    .map((l) => ({ t: l.t, p: parsePos(l.line.slice(4)) }))
    .filter((s) => s.p !== null)
  const fps = inWin
    .filter((l) => l.line.startsWith('FPS '))
    .map((l) => Number(l.line.slice(4)))
    .filter((n) => Number.isFinite(n) && n > 0)
  const out = { posSamples: pos.length }
  if (pos.length >= 2) {
    const a = pos[0],
      b = pos[pos.length - 1]
    out.demoSecondsPerWallSecond = +((b.p - a.p) / ((b.t - a.t) / 1000)).toFixed(2)
    out.demoFrom = a.p
    out.demoTo = b.p
    out.longestGapMs = Math.max(...pos.slice(1).map((s, i) => s.t - pos[i].t))
  }
  const rawFps = inWin.find((l) => l.line.startsWith('FPS '))
  out.fps = fps.length
    ? { samples: fps.length, mean: +(fps.reduce((x, y) => x + y, 0) / fps.length).toFixed(1) }
    : { note: `no numeric fps; first FPS line: ${rawFps?.line ?? 'none'}` }
  return out
}

// ---- overlay ---------------------------------------------------------------------------------
const overlayEvents = []
function makeOverlay(display, bg) {
  const w = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  w.webContents.on('console-message', (...a) => {
    const msg = typeof a[0]?.message === 'string' ? a[0].message : a[2]
    try {
      overlayEvents.push({ t: Date.now(), ...JSON.parse(msg) })
    } catch {
      /* not ours */
    }
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  return new Promise((resolve) => {
    w.webContents.once('did-finish-load', () => {
      w.setBounds(display.bounds)
      w.show()
      w.focus()
      resolve(w)
    })
    w.loadFile(join(SPIKE_DIR, 'overlay.html'), { query: { bg } })
  })
}
const hwndOf = (w) => String(w.getNativeWindowHandle().readBigUInt64LE(0))

// ---- helpers ---------------------------------------------------------------------------------
const soft = async (name, fn) => {
  try {
    r.probes[name] = await fn()
  } catch (e) {
    r.probes[name] = { error: String(e?.stack ?? e).slice(0, 400) }
  }
}
const shot = async (name) =>
  (await win(`shot ${join(RESULTS, `${stamp}-${name}.png`).replace(/\\/g, '/')}`)).ok
    ? `${stamp}-${name}.png`
    : 'screenshot failed'
const rectEq = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
let game = { pid: 0, hwnd: '0' }
let overlay = null
let overlayHwnd = '0'
const who = (pid) => (pid === process.pid ? 'overlay' : pid === game.pid ? 'game' : `other:${pid}`)
async function owner(x, y) {
  const o = await win(`at ${x} ${y}`)
  return o.error ? o : { owner: who(o.pid), pid: o.pid, class: o.class, rootClass: o.rootClass }
}
async function snap(label, d) {
  const cx = Math.round(d.x + d.w / 2),
    cy = Math.round(d.y + d.h / 2)
  const fg = await win('fg')
  const g = await win(`info ${game.hwnd}`)
  const ov = overlay && !overlay.isDestroyed() ? await win(`info ${overlayHwnd}`) : null
  return {
    label,
    centreOwner: await owner(cx, cy),
    foreground: fg.error ? fg : { owner: who(fg.pid), class: fg.rootClass },
    gameIsForeground: g.foreground,
    gameIconic: g.iconic,
    gameRect: g.window,
    gameTopmost: g.topmost,
    overlayTopmost: ov?.topmost,
    overlayRect: ov?.window,
  }
}
const stopGame = { exitedAt: null }

// ---- main ------------------------------------------------------------------------------------
async function main() {
  mkdirSync(RESULTS, { recursive: true })
  mkdirSync(join(GAME_DIR, 'logs'), { recursive: true })
  rmSync(LOG_PATH, { force: true })
  startProbe()

  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const phys = (d) => {
    const p = screen.dipToScreenRect(null, d.bounds)
    return { x: p.x, y: p.y, w: p.width, h: p.height }
  }
  const D = phys(primary)
  r.launcherDisplayNote = 'harness is standalone: the "launcher display" is the primary display'
  r.primary = {
    id: primary.id,
    scaleFactor: primary.scaleFactor,
    dipBounds: primary.bounds,
    physical: D,
  }

  writeAtomic(
    join(GAME_DIR, LOOP_CFG),
    [
      'set q2l_s186_seq 0',
      `alias q2l_s186_loop "exec ${CTL_CFG}; wait 5; q2l_s186_loop"`,
      'q2l_s186_loop',
      '',
    ].join('\n'),
  )
  writeAtomic(join(GAME_DIR, CTL_CFG), ctlFile(null))
  const geo = (d) => `${d.w}x${d.h}+${d.x}+${d.y}`
  const gameArgs = [
    '+set',
    'game',
    GAME,
    '+set',
    'logfile',
    '2',
    '+set',
    'logfile_flush',
    '3',
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
    geo(D),
    '+set',
    'net_clientport',
    '27986',
    '+demo',
    DEMO,
    '+exec',
    LOOP_CFG,
  ]
  r.gameArgs = gameArgs
  const child = spawn(Q2PRO, gameArgs, { cwd: ROOT, stdio: 'ignore' })
  game.pid = child.pid
  child.on('exit', () => (stopGame.exitedAt = Date.now()))

  try {
    await sleep(5000)
    game.hwnd = String((await win(`mainwin ${game.pid}`)).hwnd)

    await soft('P1_gameGeometry', async () => {
      const g = await win(`info ${game.hwnd}`)
      const tb = await win('taskbar')
      const out = {
        asked: D,
        gameRect: g.window,
        rectEqualsDisplay: rectEq(g.window, D),
        gameTopmost: g.topmost,
        gameCaptioned: g.captioned,
        taskbar: tb,
      }
      // A point in the taskbar band, only meaningful if the band lies inside the display.
      const t = tb.window
      const cx = t && Math.round(t.x + t.w / 2),
        cy = t && Math.round(t.y + t.h / 2)
      if (t && tb.visible && cx >= D.x && cx < D.x + D.w && cy >= D.y && cy < D.y + D.h) {
        out.taskbarPoint = { x: cx, y: cy, owner: await owner(cx, cy) }
        out.gameOwnsTaskbarBand = out.taskbarPoint.owner.owner === 'game'
      } else out.taskbarPoint = 'not checked: taskbar not visible or not on the primary display'
      out.screenshot = await shot('P1-game')
      return out
    })

    await soft('P2_overlayHitTest', async () => {
      const points = {
        centre: [D.x + D.w / 2, D.y + D.h / 2],
        topLeft: [D.x + 2, D.y + 2],
        topRight: [D.x + D.w - 3, D.y + 2],
        bottomLeft: [D.x + 2, D.y + D.h - 3],
        bottomRight: [D.x + D.w - 3, D.y + D.h - 3],
      }
      const out = {}
      for (const [variant, bg] of [
        ['fullyTransparent', 'transparent'],
        ['rgba(0,0,0,0.01)', 'dim'],
      ]) {
        try {
          if (overlay && !overlay.isDestroyed()) overlay.destroy()
          overlay = await makeOverlay(primary, bg)
          overlayHwnd = hwndOf(overlay)
          await sleep(1200)
          const v = { overlayRect: (await win(`info ${overlayHwnd}`)).window, hits: {} }
          v.rectEqualsDisplay = rectEq(v.overlayRect, D)
          for (const [k, [x, y]] of Object.entries(points))
            v.hits[k] = (await owner(Math.round(x), Math.round(y))).owner
          v.allOverlay = Object.values(v.hits).every((h) => h === 'overlay')
          v.info = await win(`info ${overlayHwnd}`)
          v.screenshot = await shot(`P2-${bg}`)
          out[variant] = v
        } catch (e) {
          out[variant] = { error: String(e).slice(0, 300) }
        }
      }
      // Keep the variant that owned the centre; else the last one (rgba 0.01).
      out.kept = out.fullyTransparent?.allOverlay ? 'fullyTransparent' : 'rgba(0,0,0,0.01)'
      if (out.kept === 'fullyTransparent') {
        overlay.destroy()
        overlay = await makeOverlay(primary, 'transparent')
        overlayHwnd = hwndOf(overlay)
        await sleep(1000)
      }
      return out
    })

    await soft('P3_perturbations', async () => {
      const out = { steps: [] }
      out.demoRestart = await send(`demo ${DEMO}`)
      await sleep(1500)
      out.steps.push(await snap('baseline', D))
      const other = await win('other')
      out.otherWindow = other
      if (other.hwnd) {
        out.steps.push({
          activated: await win(`activate ${other.hwnd}`),
          ...(await snap('afterOtherWindowTookFocus', D)),
        })
        overlay.focus()
        await sleep(600)
        out.steps.push(await snap('afterOverlayRefocus', D))
      } else
        out.steps.push({
          label: 'focus steal',
          note: 'not checked: no other window (Code/explorer/WindowsTerminal) found',
        })
      await win('alttab')
      out.steps.push(await snap('afterAltTab', D))
      overlay.focus()
      await sleep(600)
      out.steps.push(await snap('afterAltTab+overlayRefocus', D))
      out.geometryResend = await send(`set vid_geometry ${geo(D)}`)
      await sleep(1500)
      out.steps.push(await snap('afterLiveVidGeometry', D))
      out.alwaysOnTopOff = await send('set win_alwaysontop 0')
      await sleep(1000)
      out.steps.push(await snap('afterWinAlwaysontop0', D))
      out.alwaysOnTopOn = await send('set win_alwaysontop 1')
      await sleep(1000)
      out.steps.push(await snap('afterWinAlwaysontop1', D))
      overlay.focus()
      await sleep(400)
      out.steps.push(await snap('afterFinalOverlayRefocus', D))
      return out
    })

    await soft('P4_playback', async () => {
      const out = { demoRestart: await send(`demo ${DEMO}`) }
      await sleep(1000)
      const phases = [
        ['overlayShownFocused', 1],
        ['controlsFaded', 0],
        ['controlsShownAgain', 1],
      ]
      for (const [name, opacity] of phases) {
        await overlay.webContents.executeJavaScript(`window.setBarOpacity(${opacity})`)
        await sleep(400)
        const from = Date.now()
        let samples = 0,
          iconic = 0,
          invisible = 0
        while (Date.now() - from < 10000) {
          pollLog()
          const g = await win(`info ${game.hwnd}`)
          samples += 1
          if (g.iconic) iconic += 1
          if (g.visible === false) invisible += 1
          await sleep(250)
        }
        out[name] = {
          barOpacity: opacity,
          iconicSamples: `${iconic}/${samples}`,
          invisibleSamples: `${invisible}/${samples}`,
          ...measure(from, Date.now() + 1000),
        }
      }
      out.demoNote =
        'a rate near 0 with demoFrom==demoTo can mean the demo ended, not a stall - compare with the other phases'
      return out
    })

    await soft('P5_input', async () => {
      const out = {}
      const before = overlayEvents.length
      out.cursorBefore = await win('cursor')
      const y = Math.round(D.y + D.h / 2)
      for (const f of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        await win(`move ${Math.round(D.x + D.w * f)} ${y}`)
        await sleep(120)
      }
      out.cursorOverGameArea = await win('cursor')
      await win(`move ${Math.round(D.x + D.w / 2)} ${Math.round(D.y + D.h / 3)}`)
      await sleep(150)
      await win('click')
      await sleep(200)
      await win('keys 65,87,32') // A W Space
      await sleep(400)
      out.cursorAfter = await win('cursor')
      const ev = overlayEvents.slice(before)
      const count = (e) => ev.filter((x) => x.e === e).length
      out.overlayLogged = {
        mousemove: count('mousemove'),
        mousedown: count('mousedown'),
        keydown: count('keydown'),
        keys: ev.filter((x) => x.e === 'keydown').map((x) => x.code),
        other: ev
          .filter((x) => !['mousemove', 'mousedown', 'keydown'].includes(x.e))
          .map((x) => x.e),
      }
      out.cursorHidden = !out.cursorOverGameArea.showing
      out.clipVsVirtualScreen = {
        clip: out.cursorAfter.clip,
        virtualScreen: out.cursorAfter.virtualScreen,
        clipIsFullVirtualScreen: rectEq(out.cursorAfter.clip, out.cursorAfter.virtualScreen),
      }
      out.screenshot = await shot('P5-after-input')
      return out
    })

    await soft('P6_displays', async () => {
      const out = {
        displays: displays.map((d) => ({
          id: d.id,
          primary: d.id === primary.id,
          scaleFactor: d.scaleFactor,
          dipBounds: d.bounds,
          physical: phys(d),
        })),
        checks: [],
      }
      for (const d of displays) {
        const p = phys(d)
        const c = { displayId: d.id, physical: p }
        const s = await send(`set vid_geometry ${geo(p)}`)
        await sleep(1500)
        const g = await win(`info ${game.hwnd}`)
        Object.assign(c, {
          sent: s.acked,
          gameRect: g.window,
          rectEqualsDisplay: rectEq(g.window, p),
        })
        out.checks.push(c)
      }
      out.notChecked = []
      if (displays.length < 2)
        out.notChecked.push('second monitor: only one display present, no hand steps allowed')
      if (!displays.some((d) => d.scaleFactor !== 1))
        out.notChecked.push(
          'display scaling: every display is at scaleFactor 1 and system settings must not change',
        )
      if (!displays.some((d) => d.scaleFactor === 1))
        out.notChecked.push('100% scaling: no display at scaleFactor 1')
      // Put the game back on the primary display before closing.
      await send(`set vid_geometry ${geo(D)}`)
      return out
    })
  } finally {
    await soft('shutdown', async () => {
      const out = { wmClose: await win(`close ${game.hwnd}`) }
      const t = Date.now()
      while (stopGame.exitedAt === null && Date.now() - t < 10000) await sleep(100)
      out.exitedAfterWmClose = stopGame.exitedAt !== null
      if (!out.exitedAfterWmClose) {
        out.fallback =
          'WM_CLOSE did not end the game within 10 s; killed so no process is left behind'
        child.kill()
      }
      await sleep(500)
      pollLog()
      return out
    })
    r.notableLines = [
      ...new Set(log.map((l) => l.line).filter((l) => !/^(POS|FPS|Execing|ACK)/.test(l))),
    ].slice(0, 60)
    r.overlayEventTotals = overlayEvents.reduce((a, e) => ((a[e.e] = (a[e.e] ?? 0) + 1), a), {})
    for (const f of [
      LOOP_CFG,
      CTL_CFG,
      ...Array.from({ length: seq + 1 }, (_, i) => `q2l_s186_cmd_${i}.cfg`),
    ])
      rmSync(join(GAME_DIR, f), { force: true })
    if (overlay && !overlay.isDestroyed()) overlay.destroy()
    try {
      ps.stdin.end()
      ps.kill()
    } catch {
      /* already gone */
    }
    const out = join(RESULTS, `${stamp}.json`)
    writeFileSync(out, JSON.stringify(r, null, 2))
    console.log(JSON.stringify(r.probes, null, 2))
    console.log('results:', out)
  }
}

app.on('window-all-closed', () => {
  /* keep alive between overlay variants */
})
app
  .whenReady()
  .then(main)
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => app.quit())
