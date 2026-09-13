// Story 059 D10 acceptance flow: rename an existing cvar section through the real UI (D8's
// `RenameCvarSectionDialog`) and add a raw/non-catalogue cvar by name+value through the real UI
// (D8's `AddCvarDialog`) - the two live interactions the story's own D10 wording names ("a `ui:flow`
// that renames a section and adds a raw cvar through the real UI").
// Mirrors scripts/flows/controls-subcategory.mjs's shape (story 053's direct prior-art flow for the
// same kind of section/sub-section CRUD, one level up in Controls rather than Settings): launch
// against the populated fixture, drive real testids/roles, assert on real DOM state rather than
// trusting a screenshot alone.
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching
// (`scripts/flow.mjs`'s `withApp()` just opens the existing `.ui-verify/fixture/populated/userdata`
// as-is) - so a name reused across two runs in a row would find a *previous* run's already-renamed
// section/already-added cvar still on disk instead of the fixture's fresh, original state. A
// per-run suffix on both names keeps this flow idempotent regardless of what an earlier run left
// behind, same reasoning `controls-subcategory.mjs`'s own `SUBCATEGORY_NAME` gives.
const RUN_SUFFIX = Date.now().toString(36)
const SECTION_RENAME = `Renamed Settings Section ${RUN_SUFFIX}`
const RAW_CVAR_NAME = `q2l_flow_cvar_${RUN_SUFFIX}`
const RAW_CVAR_VALUE = 'flow-added-value'

export default async function settingsSectionRenameAddCvar({ page, shot, step }) {
  step('open Config > Plain Profile > Settings')
  await page.getByTestId('nav-config').click()
  await page.getByTestId('config-profile-row').filter({ hasText: 'Plain Profile' }).first().click()
  await page.getByTestId('config-tab-settings').click()

  step('wait for the fixture\'s user-named section (scripts/lib/fixture.mjs\'s "Fixture Section")')
  await page.getByText('Fixture Section', { exact: true }).waitFor({ timeout: 8000 })

  step('open the rename-section dialog')
  // No testid on the section toolbar's icon buttons (`SettingsTab.tsx`) - same convention
  // `controls-subcategory.mjs`'s category-chip click already uses - selecting by translated
  // accessible name. The fixture profile has exactly one user-owned section, so this is unambiguous.
  await page.getByRole('button', { name: 'Rename section' }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(SECTION_RENAME)
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()

  step('assert the section header now shows the renamed name')
  const header = page.getByText(SECTION_RENAME, { exact: true })
  await header.waitFor({ timeout: 8000 })
  await header.scrollIntoViewIfNeeded()
  await shot('section-renamed')

  step('open the Add-cvar dialog for the renamed section')
  await page.getByRole('button', { name: 'Add cvar' }).click()
  await page.getByRole('dialog').getByLabel('Cvar name', { exact: true }).fill(RAW_CVAR_NAME)
  await page.getByRole('dialog').getByLabel('Value', { exact: true }).fill(RAW_CVAR_VALUE)
  // Scoped to the dialog: the section toolbar's own "Add cvar" trigger button (clicked above)
  // shares the same translated accessible name as this dialog's submit button.
  await page.getByRole('dialog').getByRole('button', { name: 'Add cvar' }).click()

  step('assert the new raw cvar renders as a plain, non-catalogue row')
  const row = page.getByText(RAW_CVAR_NAME, { exact: true })
  await row.waitFor({ timeout: 8000 })
  await row.scrollIntoViewIfNeeded()
  await shot('cvar-added')
}
