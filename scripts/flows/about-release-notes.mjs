// Story 099 (docs/requirements/099-about-tells-me-what-changed.md) D7: the e2e proof for the
// Settings -> About panel D1-D6 built - this-version's own release notes (or its empty state), a
// pending update's notes marked "not yet installed" next to the shared `UpdateAction`, the
// update-check row (last-checked/check-now/outcome) and the two external links (repository,
// changelog).
//
// Structural sibling of `scripts/flows/app-update.mjs` (098 D5) and
// `scripts/flows/settings-downloads-section.mjs` (072 D6): same harness (`withApp` via
// `flow.mjs`), same `dev:simulateAppUpdate`-driven `invoke`/`invokeOk` idiom as the former (copied
// here rather than imported - each flow file is a standalone module by this repo's own
// convention), same on-disk-assertion idiom as the latter for AC3's recorded external-link clicks.
//
// A tiny, justified addition to the simulate mechanism backs AC4's other half: `checkFailed`
// (`src/shared/types/update.ts`) is a *check* failure (`status: 'error'`), not a *download*
// failure (the pre-existing `error` scenario) - see that type's own doc comment for why no other
// mechanism could prove a failed-check outcome through the real UI here.
//
// ## Passes, in this order, in ONE app session
//
// 1. Open Settings.
// 2. AC4 (part 1) - a fresh boot has never checked; a real "Check now" click is a documented
//    no-op under this dev/unpackaged harness (097 AC5), proven safe rather than skipped.
// 3. AC1 - this version's own release notes, or its empty state (branches on whether
//    CHANGELOG.md actually has a `## [<version>]` section for the running `package.json` version -
//    today it does not, so this naturally exercises the empty-state path, and keeps working the day
//    a real release section exists).
// 4. AC3 - the repository/changelog links go out through the recorded external path, in order,
//    opening no app window.
// 5. AC2 + AC6 - a pending update's notes render as plain text (bold markdown flattened, an
//    `<img>`-shaped string never becomes a real element), marked "Not yet installed", with the
//    shared `UpdateAction` alongside it.
// 6. AC5 - an update with empty notes falls back to the shared "no release notes" sentence.
// 7. AC4 (part 2) - a simulated failed check shows its reason and moves the last-checked time.
//
// ## Selectors
//
// All real, pre-existing testids from D1-D6 - see `AboutPanel.tsx`/`UpdateCheckRow.tsx` before
// changing any of these:
//   nav-settings                  TitleBar.tsx
//   settings-about                SettingsView.tsx
//   about-release-notes           AboutPanel.tsx - this version's own parsed notes
//   about-release-notes-empty     AboutPanel.tsx - this version's empty state
//   about-link-repository         AboutPanel.tsx
//   about-link-changelog          AboutPanel.tsx
//   about-update-available        AboutPanel.tsx - the pending-update block's container
//   about-update-version          AboutPanel.tsx
//   about-update-notes            AboutPanel.tsx
//   about-update-action           AboutPanel.tsx - wraps the shared `UpdateAction`
//   about-update-last-checked     UpdateCheckRow.tsx
//   about-update-check-now        UpdateCheckRow.tsx
//   about-update-outcome          UpdateCheckRow.tsx
// `update-popover-download` is `UpdatePopover.tsx`'s own pre-existing testid, reused here only to
// confirm the shared `UpdateAction` rendered its `available`-phase button (AC2) - never clicked.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import { REPO_ROOT } from '../lib/paths.mjs'

const TIMEOUT_MS = 8_000
const POLL_INTERVAL_MS = 100

/**
 * Mirrors `src/shared/constants.ts`'s `APP_REPO_URL`/`APP_CHANGELOG_URL` - duplicated as literals
 * rather than imported because this file is plain `.mjs` run directly by `node`, with no
 * TypeScript loader in the chain that would let it import a `.ts` module (same reason
 * `scripts/lib/harness.mjs`'s own `EXPECTED_RENDERER_ORIGIN` is a duplicated literal, not an
 * import, per that file's own doc comment).
 */
const APP_REPO_URL = 'https://github.com/Hantsch/q2-launcher'
const APP_CHANGELOG_URL = 'https://github.com/Hantsch/q2-launcher/blob/main/CHANGELOG.md'

