// Demo detail panel acceptance flow: proves on the real UI that the name is the panel's prominent
// title and the facts read as two groups (file, match) without any provenance text. Runs against the `replays-rows`
// fixture variant (`scripts/lib/fixture.mjs`'s `writeReplaysRowsFixture()`), the same fixture the
// `replays-detail` screen (`scripts/lib/screens.mjs`) and `replays-demo-rows.mjs` already use, so
// this flow needs no `setup()`/`teardown()` of its own.
//
// Selectors, not guesses - read `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`
// and `scripts/lib/fixture.mjs`'s `writeReplaysRowsFixture()` before changing any of these:
//   nav-replays                    TitleBar.tsx - primary nav entry
//   replays-demo-list              ReplaysView.tsx - the `<ul>` of discovered demos
//   replays-demo-row               DemoRow.tsx - one row
//   replays-detail                 DemoDetailPanel.tsx - the panel itself
//   replays-detail-title           DemoDetailPanel.tsx - the `<h2>` carrying the demo's name
//   replays-detail-facts-file      DemoDetailPanel.tsx - `<dl>` of file facts (fileName, duration, date)
//   replays-detail-facts-match     DemoDetailPanel.tsx - `<dl>` of match facts (map, mod, gamemode, pov)
//   replays-detail-field-<id>      DemoDetailPanel.tsx - one wrapper per rendered `DetailFieldId`
//   demo-detail-mvd2-note          DemoDetailPanel.tsx - the mvd2 camera note
//   replays-detail-close           DemoDetailPanel.tsx - the panel's close IconButton
//   replays-refresh                ReplaysView.tsx - toggles back to "Refresh" once the scan settles

import { REPLAYS_ROWS_DUEL_DEMO, REPLAYS_ROWS_MVD_DEMO } from '../lib/fixture.mjs'
import { rowFor, waitForDemosScanToFinish } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

/** Runs against the `replays-rows` fixture variant - mirrors `replays-demo-rows.mjs`'s own
 * `export const variant` convention. */
export const variant = 'replays-rows'

export default async function replaysDemoDetail({ page, shot, step }) {
  step('navigating to the Demos view renders the discovered list')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)

  const PROVENANCE = ['set by you', 'from the demo', 'from the file name', 'file time', 'guessed']
  const FILE_IDS = ['fileName', 'duration', 'date']
  const MATCH_IDS = ['map', 'mod', 'gamemode', 'pov']
  const ORDER = [...FILE_IDS, ...MATCH_IDS]
  const detail = page.getByTestId('replays-detail')

  async function assertNoProvenance(label) {
    // The facts area only (title + both groups): the notes editor below keeps its own source labels.
    const text = (
      await detail
        .locator('[data-testid="replays-detail-title"], [data-testid^="replays-detail-facts-"]')
        .allTextContents()
    ).join(' ')
    for (const word of PROVENANCE) {
      if (text.includes(word))
        throw new Error(
          `replays-demo-detail: ${label} panel must not show "${word}" in its facts, got "${text}"`,
        )
    }
  }

  step('the mvd row shows the mvd2 note and no provenance')
  await rowFor(page, REPLAYS_ROWS_MVD_DEMO).click({ timeout: TIMEOUT_MS })
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await detail
    .getByTestId('demo-detail-mvd2-note')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoProvenance('mvd')

  step(
    'the tdm row: the name is a large title, no browser-knows heading, no name/source/format rows',
  )
  await rowFor(page, 'Fixture TDM Match').click({ timeout: TIMEOUT_MS })
  const title = detail.getByTestId('replays-detail-title')
  await title.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await detail
    .getByTestId('replays-detail-field-map')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const nameInput = detail.getByTestId('replays-detail-input-name')
  const titleText = await nameInput.inputValue()
  if (!titleText.includes('Fixture TDM Match')) {
    throw new Error(
      `replays-demo-detail: tdm title expected "Fixture TDM Match", got "${titleText}"`,
    )
  }
  const titleSize = await nameInput.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const valueSize = await detail
    .getByTestId('replays-detail-field-map')
    .locator('dd')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  if (!(titleSize > valueSize && titleSize > 14)) {
    throw new Error(
      `replays-demo-detail: title font ${titleSize}px must exceed value font ${valueSize}px and 14px`,
    )
  }
  if ((await detail.textContent()).includes('What the browser knows')) {
    throw new Error('replays-demo-detail: the "What the browser knows" heading must be gone')
  }
  for (const id of ['name', 'source', 'format']) {
    if ((await detail.getByTestId(`replays-detail-field-${id}`).count()) !== 0) {
      throw new Error(`replays-demo-detail: replays-detail-field-${id} must not render`)
    }
  }

  step('the facts are grouped file then match, in order, with a wider gap between the groups')
  const layout = await detail.evaluate((root, ids) => {
    const fileGroup = root.querySelector('[data-testid="replays-detail-facts-file"]')
    const matchGroup = root.querySelector('[data-testid="replays-detail-facts-match"]')
    const rows = [...root.querySelectorAll('[data-testid^="replays-detail-field-"]')].map((el) => ({
      id: el.getAttribute('data-testid').slice('replays-detail-field-'.length),
      inFile: !!fileGroup && fileGroup.contains(el),
      inMatch: !!matchGroup && matchGroup.contains(el),
      rect: el.getBoundingClientRect(),
    }))
    return {
      rows: rows
        .filter((r) => ids.includes(r.id))
        .map((r) => ({
          id: r.id,
          inFile: r.inFile,
          inMatch: r.inMatch,
          top: r.rect.top,
          bottom: r.rect.bottom,
        })),
    }
  }, ORDER)
  const ids = layout.rows.map((r) => r.id)
  let cursor = -1
  for (const id of ids) {
    const at = ORDER.indexOf(id, cursor + 1)
    if (at < 0)
      throw new Error(
        `replays-demo-detail: field order ${ids.join(',')} is not a subsequence of ${ORDER.join(',')}`,
      )
    cursor = at
  }
  for (const r of layout.rows) {
    if (FILE_IDS.includes(r.id) && !r.inFile)
      throw new Error(`replays-demo-detail: ${r.id} must sit in replays-detail-facts-file`)
    if (MATCH_IDS.includes(r.id) && !r.inMatch)
      throw new Error(`replays-demo-detail: ${r.id} must sit in replays-detail-facts-match`)
  }
  const fileRows = layout.rows.filter((r) => r.inFile)
  const matchRows = layout.rows.filter((r) => r.inMatch)
  if (fileRows.length < 2 || matchRows.length < 2) {
    throw new Error(
      `replays-demo-detail: expected at least two rows per group, got ${ids.join(',')}`,
    )
  }
  const groupGap = matchRows[0].top - fileRows[fileRows.length - 1].bottom
  const rowGap = fileRows[1].top - fileRows[0].bottom
  if (!(groupGap > rowGap)) {
    throw new Error(
      `replays-demo-detail: gap between groups (${groupGap}px) must exceed gap inside a group (${rowGap}px)`,
    )
  }
  await assertNoProvenance('tdm')

  step('the duel row shows no provenance')
  await rowFor(page, REPLAYS_ROWS_DUEL_DEMO).click({ timeout: TIMEOUT_MS })
  await detail
    .getByTestId('replays-detail-field-date')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoProvenance('duel')

  await shot('replays-demo-detail')

  step('closing the panel hides it')
  await detail.getByTestId('replays-detail-close').click({ timeout: TIMEOUT_MS })
  await detail.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
}
