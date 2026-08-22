// Live smoke test for story 029 (docs/requirements/029-drop-message-checkbox-inline-row.md):
// a weapon-drop row's message option is a "With message" checkbox mirroring "With ammo", not the
// old icon button - checking it reveals an inline row under the catalogue row with a placeholder
// and an Edit button that opens the rich `MessageEditor` modal (no key capture), and unchecking it
// hides the row again, clearing the stored message.
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-controls     ConfigView.tsx (`{ id: 'controls', label: t('config.tabs.controls') }`)
//   role=button "Weapon dropping"  the Drops category chip in the category rail
//                           (`config.controls.categories.drops`, ControlsTab.tsx's rail)
//   drop-ammo-<catalogId>    ControlsTab.tsx - added this story, wraps the "With ammo" Checkbox
//   drop-message-<catalogId> ControlsTab.tsx - added this story, wraps the "With message" Checkbox
//   drop-message-row-<catalogId>   ControlsTab.tsx - added this story, wraps the inline sub-row
//   drop-message-edit-<catalogId>  ControlsTab.tsx - added this story, the sub-row's Edit button
//   role=dialog               src/renderer/src/components/ui/Modal.tsx:101 (MessageEditor)
//
// The shotgun is the row this flow drives: it is a `WEAPONS` entry with a matching `ammo: 'shells'`
// (src/shared/config/action-catalog.ts), so its catalogue row carries both `ammoCommand` and a
// message slot - `dropRow('dropWeapon', ...)` in src/shared/config/catalog-rows.ts mints its
// `catalogId` as `dropWeapon:shotgun` (`makeCatalogId(kind, id)` = `${kind}:${id}`).

const CATALOG_ID = 'dropWeapon:shotgun'
const TIMEOUT_MS = 8_000
const TEST_MESSAGE = 'incoming!'

export default async function dropMessageCheckbox({ page, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  step('select profile')
  await page.getByTestId('config-profile-row').first().click({ timeout: TIMEOUT_MS })

  step('open controls tab')
  await page.getByTestId('config-tab-controls').click({ timeout: TIMEOUT_MS })

  step('select drops category')
  await page.getByRole('button', { name: 'Weapon dropping' }).click({ timeout: TIMEOUT_MS })

  const ammoCheckboxScope = page.getByTestId(`drop-ammo-${CATALOG_ID}`)
  const messageCheckboxScope = page.getByTestId(`drop-message-${CATALOG_ID}`)
  // `Checkbox` (src/renderer/src/components/ui/controls.tsx) renders a real `<input>` marked
  // `sr-only` plus a styled `<span>` sibling inside one `<label>` - clicking the hidden input
  // directly gets pointer-event-intercepted by that visible sibling, so click the `<label>`
  // itself (native checkbox toggling on a label click) instead.
  const ammoCheckbox = ammoCheckboxScope.locator('label')
  const messageCheckbox = messageCheckboxScope.locator('label')

  step('locate shotgun drop row')
  await ammoCheckboxScope.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await messageCheckboxScope.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('before-check')

  step('check with message')
  await messageCheckbox.click({ timeout: TIMEOUT_MS })

  step('assert inline message row revealed')
  const subRow = page.getByTestId(`drop-message-row-${CATALOG_ID}`)
  await subRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const placeholderVisible = await subRow.getByText('No message set yet').isVisible()
  if (!placeholderVisible) {
    throw new Error('inline message row revealed but placeholder text "No message set yet" is not visible')
  }

  await shot('message-row-revealed')

  step('open message editor')
  const editButton = page.getByTestId(`drop-message-edit-${CATALOG_ID}`)
  await editButton.click({ timeout: TIMEOUT_MS })

  step('assert message editor dialog open')
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert no key-capture block in dialog')
  const keyCaptureVisible = await dialog.getByText('Capture key').isVisible().catch(() => false)
  if (keyCaptureVisible) {
    throw new Error(
      'MessageEditor opened from a drop row shows a "Capture key" control - showKeyCapture should be false for drop rows',
    )
  }

  await shot('message-editor-open')

  step('type message text and save')
  const textInput = dialog.locator('input').first()
  await textInput.fill(TEST_MESSAGE, { timeout: TIMEOUT_MS })
  await dialog.getByRole('button', { name: 'Save' }).click({ timeout: TIMEOUT_MS })

  step('assert dialog closed and inline row shows saved text')
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  await subRow.getByText(TEST_MESSAGE).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('message-saved')

  step('uncheck with message')
  await messageCheckbox.click({ timeout: TIMEOUT_MS })

  step('assert inline message row hidden')
  await subRow.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  await shot('message-row-hidden')

  step('regression: toggle with ammo')
  await ammoCheckbox.click({ timeout: TIMEOUT_MS })
  await ammoCheckbox.click({ timeout: TIMEOUT_MS })
}
