// Story 187 D6: e2e proof that where cinema cannot run it stays visible, is aria-disabled and says why
// as visible text: (1) on Wayland (forced with Q2L_UI_SESSION_TYPE=wayland, honoured only under the UI
// harness) with the stage's own reason, (2) with the launcher off the primary display (faked with
// Q2L_UI_CINEMA_DISPLAY=secondary, flipped on the running app and announced by a window nudge).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const files = replaysTimelineEngineFiles()
const en = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src/renderer/src/i18n/locales/en.json', import.meta.url)), 'utf8'),
)

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_SESSION_TYPE: 'wayland',
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (message) => {
  throw new Error(`replays-cinema-unavailable: ${message}`)
}

async function waitForScan(page) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (await refresh.isDisabled()) {
    if (Date.now() >= deadline) fail('timed out waiting for the demo scan to finish')
    await sleep(100)
  }
}

async function expectDisabledWithReason(page, expected, label) {
  const cinema = page.getByTestId('replays-timeline-mode-cinema')
  await cinema.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const reason = page.getByTestId('replays-timeline-cinema-reason')
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const text = (await reason.isVisible()) ? ((await reason.textContent()) ?? '').trim() : null
    if (text === expected) break
    if (Date.now() >= deadline) fail(`${label}: the reason shows ${JSON.stringify(text)}, expected ${JSON.stringify(expected)}`)
    await sleep(100)
  }
  if ((await cinema.getAttribute('aria-disabled')) !== 'true') fail(`${label}: Cinema is not aria-disabled`)
  if ((await cinema.getAttribute('aria-checked')) !== 'false') fail(`${label}: Cinema is checked`)
}

export default async function replaysCinemaUnavailable({ page, app, step, shot }) {
  const wayland = en.replays?.stage?.unavailable?.wayland
  const notPrimary = en.replays?.cinema?.unavailable?.notPrimaryDisplay
  if (typeof wayland !== 'string') fail('en.json has no replays.stage.unavailable.wayland')
  if (typeof notPrimary !== 'string') fail('en.json has no replays.cinema.unavailable.notPrimaryDisplay')

  step('on Wayland Cinema is visible, aria-disabled, with the reason as text')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  await page.getByTestId('replays-demo-row').filter({ hasText: REPLAYS_PLAY_CTF_DEMO }).first().click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
  await expectDisabledWithReason(page, wayland, 'wayland')
  await shot('cinema-unavailable-wayland')

  step('off the primary display Cinema is disabled with the not-primary reason')
  await app.evaluate(({ BrowserWindow }) => {
    process.env.Q2L_UI_SESSION_TYPE = 'x11'
    process.env.Q2L_UI_CINEMA_DISPLAY = 'secondary'
    // The availability is re-read on window events; a one-pixel nudge announces the change.
    const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('cinema.html'))
    const [w, h] = win.getSize()
    win.setSize(w + 1, h)
  })
  await expectDisabledWithReason(page, notPrimary, 'secondary display')
  await shot('cinema-unavailable-secondary')

  step('after the game exits the timeline is gone')
  writeFileSync(files.quitFile, '')
  await page.getByTestId('replays-timeline').waitFor({ state: 'detached', timeout: 10_000 })
}
