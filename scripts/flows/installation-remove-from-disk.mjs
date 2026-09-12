// Story 094 (docs/requirements/094-an-installation-can-be-removed-from-disk.md) D4: the story's
// offline end-to-end proof - "removing an installation offers a choice between entry-only removal
// and removal from disk, the disk path is shown before anything happens, and a store-managed
// installation never gets that choice at all." No network access anywhere in this flow, and none
// was ever needed for this story: `deleteInstallationFolder` (D1) is a plain, local `fs.rm`, so
// unlike `retail-upgrade.mjs`/`repair.mjs` this flow needs no fixture HTTP server, no harness env
// override and no `Q2L_UI_HARNESS_STORE_SOURCES` juggling - just two additive fixture installations
// and the real dialog (D3).
//
// Covers, in one app session:
//   AC1 - a non-store installation's remove dialog offers both `remove-dialog-entry-only-option`
//         and `remove-dialog-disk-option`.
//   AC2 - choosing removal from disk shows `remove-dialog-disk-confirm-step` naming the exact
//         `rootPath`, before anything is deleted (the folder is still on disk at this point).
//   AC3 - confirming deletes the installation's own folder and everything inside it, and nothing
//         outside it: the sibling sentinel `writePopulatedFixture()` writes next to (not inside)
//         `INSTALL_REMOVE_DISK_ID`'s root survives, byte-for-byte.
//   AC4 - the steam-managed installation's dialog shows `remove-dialog-store-note` and has ZERO
//         `remove-dialog-disk-option` nodes in the DOM (not merely hidden); its own entry-only
//         removal is exercised end to end too, which doubles as this story's own regression proof
//         that the pre-094 removal path (`deleteFromDisk` absent) still works.
//   AC5 - with the game simulated as running (`dev:simulateLaunch`), `remove-dialog-disk-option` is
//         `disabled` and carries a non-empty `title` (the disabled reason) - the UI-side half of
//         AC5; the server-side refusal is already covered by `installations.test.ts`.
//   AC6 - after removal from disk, the installation is gone from the library and the rail. Neither
//         dashboard tile (`ConfigProfilesTile`/`PlaytimeTile`, `src/renderer/src/modules/home/
//         dashboard/`) names a specific installation - both are aggregate/summary tiles - so there
//         is no dashboard surface this flow can additionally check; library+rail is this story's
//         whole per-installation surface.
//
// ## The two fixture installations, and why AC5 reuses one instead of a third
//
// `scripts/lib/fixture.mjs`'s `populatedInstallations()` gains two additive installations (last
// `sortOrder`s, assigned to no config profile - the convention every fixture since 090 documents):
// `INSTALL_REMOVE_STORE_ID` (`source: 'steam'`, AC4's store-managed case) and
// `INSTALL_REMOVE_DISK_ID` (`source: 'manual'`, the one this flow actually deletes). Both are plain,
// playable fixtures - no special `checks`/`status` seeding needed, since this story's dialog only
// ever reads `installation.source`/`rootPath`/the live launch state, never the validation checks.
//
// AC5 needs an installation that is BOTH non-store and simulated running. Rather than a third
// fixture install, this flow reorders its own steps (per the deliverable's own plan): it simulates
// `INSTALL_REMOVE_DISK_ID` as running FIRST, opens the dialog and asserts the disk option's
// disabled state and reason, closes the dialog, restores `idle`, and only THEN proceeds with the
// real AC1-AC3 walk-through that ends in that same installation's folder actually being deleted.
//
// `writePopulatedFixture()` also writes a sentinel file at `installRemoveDiskSiblingSentinelPath()`
// - a directory named `<INSTALL_REMOVE_DISK_ID>-sibling`, next to (never inside)
// `INSTALL_REMOVE_DISK_ID`'s own root - so AC3's "nothing outside that folder is touched" has a
// concrete file to prove survives.
//
// ## Selectors
//
// Everything inside the dialog is D3's own real `data-testid`s (see
// `src/renderer/src/components/installations/RemoveInstallationDialog.tsx`):
//   remove-dialog-entry-only-option / remove-dialog-disk-option    the two-outcome chooser
//   remove-dialog-disk-confirm-step / remove-dialog-disk-path      the disk confirm step (AC2)
//   remove-dialog-delete-folder-confirm                            the footer's danger button, only
//                                                                    present once the disk step shows
//   remove-dialog-store-note                                       AC4's store-managed note
// The trigger itself (`LibraryView.tsx`) carries `installation-remove-${installation.id}` - a
// removable installation always opens the dialog (default `confirmBeforeRemoving: true`), so this
// flow never has to touch that setting.
import { existsSync, readFileSync } from 'node:fs'
import {
  INSTALL_REMOVE_DISK_ID,
  INSTALL_REMOVE_DISK_NAME,
  INSTALL_REMOVE_DISK_SIBLING_SENTINEL_CONTENT,
  INSTALL_REMOVE_STORE_ID,
  INSTALL_REMOVE_STORE_NAME,
  installRemoveDiskSiblingSentinelPath,
  installationRootPath,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

export async function setup() {
  writePopulatedFixture()
  return {}
}

/** The library row's own wrapper - mirrors `retail-upgrade.mjs`'s own `libraryCard()`. */
function libraryCard(page, name) {
  return page
    .locator('div.items-start')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

/** Scopes the rail's own tile lookup to `<aside>` - mirrors `retail-upgrade.mjs`'s `railTile()`. */
function railTile(page, name) {
  return page.locator('aside').getByRole('button', { name, exact: true })
}

/** Verbatim from `retail-upgrade.mjs`/`repair.mjs` - the dev-only channel that flips an
 * installation's simulated launch phase without a real game process. */
async function simulateLaunch(page, installationId, phase) {
  const outcome = await page.evaluate(
    ({ id, ph }) => window.q2.invoke('dev:simulateLaunch', { installationId: id, phase: ph }),
    { id: installationId, ph: phase },
  )
  if (!outcome?.ok) {
    throw new Error(`dev:simulateLaunch(${phase}) failed: ${JSON.stringify(outcome)}`)
  }
}

/** Opens `installationId`'s remove dialog from its library-row trigger and waits for it to render. */
async function openRemoveDialog(page, installationId) {
  await page.getByTestId(`installation-remove-${installationId}`).click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return dialog
}

async function closeDialog(page) {
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
}

export default async function installationRemoveFromDisk({ page, shot, step }) {
  const diskRoot = installationRootPath(INSTALL_REMOVE_DISK_ID)
  const sentinelPath = installRemoveDiskSiblingSentinelPath()

  step('open the library')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await libraryCard(page, INSTALL_REMOVE_DISK_NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // ================================================================================================
  // AC5 - the running-game refusal, run FIRST against INSTALL_REMOVE_DISK_ID (reused rather than a
  // third fixture install - see this file's own header comment for why).
  // ================================================================================================
  step('AC5: simulate the game running, then open the remove dialog')
  await simulateLaunch(page, INSTALL_REMOVE_DISK_ID, 'running')
  let dialog = await openRemoveDialog(page, INSTALL_REMOVE_DISK_ID)
  const diskOptionWhileRunning = dialog.getByTestId('remove-dialog-disk-option')
  await diskOptionWhileRunning.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC5: the disk option is disabled, with a non-empty reason, while the game runs')
  if (!(await diskOptionWhileRunning.isDisabled())) {
    throw new Error('expected remove-dialog-disk-option to be disabled while the game is running (AC5)')
  }
  const disabledReason = await diskOptionWhileRunning.getAttribute('title')
  if (!disabledReason) {
    throw new Error('expected remove-dialog-disk-option to carry a non-empty disabled reason (AC5)')
  }
  await shot('disk-option-disabled-while-running')
  await closeDialog(page)

  step('restore idle so the rest of the run exercises the ordinary, not-running removal')
  await simulateLaunch(page, INSTALL_REMOVE_DISK_ID, 'idle')

  // ================================================================================================
  // AC1 - both outcomes offered for a non-store installation.
  // ================================================================================================
  step('AC1: reopen the remove dialog and assert both outcomes are offered')
  dialog = await openRemoveDialog(page, INSTALL_REMOVE_DISK_ID)
  await dialog.getByTestId('remove-dialog-entry-only-option').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await dialog.getByTestId('remove-dialog-disk-option').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('dialog-both-options')

  // ================================================================================================
  // AC2 - choosing removal from disk shows the exact path; nothing has happened yet.
  // ================================================================================================
  step('AC2: choose removal from disk and assert the confirm step names the exact path')
  await dialog.getByTestId('remove-dialog-disk-option').click({ timeout: TIMEOUT_MS })
  await dialog.getByTestId('remove-dialog-disk-confirm-step').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const shownPath = await dialog.getByTestId('remove-dialog-disk-path').innerText()
  if (shownPath !== diskRoot) {
    throw new Error(`expected the disk confirm step to name ${diskRoot} (AC2), got ${JSON.stringify(shownPath)}`)
  }
  if (!existsSync(diskRoot)) {
    throw new Error('the installation folder is already gone before confirming - AC2 precondition violated')
  }
  await shot('disk-confirm-step-path')

  // ================================================================================================
  // AC3/AC6 - confirm, then assert the on-disk result and every surface.
  // ================================================================================================
  step('confirm deletion from disk')
  await dialog.getByTestId('remove-dialog-delete-folder-confirm').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('AC3: the installation folder is gone, and the sibling sentinel survives untouched')
  if (existsSync(diskRoot)) {
    throw new Error('expected the installation root to be deleted from disk (AC3)')
  }
  if (!existsSync(sentinelPath)) {
    throw new Error(
      'the sibling sentinel file was deleted too - AC3 requires only the installation folder to be removed',
    )
  }
  const sentinelContent = readFileSync(sentinelPath, 'utf8')
  if (sentinelContent !== INSTALL_REMOVE_DISK_SIBLING_SENTINEL_CONTENT) {
    throw new Error('the sibling sentinel file content changed during the removal (AC3)')
  }

  step('AC6: the installation is gone from the library')
  if (await libraryCard(page, INSTALL_REMOVE_DISK_NAME).count()) {
    throw new Error('expected the removed installation to be gone from the library (AC6)')
  }

  step('AC6: the installation is gone from the rail')
  if (await railTile(page, INSTALL_REMOVE_DISK_NAME).count()) {
    throw new Error('expected the removed installation to be gone from the rail (AC6)')
  }
  await shot('post-removal-library')

  // ================================================================================================
  // AC4 - a steam installation offers entry-only removal only, with the store note; confirming it
  // still works end to end (this doubles as this story's own regression proof for the pre-094 path).
  // ================================================================================================
  step('AC4: select the steam-managed installation and open its remove dialog')
  await libraryCard(page, INSTALL_REMOVE_STORE_NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  dialog = await openRemoveDialog(page, INSTALL_REMOVE_STORE_ID)

  step('AC4: the store note is shown, and there is no disk option in the DOM at all')
  await dialog.getByTestId('remove-dialog-store-note').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await dialog.getByTestId('remove-dialog-disk-option').count()) {
    throw new Error('expected zero remove-dialog-disk-option nodes for a steam installation (AC4)')
  }
  await shot('store-managed-dialog')

  step('AC4: entry-only removal still works end to end')
  await dialog.getByRole('button', { name: 'Remove from launcher' }).click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  if (await libraryCard(page, INSTALL_REMOVE_STORE_NAME).count()) {
    throw new Error('expected the steam installation to be gone from the library after entry-only removal (AC4)')
  }
  if (!existsSync(installationRootPath(INSTALL_REMOVE_STORE_ID))) {
    throw new Error('entry-only removal deleted files from disk - it must only drop the library entry (AC4)')
  }
  await shot('store-managed-removed-entry-only')

  console.log(
    'installation-remove-from-disk: a non-store installation offered both outcomes, choosing removal ' +
      "from disk named the exact path before anything happened, confirming deleted the installation's " +
      'folder while a sibling sentinel survived untouched and the installation vanished from the ' +
      'library and the rail, a steam installation showed the store note with no disk option at all ' +
      '(and its own entry-only removal still worked end to end), and with the game simulated as ' +
      'running the disk option was disabled with a readable reason.',
  )
}
