// D7's worked example (docs/requirements/026-ui-verification-harness.md): the
// populated fixture -> a profile -> Overview -> a keycap -> the open
// `KeyBindDialog`, screenshotted. Mirrors the `keybind-dialog` screen in
// scripts/lib/screens.mjs, which walks the same sequence — this file exists
// to prove the flow API (`scripts/flow.mjs`) on a real story-shaped smoke
// test, not to duplicate that registry entry for its own sake.
//
// Selectors, not guesses:
//   nav-config          TitleBar.tsx
//   config-profile-row  ConfigView.tsx
//   config-tab-overview ConfigView.tsx
//   keycap-MOUSE1        OverviewKeyboardPanel.tsx; MOUSE1 is bound in the
//                        `Plain Profile` fixture (scripts/lib/fixture.mjs).
//                        Story 017 retired the edit-mode toggle: outside test
//                        mode, clicking a keycap opens KeyBindDialog directly.
//   role=dialog          src/renderer/src/components/ui/Modal.tsx:101

const CLICK_TIMEOUT_MS = 8_000

export default async function openKeycapDialog({ page, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })

  step('select profile')
  await page.getByTestId('config-profile-row').first().click({ timeout: CLICK_TIMEOUT_MS })

  step('open overview tab')
  await page.getByTestId('config-tab-overview').click({ timeout: CLICK_TIMEOUT_MS })

  step('open keycap dialog')
  await page.getByTestId('keycap-MOUSE1').click({ timeout: CLICK_TIMEOUT_MS })

  step('assert dialog open')
  try {
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  } catch {
    throw new Error('KeyBindDialog did not open — no visible role="dialog" element found')
  }

  await shot('dialog-open')
}
