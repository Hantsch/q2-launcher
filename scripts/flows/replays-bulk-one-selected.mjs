// Story 259 acceptance flow: the Delete/Tag/Move bar shows as soon as one demo is selected and each
// action acts on that demo only - Delete asks first, Tag and Move touch no other demo - the bar is
// gone when nothing is selected, and one demo inside a zip gets the same disabled actions and zip
// reason as several.
//
// Selectors - read `BulkActionBar.tsx`, `TagDemosDialog.tsx`, `MoveDemosDialog.tsx` before changing:
//   replays-filter-search        DemoListFilterBar.tsx - narrows the list to this flow's demos
//   replays-demo-row             DemoRow.tsx - one row; replays-demo-scroll the focusable list
//   replays-bulk-bar             BulkActionBar.tsx - shown at one or more selected, or with an outcome
//   replays-bulk-count/-delete/-tag/-move/-zip-skip/-summary   its parts
//   replays-tag-input            TagInput.tsx - the add input; replays-bulk-tag-apply submits
//   replays-bulk-move-folder     MoveDemosDialog.tsx - a folder (data-path)
//   replays-bulk-delete-confirm  ReplaysView.tsx - the confirmation dialog's confirm button

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  INSTALL_ONE_ID,
  installationConfigFilePath,
  removeReplaysZipPackArchive,
  vendoredExtractorExists,
  writeReplaysZipPackArchive,
} from '../lib/fixture.mjs'
import { variantUserDataDir } from '../lib/harness.mjs'
import { TIMEOUT_MS, openAllDemos, openFolder, poll, rowFor } from '../lib/replays-copy-in.mjs'

const PLACEHOLDER_DEMO_BYTES = 'q2l-fixture-demo-placeholder\n'
const SUB = 'q2lbo-sub'
const TAG = 'q2lbo'
const [NAME_A, NAME_B, NAME_C] = ['a', 'b', 'c'].map((letter) => `test-q2lbo-${letter}.dm2`)
const ZIP_ENTRY = 'test.dm2'
const demoPath = (rel) => installationConfigFilePath(INSTALL_ONE_ID, `demos/${rel}`)
const A = demoPath(NAME_A)
const B = demoPath(NAME_B)
const C = demoPath(NAME_C)
const A_MOVED = demoPath(`${SUB}/${NAME_A}`)

const cleanup = () => {
  rmSync(demoPath(SUB), { recursive: true, force: true })
  for (const path of [A, B, C]) {
    rmSync(path, { force: true })
    rmSync(`${path}.json`, { force: true })
  }
}

export async function setup() {
  writeReplaysZipPackArchive()
  mkdirSync(demoPath(SUB), { recursive: true })
  mkdirSync(dirname(A), { recursive: true })
  for (const path of [A, B, C]) writeFileSync(path, PLACEHOLDER_DEMO_BYTES)
  return {}
}

export async function teardown() {
  removeReplaysZipPackArchive()
  cleanup()
}

