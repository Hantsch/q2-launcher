// Story 243 acceptance flow: a demo's details are edited where they are read. The detail is one view
// with no Edit, Save or Cancel - every text fact is an input in place that saves itself (Enter or
// leaving the field), Escape reverts, a refused text stays with its reason, a failed save toasts and
// keeps the text, and the list patches that one row without a rescan. Runs against the
// `replays-rows` fixture variant, same as `replays-demo-detail.mjs`, so this flow needs no
// `setup()`/`teardown()` of its own.
//
// Selectors - read `DemoDetailPanel.tsx`, `InPlaceField.tsx`, `DemoListFilterBar.tsx` and
// `ReplaysListStatus.tsx` before changing any of these:
//   replays-detail-edit / replays-editor-save / -cancel   must not exist any more
//   replays-detail-input-<field>        DemoDetailPanel.tsx - one in-place input per text fact
//   replays-detail-input-<field>-error  InPlaceField.tsx - the refusal reason
//   replays-discard-dialog              must not exist any more
//   replays-list-loading                ReplaysListStatus.tsx - the scan-progress strip
//   [role="status"]                     the toast region

import { existsSync, readFileSync, rmSync } from 'node:fs'
import {
  REPLAYS_ROWS_DUEL_DEMO,
  REPLAYS_ROWS_MVD_DEMO,
  replaysRowsSidecarPath,
} from '../lib/fixture.mjs'
import { rowFor, openDemosRoot } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

export const variant = 'replays-rows'

const NAME = 'Edited MVD final'
const MOD = 'lithium'
const GONE_TEXT = 'The demo file is gone, so its notes were not saved.'

function sidecarText(demo = REPLAYS_ROWS_MVD_DEMO) {
  try {
    return readFileSync(replaysRowsSidecarPath(demo), 'utf8')
  } catch {
    return null
  }
}

const input = (page, field) => page.getByTestId(`replays-detail-input-${field}`)

async function expectNone(page, testIds, why) {
  for (const id of testIds) {
    if ((await page.getByTestId(id).count()) !== 0) {
      throw new Error(`replays-edit-sidecar: ${why} - ${id} must not exist`)
    }
  }
}

async function expectValue(page, field, expected, why) {
  const actual = await input(page, field).inputValue()
  if (actual !== expected) {
    throw new Error(
      `replays-edit-sidecar: ${why} - ${field} expected "${expected}", got "${actual}"`,
    )
  }
}

async function expectReason(page, field, expected) {
  const reason = page.getByTestId(`replays-detail-input-${field}-error`)
  await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = (await reason.textContent()) ?? ''
  if (!text.includes(expected)) {
    throw new Error(
      `replays-edit-sidecar: the ${field} reason expected to contain "${expected}", got "${text}"`,
    )
  }
}

async function waitForSidecar(predicate, why) {
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const text = sidecarText()
    const parsed = text === null ? {} : JSON.parse(text)
    if (predicate(parsed)) return parsed
    if (Date.now() > deadline) {
      throw new Error(`replays-edit-sidecar: ${why} - sidecar is ${JSON.stringify(parsed)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export default async function replaysEditSidecar({ page, shot, step }) {
  await openDemosRoot(page)
  await rowFor(page, REPLAYS_ROWS_MVD_DEMO).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail-title').waitFor({ state: 'attached', timeout: TIMEOUT_MS })

  step('the detail is one view: no Edit, Save, Cancel or discard dialog')
  await expectNone(
    page,
    ['replays-detail-edit', 'replays-editor-save', 'replays-editor-cancel'],
    'the detail is always editable',
  )
  await input(page, 'description').fill('A note typed and then left behind')
  await rowFor(page, REPLAYS_ROWS_DUEL_DEMO).click({ timeout: TIMEOUT_MS })
  await expectNone(page, ['replays-discard-dialog'], 'selecting another demo never asks')
  await rowFor(page, REPLAYS_ROWS_MVD_DEMO).click({ timeout: TIMEOUT_MS })
  await waitForSidecar(
    (sidecar) => sidecar.description === 'A note typed and then left behind',
    'leaving a demo must save the text typed in its field',
  )

  step('every text field is an input in place')
  for (const field of ['name', 'description', 'date', 'map', 'mod', 'gamemode']) {
    await input(page, field).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  await page
    .getByTestId('replays-detail-header')
    .getByTestId('replays-detail-input-name')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('Enter saves the name, blur saves the mod, Escape reverts')
  await input(page, 'name').fill(NAME)
  await input(page, 'name').press('Enter')
  await rowFor(page, NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForSidecar((sidecar) => sidecar.name === NAME, 'Enter must save the name')

  await input(page, 'mod').fill(MOD)
  await input(page, 'name').focus()
  await waitForSidecar((sidecar) => sidecar.mod === MOD, 'leaving the field must save the mod')

  await input(page, 'map').fill('q2dm-escaped')
  await input(page, 'map').press('Escape')
  await input(page, 'name').focus()
  if ((await input(page, 'map').inputValue()) === 'q2dm-escaped') {
    throw new Error('replays-edit-sidecar: Escape must revert the typed map')
  }
  const afterEscape = JSON.parse(sidecarText() ?? '{}')
  if (afterEscape.map !== undefined || afterEscape.name !== NAME || afterEscape.mod !== MOD) {
    throw new Error(
      `replays-edit-sidecar: Escape must write nothing, got ${JSON.stringify(afterEscape)}`,
    )
  }
  await shot('replays-edit-sidecar')

  step('a failed save toasts and keeps the text')
  await rowFor(page, REPLAYS_ROWS_DUEL_DEMO).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail-title').waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  const gone = replaysRowsSidecarPath(REPLAYS_ROWS_DUEL_DEMO).replace(/\.json$/, '')
  if (!existsSync(gone)) {
    throw new Error(`replays-edit-sidecar: expected the duel demo file at ${gone}`)
  }
  rmSync(gone)
  await input(page, 'mod').fill('typed-after-delete')
  await input(page, 'mod').press('Enter')
  await page
    .locator('[role="status"]')
    .filter({ hasText: GONE_TEXT })
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectValue(page, 'mod', 'typed-after-delete', 'a failed save must keep the typed text')

  step('the row shows the saved name without a rescan')
  await rowFor(page, NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await page.getByTestId('replays-list-loading').count()) !== 0) {
    throw new Error('replays-edit-sidecar: a save must not show the scan-progress strip')
  }
  if (await page.getByTestId('replays-refresh').isDisabled()) {
    throw new Error('replays-edit-sidecar: a save must not start a scan')
  }

  step('an impossible date and a too-long name are refused with their reason')
  await rowFor(page, NAME).click({ timeout: TIMEOUT_MS })
  await expectValue(page, 'name', NAME, 'the demo opens on its saved name')
  const before = sidecarText()
  await input(page, 'date').fill('2026-02-30 10:00')
  await input(page, 'date').press('Enter')
  await expectReason(page, 'date', 'YYYY-MM-DD HH:MM')
  await input(page, 'name').fill('x'.repeat(201))
  await input(page, 'name').press('Enter')
  await expectReason(page, 'name', 'Too long')
  if (sidecarText() !== before) {
    throw new Error('replays-edit-sidecar: a refused text must not change the sidecar')
  }
}
