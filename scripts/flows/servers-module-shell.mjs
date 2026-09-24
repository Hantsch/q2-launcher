// Story 106 (docs/requirements/106-a-servers-module-exists-with-its-own-nav-entry.md) D3
// acceptance flow: proves the servers module's renderer half is actually wired into the shell,
// not just present in the manifest - AC2 (nav entry + planned route) and AC5 (Settings section).
// Mirrors `scripts/flows/settings-downloads-section.mjs`'s structure.
//
// Selectors, not guesses - read `src/renderer/src/modules/index.ts`,
// `src/renderer/src/modules/servers/ServersSettingsSection.tsx` and
// `src/renderer/src/views/SettingsView.tsx` before changing any of these:
//   nav-servers                TitleBar.tsx - primary nav entry, `nav-${module.id}`
//   settings-section-servers   SettingsView.tsx - the shell's own Panel wrapper around the
//                              contributed section, `settings-section-${id}`
//   servers-settings-placeholder  ServersSettingsSection.tsx - the section's placeholder text

const TIMEOUT_MS = 8_000

export default async function serversModuleShell({ page, shot, step }) {
  step('clicking the Servers nav entry renders its (planned) route')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })

  // The servers module contributes no `View` yet (Decisions: no view in RENDERER_MODULES), so its
  // route renders the shell's `PlannedModuleView` fallback - proven here by the module's own
  // title heading and the "Planned" badge that fallback always shows.
  const heading = page.getByRole('heading', { name: 'Servers', exact: true })
  await heading.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const plannedBadge = page.getByText('Planned', { exact: true })
  await plannedBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('servers-planned-route')

  step('the Settings view shows a servers section')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  const section = page.getByTestId('settings-section-servers')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await section.getByTestId('servers-settings-placeholder').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })

  await shot('servers-settings-section')
}
