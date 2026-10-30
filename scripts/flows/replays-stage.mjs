// Story 170 D5: e2e proof that Play launches the demo onto the launcher's stage. The stage picture is
// a 4:3 box below which the timeline and the console field sit; the list is hidden, the detail of the playing demo sits right of the stage; the
// game is launched with the stage args whose `vid_geometry` is the picture's box in physical screen
// pixels; steering and console commands still reach the engine exactly once; when the game exits the
// list is back. The "engine" is the fixture's stub (`scripts/lib/stub-engine.cjs`), as in
// `replays-timeline.mjs`.
//
// A real game left running by a launcher quit (story 163) archives the stage values when it
// exits, possibly after the next launcher start, so the next start waits for the recorded game pid and
// only then puts the user's own lines back. The last steps seed that record with a process the flow owns (story 321).
//
// Selectors: `replays-stage`, `replays-stage-picture` (`DemoStage.tsx`), `replays-demo-list`,
// `replays-detail`, `replays-timeline`, `replays-timeline-toggle`, `replays-console-{field,input}`.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { makeFail, sleep } from '../lib/flow-common.mjs'
import { variantUserDataDir, withApp } from '../lib/harness.mjs'
import {
  commands,
  makeEngineCommandsExpecter,
  openDemos,
  openFolder,
  poll,
} from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT
// The last step quits the app itself and starts it again.
export const expectExit = true

const TIMEOUT_MS = 8_000
const SETTLE_MS = 700

const EXIT_TIMEOUT_MS = 15_000
/** The user's own stage cvars before any session; the flow compares them to themselves. */
const USER_STAGE_LINES = ['seta vid_fullscreen "1"', 'seta vid_geometry "800x600+0+0"']
const PENDING_FILE = 'replays-session-cvars.pending.json'

const files = replaysTimelineEngineFiles()
let configFile = ''
let engineEnv = {}

export async function setup() {
  const fixture = writeReplaysTimelineFixture()
  // The demo plays in the fixture's ctf game dir (Windows: the game dir; Linux: Q2PRO's write dir,
  // which the harness redirects into the variant's userData).
  configFile =
    process.platform === 'win32'
      ? join(fixture.installRoot, 'ctf', 'q2config.cfg')
      : join(variantUserDataDir(variant), 'harness-home', '.q2pro', 'ctf', 'q2config.cfg')
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, `${USER_STAGE_LINES.join('\n')}\n`)
  rmSync(join(variantUserDataDir(variant), PENDING_FILE), { force: true })
  engineEnv = {
    Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
    Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
    Q2L_UI_ENGINE_CONFIG_FILE: configFile,
    Q2L_UI_ENGINE_ARCHIVE_CVARS: 'vid_fullscreen,vid_geometry',
  }
  return { env: engineEnv }
}

const holdsUserLines = () => {
  const text = readFileSync(configFile, 'latin1')
  return USER_STAGE_LINES.every((l) => text.includes(l))
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const fail = makeFail('replays-stage')
const expectCommands = makeEngineCommandsExpecter(files.commandLog, fail)

async function launchLine(logPath) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    const line = content
      .split(/\r?\n/)
      .filter((l) => l.includes('launching'))
      .pop()
    if (line) return line
    if (Date.now() >= deadline) fail('main.log never contained a launching line')
    await sleep(150)
  }
}

