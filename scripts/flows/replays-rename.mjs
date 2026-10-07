// Story 157 D4 acceptance flow: renames a demo through the detail panel's "Rename demo" dialog -
// an invalid stem is refused inline before any request is sent, a taken name is refused by the
// server without touching the collision target, a valid rename moves both the demo and its
// sidecar on disk and the selection follows the renamed row, and the sidecar picks up a `date`
// alongside the `description` it already carried. Mirrors `replays-demo-file-actions.mjs`'s
// setup/teardown shape and selector conventions.
//
// Selectors, not guesses - read `RenameDemoDialog.tsx`, `DemoFileActions.tsx` and
// `DemoDetailPanel.tsx` before changing any of these:
//   nav-replays                 TitleBar.tsx - primary nav entry
//   replays-filter-search       DemoListFilterBar.tsx - narrows the virtualized list into the DOM
//   replays-demo-row            DemoRow.tsx - one row
//   replays-detail              DemoDetailPanel.tsx - the detail panel
//   replays-detail-title        DemoDetailPanel.tsx - the panel's h2
//   replays-detail-file-actions DemoDetailPanel.tsx - wraps DemoFileActions
//   replays-detail-field-map    DemoDetailPanel.tsx - the map detail row
//   replays-detail-field-date   DemoDetailPanel.tsx - the date detail row
//   demo-rename                 DemoFileActions.tsx - opens the rename dialog
//   demo-rename-dialog          RenameDemoDialog.tsx - the dialog's content div (Modal's `children`)
//   demo-rename-input           RenameDemoDialog.tsx - the stem input, inside demo-rename-dialog
//   demo-rename-save            RenameDemoDialog.tsx - the Save button, in Modal's `footer` prop -
//                                a DOM sibling of demo-rename-dialog, not a descendant - so it is
//                                queried at the page level, not scoped under `dialog`
//   demo-rename-error           RenameDemoDialog.tsx - the inline reason, inside demo-rename-dialog

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { INSTALL_ONE_ID, installationConfigFilePath } from '../lib/fixture.mjs'
import { openAllDemos, openFolder, rowFor } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

// Deliberately unparsable - the same placeholder bytes the shared demo fixture uses, so this
// file's map stays unknown/null before and after the rename (D4's step 4 relies on that).
const PLACEHOLDER_DEMO_BYTES = 'q2l-fixture-demo-placeholder\n'

const ORIGINAL_NAME = '2026-09-26-2130-q2dm1.dm2'
const ORIGINAL_DEMO = installationConfigFilePath(INSTALL_ONE_ID, `demos/${ORIGINAL_NAME}`)
const ORIGINAL_SIDECAR = installationConfigFilePath(INSTALL_ONE_ID, `demos/${ORIGINAL_NAME}.json`)
const TAKEN_DEMO = installationConfigFilePath(INSTALL_ONE_ID, 'demos/taken.dm2')
const FINAL_NAME = 'final-vs-tom.dm2'
const FINAL_DEMO = installationConfigFilePath(INSTALL_ONE_ID, `demos/${FINAL_NAME}`)
const FINAL_SIDECAR = installationConfigFilePath(INSTALL_ONE_ID, `demos/${FINAL_NAME}.json`)

const ORIGINAL_DESCRIPTION = 'a description that must survive the rename'
const ORIGINAL_SIDECAR_JSON = JSON.stringify({
  schemaVersion: 1,
  description: ORIGINAL_DESCRIPTION,
})

export async function setup() {
  mkdirSync(dirname(ORIGINAL_DEMO), { recursive: true })
  writeFileSync(ORIGINAL_DEMO, PLACEHOLDER_DEMO_BYTES)
  writeFileSync(ORIGINAL_SIDECAR, ORIGINAL_SIDECAR_JSON)
  writeFileSync(TAKEN_DEMO, PLACEHOLDER_DEMO_BYTES)
  return {}
}

export async function teardown() {
  // Flows never reseed - clean up whichever names are on disk, whichever step the flow reached.
  rmSync(ORIGINAL_DEMO, { force: true })
  rmSync(ORIGINAL_SIDECAR, { force: true })
  rmSync(TAKEN_DEMO, { force: true })
  rmSync(FINAL_DEMO, { force: true })
  rmSync(FINAL_SIDECAR, { force: true })
}

