// Story 155 acceptance flow: a user writes their own notes for a demo in the detail panel's editor,
// sees invalid rating/date values refused inline, saves, and the notes land in the demo's `.json`
// sidecar on disk - while the list patches that one row in place (new name, favourite-first,
// filterable by the new mod) without a rescan. Then Cancel restores the saved value, and leaving a
// dirty draft asks first. Runs against the `replays-rows` fixture variant, same as
// `replays-demo-detail.mjs`, so this flow needs no `setup()`/`teardown()` of its own.
//
// Selectors - read `DemoNotesEditor.tsx`, `DiscardDemoNotesDialog.tsx`, `DemoListFilterBar.tsx` and
// `ReplaysListStatus.tsx` before changing any of these:
//   replays-editor-<field>            DemoNotesEditor.tsx - one control per field
//   replays-editor-error-<field>      DemoNotesEditor.tsx - inline rating/date error
//   replays-editor-save / -cancel     DemoNotesEditor.tsx
//   replays-discard-dialog / -keep    DiscardDemoNotesDialog.tsx
//   replays-filter-mod / -clear       DemoListFilterBar.tsx
//   replays-list-loading              ReplaysListStatus.tsx - the scan-progress strip

import { readFileSync } from 'node:fs'
import {
  REPLAYS_ROWS_DUEL_DEMO,
  REPLAYS_ROWS_MVD_DEMO,
  replaysRowsSidecarPath,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

export const variant = 'replays-rows'

const NAME = 'Edited MVD final'
const MOD = 'lithium'
// Later than the fixture's own file times, so favourite-first-then-newest puts this row on top even
// above the fixture's other favourite (the tdm row).
const DATE_TEXT = '2030-06-15 20:30'

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

async function expectInlineError(page, field) {
  await page.getByTestId(`replays-editor-error-${field}`).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await page.getByTestId('replays-editor-save').isDisabled())) {
    throw new Error(`replays-edit-sidecar: Save must be disabled while ${field} is invalid`)
  }
}

async function expectValue(page, field, expected, why) {
  const actual = await page.getByTestId(`replays-editor-${field}`).inputValue()
  if (actual !== expected) {
    throw new Error(`replays-edit-sidecar: ${why} - ${field} expected "${expected}", got "${actual}"`)
  }
}

export default async function replaysEditSidecar({ page, shot, step }) {
  step('opening a sidecar-less loose demo shows the notes editor')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  await rowFor(page, REPLAYS_ROWS_MVD_DEMO).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-editor').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('filling every field')
  await page.getByTestId('replays-editor-name').fill(NAME)
  await page.getByTestId('replays-editor-description').fill('The one with the comeback.')
  await page.getByTestId('replays-editor-mod').fill(MOD)
  await page.getByTestId('replays-editor-gamemode').fill('tdm')
  await page.getByTestId('replays-editor-map').fill('q2dm8')
  await page.getByTestId('replays-editor-date').fill(DATE_TEXT)
  await page.getByTestId('replays-editor-favourite').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-editor-rating').fill('8')

  step('rating 0 is refused inline and Save is disabled')
  await page.getByTestId('replays-editor-rating').fill('0')
  await expectInlineError(page, 'rating')
  await page.getByTestId('replays-editor-rating').fill('8')
  await page.getByTestId('replays-editor-error-rating').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('an impossible date is refused inline and Save is disabled')
  await page.getByTestId('replays-editor-date').fill('2026-02-30 10:00')
  await expectInlineError(page, 'date')
  await page.getByTestId('replays-editor-date').fill(DATE_TEXT)
  await page.getByTestId('replays-editor-error-date').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('Save writes every field into the sidecar on disk')
  await page.getByTestId('replays-editor-save').click({ timeout: TIMEOUT_MS })
  await rowFor(page, NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const written = JSON.parse(readFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_MVD_DEMO), 'utf8'))
  const expected = {
    name: NAME,
    description: 'The one with the comeback.',
    mod: MOD,
    gamemode: 'tdm',
    map: 'q2dm8',
    favourite: true,
    rating: 8,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (written[key] !== value) {
      throw new Error(`replays-edit-sidecar: sidecar ${key} expected ${JSON.stringify(value)}, got ${JSON.stringify(written[key])}`)
    }
  }
  if (typeof written.date !== 'string' || !written.date.startsWith('2030-06-15T20:30:00')) {
    throw new Error(`replays-edit-sidecar: sidecar date expected 2030-06-15T20:30:00±offset, got ${JSON.stringify(written.date)}`)
  }

  step('the row shows the new name, sits on top, and no rescan ran')
  const firstText = await page.getByTestId('replays-demo-row').first().textContent()
  if (!firstText.includes(NAME)) {
    throw new Error(`replays-edit-sidecar: the saved favourite should be the first row, got "${firstText}"`)
  }
  if ((await page.getByTestId('replays-list-loading').count()) !== 0) {
    throw new Error('replays-edit-sidecar: a save must not show the scan-progress strip')
  }
  if (await page.getByTestId('replays-refresh').isDisabled()) {
    throw new Error('replays-edit-sidecar: a save must not start a scan')
  }

  step('filtering by the new mod still lists the row')
  await page.getByTestId('replays-filter-mod').selectOption(MOD, { timeout: TIMEOUT_MS })
  await rowFor(page, NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('replays-edit-sidecar')
  await page.getByTestId('replays-filter-clear').click({ timeout: TIMEOUT_MS })
  await rowFor(page, REPLAYS_ROWS_DUEL_DEMO).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('Cancel puts the saved value back')
  await page.getByTestId('replays-editor-name').fill('Typed but not kept')
  await page.getByTestId('replays-editor-cancel').click({ timeout: TIMEOUT_MS })
  await expectValue(page, 'name', NAME, 'Cancel must restore the saved value')

  step('leaving a dirty draft asks first, and Keep editing keeps it')
  await page.getByTestId('replays-editor-name').fill('Unsaved edit')
  await rowFor(page, REPLAYS_ROWS_DUEL_DEMO).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-discard-dialog').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-discard-keep').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-discard-dialog').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  await expectValue(page, 'name', 'Unsaved edit', 'Keep editing must keep the draft')
}
