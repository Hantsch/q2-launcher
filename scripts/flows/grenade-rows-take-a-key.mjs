// Story 063 D5 ui:flow: proves the D1-D4 fix on the real Controls surface. Two keyless
// `kind: 'alias'` Weapons rows seeded by `scripts/lib/fixture.mjs`'s populated ("plain") profile -
// `fixture-action-inert-grenades` (`use grenades`) and `fixture-action-inert-glauncher` (the
// two-word `use grenade launcher`, the interesting one since D1-D3's bug was in how a multi-word
// alias body got misread as `kind: 'alias'` on file->state round trip) - render inert (no capture,
// `[-]`-equivalent placeholder cell, `BindSlot.tsx`'s `BindSlotPlaceholder`,
// `.ctrl-slot.is-inert`) until D4's row-menu "Make bindable" action
// (`config.controls.actions.makeBindable`, `ControlsRowMenu.tsx`) converts the row's `kind` from
// `'alias'` to `'bind'` in place. This flow drives that conversion through the real menu for both
// rows, then captures a real key on each newly-live slot and asserts the capture actually landed -
// mirrors `scripts/flows/controls-extra-keys.mjs`'s row-locator/key-capture/aria-label-polling
// style and `scripts/flows/custom-action-row.mjs`'s low-level `.ctrl-row`/`data-row-id` locator
// convention.
//
// Keys used ('n', then 'm') are not bound anywhere else in the populated fixture (`binds`:
// MOUSE1/SPACE/q; other actions' `keys`: G/H/J), so assigning either can never trigger the
// collision Cancel/Replace banner instead of a plain assign.
//
// Selector confirmed by reading `BindSlot.tsx` directly (`BindSlotPlaceholder`) rather than
// assumed from the story text: `.ctrl-slot.is-inert` is real, matches the placeholder's own
// `className`.

const CLICK_TIMEOUT_MS = 8_000

const ROWS = [
  { id: 'fixture-action-inert-grenades', key: 'n', label: 'grenades' },
  { id: 'fixture-action-inert-glauncher', key: 'm', label: 'glauncher' },
]

export default async function grenadeRowsTakeAKey({ page, shot, step }) {
  step('open Config > Plain Profile > Controls')
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: CLICK_TIMEOUT_MS })
  await page.getByTestId('config-tab-controls').click({ timeout: CLICK_TIMEOUT_MS })

  step('select the Weapons category (both inert fixture rows live there)')
  // The grid is filtered to `selectedCategoryId` (`ControlsTab.tsx`) - it defaults to the first
  // category (`movement`), not `weapons`, so both seeded inert rows are invisible until this
  // chip is clicked. No testid on the chip itself, selected by its translated accessible name
  // (`Button`, `role="button"`, `aria-pressed`), same convention `screens.mjs` uses for it.
  await page.getByRole('button', { name: 'Weapons', exact: true }).click({ timeout: CLICK_TIMEOUT_MS })

  step('locate both inert rows')
  for (const { id } of ROWS) {
    const row = page.locator(`.ctrl-row[data-row-id="${id}"]`)
    await row.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    await row.locator('.ctrl-slot.is-inert').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  }
  await shot('both-rows-inert')

  for (const { id, key, label } of ROWS) {
    const row = page.locator(`.ctrl-row[data-row-id="${id}"]`)
    await row.scrollIntoViewIfNeeded()

    step(`${label}: open row menu and "Make bindable"`)
    // `ControlsRowMenu.tsx`'s trigger `IconButton`'s accessible name is
    // `config.controls.actions.moveMenuFor`, "Ordering options for "{{name}}"" - scoped to this
    // row so it can never match the other inert row's trigger.
    await row
      .getByRole('button', { name: /^Ordering options for/ })
      .click({ timeout: CLICK_TIMEOUT_MS })
    await page.waitForTimeout(300)
    // The menu portals into document.body (`Menu.tsx`), so it is found off `page`, not `row`.
    await page
      .getByRole('menuitem', { name: 'Make bindable' })
      .click({ timeout: CLICK_TIMEOUT_MS })

    step(`${label}: assert the row is no longer inert`)
    await row.locator('.ctrl-slot.is-inert').waitFor({ state: 'hidden', timeout: CLICK_TIMEOUT_MS })
    await row.locator('.ctrl-keycell .ctrl-slot').first().waitFor({
      state: 'visible',
      timeout: CLICK_TIMEOUT_MS,
    })
    await shot(`${label}-made-bindable`)

    step(`${label}: capture a key on the now-live slot`)
    const primarySlot = row.locator('.ctrl-keycell .ctrl-slot').first()
    await primarySlot.click({ timeout: CLICK_TIMEOUT_MS })
    await page.keyboard.press(key)

    step(`${label}: assert the capture shows the key, not the inert placeholder`)
    // Same polling style as `controls-extra-keys.mjs`: the write is a real state update and this
    // must not race its re-render. The slot's accessible name carries the actual value
    // (`BindSlot.tsx`'s `aria-label`, "{{slot}}: {{value}}").
    const deadline = Date.now() + CLICK_TIMEOUT_MS
    let ariaLabel = await primarySlot.getAttribute('aria-label')
    while (Date.now() < deadline && !ariaLabel?.toLowerCase().includes(`: ${key}`)) {
      await page.waitForTimeout(100)
      ariaLabel = await primarySlot.getAttribute('aria-label')
    }
    if (!ariaLabel || !ariaLabel.toLowerCase().includes(`: ${key}`)) {
      throw new Error(
        `expected the ${label} row's primary slot to show captured key "${key}", got aria-label "${ariaLabel}"`,
      )
    }
    const inertCount = await row.locator('.ctrl-slot.is-inert').count()
    if (inertCount !== 0) {
      throw new Error(`expected the ${label} row to have no inert slot after capture, found ${inertCount}`)
    }

    await shot(`${label}-key-captured`)
  }
}
