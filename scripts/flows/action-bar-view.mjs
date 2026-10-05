// Story 180 D4: the action bar's big button speaks for the active tab. Home/Library -> "Play"
// (`data-action="play"`); Demos -> "View" (`data-action="view"`), disabled until a demo is selected;
// leaving Demos restores "Play" at once; the demo detail panel no longer has its own play button; and an
// installation-level state (Repair) wins over the tab's contribution.
//
// Fixture: the `replays-play` one plus a third, `missing` installation (`brokenInstallation`).
// Selectors: `actionbar-play` (+ `data-action`), `nav-home|library|replays`, `replays-demo-row`,
// `replays-demo-play`, `replays-demo-play-anyway` (both must be gone), `installation-tile`.
import { REPLAYS_PLAY_CTF_DEMO, writeReplaysPlayFixture } from '../lib/fixture.mjs'
import { openDemos, openFolder } from '../lib/replays-copy-in.mjs'

export const variant = 'replays-play'

const TIMEOUT_MS = 8_000
const SHORT_MS = 1_500

export async function setup() {
  writeReplaysPlayFixture('replays-play', { brokenInstallation: true })
  return {}
}

async function expectAction(page, action, label, disabled) {
  const button = page.locator(`[data-testid="actionbar-play"][data-action="${action}"]`)
  await button.waitFor({ state: 'visible', timeout: SHORT_MS })
  const text = ((await button.textContent()) ?? '').trim()
  if (label !== undefined && text !== label) {
    throw new Error(
      `action-bar-view: expected label ${JSON.stringify(label)} for ${action}, got ${JSON.stringify(text)}`,
    )
  }
  if (disabled !== undefined && (await button.isDisabled()) !== disabled) {
    throw new Error(`action-bar-view: expected ${action} disabled=${disabled}`)
  }
}

export default async function actionBarView({ page, step, shot }) {
  step('Home and Library read "Play"')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await expectAction(page, 'play', 'Play')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await expectAction(page, 'play', 'Play')

  step('Demos with no selection: "View", disabled')
  await openDemos(page)
  await openFolder(page, 'ctf')
  await expectAction(page, 'view', 'View', true)
  await shot('view-disabled')

  step('selecting a demo enables View; the detail panel has no play buttons')
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await page.locator('[data-testid="actionbar-play"][data-action="view"]:not([disabled])').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  for (const id of ['replays-demo-play', 'replays-demo-play-anyway']) {
    if ((await page.getByTestId(id).count()) !== 0)
      throw new Error(`action-bar-view: ${id} must not exist any more`)
  }
  await shot('view-enabled')

  step('back on Home the button is "Play" at once')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await expectAction(page, 'play', 'Play')

  step('on Demos, a broken active installation turns the button into Repair')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('installation-tile').nth(2).click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('installation-tile')
    .nth(2)
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectAction(page, 'repair')
  await shot('repair-wins')
}
