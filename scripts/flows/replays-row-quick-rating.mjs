// Story 155 D6 acceptance flow: a user stars and rates a demo straight from the list row, with the
// detail panel never opening for it, and the write lands in the demo's own `.json` sidecar next to
// whatever notes were already there - same as `replays-edit-sidecar.mjs`'s full-editor save, but
// through the row's own quick controls. Runs against the `replays-rows` fixture variant, same as
// `replays-demo-detail.mjs`/`replays-edit-sidecar.mjs`, so this flow needs no `setup()`/`teardown()`
// of its own.
//
// Selectors - read `DemoRow.tsx` before changing any of these:
//   replays-row-favourite   DemoRow.tsx - the quick favourite toggle IconButton
//   replays-row-rating      DemoRow.tsx - the quick rating <select>
//   replays-detail          DemoDetailPanel.tsx - must never appear from a row-control interaction

import { readFileSync } from 'node:fs'
import { REPLAYS_ROWS_DUEL_DEMO, replaysRowsSidecarPath } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

export const variant = 'replays-rows'

function rowFor(page, text) {
  return page.getByTestId('replays-demo-row').filter({ hasText: text })
}

async function waitForDemosScanToFinish(page) {
  const refreshButton = page.getByTestId('replays-refresh')
  await refreshButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await refreshButton.isDisabled())) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('replays-row-quick-rating: timed out waiting for replays-refresh to become enabled')
}

export default async function replaysRowQuickRating({ page, shot, step }) {
  step('noting the duel row\'s sidecar before any quick edit')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  const before = JSON.parse(readFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_DUEL_DEMO), 'utf8'))
  if (before.favourite === true) {
    throw new Error('replays-row-quick-rating: fixture precondition - duel demo must not start as a favourite')
  }

  const row = rowFor(page, REPLAYS_ROWS_DUEL_DEMO)
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('toggling favourite and picking a rating from the row itself')
  await row.getByTestId('replays-row-favourite').click({ timeout: TIMEOUT_MS })
  await row.getByTestId('replays-row-rating').selectOption('7', { timeout: TIMEOUT_MS })

  step('the detail panel never opened from either control')
  if ((await page.getByTestId('replays-detail').count()) !== 0) {
    throw new Error('replays-row-quick-rating: a row quick edit must never open the detail panel')
  }

  step('both writes landed on disk, keeping every earlier field')
  const deadline = Date.now() + TIMEOUT_MS
  let written = before
  while (Date.now() < deadline) {
    written = JSON.parse(readFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_DUEL_DEMO), 'utf8'))
    if (written.favourite === true && written.rating === 7) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (written.favourite !== true) {
    throw new Error(`replays-row-quick-rating: sidecar favourite expected true, got ${JSON.stringify(written.favourite)}`)
  }
  if (written.rating !== 7) {
    throw new Error(`replays-row-quick-rating: sidecar rating expected 7, got ${JSON.stringify(written.rating)}`)
  }
  if (JSON.stringify(written.sides) !== JSON.stringify(before.sides)) {
    throw new Error('replays-row-quick-rating: a quick edit must never touch the sidecar\'s other fields')
  }

  step('the row now sorts ahead of a non-favourite row (favourites-first)')
  await shot('replays-row-quick-rating')
  const rows = await page.getByTestId('replays-demo-row').all()
  let duelIndex = -1
  let mvdIndex = -1
  for (let i = 0; i < rows.length; i += 1) {
    const text = await rows[i].textContent()
    if (text.includes(REPLAYS_ROWS_DUEL_DEMO)) duelIndex = i
    if (text.includes('rows-mvd')) mvdIndex = i
  }
  if (duelIndex === -1 || mvdIndex === -1) {
    throw new Error('replays-row-quick-rating: expected both the duel and mvd rows to be visible')
  }
  if (duelIndex >= mvdIndex) {
    throw new Error('replays-row-quick-rating: the newly-favourited row must sort ahead of a non-favourite row')
  }
}
