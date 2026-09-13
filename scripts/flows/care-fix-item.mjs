// Story 058 D7 acceptance flow: drive one Care tidy-up item from listed to fixed through its own
// row action - not the batch dialog (`CareBatchFixDialog`), which is a different acceptance path
// entirely. Mirrors `scripts/flows/raw-inline-edit.mjs`'s shape (real testids/roles, a `shot` per
// meaningful state, assertions on real DOM state) and `open-keycap-dialog.mjs`'s keycap-binding
// sequence for the setup half.
//
// The populated fixture's "Plain Profile" already carries its own findings out of the box (the
// standard movement/weapons/drops catalogue every profile gets migrated onto - story 052 D6 -
// raises several `aliasShadowsCommand` Config health warnings, and its two `drop_grenades` alias
// entries are a pre-existing `duplicateAlias` Tidy-up row), which is exactly why `config-care-clear`
// uses a different fixture profile for its own "all clear" screen - see that entry's own comment in
// `scripts/lib/screens.mjs`. None of that is a `shadowedBind` finding though, so this flow creates
// one live, through a real user action, and asserts on that one row specifically rather than on the
// tab's overall state: `KeyBindDialog` (opened from the Overview tab's keycap, story 017 - no
// edit-mode toggle to arm first) writes `profile.binds[keyName]` directly with no collision guard at
// all (unlike the Controls tab's per-slot `BindSlot`, whose Cancel/Replace banner would immediately
// release whichever claim it kept). Rebinding `MOUSE1`'s raw command away from the "Attack" catalogue
// action's own mirror value (`+attack`) leaves two live claims on one physical key: the hand-typed
// base bind and the action's key slot, and Care's `analyzeTidyUp` (`tidy-up-findings.ts`) reports
// exactly that as a `shadowedBind` finding. It is `mode: 'auto'` (safe/provable), because
// `resolveWinner` can attribute the file's actual last-written bind unambiguously to the hand-typed
// entry - which is what makes it eligible for the row's own "Apply" action, not just for the batch
// dialog.
//
// This flow deliberately stops at "the row is gone" rather than asserting the All clear block
// reappears: `setBinds` (the keycap dialog's own save path) marks the profile dirty (story 043 D4),
// and a dirty profile's canonical file reads `outOfSync` in the Files group until an explicit Save -
// which this flow does not perform, since Plain Profile also carries the pre-existing findings named
// above regardless. Asserting the specific row's removal is what the deliverable's own acceptance
// criterion asks for either way ("applies one tidy-up item and asserts the row is gone").
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-overview     ConfigView.tsx
//   keycap-MOUSE1           OverviewKeyboardPanel.tsx - MOUSE1 is bound in the Plain Profile
//                           fixture (scripts/lib/fixture.mjs), mirroring the "Attack" action
//   role=dialog             KeyBindDialog, via Modal.tsx
//   config.keyBindDialog.rawCommandLabel ("Command") / .assign ("Assign") - KeyBindDialog.tsx
//   config-tab-care         ConfigView.tsx
//   config.care.item.tidy.title.shadowedBind ("“{{key}}” is claimed more than once") -
//                           CareItemRow.tsx, via lib/care-items.ts's `tidyItems`
//   config.care.tidyUp.action.apply ("Apply") - the row's own action button, CareItemRow.tsx
//
// Unlike `ui:verify`, `ui:flow` never reseeds the fixture before launching (`scripts/flow.mjs`'s
// `withApp()` opens `.ui-verify/fixture/populated/userdata` as-is), so a re-run against a fixture
// this flow (or a prior run of it) already left dirty needs a fresh `npm run ui:seed` first - the
// same caveat `raw-inline-edit.mjs` documents for its own precondition.

const TIMEOUT_MS = 8_000
const REPLACEMENT_COMMAND = 'weapnext'

export default async function careFixItem({ page, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  step('select Plain Profile')
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })

  step('open Overview tab')
  await page.getByTestId('config-tab-overview').click({ timeout: TIMEOUT_MS })

  step('open the MOUSE1 keycap dialog')
  await page.getByTestId('keycap-MOUSE1').click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step("rebind MOUSE1 to a command that is not the Attack action's own mirror value")
  await page.getByLabel('Command', { exact: true }).fill(REPLACEMENT_COMMAND)
  await page.getByRole('button', { name: 'Assign', exact: true }).click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('open Care')
  await page.getByTestId('config-tab-care').click({ timeout: TIMEOUT_MS })

  step('assert the shadowed-bind item is listed')
  const conflictRow = page.locator('li').filter({ hasText: 'is claimed more than once' })
  await conflictRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const rowText = await conflictRow.innerText()
  if (!rowText.includes('MOUSE1')) {
    throw new Error(`expected the listed shadowed-bind item to name MOUSE1, got: ${JSON.stringify(rowText)}`)
  }

  await shot('item-listed')

  step("apply the fix from the row's own action")
  await conflictRow.getByRole('button', { name: 'Apply' }).click({ timeout: TIMEOUT_MS })

  step('assert the row is gone')
  await conflictRow.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  await shot('item-fixed')
}
