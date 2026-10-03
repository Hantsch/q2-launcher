// Story 170 D5: e2e proof that Play launches the demo onto the launcher's stage. The stage picture is
// a 4:3 box below which the timeline and the console field sit; the list is hidden, the detail of the playing demo sits right of the stage; the
// game is launched with the stage args whose `vid_geometry` is the picture's box in physical screen
// pixels; steering and console commands still reach the engine exactly once; when the game exits the
// list is back. The "engine" is the fixture's stub (`scripts/lib/stub-engine.cjs`), as in
// `replays-timeline.mjs`.
//
// Selectors: `replays-stage`, `replays-stage-picture` (`DemoStage.tsx`), `replays-demo-list`,
// `replays-detail`, `replays-timeline`, `replays-timeline-toggle`, `replays-console-{field,input}`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { makeFail, sleep } from '../lib/flow-common.mjs'
import { commands, waitForScan } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const ENGINE_TIMEOUT_MS = 5_000
const SETTLE_MS = 700

const files = replaysTimelineEngineFiles()

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: { Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog, Q2L_UI_ENGINE_QUIT_FILE: files.quitFile },
  }
}

const fail = makeFail('replays-stage')

async function expectCommands(expected, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (commands(files.commandLog).length < expected.length) {
    if (Date.now() >= deadline)
      fail(
        `${label}: engine ran ${JSON.stringify(commands(files.commandLog))}, expected ${JSON.stringify(expected)}`,
      )
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const ran = commands(files.commandLog)
  if (JSON.stringify(ran) !== JSON.stringify(expected)) {
    fail(
      `${label}: engine ran ${JSON.stringify(ran)}, expected exactly ${JSON.stringify(expected)}`,
    )
  }
}

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
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
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
    return `${Math.round(p.width)}x${Math.round(p.height)}+${Math.round(p.x)}+${Math.round(p.y)}`
  }, armed)
  const m = /\+set vid_geometry (\d+x\d+\+-?\d+\+-?\d+)/.exec(line)
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
}
