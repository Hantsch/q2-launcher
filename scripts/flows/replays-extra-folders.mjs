// Story 142 (docs/requirements/142-i-add-my-own-demo-folders.md) D5: the story's own end-to-end
// proof. D1-D4 (already applied to the tree, not yet committed) built the extra-demo-folder list:
// the `replays.extraFolders` state key (`src/main/lib/schemas.ts`), the `extraFolders.list/add/
// remove` handlers (`src/main/modules/replays/extra-folders.ts` + `index.ts`), scan support in
// `discoverDemos` (`src/main/modules/replays/discovery.ts`) and the Settings-section UI
// (`src/renderer/src/modules/replays/ReplaysSettingsSection.tsx`).
//
// Mirrors `scripts/flows/servers-master-sources.mjs`'s structure, including its AC3 restart phase
// (a second, independent `withApp()` call over a fresh userData directory seeded with nothing but a
// copy of phase 1's own `state.json`), and `scripts/flows/bootstrap-existing-folder-demo.mjs`'s
// `Q2L_UI_PICK_FOLDER` stubbing via a flow-level `setup()` (`installations:pickFolder` answers with
// this path instead of opening a native OS dialog - the one renderer-supplied path CLAUDE.md's own
// exception covers, gated on `Q2L_UI_HARNESS==='1' && isDev`).
//
// Selectors - read `ReplaysSettingsSection.tsx`/`ReplaysView.tsx` before changing any of these:
//   nav-settings                     TitleBar.tsx
//   settings-section-replays         SettingsView.tsx - the shell's own Panel wrapper
//   replays-extra-folders-add        ReplaysSettingsSection.tsx - the "Add folder" button
//   replays-extra-folder-row         ReplaysSettingsSection.tsx - one listed folder
//   replays-extra-folder-remove      ReplaysSettingsSection.tsx - a row's own remove IconButton
//   replays-extra-folders-error      ReplaysSettingsSection.tsx - the rendered refusal reason
//   nav-replays                      TitleBar.tsx - the Demos nav entry
//   replays-demo-row / -name / -source  ReplaysView.tsx
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../lib/paths.mjs'
import { variantUserDataDir, withApp } from '../lib/harness.mjs'
import { replaysExtraFolderFixturePath } from '../lib/fixture.mjs'
import { waitForStateJson } from '../lib/state-json.mjs'
import { waitForDemosScanToFinish } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

export async function setup() {
  return {
    env: {
      Q2L_UI_PICK_FOLDER: replaysExtraFolderFixturePath(),
    },
  }
}

function foldersList(page) {
  return page.locator('[data-testid="replays-extra-folder-row"]')
}

function rowForPath(page, path) {
  return foldersList(page).filter({ hasText: path })
}

async function openReplaysSettings(page) {
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  const section = page.getByTestId('settings-section-replays')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await section.getByTestId('replays-extra-folders-add').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
}

async function openDemosView(page) {
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByRole('heading', { name: 'Demos', exact: true }).waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  await waitForDemosScanToFinish(page)
}

