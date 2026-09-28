// Story 154 (docs/requirements/154-i-filter-demos-by-date.md) D5: the date filter's own e2e proof
// on the real Demos surface. Mirrors `replays-filter-search.mjs`'s overall structure (`variant`
// export, `setup()`/`teardown()` calling this flow's own fixture writer/remover, `statePath()`-style
// helpers, waiting for the demo scan to finish before asserting) - copied, not imported. The axe
// helper pair below is copied from `home-tile-states.mjs`'s own local `ensureAxe`/
// `assertNoAxeViolations` the same way - it isn't exported from anywhere, every flow that needs it
// copies it.
//
// Fixture (`scripts/lib/fixture.mjs`'s `writeReplaysDateFilterFixture()`): four demos under one
// extra folder -
//   - `date-filter-today.dm2`    ~0 days old,  no sidecar,        effective date = FILE TIME
//   - `date-filter-recent.mvd2`  ~3 days old,  sidecar date+mod,  effective date = SIDECAR
//   - `date-filter-old.mvd2`     ~20 days old, no sidecar,        effective date = FILE TIME
//   - `date-filter-veryold.mvd2` ~60 days old, no sidecar,        effective date = FILE TIME
//
// `setup()` returns `{ args: ['--lang=de-DE'] }` (the D4 harness feature) - this only changes
// Chromium/ICU-driven formatting (the picker's `Intl.DateTimeFormat(undefined, ...)` trigger text,
// and the native `<input type="date">`'s keyboard segment order) since the app ships only an `en`
// i18next locale - every other assertion below still exercises real UI/keyboard behaviour.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import { REPO_ROOT } from '../lib/paths.mjs'
import { AXE_RUN_OPTIONS } from '../lib/session.mjs'
import {
  REPLAYS_DATE_FILTER_OLD_DEMO,
  REPLAYS_DATE_FILTER_RECENT_DEMO,
  REPLAYS_DATE_FILTER_RECENT_MOD,
  REPLAYS_DATE_FILTER_TODAY_DEMO,
  REPLAYS_DATE_FILTER_VARIANT,
  REPLAYS_DATE_FILTER_VERYOLD_DEMO,
  removeReplaysDateFilterFixture,
  writeReplaysDateFilterFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
const POLL_INTERVAL_MS = 100

export const variant = REPLAYS_DATE_FILTER_VARIANT

// Captured in `setup()` so the flow's own date-cutoff math below uses the exact instant the
// fixture was seeded against, not a later `Date.now()` that could have crossed a calendar-day
// boundary mid-run.
let fixtureNowMs = Date.now()

export async function setup() {
  fixtureNowMs = Date.now()
  writeReplaysDateFilterFixture(fixtureNowMs)
  return { args: ['--lang=de-DE'] }
}

export async function teardown() {
  removeReplaysDateFilterFixture()
}

function statePath() {
  return join(variantUserDataDir(variant), 'state.json')
}

function readStateJson() {
  return JSON.parse(readFileSync(statePath(), 'utf8'))
}

/** Same reasoning/idiom as `replays-filter-search.mjs`'s own helper. */
async function waitForCondition(predicate, label, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

async function waitForStateJson(predicate, label) {
  await waitForCondition(() => predicate(readStateJson()), label, 4_000)
  return readStateJson()
}

/** Same reasoning/idiom as `replays-filter-search.mjs`'s own `waitForDemosScanToFinish`. */
async function waitForDemosScanToFinish(page) {
  const refreshButton = page.getByTestId('replays-refresh')
  await refreshButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await refreshButton.isDisabled())) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for replays-refresh to become enabled (scan finished)')
}

/** Same reasoning as `replays-filter-search.mjs`'s own `visibleNames` - none of this fixture's four
 * demos carries a sidecar `name`, so every row displays its own file name, a stable stand-in for
 * "which fixture row is this". */
async function visibleNames(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="replays-demo-row"]')).map(
      (row) => row.querySelector('[data-testid="replays-demo-name"]')?.textContent?.trim() ?? null,
    ),
  )
}

function assertVisibleSet(actual, expected, label) {
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `expected ${label} to show exactly ${JSON.stringify(sortedExpected)}, got ${JSON.stringify(sortedActual)}`,
    )
  }
}

async function waitForVisibleSet(page, expected, label) {
  await waitForCondition(async () => {
    const actual = await visibleNames(page)
    return actual.length === expected.length && [...actual].sort().join('|') === [...expected].sort().join('|')
  }, label)
  assertVisibleSet(await visibleNames(page), expected, label)
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${label} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

/** Mirrors `writeReplaysDateFilterFixture()`'s own `daysAgoLocal()` (`scripts/lib/fixture.mjs`) -
 * copied, not imported, same reasoning as every other duplicated helper in this file. */
function daysAgoLocal(nowMs, daysAgo) {
  const now = new Date(nowMs)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 10, 0, 0)
}

function isoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// --- axe idiom, copied from `home-tile-states.mjs` verbatim (not exported anywhere) -------------
const AXE_SOURCE_PATH = join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js')
const axeSource = readFileSync(AXE_SOURCE_PATH, 'utf8')

async function ensureAxe(page) {
  const present = await page.evaluate(() => typeof window.axe !== 'undefined')
  if (!present) await page.evaluate(axeSource)
}

async function assertNoAxeViolations(page, label) {
  await ensureAxe(page)
  const results = await page.evaluate(async (options) => await window.axe.run(options), AXE_RUN_OPTIONS)
  if (!Array.isArray(results?.violations)) {
    throw new Error(`axe.run() returned no violations array during '${label}' (got ${typeof results})`)
  }
  if (results.violations.length !== 0) {
    const ids = results.violations.map((violation) => `${violation.id} (${violation.impact})`).join(', ')
    throw new Error(`expected zero axe violations during '${label}', got ${results.violations.length}: ${ids}`)
  }
}

const ALL_NAMES = [
  REPLAYS_DATE_FILTER_TODAY_DEMO,
  REPLAYS_DATE_FILTER_RECENT_DEMO,
  REPLAYS_DATE_FILTER_OLD_DEMO,
  REPLAYS_DATE_FILTER_VERYOLD_DEMO,
]

/** Idempotent: clicking the trigger toggles the popover, so this only clicks it when the popover
 * is not already open (`replays-filter-date-from` not visible) - the popover has no auto-close on
 * a preset/field change, only on trigger click/outside click/Escape. */
async function openPicker(page) {
  const alreadyOpen = await page.getByTestId('replays-filter-date-from').isVisible().catch(() => false)
  if (!alreadyOpen) {
    await page.getByTestId('replays-filter-date-trigger').click({ timeout: TIMEOUT_MS })
    await page.getByTestId('replays-filter-date-from').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
}

async function closePicker(page) {
  const open = await page.getByTestId('replays-filter-date-from').isVisible().catch(() => false)
  if (open) {
    await page.getByTestId('replays-filter-date-trigger').click({ timeout: TIMEOUT_MS })
    await page
      .getByTestId('replays-filter-date-from')
      .waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
      .catch(() => {})
  }
}

async function clearDate(page) {
  await page.getByTestId('replays-filter-date-clear').click({ timeout: TIMEOUT_MS })
}

/** Presses Tab up to `maxTabs` times until `document.activeElement` carries the given
 * `data-testid` - bounded so a wiring regression fails fast instead of hanging. */
async function tabUntilFocused(page, testId, maxTabs = 40) {
  for (let i = 0; i < maxTabs; i++) {
    const current = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)
    if (current === testId) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`could not Tab to "${testId}" within ${maxTabs} presses`)
}

