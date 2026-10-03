// Stories 155/178 acceptance flow: a user edits a demo's details where they read them. Before Edit
// there is no notes form at all; Edit turns the facts into inputs in place (the name in the header),
// an impossible date is refused with its reason as text, Save writes the `.json` sidecar on disk and
// puts the panel back in reading mode showing the saved values - while the list patches that one row
// in place without a rescan. Cancel restores the saved values and writes nothing; leaving a dirty edit
// asks first, the edit survives a module switch, and Discard throws it away without writing. Runs
// against the `replays-rows` fixture variant, same as `replays-demo-detail.mjs`, so this flow needs no
// `setup()`/`teardown()` of its own.
//
// Selectors - read `DemoDetailPanel.tsx`, `DemoDetailEditor.tsx`, `DiscardDemoNotesDialog.tsx`,
// `DemoListFilterBar.tsx` and `ReplaysListStatus.tsx` before changing any of these:
//   replays-detail-edit / -close      DemoDetailPanel.tsx - header icon buttons
//   replays-detail-header             DemoDetailPanel.tsx - the sticky header (title slot + buttons)
//   replays-detail-title              DemoDetailPanel.tsx - reading mode's name title
//   replays-detail-field-<id>         DemoDetailPanel.tsx - one reading-mode fact
//   replays-editor-<field>            DemoDetailEditor.tsx - one control per field (name in the header)
//   replays-editor-error-<field>      DemoDetailEditor.tsx - inline date error
//   replays-editor-save / -cancel     DemoDetailEditor.tsx
//   replays-discard-dialog / -keep / -confirm   DiscardDemoNotesDialog.tsx
//   replays-filter-mod / -clear       DemoListFilterBar.tsx
//   replays-list-loading              ReplaysListStatus.tsx - the scan-progress strip

import { readFileSync } from 'node:fs'
import {
  REPLAYS_ROWS_DUEL_DEMO,
  REPLAYS_ROWS_MVD_DEMO,
  replaysRowsSidecarPath,
} from '../lib/fixture.mjs'
import { rowFor, waitForDemosScanToFinish } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

export const variant = 'replays-rows'

const NAME = 'Edited MVD final'
const MOD = 'lithium'
const DATE_TEXT = '2030-06-15 20:30'

async function expectInlineError(page, field) {
  await page
    .getByTestId(`replays-editor-error-${field}`)
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await page.getByTestId('replays-editor-save').isDisabled())) {
    throw new Error(`replays-edit-sidecar: Save must be disabled while ${field} is invalid`)
  }
}

function sidecarText() {
  try {
    return readFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_MVD_DEMO), 'utf8')
  } catch {
    return null
  }
}

async function expectText(page, testId, expected, why) {
  const actual = (await page.getByTestId(testId).textContent()) ?? ''
  if (!actual.includes(expected)) {
    throw new Error(
      `replays-edit-sidecar: ${why} - ${testId} expected to contain "${expected}", got "${actual}"`,
    )
  }
}

async function expectValue(page, field, expected, why) {
  const actual = await page.getByTestId(`replays-editor-${field}`).inputValue()
  if (actual !== expected) {
    throw new Error(
      `replays-edit-sidecar: ${why} - ${field} expected "${expected}", got "${actual}"`,
    )
  }
}

