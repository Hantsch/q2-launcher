// Story 079 D3 acceptance flow (AC2): adopting an external edit of the canonical file - Care's
// "Reload" action, one of the three adopt paths the story names alongside the conflict dialog's
// "take the file" and the focus/tab silent re-read - is a content mutation like any other, so it now
// cascades to every assigned, not-running installation too. The copy must land byte-identical to the
// ADOPTED file, never a re-render of it (`index.ts#refreshFromFiles`'s `refuseCanonicalWriteFor`).
//
// Story 079 review (finding 2): the ORIGINAL version of this flow drove the adopt through Care's
// "Reload" button after "leave to Library and back" - but D6 made `useFileSourceRefresh`'s own
// trigger 1 fire on `profileId` itself (`lib/useFileSourceRefresh.ts`), so re-selecting Plain
// Profile from the profile list is ALREADY one of AC2's three named adopt paths (the silent
// focus/tab re-read) for a CLEAN profile: it silently adopts the on-disk edit and cascades it before
// Care is ever opened. That raced the Reload button: it is only visible in the short window before
// `useDriftState`'s own `updatedAt`-triggered refetch catches up, so `reloadButton.waitFor({visible})`
// passed on timing alone and the click that followed was a no-op against an already-adopted file -
// the assertions below still passed, but for the wrong reason (nothing about Reload itself was
// exercised). Fixed by testing the SILENT RE-READ path directly (below) rather than fighting it for
// a button that this scenario does not reliably show at all.
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   nav-library             TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-care         ConfigView.tsx
//   config-tab-raw          ConfigView.tsx
//   "Start the file with `unbindall`"  RawFileTab.tsx's checkbox label text - a real content
//                           setter (`setWriteUnbindall`) that marks the profile dirty server-side
//                           the instant it is toggled, the exact recipe `screens.mjs`'s own
//                           `config-conflict-dialog` screen already uses for a real save-time
//                           conflict (part 2 below).
//   config-tab-unsaved      ConfigView.tsx - only in the strip while something is unsaved
//   config-save             ProfileSaveActions.tsx - the real Save button
//   config-conflict-dialog / config-conflict-take-file   ConfigConflictDialog.tsx - the two-pane
//                           modal `save`'s own `changedOnDisk` refusal opens, a direct synchronous
//                           response to the Save click above with no separate fetch to race.
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching, so
// this flow writes its external edit as an APPEND (never a full overwrite) and keys its own
// assertions off a per-run marker line, the same re-runnable-without-reseed idiom
// `raw-inline-edit.mjs`/`raw-save-cascades.mjs` use. Run `npm run ui:seed` first if the fixture's
// last known state came from a `ui:verify` run (Plain Profile server-dirty locks the Raw editor, and
// a stale canonical hash from a previous run's writes could otherwise change which sync-state branch
// this flow's edit lands in).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import { INSTALL_ONE_ID, INSTALL_TWO_ID, installationConfigFilePath } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors `scripts/lib/screens.mjs`'s `PLAIN_PROFILE_FILE_NAME`. */
const PLAIN_PROFILE_FILE_NAME = 'Plain-Profile.cfg'

const RUN_SUFFIX = Date.now().toString(36)

async function openPlainProfile(page) {
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })
}

async function leaveAndReturnToPlainProfile(page) {
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await openPlainProfile(page)
}

/** Polls a file on disk until its content equals `expected`, rather than asserting on the first
 * read - the adopt/cascade this flow drives is a real async IPC round trip (the silent re-read's
 * own `refreshProfilesFromFiles` call, then the sync engine's writes), so a read taken immediately
 * after the triggering UI action can still see the pre-adopt bytes. Same "poll rather than assume
 * the first read already reflects an async round trip" idiom `bootstrap-failure-retry.mjs`'s
 * `pickFreshTarget` uses for its own async field. */
async function waitForFileContent(path, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      last = readFileSync(path, 'latin1')
      if (last === expected) return
    } catch (error) {
      last = `<unreadable: ${error.message}>`
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `timed out waiting for ${path} to equal the expected bytes; last read:\n${last}\n\nexpected:\n${expected}`,
  )
}

function assertCopiesMatch(edited, label) {
  for (const installId of [INSTALL_ONE_ID, INSTALL_TWO_ID]) {
    const copyPath = installationConfigFilePath(installId, PLAIN_PROFILE_FILE_NAME)
    const copy = readFileSync(copyPath, 'latin1')
    if (copy !== edited) {
      throw new Error(
        `${label}: expected installation ${installId}'s copy (${copyPath}) to be byte-identical to ` +
          `the adopted file; it was not`,
      )
    }
  }
}

