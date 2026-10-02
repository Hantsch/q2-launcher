// Story 072 (docs/requirements/072-settings-gain-a-downloads-section.md) D6 acceptance flow: the
// downloads module's Settings-contributed section (D1/D5), walking AC1/AC2/AC3/AC4/AC6's
// user-facing halves against the `populated` fixture's non-default `downloads` settings and its
// two seeded dummy cache archives (`scripts/lib/fixture.mjs`). Mirrors
// `scripts/flows/raw-inline-edit.mjs`'s on-disk-assertion idiom: `withApp()`
// (`scripts/lib/harness.mjs:380`) asserts the app is still alive at the end, so this flow reads
// `state.json` off disk directly rather than closing/relaunching the app to prove persistence.
//
// Selectors, not guesses - read `src/renderer/src/modules/downloads/DownloadsSettingsSection.tsx`
// and `src/renderer/src/views/SettingsView.tsx` before changing any of these:
//   nav-settings                          TitleBar.tsx
//   settings-section-downloads            SettingsView.tsx (D1) - the shell's own Panel wrapper
//                                          around the contributed section
//   downloads-settings-concurrency        DownloadsSettingsSection.tsx - wraps the concurrency <Select>
//   downloads-settings-cache-budget       DownloadsSettingsSection.tsx - wraps the budget <Select>
//   downloads-settings-while-playing      DownloadsSettingsSection.tsx - wraps the while-playing <Switch>
//   downloads-settings-cache-size         DownloadsSettingsSection.tsx - the "Cache: X (N archives)" line
//   downloads-settings-clear-cache        DownloadsSettingsSection.tsx - opens the confirm Modal
//   downloads-settings-clear-cache-confirm         DownloadsSettingsSection.tsx - the confirm body text
//   downloads-settings-clear-cache-confirm-button  DownloadsSettingsSection.tsx - the confirm Modal's
//                                                    destructive action
//
// `.panel > header > h2` (the section title `SettingsSection.tsx` renders as each panel's first,
// direct child, so this selector never matches a heading nested inside a section's own controls)
// is what proves AC1's "between Library and About" ordering claim without a testid on either
// shell-owned panel.
import { variantUserDataDir } from '../lib/harness.mjs'
import { waitForStateJson } from '../lib/state-json.mjs'
import {
  DOWNLOADS_CACHE_ITEM_COUNT,
  DOWNLOADS_CACHE_TOTAL_BYTES,
  DOWNLOADS_SETTINGS_SEED,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors `src/renderer/src/lib/format.ts`'s `formatBytes` for the fixture's exact seeded total
 * (4 MB, chosen so the assertion never depends on rounding behaviour). */
const EXPECTED_CACHE_SIZE_TEXT = '4 MB'

function waitForPopulatedStateJson(predicate, label) {
  return waitForStateJson(variantUserDataDir('populated'), predicate, label)
}

export default async function settingsDownloadsSection({ page, shot, step }) {
  step('open Settings')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })

  step('the Downloads section renders in Settings between Library and About')
  const section = page.getByTestId('settings-section-downloads')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  // Section titles render visually upper-cased via CSS `text-transform`, which `innerText` reflects
  // (it returns rendered text, not the DOM's literal casing) - compare case-insensitively.
  const labels = (await page.locator('.panel > header > h2').allInnerTexts()).map((label) =>
    label.toLowerCase(),
  )
  const libraryIndex = labels.indexOf('library')
  const downloadsIndex = labels.indexOf('downloads')
  const aboutIndex = labels.indexOf('about')
  if (libraryIndex === -1 || downloadsIndex === -1 || aboutIndex === -1) {
    throw new Error(
      `expected Library, Downloads and About section headings, got: ${JSON.stringify(labels)}`,
    )
  }
  if (!(libraryIndex < downloadsIndex && downloadsIndex < aboutIndex)) {
    throw new Error(
      `expected Downloads between Library and About, got order: ${JSON.stringify(labels)}`,
    )
  }

  const concurrencySelect = page.getByTestId('downloads-settings-concurrency').locator('select')
  const budgetSelect = page.getByTestId('downloads-settings-cache-budget').locator('select')
  const whilePlayingSwitch = page
    .getByTestId('downloads-settings-while-playing')
    .getByRole('switch')

  step(
    'boot-side: the section renders the fixture-seeded non-default values, not DEFAULT_DOWNLOADS_SETTINGS',
  )
  await concurrencySelect
    .locator('option:checked')
    .waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  const seededConcurrency = await concurrencySelect.inputValue()
  const seededBudget = await budgetSelect.inputValue()
  const seededWhilePlaying = await whilePlayingSwitch.getAttribute('aria-checked')
  if (Number(seededConcurrency) !== DOWNLOADS_SETTINGS_SEED.concurrentJobs) {
    throw new Error(
      `expected concurrency select to show the seeded ${DOWNLOADS_SETTINGS_SEED.concurrentJobs}, got ${seededConcurrency}`,
    )
  }
  if (Number(seededBudget) !== DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB) {
    throw new Error(
      `expected cache-budget select to show the seeded ${DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB}, got ${seededBudget}`,
    )
  }
  if ((seededWhilePlaying === 'true') !== DOWNLOADS_SETTINGS_SEED.downloadWhilePlayingAllowed) {
    throw new Error(
      `expected while-playing switch to show the seeded ${DOWNLOADS_SETTINGS_SEED.downloadWhilePlayingAllowed}, got aria-checked=${seededWhilePlaying}`,
    )
  }

  step('the section shows the seeded cache size')
  const cacheSizeText = await page.getByTestId('downloads-settings-cache-size').innerText()
  if (!cacheSizeText.includes(EXPECTED_CACHE_SIZE_TEXT) || !cacheSizeText.includes('2')) {
    throw new Error(
      `expected cache-size line to mention ${EXPECTED_CACHE_SIZE_TEXT} and 2 archives, got: ${JSON.stringify(cacheSizeText)}`,
    )
  }

  await shot('boot-state')

  step('concurrency and download-while-playing are disabled and say why')
  const reasonText = 'Not available yet: downloads run one at a time'
  if (!(await concurrencySelect.isDisabled())) {
    throw new Error('expected the concurrency select to be disabled')
  }
  if (!(await whilePlayingSwitch.isDisabled())) {
    throw new Error('expected the download-while-playing switch to be disabled')
  }
  for (const testId of [
    'downloads-settings-concurrency-reason',
    'downloads-settings-while-playing-reason',
  ]) {
    const reason = page.getByTestId(testId)
    await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const text = await reason.innerText()
    if (!text.includes(reasonText)) {
      throw new Error(
        `expected ${testId} to say ${JSON.stringify(reasonText)}, got: ${JSON.stringify(text)}`,
      )
    }
  }

  await shot('disabled-with-reason')

  // `ui:flow` never reseeds between runs (see `raw-inline-edit.mjs`'s own doc comment), and the
  // boot-side assertions above compare against the fixture's fixed seed - so the cache budget is
  // changed and then reverted, leaving state.json exactly as it was whether this is the first run
  // or the tenth.
  step('the cache budget can be changed and is reverted to its seeded value')
  const nextBudget = DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB === 5 ? 2 : 5
  const budgetShows = (expected) =>
    page.waitForFunction(
      (value) =>
        document.querySelector('[data-testid="downloads-settings-cache-budget"] select')?.value ===
        value,
      String(expected),
      { timeout: TIMEOUT_MS },
    )

  await budgetSelect.selectOption(String(nextBudget), { timeout: TIMEOUT_MS })
  await budgetShows(nextBudget)
  const onDisk = await waitForPopulatedStateJson(
    (doc) => doc.downloads?.archiveCacheBudgetGB === nextBudget,
    'the changed cache budget',
  )
  if (onDisk.downloads?.concurrentJobs !== DOWNLOADS_SETTINGS_SEED.concurrentJobs) {
    throw new Error(
      `expected state.json's downloads.concurrentJobs to stay at the seeded ${DOWNLOADS_SETTINGS_SEED.concurrentJobs}, got ${JSON.stringify(onDisk.downloads)}`,
    )
  }

  await budgetSelect.selectOption(String(DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB), {
    timeout: TIMEOUT_MS,
  })
  await budgetShows(DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB)
  await waitForPopulatedStateJson(
    (doc) => doc.downloads?.archiveCacheBudgetGB === DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB,
    'the reverted cache budget',
  )

  step('clearing the cache names size and item count before it is confirmed')
  await page.getByTestId('downloads-settings-clear-cache').click({ timeout: TIMEOUT_MS })
  const confirmBody = page.getByTestId('downloads-settings-clear-cache-confirm')
  await confirmBody.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const confirmText = await confirmBody.innerText()
  if (!confirmText.includes(EXPECTED_CACHE_SIZE_TEXT)) {
    throw new Error(
      `expected the clear-cache confirm body to name the size ${EXPECTED_CACHE_SIZE_TEXT}, got: ${JSON.stringify(confirmText)}`,
    )
  }
  if (!confirmText.includes(String(DOWNLOADS_CACHE_ITEM_COUNT))) {
    throw new Error(
      `expected the clear-cache confirm body to name the item count ${DOWNLOADS_CACHE_ITEM_COUNT}, got: ${JSON.stringify(confirmText)}`,
    )
  }
  if (DOWNLOADS_CACHE_TOTAL_BYTES <= 0) {
    // Sanity check on the fixture constants themselves, not the UI - keeps this assertion
    // meaningful even if the seeded archive sizes change later.
    throw new Error('fixture cache archives must sum to a positive size')
  }

  await shot('clear-cache-confirm')

  // Prefer cancel here (Decisions/D6 guidance): D3's cache.test.ts and index.test.ts already cover
  // eviction/clear correctness exhaustively at the unit level - this flow's job is only to prove
  // the confirm dialog names size/count BEFORE anything is deleted (AC4), not to re-prove deletion
  // itself. Cancelling also means the fixture's two dummy archives are still there for the next run
  // of this flow, since `ui:flow` never reseeds (see `raw-inline-edit.mjs`'s own doc comment) - and,
  // combined with the budget revert above, this flow leaves nothing changed on disk by the time it
  // ends, so a second run without a reseed sees the same seeded state the first run did.
  step('cancel the clear-cache confirm, leaving the cache untouched')
  await page.getByRole('button', { name: 'Cancel' }).click({ timeout: TIMEOUT_MS })
  await confirmBody.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  const cacheSizeAfterCancel = await page.getByTestId('downloads-settings-cache-size').innerText()
  if (
    !cacheSizeAfterCancel.includes(EXPECTED_CACHE_SIZE_TEXT) ||
    !cacheSizeAfterCancel.includes('2')
  ) {
    throw new Error(
      `expected cache-size line to still show ${EXPECTED_CACHE_SIZE_TEXT}/2 archives after cancelling, got: ${JSON.stringify(cacheSizeAfterCancel)}`,
    )
  }
}