export default async function replaysDateFilter({ page, step, shot }) {
  step('navigate to Demos and wait for the scan to settle')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  await waitForVisibleSet(page, ALL_NAMES, 'the unfiltered list')

  step('presets narrow the list')
  await openPicker(page)
  await page.getByTestId('replays-filter-date-preset-today').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, [REPLAYS_DATE_FILTER_TODAY_DEMO], 'the "today" preset')
  await shot('preset-today')

  await openPicker(page)
  await page.getByTestId('replays-filter-date-preset-last7Days').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(
    page,
    [REPLAYS_DATE_FILTER_TODAY_DEMO, REPLAYS_DATE_FILTER_RECENT_DEMO],
    'the "last 7 days" preset',
  )

  await openPicker(page)
  await page.getByTestId('replays-filter-date-preset-last30Days').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(
    page,
    [REPLAYS_DATE_FILTER_TODAY_DEMO, REPLAYS_DATE_FILTER_RECENT_DEMO, REPLAYS_DATE_FILTER_OLD_DEMO],
    'the "last 30 days" preset',
  )
  await shot('preset-last30days')

  await openPicker(page)
  await clearDate(page)
  await waitForVisibleSet(page, ALL_NAMES, 'presets cleared')

  step('a custom range with an open end')
  const tenDaysAgo = isoDate(daysAgoLocal(fixtureNowMs, 10))
  await openPicker(page)
  await page.getByTestId('replays-filter-date-from').fill(tenDaysAgo)
  await waitForVisibleSet(
    page,
    [REPLAYS_DATE_FILTER_TODAY_DEMO, REPLAYS_DATE_FILTER_RECENT_DEMO],
    'a from-only range (on/after 10 days ago)',
  )

  await page.getByTestId('replays-filter-date-from').fill('')
  await page.getByTestId('replays-filter-date-to').fill(tenDaysAgo)
  await waitForVisibleSet(
    page,
    [REPLAYS_DATE_FILTER_OLD_DEMO, REPLAYS_DATE_FILTER_VERYOLD_DEMO],
    'a to-only range (on/before 10 days ago)',
  )
  await shot('custom-range-to-only')

  await page.getByTestId('replays-filter-date-clear').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, ALL_NAMES, 'custom range cleared')

  step('a from-date after the to-date is rejected')
  await openPicker(page)
  await page.getByTestId('replays-filter-date-preset-last7Days').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(
    page,
    [REPLAYS_DATE_FILTER_TODAY_DEMO, REPLAYS_DATE_FILTER_RECENT_DEMO],
    'the "last 7 days" preset (rejection step setup)',
  )
  // Typing into `From` alone always commits - `To` stays empty, and `isRangeOrderValid` treats an
  // open end as always valid - so the very first keystroke below necessarily replaces the applied
  // `preset` value with a `custom` one (`handleFieldChange` only switches mode on a valid `onChange`,
  // but this IS a valid one). Picking `From` = the exact start of last7Days's own resolved window,
  // with `To` left open, keeps the *visible rows* identical to the preset (both demos still in
  // range, no upper bound to exclude anything) - so `countBefore` below is a real, narrower-than-full
  // commit, not a no-op, even though the applied filter object itself changed shape.
  const last7DaysStart = isoDate(daysAgoLocal(fixtureNowMs, 6))
  await page.getByTestId('replays-filter-date-from').fill(last7DaysStart)
  await waitForVisibleSet(
    page,
    [REPLAYS_DATE_FILTER_TODAY_DEMO, REPLAYS_DATE_FILTER_RECENT_DEMO],
    'the from-only commit that mirrors last7Days',
  )
  const countBefore = await visibleNames(page)
  assertVisibleSet(
    countBefore,
    [REPLAYS_DATE_FILTER_TODAY_DEMO, REPLAYS_DATE_FILTER_RECENT_DEMO],
    'countBefore (a genuinely narrowed, already-committed filter)',
  )

  await page.getByTestId('replays-filter-date-to').fill('1999-01-01')
  await page
    .getByTestId('replays-filter-date-error')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const errorText = await page.getByTestId('replays-filter-date-error').textContent()
  if (errorText?.trim() !== 'The from date is after the to date.') {
    throw new Error(`expected the from-after-to error text, got "${errorText}"`)
  }
  // A bug that silently normalized the rejected edit to an unbounded range would show all four
  // fixture demos here instead of the same narrowed two - this is what actually distinguishes
  // "rejected" from "silently accepted as unfiltered" (the old version of this step compared against
  // an unfiltered `countBefore`, which couldn't tell the two apart).
  assertVisibleSet(await visibleNames(page), countBefore, 'the row count while the range is invalid')
  await shot('from-after-to-error')

  await page.getByTestId('replays-filter-date-clear').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, ALL_NAMES, 'rejection step cleared')

  step('the date filter combines with the other filters and clear-all removes it')
  await openPicker(page)
  await page.getByTestId('replays-filter-date-preset-last7Days').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(
    page,
    [REPLAYS_DATE_FILTER_TODAY_DEMO, REPLAYS_DATE_FILTER_RECENT_DEMO],
    'the "last 7 days" preset alone (combine step)',
  )
  await page.selectOption('[data-testid="replays-filter-mod"]', REPLAYS_DATE_FILTER_RECENT_MOD)
  await waitForVisibleSet(
    page,
    [REPLAYS_DATE_FILTER_RECENT_DEMO],
    'date preset ANDed with a mod filter',
  )

  await page.getByTestId('replays-filter-clear').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, ALL_NAMES, 'clear-all restores the full list')
  const triggerText = await page.getByTestId('replays-filter-date-trigger').textContent()
  if (!triggerText?.includes('Any date')) {
    throw new Error(`expected the date trigger to read "Any date" after clear-all, got "${triggerText}"`)
  }
  // The popover itself has no auto-close on a filter-state change (only trigger click/outside
  // click/Escape) - leave it in a known-closed state before the keyboard-only step below, so its
  // very first keystroke (Enter on the trigger) is unambiguously an "open" toggle.
  await closePicker(page)

  step('the picker works by keyboard alone')
  // Keep tabbing until the date filter's own trigger is focused - the exact number of stops ahead
  // of wherever focus currently sits is an implementation detail this flow shouldn't hardcode.
  await tabUntilFocused(page, 'replays-filter-date-trigger')
  await page.keyboard.press('Enter')
  await page.getByTestId('replays-filter-date-from').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.keyboard.press('Tab') // first preset button ("Today")
  await page.keyboard.press('Enter')
  await waitForVisibleSet(page, [REPLAYS_DATE_FILTER_TODAY_DEMO], 'the "today" preset picked by keyboard')

  await page.keyboard.press('Tab') // "Last 7 days"
  await page.keyboard.press('Tab') // "Last 30 days"
  await page.keyboard.press('Tab') // From field
  const dateValue = await page.evaluate(() => document.activeElement?.value ?? null)
  if (dateValue === null) {
    throw new Error('expected the focused element after tabbing past the presets to be the From date input')
  }
  // de-DE's native date input expects day-month-year keystrokes.
  await page.keyboard.type('01092026')
  const fromValue = await page.evaluate(() => document.activeElement?.value ?? null)
  if (fromValue !== '2026-09-01') {
    throw new Error(`expected the From input to read 2026-09-01 after typing "01092026" under de-DE, got "${fromValue}"`)
  }
  // `controls.tsx`'s shared `Input`/`Select` styling explicitly turns off the outline on focus
  // (`focus:outline-none`) and signals focus via a border-colour change instead
  // (`focus:border-flame-600`) - the global `:focus-visible` outline rule (`styles/index.css`)
  // never wins against that more specific utility class for this control. So the real check here
  // is "the focused element's own border colour differs from an unfocused sibling's", not a
  // literal non-`none` outline/box-shadow (neither of which this component ever sets).
  const focusIndicator = await page.evaluate(() => {
    const focused = document.activeElement
    const sibling = document.querySelector('[data-testid="replays-filter-date-to"]')
    return {
      focusedBorderColor: focused ? getComputedStyle(focused).borderColor : null,
      siblingBorderColor: sibling ? getComputedStyle(sibling).borderColor : null,
      outline: focused ? getComputedStyle(focused).outlineStyle : null,
      boxShadow: focused ? getComputedStyle(focused).boxShadow : null,
    }
  })
  const hasOutlineOrShadow = focusIndicator.outline !== 'none' || focusIndicator.boxShadow !== 'none'
  const hasBorderChange = focusIndicator.focusedBorderColor !== focusIndicator.siblingBorderColor
  if (!hasOutlineOrShadow && !hasBorderChange) {
    throw new Error(
      `expected the focused From input to carry a visible focus indicator (outline/box-shadow or a ` +
        `distinct border colour from its unfocused sibling), got ${JSON.stringify(focusIndicator)}`,
    )
  }
  await shot('keyboard-from-focused')

  await page.getByTestId('replays-filter-date-from').fill('')
  await page.getByTestId('replays-filter-date-clear').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, ALL_NAMES, 'keyboard step cleared')

  step("dates read in the user's locale")
  await openPicker(page)
  await page.getByTestId('replays-filter-date-from').fill('2026-09-01')
  await page.getByTestId('replays-filter-date-to').fill('2026-09-01')
  await closePicker(page)
  const localeTriggerText = await page.getByTestId('replays-filter-date-trigger').textContent()
  if (!localeTriggerText?.includes('01.09.2026')) {
    throw new Error(`expected the trigger to show a de-DE-formatted date (01.09.2026), got "${localeTriggerText}"`)
  }
  await shot('locale-formatted-range')
  await openPicker(page)
  await clearDate(page)
  await waitForVisibleSet(page, ALL_NAMES, 'locale step cleared')

  step('the open picker has no axe violations')
  await openPicker(page)
  await assertNoAxeViolations(page, 'date picker open (valid state)')

  await page.getByTestId('replays-filter-date-from').fill('2026-12-31')
  await page.getByTestId('replays-filter-date-to').fill('2026-01-01')
  await page
    .getByTestId('replays-filter-date-error')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoAxeViolations(page, 'date picker open (from-after-to error state)')

  await page.getByTestId('replays-filter-date-from').fill('')
  await page.getByTestId('replays-filter-date-to').fill('')
  await page.getByTestId('replays-filter-date-clear').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, ALL_NAMES, 'cleared at the end of the run')

  await waitForStateJson(() => true, 'a settled state.json before exit')

  console.log(
    'replays-date-filter: presets and a custom from/to range each narrow the list correctly, an ' +
      'invalid from-after-to range shows a recoverable error without changing the visible rows, the ' +
      'date filter ANDs with another 153 filter and clear-all removes both, the picker is fully ' +
      'keyboard-operable with a visible focus indicator, dates render in the app locale, and the open ' +
      'popover has zero axe violations in both its valid and error states',
  )
}
