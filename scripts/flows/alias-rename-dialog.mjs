// Story 039 D9/D2 live-smoke: the "Alias name" field in RenameActionDialog
// (ControlsTab.tsx) and the validation it wires to (alias-names.ts). This flow
// specifically exercises the two review-fix bugs found and fixed on this
// story: the `tooLong` reason being unreachable through the UI (the input had
// `maxLength={MAX_OWN_ALIAS_NAME_LENGTH}`, so a user could never even type a
// too-long name) and the field's live validation/submit-disable/persist path
// in general. A static screenshot cannot tell any of this apart from a dead
// input - this flow types into the real field and reads the real DOM state.
const CLICK_TIMEOUT_MS = 8_000

export default async function aliasRenameDialog({ page, shot, step }) {
  step('open Config > Plain Profile > Controls')
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })
  await page.getByTestId('config-profile-row').filter({ hasText: 'Plain Profile' }).first().click({
    timeout: CLICK_TIMEOUT_MS,
  })
  await page.getByTestId('config-tab-controls').click({ timeout: CLICK_TIMEOUT_MS })

  step('add custom action "Alias Flow Test"')
  await page.getByRole('button', { name: 'Add action' }).click({ timeout: CLICK_TIMEOUT_MS })
  await page
    .getByRole('dialog')
    .locator('input[type="text"], input:not([type])')
    .first()
    .fill('Alias Flow Test')
  await page.getByRole('button', { name: 'Create action' }).click({ timeout: CLICK_TIMEOUT_MS })

  step('open its rename dialog')
  const row = page.locator('.ctrl-row', { hasText: 'Alias Flow Test' }).first()
  await row.waitFor({ timeout: CLICK_TIMEOUT_MS })
  await row.getByRole('button', { name: 'Rename…' }).click({ timeout: CLICK_TIMEOUT_MS })
  const dialog = page.getByRole('dialog').filter({ hasText: 'Rename action' })
  await dialog.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })

  const aliasInput = dialog.getByLabel('Alias name')
  const saveButton = dialog.getByRole('button', { name: 'Save' })

  step('assert placeholder is the derived slug')
  const placeholder = await aliasInput.getAttribute('placeholder')
  if (placeholder !== 'alias_flow_test') {
    throw new Error(`expected placeholder "alias_flow_test", got "${placeholder}"`)
  }

  step('reserved name is rejected with a reason, Save disabled')
  await aliasInput.fill('weapnext')
  await dialog.getByText('already a built-in command or cvar').waitFor({ timeout: CLICK_TIMEOUT_MS })
  if (await saveButton.isEnabled()) throw new Error('Save should be disabled for a reserved alias name')

  step('a too-long name is actually typeable and rejected with a reason (review fix)')
  const tooLong = 'a'.repeat(40)
  await aliasInput.fill(tooLong)
  const typed = await aliasInput.inputValue()
  if (typed.length !== 40) {
    throw new Error(
      `input silently truncated a too-long name to ${typed.length} chars - the tooLong reason can never fire`,
    )
  }
  await dialog.getByText('an alias name can be at most').waitFor({ timeout: CLICK_TIMEOUT_MS })
  if (await saveButton.isEnabled()) throw new Error('Save should be disabled for a too-long alias name')

  step('illegal characters are rejected with a reason, Save disabled')
  await aliasInput.fill('SSG SG')
  await dialog.getByText('lowercase letters, numbers and underscores').waitFor({ timeout: CLICK_TIMEOUT_MS })
  if (await saveButton.isEnabled()) throw new Error('Save should be disabled for illegal characters')

  await shot('alias-name-rejected')

  step('a legal own name clears the error and enables Save')
  await aliasInput.fill('flow_alias_ok')
  await saveButton.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  if (!(await saveButton.isEnabled())) throw new Error('Save should be enabled for a legal alias name')
  await saveButton.click({ timeout: CLICK_TIMEOUT_MS })
  await dialog.waitFor({ state: 'hidden', timeout: CLICK_TIMEOUT_MS })

  step('reopening the dialog shows the persisted own name, not the placeholder')
  await row.getByRole('button', { name: 'Rename…' }).click({ timeout: CLICK_TIMEOUT_MS })
  await dialog.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  const persisted = await aliasInput.inputValue()
  if (persisted !== 'flow_alias_ok') {
    throw new Error(`expected the alias name to persist as "flow_alias_ok", got "${persisted}"`)
  }
  await page.getByRole('button', { name: 'Cancel' }).click({ timeout: CLICK_TIMEOUT_MS })

  await shot('alias-name-persisted')
}