export default async function replaysRename({ page, shot, step }) {
  step('an invalid name shows its reason and blocks saving')
  await openAllDemos(page)
  await openFolder(page, 'Fixture Favorite Install')

  // The demo list is virtualized (VirtualDemoList.tsx) - narrow it via the search filter to bring
  // this fixture's row into the rendered window, same trick `replays-demo-file-actions.mjs` uses.
  await page.getByTestId('replays-filter-search').fill(ORIGINAL_NAME)
  await rowFor(page, ORIGINAL_NAME).click({ timeout: TIMEOUT_MS })

  const detail = page.getByTestId('replays-detail')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const mapFieldTextBeforeRename = await detail.getByTestId('replays-detail-input-map').inputValue()

  await detail
    .getByTestId('replays-detail-file-actions')
    .getByTestId('demo-rename')
    .click({ timeout: TIMEOUT_MS })
  const dialog = page.getByTestId('demo-rename-dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const input = dialog.getByTestId('demo-rename-input')
  // The Save button lives in `Modal`'s `footer` prop, a DOM sibling of the `demo-rename-dialog`
  // content div (Modal.tsx renders `children` and `footer` into separate sibling containers) - so
  // it must be queried at the page level, same convention `repair.mjs` uses for `repair-dismiss`.
  const save = page.getByTestId('demo-rename-save')

  await input.fill('bad/name')
  await dialog.getByTestId('demo-rename-error').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await save.isDisabled())) {
    throw new Error('replays-rename: Save must stay disabled while the typed stem is invalid')
  }

  step('a taken name is rejected and nothing is overwritten')
  const takenBefore = readFileSync(TAKEN_DEMO)

  await input.fill('taken')
  await save.click({ timeout: TIMEOUT_MS })
  const errorAfterTaken = dialog.getByTestId('demo-rename-error')
  await errorAfterTaken.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const takenAfter = readFileSync(TAKEN_DEMO)
  if (!takenBefore.equals(takenAfter)) {
    throw new Error(
      'replays-rename: a rejected rename to a taken name must not touch the collision target',
    )
  }

  step('renames the demo and its sidecar')
  await input.fill('')
  await input.fill('final-vs-tom')
  await save.click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  if (!existsSync(FINAL_DEMO)) throw new Error(`replays-rename: expected ${FINAL_DEMO} to exist`)
  if (!existsSync(FINAL_SIDECAR))
    throw new Error(`replays-rename: expected ${FINAL_SIDECAR} to exist`)
  if (existsSync(ORIGINAL_DEMO))
    throw new Error(`replays-rename: expected ${ORIGINAL_DEMO} to no longer exist`)
  if (existsSync(ORIGINAL_SIDECAR)) {
    throw new Error(`replays-rename: expected ${ORIGINAL_SIDECAR} to no longer exist`)
  }

  step('the renamed row keeps its facts and selection')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const title = await detail.getByTestId('replays-detail-title').textContent()
  if (!title.includes('final-vs-tom')) {
    throw new Error(
      `replays-rename: expected the detail title to show final-vs-tom, got "${title}"`,
    )
  }
  // AC7: `final-vs-tom.dm2` no longer matches the autorecord pattern that supplied `q2dm1` as a
  // name-derived fact, so the rename writes it into the sidecar rather than losing it - the panel
  // still shows the value (no provenance text any more) and the sidecar JSON carries `map` (asserted
  // below, next to the date).
  const mapFieldTextAfterRename = await detail.getByTestId('replays-detail-input-map').inputValue()
  if (!mapFieldTextAfterRename.includes('q2dm1')) {
    throw new Error(
      `replays-rename: expected the map value to survive the rename, was "${mapFieldTextBeforeRename}", now "${mapFieldTextAfterRename}"`,
    )
  }

  step('the name date moves into the sidecar')
  const finalSidecar = JSON.parse(readFileSync(FINAL_SIDECAR, 'utf8'))
  if (finalSidecar.map !== 'q2dm1') {
    throw new Error(
      `replays-rename: expected the renamed sidecar to carry map "q2dm1", got ${JSON.stringify(finalSidecar.map)}`,
    )
  }
  if (finalSidecar.description !== ORIGINAL_DESCRIPTION) {
    throw new Error(
      `replays-rename: expected the sidecar's description to survive the rename, got "${finalSidecar.description}"`,
    )
  }
  if (finalSidecar.date === undefined || Number.isNaN(Date.parse(finalSidecar.date))) {
    throw new Error(
      `replays-rename: expected the sidecar to carry a parseable date, got ${finalSidecar.date}`,
    )
  }
  const parsedDate = new Date(finalSidecar.date)
  if (
    parsedDate.getUTCFullYear() !== 2026 ||
    parsedDate.getUTCMonth() !== 8 ||
    parsedDate.getUTCDate() !== 26
  ) {
    throw new Error(
      `replays-rename: expected the sidecar date to be 2026-09-26, got "${finalSidecar.date}"`,
    )
  }

  const dateFieldText = await detail.getByTestId('replays-detail-field-date').textContent()
  if (dateFieldText.trim() === '') {
    throw new Error('replays-rename: expected the date field to show a value')
  }

  await shot('replays-rename')
}
