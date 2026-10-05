// A demo selected while the active installation's stored engine is not Q2PRO, but its folder holds
// a Q2PRO, says so in the action bar's note line and keeps View enabled (story 246). Nothing is
// launched. Fixture `engine-choice`: "Fixture Two Engines" (stored r1q2, detected q2pro) with
// `baseq2/demos/engine-choice.dm2`.
//
// Selectors: `nav-replays`, `replays-demo-row`, `actionbar-play[data-action="view"]`,
// `actionbar-action-reason`.
import { writeEngineChoiceFixture } from '../lib/fixture.mjs'
import { openAllDemos, openFolder, selectDemo } from '../lib/replays-copy-in.mjs'

export const variant = 'engine-choice'

const TIMEOUT_MS = 8_000
const DEMO = 'engine-choice.dm2'
const NOTE = "Plays with this installation's Q2PRO."

export async function setup() {
  writeEngineChoiceFixture()
  return {}
}

export default async function replaysPlayDetectedQ2pro({ page, step, shot }) {
  step('open Demos and select the demo of the two-engines installation')
  await openAllDemos(page)
  await openFolder(page, 'Fixture Two Engines')
  await selectDemo(page, DEMO)

  step("the note line says the demo plays with the installation's Q2PRO, View stays enabled")
  const reason = page.getByTestId('actionbar-action-reason')
  await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = ((await reason.textContent()) ?? '').trim()
  if (text !== NOTE) {
    throw new Error(
      `replays-play-detected-q2pro: expected ${JSON.stringify(NOTE)}, got ${JSON.stringify(text)}`,
    )
  }
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  if (await play.isDisabled()) {
    throw new Error('replays-play-detected-q2pro: View must be enabled')
  }
  await shot('play-detected-q2pro')
}
