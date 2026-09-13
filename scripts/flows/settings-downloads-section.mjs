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
// `.panel > .stencil` (top-level `SectionLabel`s, one per shell/contributed section - `Panel`
// renders its `SectionLabel` child as its first, direct child, so this selector never matches the
// nested `stencil`-classed field labels inside a section's own controls) is what proves AC1's
// "between Library and About" ordering claim without a testid on either shell-owned panel.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import {
  DOWNLOADS_CACHE_ITEM_COUNT,
  DOWNLOADS_CACHE_TOTAL_BYTES,
  DOWNLOADS_SETTINGS_SEED,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors `src/renderer/src/lib/format.ts`'s `formatBytes` for the fixture's exact seeded total
 * (4 MB, chosen so the assertion never depends on rounding behaviour). */
const EXPECTED_CACHE_SIZE_TEXT = '4 MB'

function readPopulatedStateJson() {
  const path = join(variantUserDataDir('populated'), 'state.json')
  return JSON.parse(readFileSync(path, 'utf8'))
}

export default async function settingsDownloadsSection({ page, shot, step }) {
  step('open Settings')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })

  step('the Downloads section renders in Settings between Library and About')
  const section = page.getByTestId('settings-section-downloads')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  // `.stencil` renders visually upper-cased via CSS `text-transform`, which `innerText` reflects
  // (it returns rendered text, not the DOM's literal casing) - compare case-insensitively.
  const labels = (await page.locator('.panel > .stencil').allInnerTexts()).map((label) =>
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
  const whilePlayingSwitch = page.getByTestId('downloads-settings-while-playing').getByRole('switch')

  step(
    'boot-side: the section renders the fixture-seeded non-default values, not DEFAULT_DOWNLOADS_SETTINGS',
  )
  await concurrencySelect.locator('option:checked').waitFor({ state: 'attached', timeout: TIMEOUT_MS })
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

  step('concurrency, cache budget and download-while-playing can each be changed')
  const nextConcurrency = DOWNLOADS_SETTINGS_SEED.concurrentJobs === 2 ? 3 : 2
  const nextBudget = DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB === 5 ? 2 : 5
  const nextWhilePlaying = !DOWNLOADS_SETTINGS_SEED.downloadWhilePlayingAllowed

  await concurrencySelect.selectOption(String(nextConcurrency), { timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="downloads-settings-concurrency"] select')?.value ===
      expected,
    String(nextConcurrency),
    { timeout: TIMEOUT_MS },
  )

  await budgetSelect.selectOption(String(nextBudget), { timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="downloads-settings-cache-budget"] select')?.value ===
      expected,
    String(nextBudget),
    { timeout: TIMEOUT_MS },
  )

  await whilePlayingSwitch.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-testid="downloads-settings-while-playing"] [role="switch"]')
        ?.getAttribute('aria-checked') === expected,
    String(nextWhilePlaying),
    { timeout: TIMEOUT_MS },
  )

  await shot('values-changed')

  step(
    'the values persisted in state.json are the ones the app started with, and a change lands back on disk',
  )
  const onDisk = readPopulatedStateJson()
  if (onDisk.downloads?.concurrentJobs !== nextConcurrency) {
    throw new Error(
      `expected state.json's downloads.concurrentJobs to be ${nextConcurrency}, got ${JSON.stringify(onDisk.downloads)}`,
    )
  }
  if (onDisk.downloads?.archiveCacheBudgetGB !== nextBudget) {
    throw new Error(
      `expected state.json's downloads.archiveCacheBudgetGB to be ${nextBudget}, got ${JSON.stringify(onDisk.downloads)}`,
    )
  }
  if (onDisk.downloads?.downloadWhilePlayingAllowed !== nextWhilePlaying) {
    throw new Error(
      `expected state.json's downloads.downloadWhilePlayingAllowed to be ${nextWhilePlaying}, got ${JSON.stringify(onDisk.downloads)}`,
    )
  }

  // `ui:flow` never reseeds between runs (see `raw-inline-edit.mjs`'s own doc comment), and unlike
  // that flow's per-run-unique typed line, the boot-side assertions above compare against the
  // fixture's fixed `DOWNLOADS_SETTINGS_SEED` constants, not against whatever was last written - so
  // a second run without a reseed would find the *previous* run's changed values already on disk at
  // boot and fail. Revert every control back to its seeded value here so the persisted state (and
  // this flow) are exactly as they were before "values can be changed" ran, whether this is the
  // first run or the tenth.
  step('revert concurrency, cache budget and download-while-playing back to their seeded values')
  await concurrencySelect.selectOption(String(DOWNLOADS_SETTINGS_SEED.concurrentJobs), {
    timeout: TIMEOUT_MS,
  })
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="downloads-settings-concurrency"] select')?.value ===
      expected,
    String(DOWNLOADS_SETTINGS_SEED.concurrentJobs),
    { timeout: TIMEOUT_MS },
  )

  await budgetSelect.selectOption(String(DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB), {
    timeout: TIMEOUT_MS,
  })
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="downloads-settings-cache-budget"] select')?.value ===
      expected,
    String(DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB),
    { timeout: TIMEOUT_MS },
  )

  if (seededWhilePlaying !== (await whilePlayingSwitch.getAttribute('aria-checked'))) {
    await whilePlayingSwitch.click({ timeout: TIMEOUT_MS })
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector('[data-testid="downloads-settings-while-playing"] [role="switch"]')
          ?.getAttribute('aria-checked') === expected,
      seededWhilePlaying,
      { timeout: TIMEOUT_MS },
    )
  }

  const revertedOnDisk = readPopulatedStateJson()
  if (revertedOnDisk.downloads?.concurrentJobs !== DOWNLOADS_SETTINGS_SEED.concurrentJobs) {
    throw new Error(
      `expected the revert to restore state.json's downloads.concurrentJobs to the seeded ${DOWNLOADS_SETTINGS_SEED.concurrentJobs}, got ${JSON.stringify(revertedOnDisk.downloads)}`,
    )
  }
  if (
    revertedOnDisk.downloads?.archiveCacheBudgetGB !== DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB
  ) {
    throw new Error(
      `expected the revert to restore state.json's downloads.archiveCacheBudgetGB to the seeded ${DOWNLOADS_SETTINGS_SEED.archiveCacheBudgetGB}, got ${JSON.stringify(revertedOnDisk.downloads)}`,
    )
  }
  if (
    revertedOnDisk.downloads?.downloadWhilePlayingAllowed !==
    DOWNLOADS_SETTINGS_SEED.downloadWhilePlayingAllowed
  ) {
    throw new Error(
      `expected the revert to restore state.json's downloads.downloadWhilePlayingAllowed to the seeded ${DOWNLOADS_SETTINGS_SEED.downloadWhilePlayingAllowed}, got ${JSON.stringify(revertedOnDisk.downloads)}`,
    )
  }

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
  // combined with the settings revert above, this flow leaves nothing changed on disk by the time it
  // ends, so a second run without a reseed sees the same seeded state the first run did.
  step('cancel the clear-cache confirm, leaving the cache untouched')
  await page.getByRole('button', { name: 'Cancel' }).click({ timeout: TIMEOUT_MS })
  await confirmBody.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  const cacheSizeAfterCancel = await page.getByTestId('downloads-settings-cache-size').innerText()
  if (!cacheSizeAfterCancel.includes(EXPECTED_CACHE_SIZE_TEXT) || !cacheSizeAfterCancel.includes('2')) {
    throw new Error(
      `expected cache-size line to still show ${EXPECTED_CACHE_SIZE_TEXT}/2 archives after cancelling, got: ${JSON.stringify(cacheSizeAfterCancel)}`,
    )
  }
}
