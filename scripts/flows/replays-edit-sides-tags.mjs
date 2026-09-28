// Story 155 acceptance flow: proves the sides/players editor and the tag input actually work on the
// real UI - adding sides, taking a known player onto a side by clicking its chip (no typing), typing
// two players in by hand and reordering/removing them, removing a whole side, and picking a
// tag-suggestion built from another demo's own tags - then Save writes it all into the demo's `.json`
// sidecar on disk. Runs against the `replays-rows` fixture variant (same as `replays-edit-sidecar.mjs`),
// plus its own `setup()` that drops one extra demo (a copy of `test.dm2`, which carries real header
// player data) and a sidecar with a seed tag next to the fixture's own no-sidecar demo.
//
// Selectors - read `SidesEditor.tsx`, `TagInput.tsx` and `DemoNotesEditor.tsx` before changing any
// of these:
//   replays-sides-add                 SidesEditor.tsx - "Add side" button
//   replays-side-<i>                  SidesEditor.tsx - one side card
//   replays-side-<i>-team/-result     SidesEditor.tsx - team/result inputs
//   replays-side-<i>-remove           SidesEditor.tsx - remove-side button
//   replays-side-<i>-add-player       SidesEditor.tsx - add-player text input (Enter adds)
//   replays-side-<i>-player-<j>       SidesEditor.tsx - one player row
//   replays-known-player              SidesEditor.tsx - a known-player chip (name + source)
//   replays-tag-input                 TagInput.tsx - the tag combobox input
//   replays-tag-option                TagInput.tsx - one suggestion option
//   replays-editor-save               DemoNotesEditor.tsx

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { REPO_ROOT } from '../lib/paths.mjs'
import { REPLAYS_ROWS_MVD_DEMO, replaysRowsSidecarPath } from '../lib/fixture.mjs'

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

function rowFor(page, text) {
  return page.getByTestId('replays-demo-row').filter({ hasText: text })
}

async function waitForDemosScanToFinish(page) {
  const refreshButton = page.getByTestId('replays-refresh')
  await refreshButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await refreshButton.isDisabled())) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for replays-refresh to become enabled (scan finished)')
}

export default async function replaysEditSidesTags({ page, shot, step }) {
  step('opening the known-players demo shows the notes editor')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  await rowFor(page, KNOWN_PLAYERS_DEMO).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-editor').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('adding two sides with team names and results')
  await page.getByTestId('replays-sides-add').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-0').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-0-team').fill('Alpha')
  await page.getByTestId('replays-side-0-result').fill('25')

  await page.getByTestId('replays-sides-add').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-1').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-1-team').fill('Bravo')
  await page.getByTestId('replays-side-1-result').fill('18')

  step('taking a known player onto side 1 by clicking its chip')
  const chips = page.getByTestId('replays-known-player')
  const firstChipName = (await chips.first().textContent()).split(' (')[0]
  await chips.first().click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-side-0-player-0')
    .filter({ hasText: firstChipName })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('typing two players into side 2 and reordering/removing them')
  const side1Input = page.getByTestId('replays-side-1-add-player')
  await side1Input.fill('Zed')
  await side1Input.press('Enter')
  await page.getByTestId('replays-side-1-player-0').filter({ hasText: 'Zed' }).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await side1Input.fill('Ana')
  await side1Input.press('Enter')
  await page.getByTestId('replays-side-1-player-1').filter({ hasText: 'Ana' }).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await page.getByTestId('replays-side-1-player-1').getByRole('button', { name: 'Move Ana up' }).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-1-player-0').filter({ hasText: 'Ana' }).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await page.getByTestId('replays-side-1-player-1').getByRole('button', { name: 'Remove Zed' }).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-1-player-1').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('removing side 2 entirely, then adding a new side again')
  await page.getByTestId('replays-side-1-remove').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-1').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-sides-add').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-1').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-side-1-team').fill('Charlie')

  step('typing "gru" in the tag input suggests the seeded tag, and picking it adds the chip')
  const tagInput = page.getByTestId('replays-tag-input')
  await tagInput.fill('gru')
  const option = page.getByTestId('replays-tag-option').filter({ hasText: SEED_TAG })
  await option.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await option.click({ timeout: TIMEOUT_MS })

  await shot('replays-edit-sides-tags')

  step('Save writes the sides (in order) and the tag into the sidecar on disk')
  await page.getByTestId('replays-editor-save').click({ timeout: TIMEOUT_MS })

  const sidecarPath = knownPlayersDemoPath() + '.json'
  const deadline = Date.now() + TIMEOUT_MS
  let written = null
  while (Date.now() < deadline) {
    try {
      written = JSON.parse(readFileSync(sidecarPath, 'utf8'))
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  if (written === null) {
    throw new Error(`replays-edit-sides-tags: sidecar never appeared at ${sidecarPath}`)
  }

  if (!Array.isArray(written.sides) || written.sides.length !== 2) {
    throw new Error(`replays-edit-sides-tags: expected 2 sides, got ${JSON.stringify(written.sides)}`)
  }
  if (written.sides[0].team !== 'Alpha' || written.sides[0].result !== '25') {
    throw new Error(`replays-edit-sides-tags: side 0 mismatch: ${JSON.stringify(written.sides[0])}`)
  }
  if (!written.sides[0].players.includes(firstChipName)) {
    throw new Error(`replays-edit-sides-tags: side 0 should include the known player, got ${JSON.stringify(written.sides[0].players)}`)
  }
  if (written.sides[1].team !== 'Charlie') {
    throw new Error(`replays-edit-sides-tags: side 1 (the re-added side) expected team "Charlie", got ${JSON.stringify(written.sides[1])}`)
  }
  if (!Array.isArray(written.tags) || !written.tags.includes(SEED_TAG)) {
    throw new Error(`replays-edit-sides-tags: expected tag "${SEED_TAG}", got ${JSON.stringify(written.tags)}`)
  }
}