export default async function replaysStage({ page, app, step, shot }) {
  const picture = page.getByTestId('replays-stage-picture')
  const timeline = page.getByTestId('replays-timeline')

  step('Play arms the stage: the picture shows, list and detail hide')
  await openDemos(page)
  await openFolder(page, 'ctf')
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  // The picture's box is recorded every frame together with whether the session is live (the console
  // input enables with it): the last box measured before the session is what the launch was placed on,
  // and it has to be the box the picture still has once the session is live.
  await page.evaluate(() => {
    window.__stageRects = []
    const tick = () => {
      const el = document.querySelector('[data-testid=replays-stage-picture]')
      const input = document.querySelector('[data-testid=replays-console-input]')
      if (el) {
        const r = el.getBoundingClientRect()
        const rect = {
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        }
        window.__stageRects.push({ rect, live: !!input && !input.disabled })
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
  await play.click({ timeout: TIMEOUT_MS })
  await picture.waitFor({ state: 'visible', timeout: 15_000 })
  await timeline.waitFor({ state: 'visible', timeout: 15_000 })
  const box = await picture.boundingBox()
  if (!box) fail('the stage picture has no box')
  if (Math.abs(box.width - (box.height * 4) / 3) > 1) {
    fail(`the picture box ${box.width}x${box.height} is not 4:3 within 1 px`)
  }
  if (await page.getByTestId('replays-demo-list').isVisible())
    fail('the demo list must be hidden on the stage')
  const dBox = (await page.getByTestId('replays-detail').isVisible())
    ? await page.getByTestId('replays-detail').boundingBox()
    : null
  if (!dBox) fail('the detail of the playing demo must stay visible beside the stage')
  if (dBox.x < box.x + box.width - 1)
    fail(`the detail (x ${dBox.x}) must sit right of the picture (right ${box.x + box.width})`)
  const bottom = box.y + box.height
  const tBox = await timeline.boundingBox()
  const cBox = await page.getByTestId('replays-console-field').boundingBox()
  if (!tBox || tBox.y < bottom - 1)
    fail(`the timeline (y ${tBox?.y}) must sit below the picture (bottom ${bottom})`)
  if (!cBox || cBox.y < bottom - 1)
    fail(`the console field (y ${cBox?.y}) must sit below the picture (bottom ${bottom})`)
  await shot('stage-playing')

  step('steering and a console command reach the engine exactly once')
  await page.getByTestId('replays-timeline-toggle').click({ timeout: TIMEOUT_MS })
  await expectCommands(['pause'], 'timeline pause')
  const input = page.getByTestId('replays-console-input')
  await input.focus()
  await page.keyboard.type('fov 110')
  await page.keyboard.press('Enter')
  await expectCommands(['pause', 'fov 110'], 'console command')

  step('the launch args carry the stage geometry computed from the picture box')
  const line = await launchLine(logPath)
  const recorded = (await page.evaluate(() => window.__stageRects)).filter((e) => e.rect.width > 8)
  const armedEntries = recorded.filter((e) => !e.live)
  if (armedEntries.length === 0) fail('no stage box was recorded before the session went live')
  if (!recorded.some((e) => e.live)) fail('the session never went live in the recording')
  const armed = armedEntries[armedEntries.length - 1].rect
  await sleep(SETTLE_MS)
  const final = await picture.boundingBox()
  if (!final) fail('the stage picture has no box after the session is live')
  for (const k of ['x', 'y', 'width', 'height']) {
    if (Math.abs(final[k] - armed[k]) > 1) {
      fail(
        `the box moved after the session started: armed ${JSON.stringify(armed)}, final ${JSON.stringify(final)}`,
      )
    }
  }
  // Expected geometry: content origin + rect converted the way the app does it (`screen.dipToScreenRect`
  // with the exact, unrounded DIP rect; rounded at the end only).
  const wanted = await app.evaluate(({ BrowserWindow, screen }, rect) => {
    const win = BrowserWindow.getAllWindows()[0]
    const contentBounds = win.getContentBounds()
    const scale = screen.getDisplayMatching(contentBounds).scaleFactor
    const zoom = win.webContents.getZoomFactor()
    const dip = {
      x: contentBounds.x + rect.x * zoom,
      y: contentBounds.y + rect.y * zoom,
      width: rect.width * zoom,
      height: rect.height * zoom,
    }
    const p =
      typeof screen.dipToScreenRect === 'function'
        ? screen.dipToScreenRect(win, dip)
        : {
            x: dip.x * scale,
            y: dip.y * scale,
            width: dip.width * scale,
            height: dip.height * scale,
          }
    return `${Math.round(p.width)}x${Math.round(p.height)}${Math.round(p.x) < 0 ? '' : '+'}${Math.round(p.x)}${Math.round(p.y) < 0 ? '' : '+'}${Math.round(p.y)}`
  }, armed)
  const m = /\+set vid_geometry (\d+x\d+[+-]\d+[+-]\d+)/.exec(line)
  if (!m) fail(`the launching line has no vid_geometry: ${JSON.stringify(line)}`)
  if (m[1] !== wanted) {
    fail(
      `vid_geometry ${m[1]} is not the geometry ${wanted} of the box measured before play ${JSON.stringify(armed)}`,
    )
  }
  // The box did not change, so no re-placement may have reached the engine.
  const stray = commands(files.commandLog).filter((c) => c.includes('vid_geometry'))
  if (stray.length > 0)
    fail(`an unchanged box must not re-place the game, command log has ${JSON.stringify(stray)}`)
  for (const arg of ['+set vid_fullscreen 0', '+set win_noborder 1', '+set win_alwaysontop 1']) {
    if (!line.includes(arg)) fail(`the launching line lacks ${arg}: ${JSON.stringify(line)}`)
  }
  if (line.indexOf('vid_geometry') > line.indexOf('+demo '))
    fail('the stage args must come before +demo')

  step('after the game exits the list is back')
  writeFileSync(files.quitFile, '')
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: 10_000 })
  if (await picture.isVisible()) fail('the stage must be gone after the game exits')
  await shot('stage-gone')
  await poll(
    'q2config.cfg holding the user stage lines after the game exits',
    holdsUserLines,
    10_000,
  )

  step('Close while a staged demo runs records its pid with the snapshot')
  rmSync(files.quitFile, { force: true })
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await picture.waitFor({ state: 'visible', timeout: 15_000 })
  await timeline.waitFor({ state: 'visible', timeout: 15_000 })
  const pendingPath = join(variantUserDataDir(variant), PENDING_FILE)
  const readPid = () => {
    if (!existsSync(pendingPath)) return undefined
    try {
      return JSON.parse(readFileSync(pendingPath, 'utf8')).pid
    } catch {
      // the launcher replaces the file atomically, but a read may still race that rename
      return undefined
    }
  }
  await poll('the pending stage snapshot recording the game pid', () => readPid() > 0, 10_000)
  const pid = readPid()
  if (!(pid > 0) || !processAlive(pid))
    fail(`the recorded game pid ${JSON.stringify(pid)} must be a live process`)
  const exited = app.waitForEvent('close', { timeout: EXIT_TIMEOUT_MS })
  await page.getByTestId('titlebar-close').click({ timeout: TIMEOUT_MS })
  await exited
  // Whether the real game survives a launcher quit is story 163's own tests; the stub dies with its
  // parent, so the wait below is driven by a process this flow owns and controls.
  await poll('the stub game gone with its launcher', () => !processAlive(pid), 10_000)
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const holderPid = holder.pid
  // What the engine archived on its way out over the user's lines, and the snapshot a quit left behind.
  writeFileSync(
    configFile,
    ['seta vid_fullscreen "0"', 'seta vid_geometry "400x300+10+10"', ''].join('\n'),
  )
  writeFileSync(
    pendingPath,
    JSON.stringify({
      configPath: configFile,
      lines: { vid_fullscreen: USER_STAGE_LINES[0], vid_geometry: USER_STAGE_LINES[1] },
      pid: holderPid,
    }),
  )

  step('the next start waits for that pid, then puts back the user stage lines it archived over')
  try {
    await withApp({ variant, env: engineEnv }, async ({ page: next }) => {
      const { logPath: nextLog } = await next.evaluate(() => window.q2.invoke('app:getInfo'))
      await poll(
        'the next start waiting for the game pid',
        () => readFileSync(nextLog, 'utf8').includes(`waits for game pid ${holderPid} to exit`),
        10_000,
      )
      await sleep(2 * SETTLE_MS)
      if (holdsUserLines() || !existsSync(pendingPath))
        fail('the lines must stay archived and the snapshot kept while the game pid lives')
      holder.kill()
      await poll('the game exiting', () => !processAlive(holderPid), 10_000)
      await poll(
        'q2config.cfg holding the user stage lines and no pending snapshot',
        () => holdsUserLines() && !existsSync(pendingPath),
        15_000,
      )
    })
  } finally {
    holder.kill()
  }
  rmSync(files.quitFile, { force: true })
}
