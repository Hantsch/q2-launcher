// Story 156 D2 acceptance flow: proves "Reveal in file manager" / "Copy path" actually act on the
// right real file - a loose demo, a pack.zip archive-entry demo (both actions target the archive
// itself, never the entry path inside it), and a demo whose file has vanished from disk since the
// last scan (the file-missing refusal, with nothing newly revealed). Mirrors
// `replays-zip-entries.mjs`'s setup/teardown shape and `replays-demo-detail.mjs`'s
// click-a-row-to-open-detail flow.
//
// Selectors, not guesses - read `src/renderer/src/modules/replays/components/DemoFileActions.tsx`
// and `DemoDetailPanel.tsx` before changing any of these:
//   nav-replays                     TitleBar.tsx - primary nav entry
//   replays-demo-list               ReplaysView.tsx - the `<ul>` of discovered demos
//   replays-demo-row                DemoRow.tsx - one row
//   replays-detail                  DemoDetailPanel.tsx - the detail panel
//   replays-detail-file-actions     DemoDetailPanel.tsx - wraps DemoFileActions
//   replays-demo-reveal             DemoFileActions.tsx - the reveal button
//   replays-demo-copy-path          DemoFileActions.tsx - the copy-path button
//   replays-demo-file-action-error  DemoFileActions.tsx - the persistent inline alert

import { copyFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  INSTALL_ONE_ID,
  installationConfigFilePath,
  removeReplaysZipPackArchive,
  vendoredExtractorExists,
  writeReplaysZipPackArchive,
} from '../lib/fixture.mjs'
import { variantUserDataDir } from '../lib/harness.mjs'
import { openDemos, openFolder, rowFor } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

const VANISH_SOURCE = installationConfigFilePath(INSTALL_ONE_ID, 'demos/FINAL.DM2')
const VANISH_DEST = installationConfigFilePath(INSTALL_ONE_ID, 'demos/vanish-156.dm2')

export async function setup() {
  writeReplaysZipPackArchive()
  copyFileSync(VANISH_SOURCE, VANISH_DEST)
  return {}
}

export async function teardown() {
  removeReplaysZipPackArchive()
  rmSync(VANISH_DEST, { force: true })
}

function readRevealedPaths() {
  const filePath = join(variantUserDataDir('populated'), 'ui-harness-revealed.json')
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default async function replaysDemoFileActions({ page, app, shot, step }) {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow needs a real pack.zip archive-entry row. Run ' +
        '`npm run fetch:7za` first.',
    )
  }

  step('navigating to the Demos view renders the discovered list')
  await openDemos(page)
  await openFolder(page, 'Fixture Favorite Install')

  const detail = page.getByTestId('replays-detail')

  step("reveal on a loose demo records that demo's absolute path")
  await rowFor(page, 'duel_q2dm1.dm2').click({ timeout: TIMEOUT_MS })
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const beforeReveal = readRevealedPaths().length
  await detail.getByTestId('replays-demo-reveal').click({ timeout: TIMEOUT_MS })
  await page.waitForTimeout(200)
  const afterLooseReveal = readRevealedPaths()
  if (afterLooseReveal.length !== beforeReveal + 1) {
    throw new Error(
      `replays-demo-file-actions: expected exactly one new revealed path, got ${afterLooseReveal.length - beforeReveal}`,
    )
  }
  const lastRevealed = afterLooseReveal[afterLooseReveal.length - 1]
  if (!lastRevealed.endsWith('duel_q2dm1.dm2')) {
    throw new Error(
      `replays-demo-file-actions: expected revealed path to end with duel_q2dm1.dm2, got "${lastRevealed}"`,
    )
  }

  step('copy path on a loose demo puts its absolute path on the clipboard and shows a confirmation')
  await detail.getByTestId('replays-demo-copy-path').click({ timeout: TIMEOUT_MS })
  await page
    .getByText('Path copied', { exact: true })
    .last()
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const clipboardAfterLoose = await app.evaluate(({ clipboard }) => clipboard.readText())
  if (!clipboardAfterLoose.endsWith('duel_q2dm1.dm2')) {
    throw new Error(
      `replays-demo-file-actions: expected clipboard to end with duel_q2dm1.dm2, got "${clipboardAfterLoose}"`,
    )
  }

  step('reveal and copy path on a pack.zip entry act on pack.zip itself')
  await openFolder(page, 'pack.zip')
  const zipRow = page
    .getByTestId('replays-demo-row')
    .filter({ has: page.getByTestId('replays-demo-source').filter({ hasText: 'pack.zip ›' }) })
    .first()
  await zipRow.click({ timeout: TIMEOUT_MS })
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const beforeZipReveal = readRevealedPaths().length
  await detail.getByTestId('replays-demo-reveal').click({ timeout: TIMEOUT_MS })
  await page.waitForTimeout(200)
  const afterZipReveal = readRevealedPaths()
  const lastZipRevealed = afterZipReveal[afterZipReveal.length - 1]
  if (afterZipReveal.length !== beforeZipReveal + 1 || !lastZipRevealed.endsWith('pack.zip')) {
    throw new Error(
      `replays-demo-file-actions: expected the zip entry's reveal to record a path ending in pack.zip, got "${lastZipRevealed}"`,
    )
  }
  await detail.getByTestId('replays-demo-copy-path').click({ timeout: TIMEOUT_MS })
  await page
    .getByText('Path copied', { exact: true })
    .last()
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const clipboardAfterZip = await app.evaluate(({ clipboard }) => clipboard.readText())
  if (!clipboardAfterZip.endsWith('pack.zip')) {
    throw new Error(
      `replays-demo-file-actions: expected clipboard to end with pack.zip, got "${clipboardAfterZip}"`,
    )
  }

  step('reveal on a vanished demo shows the file-missing alert and reveals nothing')
  // The demo list is virtualized (VirtualDemoList.tsx) - vanish-156.dm2 may not be within the
  // rendered window, so narrow the list via the search filter to bring its row into the DOM.
  await page
    .getByTestId('replays-crumb')
    .filter({ hasText: 'Fixture Favorite Install' })
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-filter-search').fill('vanish-156')
  await rowFor(page, 'vanish-156.dm2').click({ timeout: TIMEOUT_MS })
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  rmSync(VANISH_DEST, { force: true })
  const beforeVanishReveal = readRevealedPaths().length
  await detail.getByTestId('replays-demo-reveal').click({ timeout: TIMEOUT_MS })
  const errorAlert = detail.getByTestId('replays-demo-file-action-error')
  await errorAlert.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const errorText = await errorAlert.textContent()
  if (!errorText.includes('no longer on disk')) {
    throw new Error(
      `replays-demo-file-actions: expected the fileMissing message, got "${errorText}"`,
    )
  }
  const afterVanishReveal = readRevealedPaths().length
  if (afterVanishReveal !== beforeVanishReveal) {
    throw new Error(
      `replays-demo-file-actions: a fileMissing refusal must reveal nothing new, but the revealed-paths count changed (${beforeVanishReveal} -> ${afterVanishReveal})`,
    )
  }

  await shot('replays-demo-file-actions')
}