async function invoke(page, channel, payload) {
  return page.evaluate(({ ch, p }) => window.q2.invoke(ch, p), { ch: channel, p: payload })
}

async function invokeOk(page, channel, payload, label) {
  const outcome = await invoke(page, channel, payload)
  if (outcome !== undefined && outcome !== null && outcome.ok === false) {
    throw new Error(`${label ?? channel} failed: ${JSON.stringify(outcome)}`)
  }
  return outcome
}

function simulateAppUpdate(page, scenario) {
  return invokeOk(page, 'dev:simulateAppUpdate', scenario, `dev:simulateAppUpdate(${scenario.scenario})`)
}

/** Mirrors `src/main/lib/ui-harness.ts`'s own try/catch-defaulting-to-`[]` idiom - this is a test
 * fixture file, not production data, so a missing/malformed file just means "nothing recorded yet". */
function readRecordedExternalUrls() {
  const filePath = join(variantUserDataDir('populated'), 'ui-harness-external.json')
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function waitUntil(predicate, description) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`timed out waiting for: ${description}`)
}

export default async function aboutReleaseNotes({ page, app, step, shot }) {
  step('open Settings')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('settings-about').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC4 part 1: a fresh boot has never checked, and Check now is a safe no-op under the harness')
  // 097 AC5: `supported = app.isPackaged`, always false when Playwright launches the
  // built-but-unpackaged app, so a real `update:check` cannot even reach 'checking' here - this
  // step proves the button is real and harmless, not what a genuine network check would show
  // (that half is 097's own acceptance, named as a gap in this story, not silently dropped).
  const lastCheckedBefore = await page.getByTestId('about-update-last-checked').innerText()
  if (!lastCheckedBefore.includes('Never checked for updates')) {
    throw new Error(
      `expected a fresh boot to show "Never checked for updates", got: ${JSON.stringify(lastCheckedBefore)}`,
    )
  }
  const checkNowButton = page.getByTestId('about-update-check-now')
  await checkNowButton.click({ timeout: TIMEOUT_MS })
  await waitUntil(() => checkNowButton.isEnabled(), 'Check now to re-enable after its no-op click')
  const lastCheckedAfterNoop = await page.getByTestId('about-update-last-checked').innerText()
  if (lastCheckedAfterNoop !== lastCheckedBefore) {
    throw new Error(
      `expected a real check under the dev/unpackaged harness to be a no-op, but last-checked changed from ${JSON.stringify(lastCheckedBefore)} to ${JSON.stringify(lastCheckedAfterNoop)}`,
    )
  }
  if ((await page.getByTestId('about-update-outcome').count()) !== 0) {
    throw new Error('expected no outcome line after a no-op check under the harness')
  }

  step('AC1: this version\'s own release notes, or its empty state if none exist yet')
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
  const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Mirrors scripts/lib/release/changelog.mjs's real heading format (`## <version> — <date>`,
  // em-dash or hyphen, no brackets) - not the bracketed shape this once wrongly assumed.
  const versionHeadingPattern = new RegExp(`^##\\s+${escapedVersion}\\s+[—-]`, 'm')
  if (versionHeadingPattern.test(changelog)) {
    const notes = page.getByTestId('about-release-notes')
    await notes.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const notesText = await notes.innerText()
    if (!notesText.trim()) {
      throw new Error('expected this version\'s release notes to be non-empty')
    }
  } else {
    await page
      .getByTestId('about-release-notes-empty')
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  await shot('this-version')

  step('AC3: the repository and changelog links go out through the recorded external path')
  const urlsBefore = readRecordedExternalUrls()
  const windowCountBefore = app.windows().length
  await page.getByTestId('about-link-repository').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('about-link-changelog').click({ timeout: TIMEOUT_MS })
  await waitUntil(
    () => readRecordedExternalUrls().length >= urlsBefore.length + 2,
    'two new recorded external urls after clicking both About links',
  )
  const urlsAfter = readRecordedExternalUrls()
  const newlyRecorded = urlsAfter.slice(urlsBefore.length)
  if (newlyRecorded[0] !== APP_REPO_URL || newlyRecorded[1] !== APP_CHANGELOG_URL) {
    throw new Error(
      `expected the repository link then the changelog link to be recorded in that order, got: ${JSON.stringify(newlyRecorded)}`,
    )
  }
  if (app.windows().length !== windowCountBefore) {
    throw new Error(
      `expected no app window to open from either external link, went from ${windowCountBefore} to ${app.windows().length}`,
    )
  }

  step('AC2 + AC6: a pending update renders its notes as plain text and offers the shared action')
  await simulateAppUpdate(page, {
    scenario: 'available',
    version: '9.9.9-flow',
    notes:
      '### Added\n- **bold** feature\n- <img src=x onerror="alert(1)"> should render as text, not an element\n',
  })
  await page.getByTestId('about-update-available').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const versionText = await page.getByTestId('about-update-version').innerText()
  if (!versionText.includes('9.9.9-flow')) {
    throw new Error(`expected the pending-update block to name 9.9.9-flow, got: ${JSON.stringify(versionText)}`)
  }
  // `Badge` renders visually upper-cased via CSS `text-transform`, which `innerText` reflects (it
  // returns rendered text, not the DOM's literal casing) - compare case-insensitively, same idiom
  // `settings-downloads-section.mjs` uses for its own `.stencil` section labels.
  const badgeText = await page.getByTestId('about-update-available').getByText('installed', { exact: false }).innerText()
  if (badgeText.toLowerCase() !== 'not yet installed') {
    throw new Error(`expected the "Not yet installed" badge, got: ${JSON.stringify(badgeText)}`)
  }
  const pendingNotesText = await page.getByTestId('about-update-notes').innerText()
  if (!pendingNotesText.includes('bold')) {
    throw new Error(
      `expected "**bold**" to render as plain "bold" text, got: ${JSON.stringify(pendingNotesText)}`,
    )
  }
  if (!pendingNotesText.includes('<img src=x onerror="alert(1)">')) {
    throw new Error(
      `expected the img-shaped bullet to render as literal visible text, got: ${JSON.stringify(pendingNotesText)}`,
    )
  }
  const imgCount = await page.getByTestId('about-update-notes').locator('img').count()
  if (imgCount !== 0) {
    throw new Error(`expected the img-shaped bullet to never become a real <img> element, got ${imgCount}`)
  }
  await page
    .getByTestId('about-update-action')
    .getByTestId('update-popover-download')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('pending-update-with-notes')

  step('AC5: an update with no notes falls back to the shared empty-state sentence')
  await simulateAppUpdate(page, { scenario: 'available', version: '9.9.9-flow-no-notes', notes: '' })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="about-update-version"]')?.textContent?.includes('9.9.9-flow-no-notes'),
    null,
    { timeout: TIMEOUT_MS },
  )
  // `EmptyState`'s title renders visually upper-cased via CSS `text-transform`, same as `Badge`
  // above - compare case-insensitively.
  const noNotesText = await page.getByTestId('about-update-notes').innerText()
  if (!noNotesText.toLowerCase().includes('this version has no release notes.')) {
    throw new Error(
      `expected the no-notes fallback sentence, got: ${JSON.stringify(noNotesText)}`,
    )
  }
  await shot('pending-update-no-notes')

  step('AC4 part 2: a failed check shows its reason and moves the last-checked time')
  await simulateAppUpdate(page, { scenario: 'checkFailed', reason: 'network' })
  const outcome = page.getByTestId('about-update-outcome')
  await outcome.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const outcomeText = await outcome.innerText()
  if (!outcomeText.includes('Could not reach the update server.')) {
    throw new Error(`expected the network-failure reason, got: ${JSON.stringify(outcomeText)}`)
  }
  const lastCheckedAfterFailure = await page.getByTestId('about-update-last-checked').innerText()
  if (lastCheckedAfterFailure.includes('Never checked')) {
    throw new Error('expected last-checked to show a real timestamp after the simulated failed check')
  }
  await shot('check-failed')

  console.log(
    'about-release-notes: this version\'s own release notes (or its empty state) render (AC1), a ' +
      'pending update shows its version and notes marked "not yet installed" next to the shared ' +
      'update action with markdown flattened to text and no HTML injection possible (AC2/AC6), an ' +
      'update with no notes falls back to the shared empty sentence (AC5), the repository/changelog ' +
      'links open externally in order with no app window opened (AC3), and the check-now row shows ' +
      'when it last checked, that a real check is a safe no-op under this harness, and a simulated ' +
      'failed check\'s reason (AC4)',
  )
}
