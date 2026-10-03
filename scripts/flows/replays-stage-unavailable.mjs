// Story 170 D5: e2e proof that where the stage is unavailable (forced with Q2L_UI_SESSION_TYPE=wayland,
// honoured only under the UI harness) the reason shows as visible text, the game opens in its own
// window (`+set vid_fullscreen 0`, no `vid_geometry`) and the timeline still appears.
//
// Selectors: `replays-stage-reason`, `replays-timeline`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { makeFail, sleep } from '../lib/flow-common.mjs'
import { waitForScan } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const files = replaysTimelineEngineFiles()
const en = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../src/renderer/src/i18n/locales/en.json', import.meta.url)),
    'utf8',
  ),
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

const fail = makeFail('replays-stage-unavailable')

export default async function replaysStageUnavailable({ page, step, shot }) {
  const expectedReason = en.replays?.stage?.unavailable?.wayland
  if (typeof expectedReason !== 'string') fail('en.json has no replays.stage.unavailable.wayland')

  step('Play on an unavailable stage shows the reason as visible text and the timeline')
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
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
  const reason = page.getByTestId('replays-stage-reason')
  await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = ((await reason.textContent()) ?? '').trim()
  if (text !== expectedReason)
    fail(`the reason shows ${JSON.stringify(text)}, expected ${JSON.stringify(expectedReason)}`)
  await shot('stage-unavailable')

  step('the launch line opens the game in its own window: vid_fullscreen 0, no vid_geometry')
  const deadline = Date.now() + 10_000
  let line
  while (!line) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    line = content
      .split(/\r?\n/)
      .filter((l) => l.includes('launching'))
      .pop()
    if (!line) {
      if (Date.now() >= deadline) fail('main.log never contained a launching line')
      await sleep(150)
    }
  }
  if (!line.includes('+set vid_fullscreen 0'))
    fail(`the launching line lacks +set vid_fullscreen 0: ${JSON.stringify(line)}`)
  if (line.includes('vid_geometry'))
    fail(`the launching line must not carry vid_geometry: ${JSON.stringify(line)}`)

  step('after the game exits the timeline is gone')
  writeFileSync(files.quitFile, '')
  await page.getByTestId('replays-timeline').waitFor({ state: 'detached', timeout: 10_000 })
}
