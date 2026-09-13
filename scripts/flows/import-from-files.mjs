// Story 066 D8 acceptance flow: the whole "Start from" story end to end - the four options (AC1),
// both template options creating a profile (AC3), picking files through `DialogService`'s
// harness-only stub and seeing them listed in load order (AC4), reordering and removing a picked
// file (AC5), and the resulting created profile carrying the fixture's real binds/aliases (this
// D's own "accepted when": "the flow ends on a created profile carrying the fixture's binds and
// aliases"). Mirrors `care-fix-item.mjs`'s shape (real testids/roles, a `shot` per meaningful
// state) and reaches past `page` for one assertion the same way `config-care-clear`'s screens.mjs
// entry already reaches past `page` for a setup step - a real `window.q2.invoke('module:invoke', …)`
// read of the committed profile, since asserting against ~99 rendered bind rows through the DOM
// would be unreasonably brittle compared to reading the actual committed state.
//
// `variant` (passed by `scripts/flow.mjs`'s optional second CLI argument, defaulting to
// `'populated'`) decides how much of the flow runs: the full walkthrough (AC1/AC3 plus the import
// path) against `populated`, or just the import path against `empty` - proving AC9 ("import from
// files needs no installation") on a launcher with zero installations registered at all, not
// merely "this flow never happened to pick one". Run both:
//   npm run ui:flow -- import-from-files
//   npm run ui:flow -- import-from-files empty
//
// `docs/fixtures/gfx.cfg` carries ZERO `bind`/`alias` lines (`grep -c '^bind \|^alias '
// docs/fixtures/gfx.cfg` is 0 - only `set` cvars), which is exactly what makes the AC5 "remove a
// file" step safe to leave removed for the rest of this flow: dropping gfx.cfg from the final
// picked-file list changes zero binds and zero aliases, so the profile this flow creates still
// carries every one of dm.cfg's 99 binds and dmalias.cfg's 96 aliases
// (`import-fixtures.test.ts`'s `readImportableFiles` corpus test, story 066 D2) - no need to
// re-pick it, which would only mint fresh, duplicate ids anyway (`PickedFilesRegistry.register()`
// never reuses an id for the same path picked twice).
//
// Selectors, not guesses - read CreateProfileDialog.tsx / ImportProfileDialog.tsx / ConfigView.tsx
// before changing any of these:
//   nav-config                     TitleBar.tsx
//   config-create-profile          ConfigView.tsx, "New profile" button
//   config-create-source           CreateProfileDialog.tsx, the "Start from" <select>
//   config-create-submit           CreateProfileDialog.tsx, the footer submit/continue button
//   "Choose files…"                 ImportProfileDialog.tsx, no testid - own translated accessible name
//   config-import-file-row         ImportProfileDialog.tsx, one <li> per picked file, in load order
//   "Move file down" / "Remove file" ImportProfileDialog.tsx, per-row IconButtons, own accessible name
//   "Create profile"               ImportProfileDialog.tsx's own footer submit button (no testid)
//   "Back to profiles"             ConfigView.tsx (config.nav.back), the detail header's back button
//   config-profile-header          ConfigView.tsx, the detail view's header (proves a profile opened)
//
// Unlike `ui:verify`, `ui:flow` never reseeds the fixture before launching (`scripts/flow.mjs`'s
// `withApp()` opens the chosen variant's userData as-is) - a re-run needs a fresh `npm run ui:seed`
// first, the same caveat every other flow in this folder's own doc comment already gives.

const TIMEOUT_MS = 8_000

function fileRow(page, index) {
  return page.getByTestId('config-import-file-row').nth(index)
}

async function fileNameOf(page, index) {
  return fileRow(page, index).locator('p').first().innerText()
}

/** Waits for exactly `expectedNames.length` rows, then asserts each row's file name in order. */
async function assertFileOrder(page, expectedNames, label) {
  const rows = page.getByTestId('config-import-file-row')
  await rows.nth(expectedNames.length - 1).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const count = await rows.count()
  if (count !== expectedNames.length) {
    throw new Error(`${label}: expected ${expectedNames.length} file row(s), found ${count}`)
  }
  for (let index = 0; index < expectedNames.length; index += 1) {
    const actual = await fileNameOf(page, index)
    if (actual !== expectedNames[index]) {
      throw new Error(
        `${label}: expected row ${index} to be "${expectedNames[index]}", got "${actual}"`,
      )
    }
  }
}

/** Reads the full profile list straight off the module - same call `config-care-clear`'s
 * screens.mjs entry uses for its own setup step, used here for an assertion instead. */
async function listProfiles(page) {
  const outcome = await page.evaluate(() =>
    window.q2.invoke('module:invoke', { moduleId: 'config', type: 'list' }),
  )
  if (!outcome?.ok) throw new Error(`config/list failed: ${JSON.stringify(outcome)}`)
  return outcome.value
}

/** Creates one profile from `CreateProfileDialog` with a template `sourceValue`, asserts it
 * created and recorded its own handedness, then navigates back to the list (AC3). */
