// Story 150+ D5 acceptance flow: proves the demos list's rich rows - sidecar/effective values,
// status markers and the detail panel - actually render on the built UI, not just in unit tests.
// Mirrors `scripts/flows/replays-discovered-list.mjs`'s structure and `replays-zip-entries.mjs`'s
// "skip the archive-entry assertion without the vendored extractor" guard.
//
// Selectors, not guesses - read `src/renderer/src/modules/replays/ReplaysView.tsx`,
// `src/renderer/src/modules/replays/components/DemoRow.tsx` and `scripts/lib/fixture.mjs`'s
// `writeReplaysRowsFixture()` before changing any of these:
//   nav-replays                    TitleBar.tsx - primary nav entry
//   replays-demo-list              ReplaysView.tsx - the `<ul>` of discovered demos
//   replays-demo-row               DemoRow.tsx - one row, `data-demo-id` carries its id
//   replays-demo-name              DemoRow.tsx - the row's effective name
//   replays-demo-gamemode          DemoRow.tsx - the row's effective gamemode
//   replays-demo-sides             DemoRow.tsx - the row's team/player sides text
//   replays-demo-map/-mod/-date/-duration/-format   DemoRow.tsx
//   replays-demo-favourite         DemoRow.tsx - shown only when `sidecar.values.favourite`
//   replays-demo-rating            DemoRow.tsx - "n/10" text, shown only when a rating is set
//   replays-marker-sidecar         DemoRow.tsx - any sidecar present (ok or error)
//   replays-marker-sidecar-error   DemoRow.tsx - a sidecar that failed to validate
//   replays-marker-unreadable      DemoRow.tsx - `!row.readable`
//   replays-marker-archive         DemoRow.tsx - an archive-entry row
//   replays-detail                  DemoDetailPanel.tsx - the side panel opened by clicking a row
//                                   (story 155: its heading is the row's effective name, no separate
//                                   title testid any more - assert against the panel's own text)
//   replays-detail-close            DemoDetailPanel.tsx - the panel's close IconButton
//   replays-refresh                ReplaysView.tsx - toggles back to "Refresh" once the scan settles

import {
  REPLAYS_ROWS_BROKEN_DEMO,
  REPLAYS_ROWS_DUEL_DEMO,
  REPLAYS_ROWS_MVD_DEMO,
  REPLAYS_ROWS_UNREADABLE_DEMO,
  REPLAYS_ROWS_ZIP_ARCHIVE,
  vendoredExtractorExists,
} from '../lib/fixture.mjs'
import { openDemosRoot, openFolder, rowFor } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

/** Runs against the `replays-rows` fixture variant, which it names itself (mirrors
 * `news-cover-template.mjs`'s own `export const variant`). */
export const variant = 'replays-rows'

