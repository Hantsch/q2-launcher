// Story 244 acceptance flow: two demos are tagged in one go (the one without a notes file gets one),
// a tag one of them carries is removed, both are moved into a subfolder where one name is taken (that
// demo is named in the outcome and the target's file stays byte for byte), and the demo left behind
// moves through the folder the harness picks (`Q2L_UI_PICK_FOLDER`).
//
// Selectors - read `BulkActionBar.tsx`, `TagDemosDialog.tsx`, `MoveDemosDialog.tsx` before changing:
//   replays-demo-row             DemoRow.tsx - one row; replays-bulk-bar its bulk bar
//   replays-bulk-tag/-move       the bar's buttons; -outcome/-summary/-entries its outcome
//   replays-bulk-tag-chip        TagDemosDialog.tsx - a carried tag; replays-bulk-tag-apply submits
//   replays-tag-input            TagInput.tsx - the add input
//   replays-bulk-move-folder     MoveDemosDialog.tsx - a folder (data-path); -pick "Choose folder..."

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { INSTALL_ONE_ID, installationConfigFilePath } from '../lib/fixture.mjs'
import {
  TIMEOUT_MS,
  assertUnchanged,
  openAllDemos,
  openFolder,
  poll,
  rowFor,
  snapshot,
} from '../lib/replays-copy-in.mjs'

const PLACEHOLDER_DEMO_BYTES = 'q2l-fixture-demo-placeholder\n'
const TAKEN_DEMO_BYTES = 'q2l-fixture-demo-already-in-the-target\n'
const NAME_A = 'test-q2lbtm-a.dm2'
const NAME_B = 'test-q2lbtm-b.dm2'
const SUB = 'q2lbtm-sub'
const PICKED = 'q2lbtm-picked'
const demosPath = (rel) => installationConfigFilePath(INSTALL_ONE_ID, `demos/${rel}`)
const A = demosPath(NAME_A)
const B = demosPath(NAME_B)
const TAKEN_B = demosPath(`${SUB}/${NAME_B}`)
const PICKED_DIR = demosPath(PICKED)

export async function setup() {
  mkdirSync(demosPath(SUB), { recursive: true })
  mkdirSync(PICKED_DIR, { recursive: true })
  writeFileSync(A, PLACEHOLDER_DEMO_BYTES)
  writeFileSync(`${A}.json`, JSON.stringify({ schemaVersion: 1, tags: ['old', 'lan'] }))
  writeFileSync(B, PLACEHOLDER_DEMO_BYTES)
  writeFileSync(TAKEN_B, TAKEN_DEMO_BYTES)
  return { env: { Q2L_UI_PICK_FOLDER: PICKED_DIR } }
}

export async function teardown() {
  for (const dir of [demosPath(SUB), PICKED_DIR]) rmSync(dir, { recursive: true, force: true })
  for (const path of [A, B]) {
    rmSync(path, { force: true })
    rmSync(`${path}.json`, { force: true })
  }
}

export default async function replaysBulkTagMove({ page, shot, step }) {
  const expectText = async (testId, what, needle) => {
    const got = (await page.getByTestId(testId).textContent()) ?? ''
    if (!got.includes(needle)) {
      throw new Error(`replays-bulk-tag-move: ${what} should say "${needle}", got "${got}"`)
    }
  }
  const tagsOf = (path) => JSON.parse(readFileSync(`${path}.json`, 'utf8')).tags ?? []
  const selectBoth = async () => {
    await rowFor(page, NAME_A).click({ timeout: TIMEOUT_MS })
    await rowFor(page, NAME_B).click({ modifiers: ['Control'], timeout: TIMEOUT_MS })
    await page.getByTestId('replays-bulk-bar').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }

  await openAllDemos(page)
  await openFolder(page, 'Fixture Favorite Install')
  await poll(
    'the flow demos to be listed',
    async () =>
      (await rowFor(page, NAME_A).count()) === 1 && (await rowFor(page, NAME_B).count()) === 1,
    TIMEOUT_MS,
  )

  step('the tag dialog counts the tags on the selection')
  await selectBoth()
  await page.getByTestId('replays-bulk-tag').click({ timeout: TIMEOUT_MS })
  const chips = page.getByTestId('replays-bulk-tag-chip')
  await chips.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const chipText = (await chips.allTextContents()).join('|')
  if (!chipText.includes('lan1 of 2') || !chipText.includes('old1 of 2')) {
    throw new Error(`replays-bulk-tag-move: the carried tags should be counted, got "${chipText}"`)
  }
  await shot('replays-bulk-tag-dialog')

  step('a tag is added to both demos and one is removed')
  await chips.filter({ hasText: 'old' }).getByRole('button').click({ timeout: TIMEOUT_MS })
  const input = page.getByTestId('replays-tag-input')
  await input.fill('epic')
  await input.press('Enter')
  await page.getByTestId('replays-bulk-tag-apply').click({ timeout: TIMEOUT_MS })
  await expectText('replays-bulk-summary', 'the tag outcome', '2 tagged')
  await poll(
    'both notes files to carry the new tag',
    async () => existsSync(`${B}.json`) && tagsOf(B).includes('epic') && tagsOf(A).includes('epic'),
    TIMEOUT_MS,
  )
  if (tagsOf(A).includes('old') || !tagsOf(A).includes('lan')) {
    throw new Error(`replays-bulk-tag-move: A should lose "old" and keep "lan", got ${tagsOf(A)}`)
  }
  await shot('replays-bulk-tag-outcome')

  step('moving into a folder where a name is taken reports that demo and leaves the target alone')
  const takenBefore = snapshot(TAKEN_B)
  await selectBoth()
  await page.getByTestId('replays-bulk-move').click({ timeout: TIMEOUT_MS })
  await page
    .locator(`[data-testid="replays-bulk-move-folder"][data-path="${SUB}"]`)
    .click({ timeout: TIMEOUT_MS })
  await expectText('replays-bulk-summary', 'the move outcome', '1 moved, 1 failed')
  await expectText('replays-bulk-entries', 'the failed demo', NAME_B)
  await expectText('replays-bulk-entries', 'the reason', 'already there')
  assertUnchanged('the demo that was in the target', TAKEN_B, takenBefore)
  if (existsSync(A) || !existsSync(demosPath(`${SUB}/${NAME_A}`))) {
    throw new Error('replays-bulk-tag-move: A should have moved into the subfolder')
  }
  if (!existsSync(B) || !existsSync(`${B}.json`)) {
    throw new Error('replays-bulk-tag-move: B and its notes file should have stayed')
  }
  await shot('replays-bulk-move-outcome')

  step('the folder the harness picks takes the demo that stayed')
  await page.getByTestId('replays-bulk-move').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-bulk-move-pick').click({ timeout: TIMEOUT_MS })
  await poll(
    'the demo and its notes file to arrive in the picked folder',
    async () =>
      existsSync(join(PICKED_DIR, NAME_B)) &&
      existsSync(join(PICKED_DIR, `${NAME_B}.json`)) &&
      !existsSync(B),
    TIMEOUT_MS,
  )
  await expectText('replays-bulk-summary', 'the pick outcome', '1 moved')
}
