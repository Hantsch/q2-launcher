// Story 056 D5 ui:flow: adds a third key to a row through the real UI and clears its primary,
// asserting the second key it added is promoted into the Key column (AC 5/9). Mirrors
// `scripts/flows/open-keycap-dialog.mjs`'s structure and `scripts/flows/custom-action-row.mjs`'s
// low-level `.ctrl-row`/`data-row-id` locator + `row.evaluate()`/thrown-`Error` assertion style.
//
// Row choice: `fixture-action-attack` (scripts/lib/fixture.mjs's populated fixture), bound to a
// single key (`MOUSE1`) with no `keys` array of its own — the simplest possible starting Key-cell
// state (slot 0 bound, the add-key affordance right beside it, no chevron). The new three-key
// "Multi Bind" fixture action (also D5) already starts folded — it exists to prove the two static
// `config-controls-extra-keys-*` screenshots in `scripts/lib/screens.mjs`, not to be driven live
// here, and driving it wouldn't demonstrate the fold transition the way starting from one key does.
// This flow drives `fixture-action-attack` through two real add-key operations (second key, then
// third) so the row's chevron only appears once the third key actually lands — visible proof of
// the fold rule, not just its end state — then clears the primary and asserts promotion.
//
// Keys used ('y', then 'u') are not bound anywhere else in the populated fixture
// (`binds`: MOUSE1/SPACE/q; other actions' `keys`: G/H/J), so assigning either can never trigger
// the collision Cancel/Replace banner instead of a plain assign.
//
// Selectors, not guesses — read ControlsTab.tsx's `renderKeyCell`/`renderExtraKeyRows` and
// ControlsRow.tsx before changing any of these:
//   .ctrl-row[data-row-id="<id>"]           ControlsRow.tsx — one row's shell
//   .ctrl-keycell .ctrl-slot                ControlsRow.tsx/ControlsTab.tsx — slot 0's BindSlot
//                                            first, then (while the group is not "open") the
//                                            add-key BindSlot at the next free index
//   .ctrl-keymore                           ControlsTab.tsx's `renderKeyCell` — the "+n" chevron,
//                                            only rendered once a row has 2+ extra keys
//   .ctrl-keysub-row[data-row-id="<id>"]    ControlsTab.tsx's `renderExtraKeyRows` — one sub-row
//                                            per extra key, plus a trailing one for the add slot
//                                            while the group is open
//
// `useKeyCapture.ts`'s handler resolves a Playwright `Delete` keypress (`event.code ===
// 'Delete'`) to the engine key name `'DEL'` via `resolveQuakeKeyName` (keyboard-layout.ts) exactly
// like every other key — `BindSlot.tsx`'s own capture handler special-cases `key === 'DEL'` to
// call `onClear()` instead of assigning "DEL" as a bound key (story 020 D5), which is what makes
// `page.keyboard.press('Delete')` clear the slot below rather than bind it.

const CLICK_TIMEOUT_MS = 8_000
const ROW_ID = 'fixture-action-attack'

export default async function controlsExtraKeys({ page, shot, step }) {
  step('open Config > Plain Profile > Controls')
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: CLICK_TIMEOUT_MS })
  await page.getByTestId('config-tab-controls').click({ timeout: CLICK_TIMEOUT_MS })

  const row = page.locator(`.ctrl-row[data-row-id="${ROW_ID}"]`)
  await row.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await row.scrollIntoViewIfNeeded()

  const subRows = () => page.locator(`.ctrl-keysub-row[data-row-id="${ROW_ID}"]`)

  step('add a second key (y)')
  // With one bound key and no extras yet, the Key cell holds exactly two `.ctrl-slot`s: slot 0
  // (bound, MOUSE1) then the add-key slot at the next free index (`renderKeyCell`'s `!isOpen`
  // branch) — `.last()` targets the add slot regardless of which one is first in DOM order.
  await row.locator('.ctrl-keycell .ctrl-slot').last().click({ timeout: CLICK_TIMEOUT_MS })
  await page.keyboard.press('y')
  // Now 2 keys total (1 extra): the fold rule always shows a single extra unfolded, so a lone
  // sub-row appears carrying the new key plus the (now-moved-here) add-key slot.
  await subRows().first().waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await shot('second-key-added')

  step('add a third key (u)')
  // The add-key slot is now the last sub-row's own `.ctrl-slot` (`renderExtraKeyRows`'s trailing
  // "key-add" row) since the group is open with exactly one extra.
  await subRows().last().locator('.ctrl-slot').click({ timeout: CLICK_TIMEOUT_MS })
  await page.keyboard.press('u')
  // Now 3 keys total (2 extras): the fold rule collapses two-plus extras by default, so the sub-
  // rows disappear and a "+2" chevron appears on the main row instead.
  await row.locator('.ctrl-keymore').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await shot('third-key-added-folded')

  step('expand the folded group')
  await row.locator('.ctrl-keymore').click({ timeout: CLICK_TIMEOUT_MS })
  await subRows().nth(1).waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await shot('third-key-added-unfolded')

  step('clear the primary key')
  // Slot 0 is always the first `.ctrl-slot` in the Key cell, bound or not.
  await row.locator('.ctrl-keycell .ctrl-slot').first().click({ timeout: CLICK_TIMEOUT_MS })
  await page.keyboard.press('Delete')

  step('assert the second key was promoted into the Key column')
  const primarySlot = row.locator('.ctrl-keycell .ctrl-slot').first()
  // The slot's accessible name carries the actual value (`BindSlot.tsx`'s `aria-label`, built from
  // `config.controls.editor.slotLabel`, "{{slot}}: {{value}}") — reading that, rather than raw text
  // content, matches exactly what a screen reader (and a human glancing at the row) would perceive
  // as "the key here now". Polled rather than read once: the clear+promote write is a real state
  // update and this must not race its re-render.
  const deadline = Date.now() + CLICK_TIMEOUT_MS
  let label = await primarySlot.getAttribute('aria-label')
  while (Date.now() < deadline && !label?.toLowerCase().includes(': y')) {
    await page.waitForTimeout(100)
    label = await primarySlot.getAttribute('aria-label')
  }
  if (!label || !label.toLowerCase().includes(': y')) {
    throw new Error(
      `expected the primary slot to show the promoted key "y" after clearing MOUSE1, got aria-label "${label}"`,
    )
  }

  await shot('primary-cleared-promoted')
}