export default async function replaysDemoRows({ page, shot, step }) {
  step('navigating to the Demos view renders the discovered list')
  await openDemosRoot(page)

  step("the sidecar'd row shows its reported name, gamemode, sides, favourite and rating")
  // The tdm row's sidecar sets `name`, so its effective name (shown in the row) is that reported
  // name, not the raw file name - select on the name the sidecar actually reports.
  const tdmRow = rowFor(page, 'Fixture TDM Match')
  await tdmRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const tdmName = await tdmRow.getByTestId('replays-demo-name').textContent()
  if (tdmName !== 'Fixture TDM Match') {
    throw new Error(
      `replays-demo-rows: tdm row name expected "Fixture TDM Match", got "${tdmName}"`,
    )
  }
  const tdmGamemode = await tdmRow.getByTestId('replays-demo-gamemode').textContent()
  if (!tdmGamemode.includes('tdm') && !/tdm/i.test(tdmGamemode)) {
    throw new Error(
      `replays-demo-rows: tdm row gamemode expected to read "tdm", got "${tdmGamemode}"`,
    )
  }
  if (tdmGamemode.toLowerCase().includes('guess')) {
    throw new Error(
      `replays-demo-rows: tdm row gamemode must not carry a guessed marker, got "${tdmGamemode}"`,
    )
  }
  const tdmSides = await tdmRow.getByTestId('replays-demo-sides').textContent()
  if (tdmSides !== 'Alpha vs Bravo') {
    throw new Error(`replays-demo-rows: tdm row sides expected "Alpha vs Bravo", got "${tdmSides}"`)
  }
  const tdmMap = await tdmRow.getByTestId('replays-demo-map').textContent()
  const tdmFormat = await tdmRow.getByTestId('replays-demo-format').textContent()
  const tdmDate = await tdmRow.getByTestId('replays-demo-date').textContent()
  if (!tdmMap || tdmMap.trim() === '' || tdmMap.trim() === '–') {
    throw new Error(`replays-demo-rows: tdm row map expected a real value, got "${tdmMap}"`)
  }
  if (!tdmFormat || tdmFormat.trim() === '') {
    throw new Error('replays-demo-rows: tdm row format expected non-empty text')
  }
  if (!tdmDate || tdmDate.trim() === '' || tdmDate.trim() === '–') {
    throw new Error(`replays-demo-rows: tdm row date expected a real value, got "${tdmDate}"`)
  }
  await tdmRow
    .getByTestId('replays-demo-favourite')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const tdmRating = await tdmRow.getByTestId('replays-demo-rating').textContent()
  if (!tdmRating.includes('8')) {
    throw new Error(`replays-demo-rows: tdm row rating expected to mention "8", got "${tdmRating}"`)
  }
  await tdmRow
    .getByTestId('replays-marker-sidecar')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const tdmSidecarErrorCount = await tdmRow.getByTestId('replays-marker-sidecar-error').count()
  if (tdmSidecarErrorCount !== 0) {
    throw new Error('replays-demo-rows: tdm row must not show a sidecar-error marker')
  }

  step('star + "8/10" only appear on the sidecar\'d row')
  const duelRow = rowFor(page, REPLAYS_ROWS_DUEL_DEMO)
  const mvdRow = rowFor(page, REPLAYS_ROWS_MVD_DEMO)
  const brokenRow = rowFor(page, REPLAYS_ROWS_BROKEN_DEMO)
  const unreadableRow = rowFor(page, REPLAYS_ROWS_UNREADABLE_DEMO)
  for (const [label, row] of [
    ['duel', duelRow],
    ['mvd', mvdRow],
    ['broken', brokenRow],
    ['unreadable', unreadableRow],
  ]) {
    const favouriteCount = await row.getByTestId('replays-demo-favourite').count()
    const ratingCount = await row.getByTestId('replays-demo-rating').count()
    if (favouriteCount !== 0 || ratingCount !== 0) {
      throw new Error(`replays-demo-rows: ${label} row must show no favourite/rating markers`)
    }
  }

  step('the two-single-player-sides row resolves gamemode "duel", with no guessed marker')
  await duelRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const duelGamemode = await duelRow.getByTestId('replays-demo-gamemode').textContent()
  if (!/duel/i.test(duelGamemode)) {
    throw new Error(
      `replays-demo-rows: duel row gamemode expected to read "duel", got "${duelGamemode}"`,
    )
  }
  if (duelGamemode.toLowerCase().includes('guess')) {
    throw new Error(
      `replays-demo-rows: duel row gamemode must not carry a guessed marker, got "${duelGamemode}"`,
    )
  }

  step('the mvd2 row with no sidecar shows demo-derived values and no sidecar markers')
  await mvdRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const mvdMap = await mvdRow.getByTestId('replays-demo-map').textContent()
  if (!mvdMap || mvdMap.trim() === '' || mvdMap.trim() === '–') {
    throw new Error(`replays-demo-rows: mvd row map expected a real value, got "${mvdMap}"`)
  }
  const mvdSidecarCount = await mvdRow.getByTestId('replays-marker-sidecar').count()
  if (mvdSidecarCount !== 0) {
    throw new Error(
      'replays-demo-rows: mvd row must show no sidecar marker at all (no sidecar file)',
    )
  }

  step('the broken-sidecar row shows the sidecar-error marker with visible text and valid values')
  await brokenRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const brokenErrorBadge = brokenRow.getByTestId('replays-marker-sidecar-error')
  await brokenErrorBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const brokenErrorText = await brokenErrorBadge.textContent()
  if (!brokenErrorText || brokenErrorText.trim() === '') {
    throw new Error('replays-demo-rows: broken row sidecar-error marker must carry visible text')
  }
  const brokenMap = await brokenRow.getByTestId('replays-demo-map').textContent()
  if (!brokenMap || brokenMap.trim() === '' || brokenMap.trim() === '–') {
    throw new Error(
      `replays-demo-rows: broken row map expected a real (header-derived) value, got "${brokenMap}"`,
    )
  }

  step('the unreadable placeholder row shows its marker with visible text and no blank cells')
  await unreadableRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const unreadableBadge = unreadableRow.getByTestId('replays-marker-unreadable')
  await unreadableBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const unreadableBadgeText = await unreadableBadge.textContent()
  if (!unreadableBadgeText || unreadableBadgeText.trim() === '') {
    throw new Error('replays-demo-rows: unreadable marker must carry visible text')
  }
  for (const testId of [
    'replays-demo-map',
    'replays-demo-mod',
    'replays-demo-sides',
    'replays-demo-date',
    'replays-demo-duration',
  ]) {
    const cellText = await unreadableRow.getByTestId(testId).textContent()
    if (cellText === null || cellText.trim() === '') {
      throw new Error(
        `replays-demo-rows: unreadable row's ${testId} cell must never be empty/blank`,
      )
    }
  }

  if (!vendoredExtractorExists()) {
    step('7za.exe is not vendored - skipping the archive-entry assertion')
  } else {
    step('the zipped copy of test.dm2 shows up as an archive-entry row')
    await openFolder(page, REPLAYS_ROWS_ZIP_ARCHIVE)
    const zipRow = page.getByTestId('replays-demo-row').filter({
      has: page
        .getByTestId('replays-demo-source')
        .filter({ hasText: `${REPLAYS_ROWS_ZIP_ARCHIVE} ›` }),
    })
    await zipRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const archiveEntry = await zipRow.getAttribute('data-archive-entry')
    if (archiveEntry !== 'true') {
      throw new Error(
        `replays-demo-rows: expected the pack.zip row to carry data-archive-entry="true", got "${archiveEntry}"`,
      )
    }
    await page.getByTestId('replays-crumb').nth(1).click({ timeout: TIMEOUT_MS })
  }

  step(
    "clicking the sidecar'd row opens the detail panel titled with its effective name, and closing hides it",
  )
  await tdmRow.click({ timeout: TIMEOUT_MS })
  const detail = page.getByTestId('replays-detail')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const detailTitle = await detail.textContent()
  if (!detailTitle.includes('Fixture TDM Match')) {
    throw new Error(
      `replays-demo-rows: detail panel expected to mention "Fixture TDM Match", got "${detailTitle}"`,
    )
  }
  await shot('replays-demo-rows-detail')

  await detail.getByTestId('replays-detail-close').click({ timeout: TIMEOUT_MS })
  await detail.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  await shot('replays-demo-rows')
}
