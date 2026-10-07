// Story 243 acceptance flow: the sides and the tags of a demo are edited in place and save
// themselves. The roster opens the sides editor on click (known-player chips, typed players), moving
// focus out saves it; a suggested tag is saved the moment it is picked, a chip's x removes it, and
// edits made back to back all land in the sidecar. Runs against the `replays-rows` fixture variant
// plus its own `setup()` that drops one extra demo (a copy of `test.dm2`, whose header carries real
// player data) and a sidecar with a seed tag next to the fixture's own no-sidecar demo.
//
// Selectors - read `SidesField.tsx`, `SidesEditor.tsx`, `TagInput.tsx` and `DemoDetailPanel.tsx`:
//   replays-detail-sides-edit         SidesField.tsx - activates the sides editor
//   replays-detail-sides-editor       SidesField.tsx - the open editor's container
//   replays-sides-add                 SidesEditor.tsx - "Add side" button
//   replays-side-<i>-team/-result     SidesEditor.tsx - team/result inputs
//   replays-known-player              SidesEditor.tsx - a known-player chip (name + source)
//   replays-tag-input / -option       TagInput.tsx
//   replays-detail-input-name         DemoDetailPanel.tsx - the header name input
//   replays-detail-favourite          DemoDetailPanel.tsx - the favourite toggle

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeFail } from '../lib/flow-common.mjs'
import { REPO_ROOT } from '../lib/paths.mjs'
import { REPLAYS_ROWS_MVD_DEMO, replaysRowsSidecarPath } from '../lib/fixture.mjs'
import { rowFor, openDemosRoot, makeSidecarWaiter } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

export const variant = 'replays-rows'

const KNOWN_PLAYERS_DEMO = 'known-players.dm2'
const SEED_TAG = 'grudge match'

function knownPlayersDemoPath() {
  return join(dirname(replaysRowsSidecarPath(REPLAYS_ROWS_MVD_DEMO)), KNOWN_PLAYERS_DEMO)
}

/** Adds `known-players.dm2` (a copy of `test.dm2`, so its header carries real player data) plus a
 * seed-tagged sidecar next to `REPLAYS_ROWS_MVD_DEMO`, the fixture's own no-sidecar-yet demo - so a
 * tag typed here has something real to suggest from. */
export async function setup() {
  const folder = dirname(replaysRowsSidecarPath(REPLAYS_ROWS_MVD_DEMO))
  mkdirSync(folder, { recursive: true })
  copyFileSync(join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2'), knownPlayersDemoPath())
  writeFileSync(
    replaysRowsSidecarPath(REPLAYS_ROWS_MVD_DEMO),
    JSON.stringify({ schemaVersion: 1, tags: [SEED_TAG] }, null, 2) + '\n',
    'utf8',
  )
}

const waitForSidecar = makeSidecarWaiter(() => {
  try {
    return JSON.parse(readFileSync(knownPlayersDemoPath() + '.json', 'utf8'))
  } catch {
    return {} // not written yet
  }
}, makeFail('replays-edit-sides-tags'))

export default async function replaysEditSidesTags({ page, shot, step }) {
  await openDemosRoot(page)
  await rowFor(page, KNOWN_PLAYERS_DEMO).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail-title').waitFor({ state: 'attached', timeout: TIMEOUT_MS })

  step('the sides field opens in place')
  await page.getByTestId('replays-detail-sides-edit').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-detail-sides-editor')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-sides-add').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-0-team').fill('Alpha')
  await page.getByTestId('replays-side-0-result').fill('25')
  const chips = page.getByTestId('replays-known-player')
  const firstChipName = (await chips.first().textContent()).split(' (')[0]
  await chips.first().click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-side-0-player-0')
    .filter({ hasText: firstChipName })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('replays-edit-sides-tags')
  await page.getByTestId('replays-sides-add').focus()
  await page.keyboard.press('Tab')
  await page
    .getByTestId('replays-detail-sides-editor')
    .waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  const saved = await waitForSidecar(
    (sidecar) => Array.isArray(sidecar.sides) && sidecar.sides.length === 1,
    'leaving the sides field must save it',
  )
  const side = saved.sides[0]
  if (side.team !== 'Alpha' || side.result !== '25' || !side.players.includes(firstChipName)) {
    throw new Error(`replays-edit-sides-tags: sides mismatch: ${JSON.stringify(saved.sides)}`)
  }

  step('a suggested tag is saved at once')
  const tagInput = page.getByTestId('replays-tag-input')
  await tagInput.fill('gru')
  const option = page.getByTestId('replays-tag-option').filter({ hasText: SEED_TAG })
  await option.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await option.click({ timeout: TIMEOUT_MS })
  await waitForSidecar(
    (sidecar) => Array.isArray(sidecar.tags) && sidecar.tags.includes(SEED_TAG),
    'picking a suggestion must save the tag without leaving the field',
  )

  step("the chip's × removes the tag on disk")
  await page.getByRole('button', { name: `Remove tag ${SEED_TAG}` }).click({ timeout: TIMEOUT_MS })
  await waitForSidecar(
    (sidecar) => !(sidecar.tags ?? []).includes(SEED_TAG),
    'the chip x must remove the tag from the sidecar',
  )

  step('back-to-back edits all land on disk')
  const name = page.getByTestId('replays-detail-input-name')
  await name.fill('Quick fire')
  await name.press('Enter')
  await tagInput.fill('burst')
  await tagInput.press('Enter')
  await page.getByTestId('replays-detail-favourite').click({ timeout: TIMEOUT_MS })
  await waitForSidecar(
    (sidecar) =>
      sidecar.name === 'Quick fire' &&
      (sidecar.tags ?? []).includes('burst') &&
      sidecar.favourite === true,
    'name, tag and favourite edited without waiting must all be saved',
  )
}
