// The integrated mode renders the engine into a canvas inside the stage (story 290). The "engine" is
// the renderer's fake engine (`integrated/fake-engine.ts`, served from Q2L_UI_ENGINE_DIR), whose
// counters live on `globalThis.__q2lFakeEngine`. Proves: a painted centre pixel, the drawing buffer
// following the window size, no key reaching the engine while the detail panel's field has focus,
// Stop pausing and disconnecting, one instance across Play cycles and a view leave, and the
// context-lost text.
//
// Selectors: `replays-engine-canvas`, `replays-stage`, `replays-detail-input-description`,
// `replays-engine-lost`, `replays-timeline-stop`, `nav-home`, `nav-replays`.
import {
  REPLAYS_INTEGRATED_VARIANT,
  REPLAYS_PLAY_CTF_DEMO,
  writeReplaysIntegratedFixture,
} from '../lib/fixture.mjs'
import { makeFail } from '../lib/flow-common.mjs'
import { openDemos, openFolder, poll, selectDemo, TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_INTEGRATED_VARIANT

export async function setup() {
  const fixture = writeReplaysIntegratedFixture()
  return { env: fixture.env }
}

const fail = makeFail('replays-integrated-canvas')

const counters = (page) => page.evaluate(() => ({ ...globalThis.__q2lFakeEngine }))

/** Centre pixel of the engine canvas, read through a 2d copy so no GL state is touched. */
const centrePixel = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="replays-engine-canvas"]')
    if (!canvas || !canvas.width || !canvas.height) return null
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    const ctx = copy.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    return Array.from(
      ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data,
    )
  })

async function expectPainted(page, label) {
  await poll(
    `${label}: a non-black centre pixel`,
    async () => {
      const px = await centrePixel(page)
      return !!px && px[3] > 0 && px[0] + px[1] + px[2] > 0
    },
    TIMEOUT_MS,
  )
}

export default async function replaysIntegratedCanvas({ page, app, step, shot }) {
  const canvas = page.getByTestId('replays-engine-canvas')
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')

  async function playDemo() {
    await selectDemo(page, REPLAYS_PLAY_CTF_DEMO)
    await poll('Play to be enabled', async () => !(await play.isDisabled()), TIMEOUT_MS)
    await play.click({ timeout: TIMEOUT_MS })
    await canvas.waitFor({ state: 'visible', timeout: 15_000 })
  }

  step('Play shows the engine canvas in the stage and it paints')
  await openDemos(page)
  await openFolder(page, 'ctf')
  await playDemo()
  if (!(await page.getByTestId('replays-stage').getByTestId('replays-engine-canvas').count()))
    fail('the canvas must sit inside the stage')
  await expectPainted(page, 'after Play')
  await shot('integrated-canvas')

  step('resizing the window resizes the drawing buffer to CSS size x devicePixelRatio')
  const before = await counters(page)
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [w, h] = win.getSize()
    win.setSize(w + (w > 1100 ? -160 : 160), h)
  })
  await poll(
    'the engine to be told about the resize',
    async () => (await counters(page)).resizes > before.resizes,
    TIMEOUT_MS,
  )
  await poll(
    'the buffer to equal CSS size x dpr',
    () =>
      page.evaluate(() => {
        const c = document.querySelector('[data-testid="replays-engine-canvas"]')
        const dpr = window.devicePixelRatio || 1
        const r = c.getBoundingClientRect()
        return c.width === Math.round(r.width * dpr) && c.height === Math.round(r.height * dpr)
      }),
    TIMEOUT_MS,
  )
  await expectPainted(page, 'after the resize')

  step('typing in the detail panel reaches the field and never the engine')
  const field = page.getByTestId('replays-detail-input-description')
  await field.click({ timeout: TIMEOUT_MS })
  await page.keyboard.type('hello q2')
  if ((await field.inputValue()) !== 'hello q2')
    fail(`the field holds ${JSON.stringify(await field.inputValue())}, not what was typed`)
  const typed = await counters(page)
  if (typed.keyEvents !== 0) fail(`the engine saw ${typed.keyEvents} key events while typing`)
  const focusable = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="replays-engine-canvas"]')
    return { attr: c.hasAttribute('tabindex'), index: c.tabIndex }
  })
  if (focusable.attr || focusable.index !== -1)
    fail(
      `the engine canvas must not be focusable (tabindex attr ${focusable.attr}, ${focusable.index})`,
    )

  step('Stop pauses the engine loop and disconnects')
  await page.getByTestId('replays-timeline-stop').click({ timeout: TIMEOUT_MS })
  await canvas.waitFor({ state: 'detached', timeout: 10_000 })
  const stopped = await counters(page)
  if (stopped.loopRunning) fail('the engine loop must not run after Stop')
  if (stopped.disconnects <= before.disconnects) fail('Stop must disconnect the engine')

  step('Play again reuses the one engine instance')
  await playDemo()
  await expectPainted(page, 'after the second Play')
  const again = await counters(page)
  if (again.instances !== 1) fail(`instances is ${again.instances} after Play again, not 1`)
  if (!again.loopRunning) fail('the engine loop must run again after Play')

  step('leaving Demos and returning keeps painting on the same canvas')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await canvas.waitFor({ state: 'detached', timeout: 10_000 })
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await canvas
    .or(page.getByTestId('replays-demo-list').filter({ visible: true }))
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await canvas.isVisible())) await playDemo()
  await expectPainted(page, 'after returning to Demos')
  if ((await counters(page)).instances !== 1) fail('returning must not create a second instance')

  step('a lost WebGL context shows the restart text')
  await page.evaluate(() => {
    const c = document.querySelector('[data-testid="replays-engine-canvas"]')
    c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
  })
  const lost = page.getByTestId('replays-engine-lost')
  await lost.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await lost.textContent()) ?? '').includes('The 3D view was lost. Press Play to restart.'))
    fail(`unexpected lost text ${JSON.stringify(await lost.textContent())}`)
  await shot('integrated-context-lost')
}
