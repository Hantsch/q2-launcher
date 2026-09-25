// Story 106 (docs/requirements/106-a-servers-module-exists-with-its-own-nav-entry.md) D3
// acceptance flow: proves the servers module's renderer half is actually wired into the shell,
// not just present in the manifest - AC2 (nav entry + a real route) and AC5 (Settings section).
// Mirrors `scripts/flows/settings-downloads-section.mjs`'s structure.
//
// Selectors, not guesses - read `src/renderer/src/modules/index.ts`,
// `src/renderer/src/modules/servers/ServersView.tsx`,
// `src/renderer/src/modules/servers/ServersSettingsSection.tsx` and
// `src/renderer/src/views/SettingsView.tsx` before changing any of these:
//   nav-servers                TitleBar.tsx - primary nav entry, `nav-${module.id}`
//   servers-manual-refresh     ServersView.tsx - story 115 D5's minimal real view (see below),
//                              the always-enabled manual scan button
//   settings-section-servers   SettingsView.tsx - the shell's own Panel wrapper around the
//                              contributed section, `settings-section-${id}`
//   servers-sources-list       ServersSettingsSection.tsx - story 111 D4's real master-source
//                              list, which replaced story 106 D3's placeholder this flow used to
//                              assert on (`servers-settings-placeholder`, removed in story 111)

const TIMEOUT_MS = 8_000

export default async function serversModuleShell({ page, shot, step }) {
  step('clicking the Servers nav entry renders its route')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })

  // Story 115 D5 review fix: the servers module now contributes a real (if deliberately minimal)
  // `View: ServersView` (`src/renderer/src/modules/index.ts`), so its route no longer falls back to
  // the shell's `PlannedModuleView` - the "Planned" badge this flow used to wait for is stale and
  // would never appear again. Waiting on `servers-manual-refresh` instead proves the real, current
  // content of the route: `ServersView`'s manual refresh button (AC3's own control), the same
  // precedent `servers-sources-list` right above already set when story 111 replaced this flow's
  // other placeholder assertion.
  const manualRefresh = page.getByTestId('servers-manual-refresh')
  await manualRefresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('servers-planned-route')

  step('the Settings view shows a servers section')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  const section = page.getByTestId('settings-section-servers')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await section.getByTestId('servers-sources-list').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })

  await shot('servers-settings-section')
}