export default async function externalEditCascades({ page, shot, step }) {
  const canonicalPath = join(variantUserDataDir('populated'), PLAIN_PROFILE_FILE_NAME)

  // ---------------------------------------------------------------------------------------------
  // Part 1 (AC2, the silent re-read - one of the story's three named adopt paths, and the one a
  // clean profile actually reaches when the canonical file changes underneath it): edit the file
  // on disk, then merely leave to Library and come back - `useFileSourceRefresh`'s trigger 1 fires
  // on `profileId` itself and adopts + cascades without any dialog or button.
  // ---------------------------------------------------------------------------------------------
  step('open config module and select Plain Profile')
  await openPlainProfile(page)

  step('edit the canonical file on disk directly, as an outside tool (e.g. Notepad) would')
  const marker1 = `// q2l_flow_external_edit_silent_${RUN_SUFFIX}`
  const before = readFileSync(canonicalPath, 'latin1')
  const edited1 = `${before}${marker1}\n`
  writeFileSync(canonicalPath, edited1, 'latin1')

  step(
    'leave to Library and back - re-selecting Plain Profile is the silent re-read trigger ' +
      '(AC2) and, for this still-clean profile, adopts and cascades the edit on its own',
  )
  await leaveAndReturnToPlainProfile(page)

  step("assert BOTH of Plain Profile's assigned installations end up holding the adopted bytes (AC2)")
  for (const installId of [INSTALL_ONE_ID, INSTALL_TWO_ID]) {
    await waitForFileContent(
      installationConfigFilePath(installId, PLAIN_PROFILE_FILE_NAME),
      edited1,
      TIMEOUT_MS,
    )
  }
  assertCopiesMatch(edited1, 'silent re-read')

  step('assert the canonical file itself was not re-rendered by the cascade')
  const canonicalAfter1 = readFileSync(canonicalPath, 'latin1')
  if (canonicalAfter1 !== edited1) {
    throw new Error(
      'expected the canonical file to still hold exactly the hand-edited bytes after the silent ' +
        're-read cascade - it was re-rendered instead',
    )
  }

  // Not asserted: that the canonical row itself reads back `inSync` in Care. AC2 is about the
  // COPIES reaching every installation, already proven byte-for-byte above; whether a freshly
  // adopted file that carries an arbitrary hand-typed trailing comment re-renders byte-identical
  // (AC4, story 079 D1) is a separate, narrower guarantee this flow does not need to lean on -
  // asserting it here would make this flow (finding 2's own subject) fail on a real, pre-existing
  // AC4 property rather than on anything the fix for finding 2 changed.
  step('open Care to visually confirm the adopted state')
  await page.getByTestId('config-tab-care').click({ timeout: TIMEOUT_MS })
  await shot('care-after-silent-adopt')

  // ---------------------------------------------------------------------------------------------
  // Part 2 (AC2, the conflict dialog's "take the file" - the one adopt path a CLEAN profile can
  // never reach at all, since it requires unsaved edits too): the exact known-good recipe
  // `scripts/lib/screens.mjs`'s own `config-conflict-dialog` screen already uses for a real,
  // deterministic save-time conflict - dirty Plain Profile through the Raw tab's `unbindall`
  // checkbox (a real content setter, server-side `dirty: true`, no race with any background
  // fetch), hand-edit the canonical file, then click the real Save button. `save`'s own
  // `changedOnDisk` guard (`index.ts`) is a direct, synchronous response to that click - unlike
  // the silent re-read's toast-only conflict handling (`ConfigView.tsx#handleFileSourceResult`),
  // there is no separate refetch to race here at all.
  // ---------------------------------------------------------------------------------------------
  step('dirty Plain Profile through the real UI (Raw tab\'s unbindall checkbox)')
  await page.getByTestId('config-tab-raw').click({ timeout: TIMEOUT_MS })
  await page
    .getByText('Start the file with `unbindall`', { exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-tab-unsaved')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('edit the canonical file on disk again, a second outside edit')
  const marker2 = `// q2l_flow_external_edit_conflict_${RUN_SUFFIX}`
  const edited2 = `${edited1}${marker2}\n`
  writeFileSync(canonicalPath, edited2, 'latin1')

  step('click Save - hits the changedOnDisk guard and opens the conflict dialog (AC2)')
  await page.getByTestId('config-save').click({ timeout: TIMEOUT_MS })
  const conflictDialog = page.getByTestId('config-conflict-dialog')
  await conflictDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('conflict-dialog-shown')

  step('click "take the file" - adopts the on-disk version, discarding the unbindall toggle')
  await page.getByTestId('config-conflict-take-file').click({ timeout: TIMEOUT_MS })
  await conflictDialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step("assert BOTH installations' copies now hold the second edit's bytes (AC2)")
  for (const installId of [INSTALL_ONE_ID, INSTALL_TWO_ID]) {
    await waitForFileContent(
      installationConfigFilePath(installId, PLAIN_PROFILE_FILE_NAME),
      edited2,
      TIMEOUT_MS,
    )
  }
  assertCopiesMatch(edited2, 'take the file')

  step('assert the canonical file was not re-rendered by this cascade either')
  const canonicalAfter2 = readFileSync(canonicalPath, 'latin1')
  if (canonicalAfter2 !== edited2) {
    throw new Error(
      'expected the canonical file to still hold exactly the hand-edited bytes after the "take the ' +
        'file" cascade - it was re-rendered instead',
    )
  }
  await shot('care-take-file-adopted')
}
