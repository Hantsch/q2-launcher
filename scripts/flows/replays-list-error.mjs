// Story 151 D4 acceptance flow: proves a discovery failure never hides the rest of the list (AC "a
// source failure never hides the rest of the list") - `replays-list-error`'s fixture
// (`scripts/lib/fixture.mjs`'s `writeReplaysListErrorFixture()`) registers two extra folders that
// each fail discovery in a distinct way (one missing entirely, one holding a broken archive) on top
// of the plain `populated` install/demo set, which still scans cleanly.
//
// Selectors - read `src/renderer/src/modules/replays/ReplaysListStatus.tsx` before changing any of
// these:
//   nav-replays                TitleBar.tsx - primary nav entry
//   replays-list-source-errors ReplaysListStatus.tsx - the source-errors container
//   replays-list-source-error  ReplaysListStatus.tsx - one row per failed source, carries
//                              `data-reason`
//   replays-demo-row / -name   ReplaysView.tsx / DemoRow.tsx

import {
  REPLAYS_FIXTURE_DEMOS,
  REPLAYS_LIST_ERROR_BROKEN_ARCHIVE_NAME,
  replaysListErrorMissingFolderPath,
  writeReplaysListErrorFixture,
} from '../lib/fixture.mjs'
import {
  openFolder,
  waitForDemosScanToFinish,
  showAllInstallations,
} from '../lib/replays-copy-in.mjs'

export const variant = 'replays-list-error'

const TIMEOUT_MS = 8_000
/** One of `replaysSourceErrorReasonSchema`'s three archive-only codes (`@shared/modules/replays`) -
 * whichever one `expandZip` reports for the broken-archive folder's `broken.zip` depends on whether
 * `resources/bin/7za.exe` happens to be vendored locally in this run. */
const ARCHIVE_REASON_CODES = ['extractor-missing', 'archive-unreadable', 'archive-too-large']

export async function setup() {
  writeReplaysListErrorFixture()
  return {}
}

export default async function replaysListError({ page, shot, step }) {
  step('opening the Demos view runs a scan that finds two failing sources')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page, { timeout: TIMEOUT_MS * 4 })

  const errors = page.getByTestId('replays-list-source-error')
  await errors.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const count = await errors.count()
  if (count !== 2) {
    throw new Error(`replays-list-error: expected exactly 2 source-error rows, got ${count}`)
  }

  step('one row reports the missing folder, one reports the broken archive')
  const missingFolder = replaysListErrorMissingFolderPath()
  const rows = await errors.all()
  let missingCount = 0
  let archiveCount = 0
  for (const row of rows) {
    const reason = await row.getAttribute('data-reason')
    const text = await row.innerText()
    if (reason === 'missing') {
      missingCount += 1
      if (!text.includes(missingFolder)) {
        throw new Error(
          `replays-list-error: expected the "missing" row's text to include ${JSON.stringify(missingFolder)}, got ${JSON.stringify(text)}`,
        )
      }
    } else if (ARCHIVE_REASON_CODES.includes(reason)) {
      archiveCount += 1
      if (!text.includes(REPLAYS_LIST_ERROR_BROKEN_ARCHIVE_NAME)) {
        throw new Error(
          `replays-list-error: expected the archive-error row's text to include ${JSON.stringify(REPLAYS_LIST_ERROR_BROKEN_ARCHIVE_NAME)}, got ${JSON.stringify(text)}`,
        )
      }
    } else {
      throw new Error(
        `replays-list-error: unexpected data-reason "${reason}" on a source-error row`,
      )
    }
  }
  if (missingCount !== 1 || archiveCount !== 1) {
    throw new Error(
      `replays-list-error: expected exactly one "missing" row and one archive-error row, got missing=${missingCount} archive=${archiveCount}`,
    )
  }
  step('every fixture demo is still listed despite the two failing sources')
  await showAllInstallations(page)
  const names = []
  const rootLabel = (demo) => `${demo.installationName} · ${demo.gameDir}`
  for (const root of new Set(REPLAYS_FIXTURE_DEMOS.map(rootLabel))) {
    await openFolder(page, root)
    names.push(...(await page.getByTestId('replays-demo-name').allTextContents()))
    await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })
    await page.getByTestId('replays-breadcrumb').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  }
  const expectedNames = REPLAYS_FIXTURE_DEMOS.map((demo) => demo.fileName)
  const sortedActual = [...names].sort()
  const sortedExpected = [...expectedNames].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `replays-list-error: expected exactly ${JSON.stringify(sortedExpected)} still listed, got ${JSON.stringify(sortedActual)}`,
    )
  }

  await shot('replays-list-error')
}
