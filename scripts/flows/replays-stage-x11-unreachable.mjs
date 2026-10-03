// Story 198: e2e proof that where the launcher cannot reach the X server (forced with
// Q2L_UI_SESSION_TYPE=x11, honoured only under the UI harness; the harness has no X display) the demo
// still plays on the stage and the not-on-top notice shows as visible text.
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
    fileURLToPath(
      new URL('../../src/renderer/src/modules/replays/locale/en.json', import.meta.url),
    ),
    'utf8',
  ),
)

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_SESSION_TYPE: 'x11',
    },
  }
}

const fail = makeFail('replays-stage-x11-unreachable')

export default async function replaysStageX11Unreachable({ page, step, shot }) {
  const expectedReason = en.replays?.stage?.notOnTop?.x11
  if (typeof expectedReason !== 'string') fail('en.json has no replays.stage.notOnTop.x11')

  step('Play with an unreachable X server shows the notice as visible text and the timeline')
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
  await shot('stage-x11-not-on-top')

  step('the launch line still places the game on the stage: vid_geometry')
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
  if (!line.includes('vid_geometry'))
    fail(`the launching line lacks vid_geometry: ${JSON.stringify(line)}`)

  step('after the game exits the timeline is gone')
  writeFileSync(files.quitFile, '')
  await page.getByTestId('replays-timeline').waitFor({ state: 'detached', timeout: 10_000 })
}