export default async function replaysExtraFolders({ page, shot, step, variant }) {
  const userDataDir = variantUserDataDir(variant)
  const extraFolder = replaysExtraFolderFixturePath()

  step('open Settings, reach the replays section, and add the extra folder (AC1)')
  await openReplaysSettings(page)
  await page.getByTestId('replays-extra-folders-add').click({ timeout: TIMEOUT_MS })
  await rowForPath(page, extraFolder).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('replays-extra-folder-added')

  step('the Demos view lists both files under the extra-folder source, and no decoys (AC2)')
  await openDemosView(page)
  const expectedSourceText = `extra folder: ${extraFolder}`
  for (const fileName of ['a.dm2', 'B.MVD2']) {
    const row = page.locator('[data-testid="replays-demo-row"]').filter({ hasText: fileName })
    await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const sourceText = await row.getByTestId('replays-demo-source').innerText()
    if (sourceText !== expectedSourceText) {
      throw new Error(
        `expected ${fileName}'s source to read ${JSON.stringify(expectedSourceText)}, got ${JSON.stringify(sourceText)}`,
      )
    }
  }
  const names = await page.getByTestId('replays-demo-name').allInnerTexts()
  for (const decoy of ['deep.dm2', 'a.dm2.json']) {
    if (names.some((name) => name.includes(decoy))) {
      throw new Error(`expected ${decoy} to never appear in the Demos list - it is a decoy (AC2)`)
    }
  }
  await shot('replays-demos-with-extra-folder')

  step('the extra-folder row survives a restart (AC3)')
  const restartVariant = `${variant}-extra-folders-restart`
  const restartUserDataDir = variantUserDataDir(restartVariant)
  mkdirSync(restartUserDataDir, { recursive: true })
  await waitForStateJson(
    userDataDir,
    (doc) => doc.replays?.extraFolders?.some((row) => row.path === extraFolder),
    'the extra folder in replays.extraFolders',
  )
  copyFileSync(join(userDataDir, 'state.json'), join(restartUserDataDir, 'state.json'))

  await withApp(
    { variant: restartVariant, viewport: { width: 1280, height: 800 } },
    async ({ page: secondPage }) => {
      await openReplaysSettings(secondPage)
      await rowForPath(secondPage, extraFolder).waitFor({
        state: 'visible',
        timeout: TIMEOUT_MS,
      })
      await secondPage.screenshot({
        path: join(
          REPO_ROOT,
          '.ui-verify',
          'screenshots',
          'flows',
          'replays-extra-folders-restarted.png',
        ),
      })
    },
  )

  step('re-adding the same folder is refused, and the Demos view still shows each file once (AC4)')
  // The first window is still on the Demos view from AC2; the add button lives in Settings.
  await openReplaysSettings(page)
  await rowForPath(page, extraFolder).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-extra-folders-add').click({ timeout: TIMEOUT_MS })
  const errorText = page.getByTestId('replays-extra-folders-error')
  await errorText.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await foldersList(page).count()) !== 1) {
    throw new Error(
      're-adding the same folder produced a second row - expected the add to be refused',
    )
  }
  await shot('replays-extra-folder-duplicate-refused')

  await openDemosView(page)
  for (const fileName of ['a.dm2', 'B.MVD2']) {
    const count = await page
      .locator('[data-testid="replays-demo-row"]')
      .filter({ hasText: fileName })
      .count()
    if (count !== 1) {
      throw new Error(
        `expected ${fileName} to appear exactly once after the refused re-add, got ${count}`,
      )
    }
  }

  step('removing the row hides the demos from the list without touching the files on disk (AC5)')
  await openReplaysSettings(page)
  await rowForPath(page, extraFolder).getByTestId('replays-extra-folder-remove').click({
    timeout: TIMEOUT_MS,
  })
  await rowForPath(page, extraFolder).waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  await openDemosView(page)
  for (const fileName of ['a.dm2', 'B.MVD2']) {
    const count = await page
      .locator('[data-testid="replays-demo-row"]')
      .filter({ hasText: fileName })
      .count()
    if (count !== 0) {
      throw new Error(
        `expected ${fileName} to be gone from the Demos list after removing its folder`,
      )
    }
  }
  await shot('replays-extra-folder-removed')

  if (!existsSync(extraFolder)) {
    throw new Error(
      `expected the fixture folder ${extraFolder} to still exist on disk after removal`,
    )
  }
  const filesOnDisk = readdirSync(extraFolder)
  for (const fileName of ['a.dm2', 'B.MVD2']) {
    if (!filesOnDisk.includes(fileName)) {
      throw new Error(
        `expected ${fileName} to still be present on disk under ${extraFolder} after removal`,
      )
    }
  }

  // No revert needed for a second run without a reseed: the row was never part of the seeded
  // `populated` fixture (`writePopulatedFixture()` writes this folder's files but never adds it to
  // `replaysState().extraFolders`), and this flow always ends with the row removed again - the same
  // starting shape a fresh seed would produce.
}