export default async function replaysBulkOneSelected({ page, shot, step, variant }) {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'replays-bulk-one-selected: resources/bin/7za.exe is missing - run `npm run fetch:7za`',
    )
  }
  const expectText = async (testId, what, needle) => {
    const got = (await page.getByTestId(testId).textContent()) ?? ''
    if (!got.includes(needle)) {
      throw new Error(`replays-bulk-one-selected: ${what} should say "${needle}", got "${got}"`)
    }
  }
  const bar = page.getByTestId('replays-bulk-bar')
  const actions = ['replays-bulk-delete', 'replays-bulk-tag', 'replays-bulk-move']
  const tagsOf = (path) =>
    existsSync(`${path}.json`) ? (JSON.parse(readFileSync(`${path}.json`, 'utf8')).tags ?? []) : []
  const selectOnly = async (name) => {
    await rowFor(page, name).click({ timeout: TIMEOUT_MS })
    await bar.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }

  await openAllDemos(page)
  await openFolder(page, 'Fixture Favorite Install')
  await page.getByTestId('replays-filter-search').fill('test')
  await poll(
    'the flow demos and the zip entry to be listed',
    async () => {
      for (const name of [NAME_A, NAME_B, NAME_C, ZIP_ENTRY])
        if ((await rowFor(page, name).count()) !== 1) return false
      return true
    },
    TIMEOUT_MS,
  )

  step('with no demo selected the bar is not shown')
  if ((await bar.count()) !== 0) {
    throw new Error('replays-bulk-one-selected: the bulk bar is shown with nothing selected')
  }

  step('one selected demo shows Delete, Tag and Move')
  await selectOnly(NAME_A)
  await expectText('replays-bulk-count', 'the bar count', '1 demo selected')
  for (const id of actions) {
    const button = page.getByTestId(id)
    await button.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    if (!(await button.isEnabled())) {
      throw new Error(`replays-bulk-one-selected: ${id} should be enabled for one selected demo`)
    }
  }
  await shot('replays-bulk-one-selected')

  step('Tag acts on the one selected demo')
  await page.getByTestId('replays-bulk-tag').click({ timeout: TIMEOUT_MS })
  await page.getByText('Tag 1 demo').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const input = page.getByRole('dialog', { name: 'Tag 1 demo' }).getByTestId('replays-tag-input')
  await input.fill(TAG)
  await input.press('Enter')
  await page.getByTestId('replays-bulk-tag-apply').click({ timeout: TIMEOUT_MS })
  await expectText('replays-bulk-summary', 'the tag outcome', '1 tagged')
  await poll('the selected demo to carry the tag', async () => tagsOf(A).includes(TAG), TIMEOUT_MS)
  if (tagsOf(B).includes(TAG) || tagsOf(C).includes(TAG)) {
    throw new Error('replays-bulk-one-selected: Tag reached a demo that was not selected')
  }

  step('Move acts on the one selected demo')
  await selectOnly(NAME_A)
  await page.getByTestId('replays-bulk-move').click({ timeout: TIMEOUT_MS })
  await page
    .locator(`[data-testid="replays-bulk-move-folder"][data-path="${SUB}"]`)
    .click({ timeout: TIMEOUT_MS })
  await expectText('replays-bulk-summary', 'the move outcome', '1 moved')
  await poll(
    'the selected demo to arrive in the subfolder',
    async () => existsSync(A_MOVED) && !existsSync(A),
    TIMEOUT_MS,
  )
  if (!existsSync(B) || !existsSync(C)) {
    throw new Error('replays-bulk-one-selected: Move reached a demo that was not selected')
  }

  step('Delete asks first and removes only the one selected demo')
  await selectOnly(NAME_B)
  await page.getByTestId('replays-bulk-delete').click({ timeout: TIMEOUT_MS })
  await page.getByText('Delete 1 demo?').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!existsSync(B))
    throw new Error('replays-bulk-one-selected: Delete ran before the confirmation')
  await page.getByTestId('replays-bulk-delete-confirm').click({ timeout: TIMEOUT_MS })
  await expectText('replays-bulk-summary', 'the delete outcome', '1 deleted')
  const trashDir = join(variantUserDataDir(variant), 'harness-trash')
  const trashed = existsSync(trashDir) ? readdirSync(trashDir) : []
  if (existsSync(B) || !trashed.some((entry) => entry.endsWith(`-${NAME_B}`))) {
    throw new Error(`replays-bulk-one-selected: ${NAME_B} should be gone and in ${trashDir}`)
  }
  if (!existsSync(C)) {
    throw new Error('replays-bulk-one-selected: Delete reached a demo that was not selected')
  }

  step('clearing the selection hides the bar')
  await selectOnly(NAME_C)
  await page.getByTestId('replays-demo-scroll').focus()
  await page.keyboard.press('Escape')
  await bar.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('one selected zip demo disables the actions with the zip reason')
  await selectOnly(ZIP_ENTRY)
  for (const id of actions) {
    if (!(await page.getByTestId(id).isDisabled())) {
      throw new Error(`replays-bulk-one-selected: ${id} should be disabled for a zip entry`)
    }
  }
  await expectText('replays-bulk-zip-skip', 'the zip line', '1 zip entry is skipped')
  await shot('replays-bulk-one-selected-zip')

  // The filter is persisted after a debounce: leave it empty for the flows that follow.
  await page.getByTestId('replays-filter-search').fill('')
  await page.waitForTimeout(600)
}
