// Live smoke test for story 055 (docs/requirements/055-drop-alias-is-a-drop-with-two-toggles.md),
// updated from story 029's original checkbox-driven version: a weapon-drop row's two options -
// "drop ammo too" and "announce to team" - are now `DropToggles` icon toggle buttons
// (`aria-pressed`, tooltip, `IconButton`), not the two text-labelled `Checkbox`es this flow used to
// drive. Toggling the message button on reveals the same inline row under the catalogue row with a
// placeholder (or the stored text) and an Edit button that opens the rich `MessageEditor` modal (no
// key capture); toggling it back off hides the row again and clears the stored message.
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-controls     ConfigView.tsx (`{ id: 'controls', label: t('config.tabs.controls') }`)
//   role=button "Weapon dropping"  the Drops category chip in the category rail
//                           (`config.controls.categories.drops`, ControlsTab.tsx's rail)
//   drop-ammo-<catalogId>    ControlsTab.tsx's `renderDropToggles` - wraps the ammo `IconButton`
//                            (`DropToggles.tsx`'s `ammoTestId`)
//   drop-message-<catalogId> ControlsTab.tsx's `renderDropToggles` - wraps the message `IconButton`
//                            (`DropToggles.tsx`'s `messageTestId`)
//   drop-message-row-<catalogId>   ControlsTab.tsx - wraps the inline sub-row
//   drop-message-edit-<catalogId>  ControlsTab.tsx - the sub-row's Edit button
//   role=dialog               src/renderer/src/components/ui/Modal.tsx:101 (MessageEditor)
//
// Story 055 D5 notes:
// - `renderDropToggles` keys these two testids off the row's `catalogId` (falling back to
//   `action.id` only for a plain, non-catalogue drop alias) - the same fallback
//   `drop-message-row-`/`drop-message-edit-` already used. A catalogue-mirror action minted by the
//   runtime migration (`migrateCatalogActions`, `src/main/services/migrations.ts`) gets a fresh
//   `randomUUID()` for its own `id` on every reseed, so a flow script can never hardcode it, while
//   `catalogId` (e.g. `dropWeapon:railgun`) is a stable literal built by `makeCatalogId`. This flow
//   used to hardcode `action.id` and broke immediately - fixed as part of this same deliverable.
// - The row driven here is Railgun (`dropWeapon:railgun`), not Shotgun as story 029's original did:
//   `isDropEntry` (the new gate replacing `row.categoryId === 'drops'`) requires an actual
//   `drop <item>` command in the action's own body, and a never-touched catalogue row like Shotgun
//   still has `commands: []` until the user binds a key or otherwise materialises it - so it shows
//   no toggles at all yet. Railgun is the `fixture-action-drop-message` fixture action
//   (scripts/lib/fixture.mjs), seeded with a real `drop railgun` command plus a stored `say`
//   message, so it already qualifies and its toggles render unconditionally; it has ammo (`slugs`,
//   action-catalog.ts), so the ammo toggle is enabled too. The message toggle starts pressed (a
//   message is already stored) - the reverse of story 029's fresh-shotgun start state - so this flow
//   exercises "off, on again (now empty, placeholder shows)" instead of "on from scratch".
// - Clicking a toggle updates `aria-pressed` on the next React render, not synchronously within the
//   same task as the click - reading the attribute immediately after `.click()` can still observe
//   the pre-click value. `waitForPressed()` polls instead of reading once.
// - This flow reads/mutates the `populated` fixture's on-disk userData without reseeding it first
//   (`ui:flow`, unlike `ui:verify`/`ui:shot`/`ui:a11y`, never reseeds - see docs/UI-VERIFICATION.md),
//   so it has to end where it started or its own opening assertion would fail on the second run
//   (story 055 review, finding 6 - story 029's checkbox version was start-to-end-to-start, and the
//   toggle rewrite lost that). The final two steps put both toggles back: ammo off, and the message
//   back on carrying the fixture's own text and channel, captured off the inline row before
//   anything is changed. No `npm run ui:seed` needed between runs.

const CATALOG_ID = 'dropWeapon:railgun'
const TIMEOUT_MS = 8_000
const TEST_MESSAGE = 'incoming!'

async function waitForPressed(page, locator, expected, label) {
  const deadline = Date.now() + TIMEOUT_MS
  let current
  for (;;) {
    current = await locator.getAttribute('aria-pressed')
    if (current === expected) return
    if (Date.now() >= deadline) {
      throw new Error(`${label}: expected aria-pressed="${expected}", still "${current}" after ${TIMEOUT_MS}ms`)
    }
    await page.waitForTimeout(50)
  }
}

