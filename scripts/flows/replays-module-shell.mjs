// Story 135 (docs/requirements/135-a-demos-module-exists-with-its-own-nav-entry.md) D3
// acceptance flow: proves the replays module's renderer half is actually wired into the shell,
// not just present in the manifest - the nav entry + planned-module route, and the Settings
// section. Mirrors `scripts/flows/servers-module-shell.mjs`'s structure.
//
// Selectors, not guesses - read `src/renderer/src/modules/index.ts`,
// `src/renderer/src/modules/replays/ReplaysSettingsSection.tsx` and
// `src/renderer/src/views/SettingsView.tsx` before changing any of these:
//   nav-replays                TitleBar.tsx - primary nav entry, `nav-${module.id}`, labelled
//                              "Demos" (`common.label.demos`)
//   settings-section-replays  SettingsView.tsx - the shell's own Panel wrapper around the
//                              contributed section, `settings-section-${id}`
//   replays-name-templates    NameTemplatesList.tsx - story 140 D3's naming-pattern list, which
//                              replaced this deliverable's placeholder paragraph
//   replays-extra-folders-add ReplaysSettingsSection.tsx - story 142 D4's extra-demo-folders
//                              "Add folder" button, a sibling block to the naming-pattern list
//
// Story [[142]] will later replace the planned-module placeholder view with a real route - when
// it does, this flow's assertions above must be updated to match.

const TIMEOUT_MS = 8_000

export default async function replaysModuleShell({ page, shot, step }) {
  step('clicking the Demos nav entry renders its route')
  const nav = page.getByTestId('nav-replays')
  await nav.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectVisibleText(nav, 'Demos')
  await nav.click({ timeout: TIMEOUT_MS })

  const heading = page.getByRole('heading', { name: 'Demos', exact: true })
  await heading.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('replays-route')

  step('the Settings view shows a replays section')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  const section = page.getByTestId('settings-section-replays')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await section.getByTestId('replays-name-templates').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  await section.getByTestId('replays-extra-folders-add').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })

  await shot('replays-settings-section')
}

async function expectVisibleText(locator, text) {
  const actual = (await locator.textContent())?.trim()
  if (actual !== text) {
    throw new Error(`expected nav-replays text "${text}", got "${actual}"`)
  }
}
