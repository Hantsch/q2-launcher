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
// 2. AC4 (part 1) - the update-check row, in whichever of its two legitimate shapes the running
//    build has: a documented no-op under the dev/unpackaged harness (097 AC5), a real recorded
//    check against a packaged one. Branches on the build, not on an assumption about it.
// 3. AC1 - this version's own release notes, or its empty state (branches on whether CHANGELOG.md
//    has a `## <version> — <date>` section for the version the RUNNING APP reports - the unpackaged
//    harness reports Electron's own version and so exercises the empty-state path, a packaged build
//    reports the real one and exercises the notes path).
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
/**
 * A *real* update check - the packaged branch of pass 2 below - is bounded by
 * `UPDATE_CHECK_TIMEOUT_MS` (20s, `src/main/services/update/service.ts`), not by how fast the UI
 * reacts, so the ordinary 8s above would fail a check that is merely slow rather than broken.
 */
const CHECK_TIMEOUT_MS = 30_000
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

async function waitUntil(predicate, description, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
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

  step('AC4 part 1: the update-check row behaves the way the running build supports')
  // 097 AC5: `supported = app.isPackaged` (`src/main/context.ts` hands `electronApp.isPackaged`
  // straight to `createUpdateService`), so this row has two legitimate shapes and which one applies
  // is a property of the BUILD, not of this flow:
  //
  //   unpackaged - a check cannot even reach 'checking', so "Check now" is a documented no-op.
  //   packaged   - the service is supported: it fires its own startup check
  //                (`scheduleStartupCheck()`) and the button runs a genuine network check.
  //
  // Asserting the no-op unconditionally made this flow fail by construction as soon as
  // `.github/workflows/linux-verify.yml` (101 D5) started running it against a real AppImage via
  // `--app=<path>`: both "Never checked for updates" and the unchanged last-checked time are false
  // there. The build is read off the running app (`app:getInfo`, which already reports
  // `isPackaged`) rather than derived from whether `--app=` happened to be passed.
  const { isPackaged, appVersion } = await invoke(page, 'app:getInfo')
  const lastChecked = page.getByTestId('about-update-last-checked')
  const checkNowButton = page.getByTestId('about-update-check-now')

  if (!isPackaged) {
    const lastCheckedBefore = await lastChecked.innerText()
    if (!lastCheckedBefore.includes('Never checked for updates')) {
      throw new Error(
        `expected a fresh boot to show "Never checked for updates", got: ${JSON.stringify(lastCheckedBefore)}`,
      )
    }
    await checkNowButton.click({ timeout: TIMEOUT_MS })
    await waitUntil(() => checkNowButton.isEnabled(), 'Check now to re-enable after its no-op click')
    const lastCheckedAfterNoop = await lastChecked.innerText()
    if (lastCheckedAfterNoop !== lastCheckedBefore) {
      throw new Error(
        `expected a real check under the dev/unpackaged harness to be a no-op, but last-checked changed from ${JSON.stringify(lastCheckedBefore)} to ${JSON.stringify(lastCheckedAfterNoop)}`,
      )
    }
    if ((await page.getByTestId('about-update-outcome').count()) !== 0) {
      throw new Error('expected no outcome line after a no-op check under the harness')
    }
  } else {
    // "Never checked" is not assertable here: the startup check is fire-and-forget, so it may
    // already have completed by the time Settings opens. What a packaged build can be held to is
    // that a check completes and is *recorded*. The outcome's content is deliberately not
    // asserted - a CI runner may be rate-limited or offline, and `runAttempt()` writes
    // `lastCheckedAt` on a failed check exactly as on a successful one.
    await checkNowButton.click({ timeout: CHECK_TIMEOUT_MS })
    await waitUntil(
      () => checkNowButton.isEnabled(),
      'Check now to re-enable after a real check',
      CHECK_TIMEOUT_MS,
    )
    await waitUntil(
      async () => !(await lastChecked.innerText()).includes('Never checked for updates'),
      'last-checked to record a completed check',
      CHECK_TIMEOUT_MS,
    )
    await page
      .getByTestId('about-update-outcome')
      .waitFor({ state: 'visible', timeout: CHECK_TIMEOUT_MS })
  }

  step('AC1: this version\'s own release notes, or its empty state if none exist yet')
  // `appVersion`, not package.json's `version`: `installedReleaseNotes()` looks the section up by
  // `app.getVersion()`, and under the unpackaged harness that is NOT the repo's version. Electron
  // is handed `out/main/index.js` as its app path (`launchApp()` in `scripts/lib/harness.mjs`),
  // there is no package.json in `out/main/`, so `app.getVersion()` falls back to Electron's own
  // version - which never has a changelog section, so this run always takes the empty-state branch.
  // A packaged build reports the real version and takes the other one. Reading package.json here
  // predicted the packaged answer for both, and started failing the moment CHANGELOG.md grew a
  // section for the current version.
  const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
  const escapedVersion = appVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