export default async function dropMessageCheckbox({ page, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  step('select profile')
  await page.getByTestId('config-profile-row').first().click({ timeout: TIMEOUT_MS })

  step('open controls tab')
  await page.getByTestId('config-tab-controls').click({ timeout: TIMEOUT_MS })

  step('select drops category')
  await page.getByRole('button', { name: 'Weapon dropping' }).click({ timeout: TIMEOUT_MS })

  const ammoToggle = page.getByTestId(`drop-ammo-${CATALOG_ID}`).getByRole('button')
  const messageToggle = page.getByTestId(`drop-message-${CATALOG_ID}`).getByRole('button')

  step('locate railgun drop row')
  await ammoToggle.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await messageToggle.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert initial toggle state (ammo off, message on)')
  await waitForPressed(page, ammoToggle, 'false', 'ammo toggle (expected unpressed - fixture carries no ammo command)')
  await waitForPressed(page, messageToggle, 'true', 'message toggle (expected pressed - fixture carries a stored message)')

  const subRow = page.getByTestId(`drop-message-row-${CATALOG_ID}`)
  await subRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // The stored message this run starts from, so the last step can put it back verbatim and leave
  // the fixture exactly as it was found (see the idempotency note above). The message toggle was
  // just asserted pressed on a freshly mounted tab, which - `renderDropToggles`'s `messageOn` being
  // "stored text OR just revealed", and nothing revealed yet - means this is real stored text, not
  // the placeholder.
  const initialMessage = (await subRow.locator('span').first().innerText()).trim()

  await shot('before-check')

  // Finding 6/7: everything between capturing `initialMessage` above and the restore below has to run
  // inside a `try`, with the restore itself moved into `finally` - otherwise a thrown assertion
  // partway through (this flow's whole point is to assert things) skips the restore and leaves the
  // fixture's stored message permanently mutated, breaking the NEXT run's own opening-state
  // assertion (the same failure mode the restore was added to fix, just one step earlier in the
  // chain).
  const dialog = page.getByRole('dialog')
  const editButton = page.getByTestId(`drop-message-edit-${CATALOG_ID}`)

  try {
    step('turn message toggle off (clears stored message)')
    await messageToggle.click({ timeout: TIMEOUT_MS })

    step('assert message toggle unpressed and inline row hidden')
    await waitForPressed(page, messageToggle, 'false', 'message toggle after turning off')
    await subRow.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

    await shot('message-row-hidden')

    step('turn message toggle on again')
    await messageToggle.click({ timeout: TIMEOUT_MS })

    step('assert message toggle pressed')
    await waitForPressed(page, messageToggle, 'true', 'message toggle after turning back on')

    step('assert inline message row revealed with placeholder')
    await subRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const placeholderVisible = await subRow.getByText('No message set yet').isVisible()
    if (!placeholderVisible) {
      throw new Error('inline message row revealed but placeholder text "No message set yet" is not visible')
    }

    await shot('message-row-revealed')

    step('open message editor')
    await editButton.click({ timeout: TIMEOUT_MS })

    step('assert message editor dialog open')
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

    step('turn message toggle off')
    await messageToggle.click({ timeout: TIMEOUT_MS })

    step('assert message toggle unpressed and inline row hidden')
    await waitForPressed(page, messageToggle, 'false', 'message toggle after final turn-off')
    await subRow.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

    await shot('message-row-hidden-final')

    step('regression: toggle ammo on and off (ends back at its starting position)')
    await ammoToggle.click({ timeout: TIMEOUT_MS })
    await waitForPressed(page, ammoToggle, 'true', 'ammo toggle after turning on')
    await ammoToggle.click({ timeout: TIMEOUT_MS })
    await waitForPressed(page, ammoToggle, 'false', 'ammo toggle after turning back off')
  } finally {
    // Finding 6: restore the one thing this flow ends up having changed - the stored message - so a
    // second run meets the same starting state its first assertion demands. Channel `say` is what the
    // fixture seeds this row with (`scripts/lib/fixture.mjs`, `fixture-action-drop-message`); the
    // editor defaults a fresh message to `say_team`, so it has to be set back explicitly. Runs even
    // if a step above threw, so the fixture is never left mutated for the next run.
    step('restore the fixture message (re-runnable without reseeding)')
    // The toggle may already be back on (a throw after the last turn-off step above never happened)
    // or off (a throw anywhere earlier left it in whatever state that step's own body put it in) -
    // read the current state rather than assuming, and only click it on when it is not already.
    const pressed = await messageToggle.getAttribute('aria-pressed').catch(() => null)
    if (pressed !== 'true') {
      await messageToggle.click({ timeout: TIMEOUT_MS })
      await waitForPressed(page, messageToggle, 'true', 'message toggle while restoring')
    }
    await subRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await editButton.click({ timeout: TIMEOUT_MS })
    await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await dialog.getByTestId('message-editor-channel').selectOption('say', { timeout: TIMEOUT_MS })
    await dialog.locator('input').first().fill(initialMessage, { timeout: TIMEOUT_MS })
    await dialog.getByRole('button', { name: 'Save' }).click({ timeout: TIMEOUT_MS })
    await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

    step('assert the starting state is back (ammo off, message on with its original text)')
    await waitForPressed(page, ammoToggle, 'false', 'ammo toggle at end of flow')
    await waitForPressed(page, messageToggle, 'true', 'message toggle at end of flow')
    await subRow.getByText(initialMessage).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
}
