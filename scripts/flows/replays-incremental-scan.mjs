// Story 144 D4 acceptance flow: proves the Demos view's own "index only re-reads what changed"
// design end to end on the real UI - opening the view with no cache yet still lists every fixture
// demo (only a scan can produce that), a file added on disk after that shows up once the refresh
// button is used and finishes, and a file removed on disk disappears the same way. Mirrors
// `scripts/flows/replays-discovered-list.mjs`'s structure and
// `scripts/flows/external-edit-cascades.mjs`'s "no reseed between runs, use a per-run-unique file
// name" idiom (`RUN_SUFFIX = Date.now().toString(36)`) so this flow is safe to re-run against a
// fixture whose state carries over from a previous run.
//
// Selectors, not guesses - read `src/renderer/src/modules/replays/ReplaysView.tsx` before changing
// any of these:
//   nav-replays            TitleBar.tsx - primary nav entry, `nav-${module.id}`
//   replays-demo-list      ReplaysView.tsx - the `<ul>` of discovered demos
//   replays-demo-row       ReplaysView.tsx - one `<li>` per demo
//   replays-demo-name      ReplaysView.tsx - the row's file name text
//   replays-refresh        ReplaysView.tsx - the manual rescan button; disabled + "Scanning…"
//                          label while a scan (`scanStart`/`onScanProgress`) is running

import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { REPLAYS_FIXTURE_DEMOS, installationRootFilePath } from '../lib/fixture.mjs'
import { openFolder, showAllInstallations } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

const RUN_SUFFIX = Date.now().toString(36)

/** One real fixture demo file this flow copies from, to create a genuinely new file the scanner
 * has never seen before - `duel_q2dm1.dm2`, an `INSTALL_ONE_ID`/`baseq2` loose file (mirrors
 * `replays-discovered-list.mjs`'s own use of `REPLAYS_FIXTURE_DEMOS`). */
const SOURCE_DEMO = REPLAYS_FIXTURE_DEMOS.find((demo) => demo.fileName === 'duel_q2dm1.dm2')

function sourceDemoPath() {
  return installationRootFilePath(
    SOURCE_DEMO.installationId,
    `baseq2/demos/${SOURCE_DEMO.fileName}`,
  )
}

function newDemoFileName() {
  return `q2l_flow_incremental_${RUN_SUFFIX}.dm2`
}

function newDemoPath() {
  return installationRootFilePath(SOURCE_DEMO.installationId, `baseq2/demos/${newDemoFileName()}`)
}

async function openDemosView(page) {
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  const list = page.getByTestId('replays-demo-list')
  await list.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

/** Waits for the refresh button to go back to its enabled "Refresh" state - the real signal a
 * triggered scan has finished and the list reflects the current on-disk state, same idiom
 * `replays-extra-folders.mjs`'s own `waitForDemosScanToFinish` uses. */
async function waitForScanToFinish(page) {
  const refreshButton = page.getByTestId('replays-refresh')
  await refreshButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await refreshButton.isDisabled())) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for replays-refresh to become enabled (scan finished)')
}

export default async function replaysIncrementalScan({ page, shot, step }) {
  step(
    'a fresh variant has no replays-index.json cache yet - opening Demos can only show the ' +
      'fixture rows via a real scan',
  )
  await openDemosView(page)

  await showAllInstallations(page)
  const expectedNames = REPLAYS_FIXTURE_DEMOS.map((demo) => demo.fileName)
  const rootLabel = (demo) => `${demo.installationName} · ${demo.gameDir}`
  const namesAfterFirstOpen = []
  for (const root of new Set(REPLAYS_FIXTURE_DEMOS.map(rootLabel))) {
    await openFolder(page, root)
    namesAfterFirstOpen.push(...(await page.getByTestId('replays-demo-name').allTextContents()))
    await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })
    await page.getByTestId('replays-breadcrumb').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  }
  await openFolder(page, rootLabel(SOURCE_DEMO))
  const sortedActual = [...namesAfterFirstOpen].sort()
  const sortedExpected = [...expectedNames].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `replays-incremental-scan: expected exactly ${JSON.stringify(sortedExpected)} after the first ` +
        `open, got ${JSON.stringify(sortedActual)}`,
    )
  }

  step('copy one fixture demo to a new file in the same demos folder, real fs')
  const newPath = newDemoPath()
  rmSync(newPath, { force: true })
  copyFileSync(sourceDemoPath(), newPath)

  step('click Refresh and wait for the scan to finish')
  await page.getByTestId('replays-refresh').click({ timeout: TIMEOUT_MS })
  await waitForScanToFinish(page)

  step('the new file now has its own row')
  const newRow = page.getByTestId('replays-demo-row').filter({ hasText: newDemoFileName() })
  await newRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const rowCountForNewFile = await newRow.count()
  if (rowCountForNewFile !== 1) {
    throw new Error(
      `replays-incremental-scan: expected exactly one row for ${newDemoFileName()}, got ${rowCountForNewFile}`,
    )
  }

  step('delete the new file, real fs')
  rmSync(newPath, { force: true })
  if (existsSync(newPath)) {
    throw new Error(`replays-incremental-scan: expected ${newPath} to be gone after rmSync`)
  }

  step('click Refresh again and wait for the scan to finish')
  await page.getByTestId('replays-refresh').click({ timeout: TIMEOUT_MS })
  await waitForScanToFinish(page)

  step('the row for the deleted file is gone')
  await newRow.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  const rowCountAfterDelete = await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: newDemoFileName() })
    .count()
  if (rowCountAfterDelete !== 0) {
    throw new Error(
      `replays-incremental-scan: expected zero rows for ${newDemoFileName()} after deletion, got ${rowCountAfterDelete}`,
    )
  }

  await shot('replays-after-refresh')
}
