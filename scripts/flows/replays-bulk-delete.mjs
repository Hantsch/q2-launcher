// Story 244 acceptance flow: several demos are selected and deleted in one go - the bulk bar shows
// the count and the Delete/Tag/Move actions, the detail pane the selection summary, a zip entry in
// the selection is named as skipped, the confirmation names how many demos go, the files land in
// the harness trash (never the real one), the outcome is spelled out, and the demos that were not
// deleted stay selected.
//
// Selectors - read `BulkActionBar.tsx`, `SelectionSummary.tsx` and `ReplaysView.tsx` before changing:
//   replays-filter-search        DemoListFilterBar.tsx - narrows the list to this flow's demos
//   replays-demo-row             DemoRow.tsx - one row (data-demo-id); replays-row-select its checkbox
//   replays-bulk-bar             BulkActionBar.tsx - shown at two or more selected, or with an outcome
//   replays-bulk-count/-delete/-tag/-move/-zip-skip/-outcome/-summary/-entries   its parts
//   replays-bulk-delete-confirm  ReplaysView.tsx - the confirmation dialog's confirm button
//   replays-selection-summary    SelectionSummary.tsx - the detail pane while several are selected

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  INSTALL_ONE_ID,
  installationConfigFilePath,
  removeReplaysZipPackArchive,
  vendoredExtractorExists,
  writeReplaysZipPackArchive,
} from '../lib/fixture.mjs'
import { variantUserDataDir } from '../lib/harness.mjs'
import { openAllDemos, openFolder, poll } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000
const PLACEHOLDER_DEMO_BYTES = 'q2l-fixture-demo-placeholder\n'
const LOOSE = ['a', 'b', 'c'].map((letter) => `test-q2lbd-${letter}.dm2`)
const ZIP_ENTRY = 'test.dm2'
const demoPath = (name) => installationConfigFilePath(INSTALL_ONE_ID, `demos/${name}`)

export async function setup() {
  writeReplaysZipPackArchive()
  mkdirSync(dirname(demoPath(LOOSE[0])), { recursive: true })
  for (const name of LOOSE) writeFileSync(demoPath(name), PLACEHOLDER_DEMO_BYTES)
  return {}
}

export async function teardown() {
  removeReplaysZipPackArchive()
  for (const name of LOOSE) rmSync(demoPath(name), { force: true })
}

export default async function replaysBulkDelete({ page, shot, step, variant }) {
  if (!vendoredExtractorExists()) {
    throw new Error('replays-bulk-delete: resources/bin/7za.exe is missing - run `npm run fetch:7za`')
  }
  const text = async (testId) => (await page.getByTestId(testId).textContent()) ?? ''
  const expectText = async (testId, what, needle) => {
    const got = await text(testId)
    if (!got.includes(needle)) {
      throw new Error(`replays-bulk-delete: ${what} should say "${needle}", got "${got}"`)
    }
  }

  await openAllDemos(page)
  await openFolder(page, 'Fixture Favorite Install')
  await page.getByTestId('replays-filter-search').fill('test')

  const rows = page.getByTestId('replays-demo-row')
  const rowNamed = (name) =>
    rows.filter({ has: page.getByTestId('replays-demo-name').filter({ hasText: name }) })
  await poll(
    'the flow demos and the zip entry to be listed',
    async () => {
      for (const name of [...LOOSE, ZIP_ENTRY]) if ((await rowNamed(name).count()) !== 1) return false
      return true
    },
    TIMEOUT_MS,
  )
  const checkedNames = () =>
    rows.evaluateAll((els) =>
      els
        .filter((el) => el.querySelector('[data-testid="replays-row-select"]').checked)
        .map((el) => el.querySelector('[data-testid="replays-demo-name"]').textContent),
    )

  step('the bulk bar and the summary describe the selection')
  await rowNamed(LOOSE[0]).click({ timeout: TIMEOUT_MS })
  for (const name of [LOOSE[1], LOOSE[2], ZIP_ENTRY]) {
    await rowNamed(name).click({ modifiers: ['Control'], timeout: TIMEOUT_MS })
  }
  await page.getByTestId('replays-bulk-bar').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectText('replays-bulk-count', 'the bar count', '4 demos selected')
  for (const id of ['replays-bulk-delete', 'replays-bulk-tag', 'replays-bulk-move']) {
    await page.getByTestId(id).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  await expectText('replays-selection-summary', 'the selection summary', '4 demos selected')
  await expectText('replays-bulk-zip-skip', 'the zip line', '1 zip entry is skipped')
  await shot('replays-bulk-delete-selected')

  step('the confirmation names the count without the zip entry')
  await page.getByTestId('replays-bulk-delete').click({ timeout: TIMEOUT_MS })
  await page.getByText('Delete 3 demos?').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-bulk-delete-confirm').click({ timeout: TIMEOUT_MS })

  step('the outcome is shown, the files are in the harness trash')
  await page.getByTestId('replays-bulk-outcome').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectText('replays-bulk-summary', 'the outcome summary', '3 deleted, 1 skipped')
  await expectText('replays-bulk-entries', 'the skipped list', ZIP_ENTRY)
  await expectText('replays-bulk-entries', 'the skipped reason', 'read-only')
  const trashDir = join(variantUserDataDir(variant), 'harness-trash')
  const trashed = existsSync(trashDir) ? readdirSync(trashDir) : []
  for (const name of LOOSE) {
    if (existsSync(demoPath(name))) throw new Error(`replays-bulk-delete: ${name} was not removed`)
    if (!trashed.some((entry) => entry.endsWith(`-${name}`))) {
      throw new Error(`replays-bulk-delete: ${name} is not in ${trashDir} (${trashed.join(', ')})`)
    }
  }
  await shot('replays-bulk-delete-outcome')

  step('the demo that was not deleted stays selected')
  await poll(
    'only the zip entry to stay listed and checked',
    async () => {
      const checked = await checkedNames()
      return checked.length === 1 && checked[0].includes(ZIP_ENTRY) && (await rows.count()) >= 1
    },
    TIMEOUT_MS,
  )
  for (const name of LOOSE) {
    if ((await rowNamed(name).count()) !== 0) {
      throw new Error(`replays-bulk-delete: ${name} is still listed after the delete`)
    }
  }

  step('the next selection change dismisses the outcome')
  await page.getByTestId('replays-demo-scroll').focus()
  await page.keyboard.press('Escape')
  await page.getByTestId('replays-bulk-outcome').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  // The filter is persisted after a debounce: leave it empty for the flows that follow.
  await page.getByTestId('replays-filter-search').fill('')
  await page.waitForTimeout(600)
}