async function createTemplateProfile({ page, step, shot }, sourceValue, name) {
  step(`open "New profile" for ${sourceValue}`)
  await page.getByTestId('config-create-profile').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-create-source').selectOption(sourceValue)
  await page.getByPlaceholder('My profile').fill(name)

  step(`submit ${sourceValue}`)
  await page.getByTestId('config-create-submit').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-profile-header').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step(`assert ${sourceValue} created a profile carrying its own seedFrom`)
  const profiles = await listProfiles(page)
  const created = profiles.find((profile) => profile.name === name)
  if (!created) throw new Error(`no profile named "${name}" after creating from ${sourceValue}`)
  if (created.seedFrom !== sourceValue) {
    throw new Error(
      `expected "${name}".seedFrom to be "${sourceValue}", got ${JSON.stringify(created.seedFrom)}`,
    )
  }
  await shot(`created-${sourceValue}`)

  step('back to the profile list')
  await page.getByRole('button', { name: 'Back to profiles' }).click({ timeout: TIMEOUT_MS })
}

export default async function importFromFiles({ page, shot, step, variant }) {
  // AC9's own e2e proof: run just the import path against the `empty` variant (zero
  // installations registered at all) instead of the full walkthrough - see this file's own top
  // comment for the two invocations this flow is meant to be run with.
  const runFullWalkthrough = variant !== 'empty'

  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  if (runFullWalkthrough) {
    step('open "New profile" and assert the Start from select offers four options (AC1)')
    await page.getByTestId('config-create-profile').click({ timeout: TIMEOUT_MS })
    const select = page.getByTestId('config-create-source')
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.getAttribute('value')))
    const expectedValues = ['empty', 'template-right', 'template-left', 'import']
    const matches =
      values.length === expectedValues.length &&
      expectedValues.every((value, index) => values[index] === value)
    if (!matches) {
      throw new Error(
        `expected Start-from options ${JSON.stringify(expectedValues)}, got ${JSON.stringify(values)}`,
      )
    }
    await shot('four-start-from-options')

    step('close the create dialog without submitting')
    await page.keyboard.press('Escape')
    await page
      .getByTestId('config-create-profile')
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

    step('both template options create a profile (AC3)')
    await createTemplateProfile(
      { page, step, shot },
      'template-right',
      'D8 Flow Right-Handed Template',
    )
    await createTemplateProfile(
      { page, step, shot },
      'template-left',
      'D8 Flow Left-Handed Template',
    )
  }

  step('open "New profile" for import')
  await page.getByTestId('config-create-profile').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-create-source').selectOption('import')
  await page.getByTestId('config-create-submit').click({ timeout: TIMEOUT_MS })

  step('choose files - the harness stub answers, no real OS dialog ever appears (AC4)')
  await page.getByRole('button', { name: 'Choose files…' }).click({ timeout: TIMEOUT_MS })
  await assertFileOrder(page, ['dm.cfg', 'dmalias.cfg', 'gfx.cfg'], 'initial pick')
  await shot('files-picked')

  step('reorder: move dm.cfg down one row (AC5)')
  await fileRow(page, 0)
    .getByRole('button', { name: 'Move file down' })
    .click({ timeout: TIMEOUT_MS })
  await assertFileOrder(page, ['dmalias.cfg', 'dm.cfg', 'gfx.cfg'], 'after reorder')
  await shot('files-reordered')

  step("remove gfx.cfg - it carries zero binds/aliases, see this file's own top comment (AC5)")
  await fileRow(page, 2).getByRole('button', { name: 'Remove file' }).click({ timeout: TIMEOUT_MS })
  await assertFileOrder(page, ['dmalias.cfg', 'dm.cfg'], 'after remove')
  await shot('file-removed')

  const profileName = `D8 Flow Import (${variant})`
  step(`name the profile "${profileName}"`)
  await page.getByPlaceholder('My profile').fill(profileName)

  step('create the profile')
  await page.getByRole('button', { name: 'Create profile' }).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-profile-header').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step("assert the created profile carries dm.cfg's binds and dmalias.cfg's aliases")
  const profiles = await listProfiles(page)
  const created = profiles.find((profile) => profile.name === profileName)
  if (!created) throw new Error(`no profile named "${profileName}" after import`)

  const binds = created.binds ?? {}
  if (binds.ESCAPE !== 'togglemenu') {
    throw new Error(`expected binds.ESCAPE to be "togglemenu", got ${JSON.stringify(binds.ESCAPE)}`)
  }
  if (binds.RIGHTARROW !== 'exec dmalias.cfg') {
    throw new Error(
      `expected binds.RIGHTARROW to be "exec dmalias.cfg", got ${JSON.stringify(binds.RIGHTARROW)}`,
    )
  }
  // dm.cfg's 100 `^bind ` lines minus the one unparseable `bind ; ""` - gfx.cfg contributes zero
  // binds, so removing it above does not change this count from the D2 corpus test's own figure.
  if (Object.keys(binds).length !== 99) {
    throw new Error(
      `expected exactly 99 binds (dm.cfg's own count), got ${Object.keys(binds).length}`,
    )
  }

  const aliasNames = (created.actions ?? []).map((action) => action.name)
  for (const expectedAlias of ['cali', 's_ok', 'dall']) {
    if (!aliasNames.includes(expectedAlias)) {
      throw new Error(`expected the created profile's actions to include alias "${expectedAlias}"`)
    }
  }

  await shot('created-profile')
}
