// Story 179 D2 acceptance flow: a user favourites a demo from the detail panel's header with one
// click; the write lands in the demo's own `.json` sidecar beside its other fields and the list row
// reflects it (and sorts first) without the refresh button ever being clicked. Runs against the
// `replays-rows` fixture variant.
//
// Selectors - read `DemoDetailPanel.tsx` / `DemoRow.tsx` before changing any of these:
//   replays-detail-favourite   DemoDetailPanel.tsx - header favourite toggle (aria-pressed)
//   replays-demo-favourite     DemoRow.tsx - the row's favourite marker

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
  throw new Error(
    'replays-detail-quick-edit: timed out waiting for replays-refresh to become enabled',
  )
}

export default async function replaysDetailQuickEdit({ page, shot, step }) {
  step("noting the duel row's sidecar before the edit")
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  const before = JSON.parse(readFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_DUEL_DEMO), 'utf8'))
  if (before.favourite === true) {
    throw new Error(
      'replays-detail-quick-edit: fixture precondition - duel demo must not start as a favourite',
    )
  }

  step("opening the duel row's detail and clicking the header favourite toggle")
  const row = rowFor(page, REPLAYS_ROWS_DUEL_DEMO)
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await row.click({ timeout: TIMEOUT_MS })
  const toggle = page.getByTestId('replays-detail-favourite')
  await toggle.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await toggle.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('replays-detail-quick-edit: the toggle must start unpressed')
  }
  await toggle.click({ timeout: TIMEOUT_MS })

  step('the toggle reads pressed')
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="replays-detail-favourite"]')
        ?.getAttribute('aria-pressed') === 'true',
    null,
    { timeout: TIMEOUT_MS },
  )

  step('the write landed on disk, keeping every other field')
  const deadline = Date.now() + TIMEOUT_MS
  let written = before
  while (Date.now() < deadline) {
    written = JSON.parse(readFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_DUEL_DEMO), 'utf8'))
    if (written.favourite === true) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (written.favourite !== true) {
    throw new Error(
      `replays-detail-quick-edit: sidecar favourite expected true, got ${JSON.stringify(written.favourite)}`,
    )
  }
  const { favourite: _after, ...writtenRest } = written
  const { favourite: _before, ...beforeRest } = before
  if (JSON.stringify(writtenRest) !== JSON.stringify(beforeRest)) {
    throw new Error(
      "replays-detail-quick-edit: a favourite toggle must never touch the sidecar's other fields",
    )
  }

  step('the row shows the favourite marker and sorts first, with no refresh')
  await rowFor(page, REPLAYS_ROWS_DUEL_DEMO)
    .getByTestId('replays-demo-favourite')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('replays-detail-quick-edit')
  // The fixture already carries another favourite, so "first" means: only favourites sit above it.
  const rows = await page.getByTestId('replays-demo-row').all()
  let seenDuel = false
  for (const candidate of rows) {
    if ((await candidate.textContent()).includes(REPLAYS_ROWS_DUEL_DEMO)) {
      seenDuel = true
      break
    }
    if ((await candidate.getByTestId('replays-demo-favourite').count()) === 0) {
      throw new Error(
        'replays-detail-quick-edit: a non-favourite row sorts above the newly favourited demo',
      )
    }
  }
  if (!seenDuel)
    throw new Error('replays-detail-quick-edit: the duel row disappeared from the list')

  await ratingSteps({ page, shot, step })
}

// Story 179 D3: the star rating in the detail panel.
function readSidecar() {
  return JSON.parse(readFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_DUEL_DEMO), 'utf8'))
}

async function waitForSidecar(predicate, describe) {
  const deadline = Date.now() + TIMEOUT_MS
  let current = readSidecar()
  while (Date.now() < deadline) {
    current = readSidecar()
    if (predicate(current)) return current
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `replays-detail-quick-edit: timed out waiting for ${describe}; sidecar is ${JSON.stringify(current)}`,
  )
}

async function expectText(locator, expected, what) {
  const deadline = Date.now() + TIMEOUT_MS
  let text = null
  while (Date.now() < deadline) {
    text = (await locator.count()) > 0 ? (await locator.first().textContent())?.trim() : null
    if (text === expected) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `replays-detail-quick-edit: ${what} expected ${JSON.stringify(expected)}, got ${JSON.stringify(text)}`,
  )
}

async function ratingSteps({ page, shot, step }) {
  const duelRow = rowFor(page, REPLAYS_ROWS_DUEL_DEMO)
  const ratingValue = page.getByTestId('replays-detail-rating-value')
  const star = (n) => page.getByTestId(`replays-detail-rating-star-${n}`)

  step('clicking star 7 rates the demo: sidecar, detail text and row agree')
  await star(7).click({ timeout: TIMEOUT_MS })
  await waitForSidecar((s) => s.rating === 7, 'rating: 7')
  await expectText(ratingValue, '7/10', 'replays-detail-rating-value')
  await expectText(
    duelRow.getByTestId('replays-demo-rating'),
    '7/10',
    "the row's replays-demo-rating",
  )
  await shot('replays-detail-rating')

  step('clicking star 7 again clears the rating')
  await star(7).click({ timeout: TIMEOUT_MS })
  await waitForSidecar((s) => !('rating' in s), 'the rating to leave the sidecar')
  await expectText(ratingValue, 'Not rated', 'replays-detail-rating-value')
  await duelRow
    .getByTestId('replays-demo-rating')
    .waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('favourite then star 4 with no wait: neither write loses the other')
  const favouriteNow = readSidecar().favourite === true
  await page.getByTestId('replays-detail-favourite').click({ timeout: TIMEOUT_MS })
  await star(4).click({ timeout: TIMEOUT_MS })
  await waitForSidecar(
    (s) => (s.favourite === true) !== favouriteNow && s.rating === 4,
    'the toggled favourite and rating: 4',
  )

  step('keyboard: ArrowRight raises the rating, Delete clears it')
  await star(4).focus()
  await page.keyboard.press('ArrowRight')
  await waitForSidecar((s) => s.rating === 5, 'rating: 5')
  await page.keyboard.press('Delete')
  await waitForSidecar((s) => !('rating' in s), 'the rating to leave the sidecar')
}