export default async function replaysEditSidecar({ page, shot, step }) {
  step('opening a sidecar-less loose demo shows its facts, with no notes form')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  await rowFor(page, REPLAYS_ROWS_MVD_DEMO).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail-title').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const editorBits = await page.locator('[data-testid^="replays-editor"]').count()
  if (editorBits !== 0 || (await page.getByTestId('replays-notes-slot').count()) !== 0) {
    throw new Error(
      `replays-edit-sidecar: no notes form may render before Edit, found ${editorBits} replays-editor-* elements`,
    )
  }

  step('the favourite is set with the header button before editing')
  await page.getByTestId('replays-detail-favourite').click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="replays-detail-favourite"]')
        ?.getAttribute('aria-pressed') === 'true',
    undefined,
    { timeout: TIMEOUT_MS },
  )

  step('Edit turns the facts into inputs in place, the name in the header')
  await page.getByTestId('replays-detail-edit').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-editor').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (
    (await page.getByTestId('replays-editor-favourite').count()) !== 0 ||
    (await page.getByTestId('replays-editor-rating').count()) !== 0
  ) {
    throw new Error(
      'replays-edit-sidecar: edit mode must offer neither a favourite nor a rating input',
    )
  }
  await page
    .getByTestId('replays-detail-header')
    .getByTestId('replays-editor-name')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await page.getByTestId('replays-detail-title').count()) !== 0) {
    throw new Error(
      'replays-edit-sidecar: the name title must give way to the name input in edit mode',
    )
  }
  await page.getByTestId('replays-editor-name').fill(NAME)
  await page.getByTestId('replays-editor-mod').fill(MOD)
  await page.getByTestId('replays-editor-date').fill(DATE_TEXT)

  step('an impossible date is refused with its reason as text and Save is disabled')
  await page.getByTestId('replays-editor-date').fill('2026-02-30 10:00')
  await expectInlineError(page, 'date')
  await expectText(
    page,
    'replays-editor-error-date',
    'YYYY-MM-DD HH:MM',
    'the date reason must be visible text',
  )
  await page.getByTestId('replays-editor-date').fill(DATE_TEXT)
  await page
    .getByTestId('replays-editor-error-date')
    .waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('Save writes the sidecar and puts the panel back in reading mode showing the values')
  await page.getByTestId('replays-editor-save').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-editor').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await rowFor(page, NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const savedText = sidecarText()
  const written = JSON.parse(savedText ?? '{}')
  if (written.name !== NAME || written.mod !== MOD) {
    throw new Error(
      `replays-edit-sidecar: sidecar expected name/mod ${NAME}/${MOD}, got ${JSON.stringify(written)}`,
    )
  }
  if (written.favourite !== true) {
    throw new Error(
      `replays-edit-sidecar: Save must keep the favourite set before editing, got ${JSON.stringify(written)}`,
    )
  }
  if (typeof written.date !== 'string' || !written.date.startsWith('2030-06-15T20:30:00')) {
    throw new Error(
      `replays-edit-sidecar: sidecar date expected 2030-06-15T20:30:00 plus offset, got ${JSON.stringify(written.date)}`,
    )
  }
  await expectText(page, 'replays-detail-title', NAME, 'reading mode must show the saved name')
  await expectText(page, 'replays-detail-field-mod', MOD, 'reading mode must show the saved mod')
  await expectText(
    page,
    'replays-detail-field-date',
    '2030',
    'reading mode must show the saved date',
  )

  step('the row is patched in place and no rescan ran')
  if ((await page.getByTestId('replays-list-loading').count()) !== 0) {
    throw new Error('replays-edit-sidecar: a save must not show the scan-progress strip')
  }
  if (await page.getByTestId('replays-refresh').isDisabled()) {
    throw new Error('replays-edit-sidecar: a save must not start a scan')
  }
  await page.getByTestId('replays-filter-mod').selectOption(MOD, { timeout: TIMEOUT_MS })
  await rowFor(page, NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('replays-edit-sidecar')
  await page.getByTestId('replays-filter-clear').click({ timeout: TIMEOUT_MS })
  await rowFor(page, REPLAYS_ROWS_DUEL_DEMO).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('Cancel restores the saved values and writes nothing')
  await page.getByTestId('replays-detail-edit').click({ timeout: TIMEOUT_MS })
  await expectValue(page, 'name', NAME, 'Edit must start from the saved value')
  await page.getByTestId('replays-editor-name').fill('Typed but not kept')
  await page.getByTestId('replays-editor-cancel').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-editor').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await expectText(page, 'replays-detail-title', NAME, 'Cancel must leave the saved name')
  if (sidecarText() !== savedText)
    throw new Error('replays-edit-sidecar: Cancel must not write the sidecar')

  step('leaving a dirty edit asks first, and Keep editing keeps it')
  await page.getByTestId('replays-detail-edit').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-editor-name').fill('Unsaved edit')
  await rowFor(page, REPLAYS_ROWS_DUEL_DEMO).click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-discard-dialog')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-discard-keep').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-discard-dialog').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  await expectValue(page, 'name', 'Unsaved edit', 'Keep editing must keep the draft')

  step('the edit survives a module switch')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-editor').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  await expectValue(
    page,
    'name',
    'Unsaved edit',
    'a module switch must keep edit mode and the draft',
  )

  step('Close asks first, and Discard throws the edit away without writing')
  await page.getByTestId('replays-detail-close').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-discard-dialog')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-discard-confirm').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  if (sidecarText() !== savedText)
    throw new Error('replays-edit-sidecar: Discard must not write the sidecar')
}
