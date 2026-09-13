// Story 079 D9 acceptance flow (AC5, AC6, AC7, AC8): a hand-edited installation copy is drift, not
// a launcher failure, and Care offers a one-click way out of it.
//
// Unlike `external-edit-cascades.mjs` (which hand-edits the CANONICAL file and proves the adopt
// cascades out to every installation), this flow hand-edits one INSTALLATION's own copy directly -
// the canonical file and the profile in memory never change, so the row this produces is that
// installation's own `outOfSync` Files row, the one D9 adds `Sync now` to.
//
// One precondition worth being explicit about: a config profile's installation copies are NOT
// written by anything at app startup - only the canonical file is (the one-time format migration in
// `runFileSourceStartup`, `rebuild.ts`). An installation copy is only ever written by an explicit
// content mutation (`save`/`write`/`assign`/a rename cascade) or, since this deliverable, `Sync now`
// itself. So on a freshly seeded fixture BOTH of Plain Profile's assigned installations
// (`INSTALL_ONE_ID`/`INSTALL_TWO_ID`) start with no copy on disk at all - a real `missing` Files row,
// not a fixture bug. This flow uses that fact rather than fighting it: it opens Care first and
// clicks away any pre-existing `Sync now` row (`missing`, on a fresh fixture; already-cleared and a
// no-op on a re-run of this same flow), which both establishes the known-synced baseline this flow's
// own before/after badge assertion needs AND exercises Sync now's `missing` branch for free, before
// ever touching a file by hand.
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   nav-library             TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-care         ConfigView.tsx - also carries the badge this flow reads BEFORE opening it
//   config-tab-overview     ConfigView.tsx
//   role=button "Sync now"  CareItemRow.tsx, via `config.care.sync.syncNow` - shown on an
//                           installation row that is `outOfSync` or `missing` (`lib/care-items.ts`)
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching, so
// this flow writes its drift with a per-run marker line (same re-runnable-without-reseed idiom
// `raw-save-cascades.mjs`/`external-edit-cascades.mjs` use) rather than a fixed byte sequence. Run
// `npm run ui:seed` first if the fixture's last known state came from a `ui:verify` run.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import { INSTALL_TWO_ID, installationConfigFilePath } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors `scripts/lib/screens.mjs`'s `PLAIN_PROFILE_FILE_NAME`. */
const PLAIN_PROFILE_FILE_NAME = 'Plain-Profile.cfg'

const RUN_SUFFIX = Date.now().toString(36)
const MARKER_LINE = `// q2l_flow_care_drift_${RUN_SUFFIX}`

/** Reads the digit(s) off the Care tab's own badge (`ConfigView.tsx`'s `<Badge>` inside
 * `config-tab-care`), or `0` while it carries none - the tab label itself ("Care") has no digit in
 * it, so any match is the badge's own count. */
async function readCareBadgeCount(page) {
  const text = await page.getByTestId('config-tab-care').innerText()
  const match = text.match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

async function openPlainProfile(page) {
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })
}

/** Clicks every `Sync now` button currently visible in the Care tab, one at a time, waiting for
 * each click's row to actually clear before moving to the next - so this flow's baseline is
 * genuinely synced, not just "a click was sent". A no-op once none remain.
 *
 * Waits out the Files group's own initial fetch first (`config.care.files.loading`,
 * `CareTab.tsx`'s `FilesGroup`) - otherwise a check that races that fetch reads zero rows simply
 * because nothing has answered yet, not because nothing is drifted. `waitFor({state:'hidden'})`
 * resolves immediately if the spinner text was never present at all (already loaded). */
async function clearAnySyncNowRows(page) {
  await page
    .getByText('Checking whether your files are in sync', { exact: false })
    .waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  for (let i = 0; i < 5; i++) {
    const buttons = page.locator('button', { hasText: 'Sync now' })
    const before = await buttons.count()
    if (before === 0) return
    await buttons.first().click({ timeout: TIMEOUT_MS })
    await page.waitForFunction(
      (expectedBefore) => {
        const remaining = Array.from(document.querySelectorAll('button')).filter(
          (button) => button.textContent === 'Sync now',
        )
        return remaining.length < expectedBefore
      },
      before,
      { timeout: TIMEOUT_MS },
    )
  }
}

export default async function careDriftSyncNow({ page, shot, step }) {
  step('open config module and select Plain Profile')
  await openPlainProfile(page)

  step(
    'open Care and clear any pre-existing Sync now row - a fresh fixture has no installation ' +
      'copy on disk yet (see the file doc comment), which is itself a real `missing` drift row',
  )
  await page.getByTestId('config-tab-care').click({ timeout: TIMEOUT_MS })
  await clearAnySyncNowRows(page)

  step("back to Overview and read the Care badge from this now-synced baseline")
  await page.getByTestId('config-tab-overview').click({ timeout: TIMEOUT_MS })
  const badgeBefore = await readCareBadgeCount(page)

  step('leave to Library - the drift below must be detected without Care ever being open')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })

  step("edit one assigned installation's own copy on disk directly, as an outside tool would")
  const copyPath = installationConfigFilePath(INSTALL_TWO_ID, PLAIN_PROFILE_FILE_NAME)
  const before = readFileSync(copyPath, 'latin1')
  const edited = `${before}${MARKER_LINE}\n`
  writeFileSync(copyPath, edited, 'latin1')

  step('re-entering Config shows the drift in the badge without opening Care (AC5, AC6)')
  await openPlainProfile(page)
  await page.waitForFunction(
    ({ testId, expected }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`)
      if (!el) return false
      const match = el.textContent.match(/(\d+)/)
      const count = match ? Number(match[1]) : 0
      return count === expected
    },
    { testId: 'config-tab-care', expected: badgeBefore + 1 },
    { timeout: TIMEOUT_MS },
  )
  await shot('badge-shows-drift')

  step('open Care')
  await page.getByTestId('config-tab-care').click({ timeout: TIMEOUT_MS })

  step('the row reads Changed in the game folder and Sync now names the file it will overwrite (AC8)')
  const driftedRow = page.getByText('Changed in the game folder', { exact: false }).first()
  await driftedRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const syncNowButton = page.getByRole('button', { name: 'Sync now' })
  await syncNowButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  // The hint line (`config.care.sync.syncNowHint`) interpolates the row's own target path, the exact
  // on-disk file this click is about to overwrite. `.first()`: the row also shows the same raw path
  // on its own separate line, so this text can legitimately appear twice.
  await page
    .getByText(copyPath, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await driftedRow.scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  await shot('care-drift-detected')

  step('Sync now rewrites the copy and clears the row (AC7)')
  await syncNowButton.click({ timeout: TIMEOUT_MS })
  await syncNowButton.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  await driftedRow.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  await shot('care-synced')

  step("assert the installation's copy is now byte-identical to the profile's canonical file")
  const canonicalPath = join(variantUserDataDir('populated'), PLAIN_PROFILE_FILE_NAME)
  const canonical = readFileSync(canonicalPath, 'latin1')
  const synced = readFileSync(copyPath, 'latin1')
  if (synced !== canonical) {
    throw new Error(
      `expected installation ${INSTALL_TWO_ID}'s copy (${copyPath}) to be byte-identical to the ` +
        `canonical file (${canonicalPath}) after Sync now; it was not`,
    )
  }
  // And genuinely rewritten, not merely coincidentally equal to what the hand-edit already produced.
  if (synced === edited) {
    throw new Error('expected Sync now to overwrite the hand-edited bytes; the marker line survived')
  }
}
