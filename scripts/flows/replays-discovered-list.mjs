// Story 141 D5 acceptance flow: proves the Demos view actually lists every discovered demo across
// two installations and two game dirs (AC "every discovered demo across every installation and mod
// is listed"), and that the fixture's four decoys (a sidecar, a launcher-temp-copy folder, a nested
// subfolder, a wrong extension) never show up. Mirrors `scripts/flows/servers-module-shell.mjs`'s
// structure.
//
// Selectors, not guesses - read `src/renderer/src/modules/replays/ReplaysView.tsx` and
// `scripts/lib/fixture.mjs`'s `REPLAYS_FIXTURE_DEMOS`/`REPLAYS_FIXTURE_DECOYS` before changing any
// of these:
//   nav-replays            TitleBar.tsx - primary nav entry, `nav-${module.id}`
//   replays-demo-list      ReplaysView.tsx - the `<ul>` of discovered demos
//   replays-demo-row       ReplaysView.tsx - one `<li>` per demo, `data-demo-id` carries its id
//   replays-demo-name      ReplaysView.tsx - the row's file name text
//   replays-demo-source    ReplaysView.tsx - the row's "{{installation}} · {{gameDir}}" text
//
// Story 150 (a later story, per this deliverable's own plan) is expected to replace this row
// markup with something richer - whoever writes that story must update this flow's selectors and
// assertions to match, not merely delete it.

import { REPLAYS_FIXTURE_DEMOS } from '../lib/fixture.mjs'
import { openDemos, openFolder } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

export default async function replaysDiscoveredList({ page, shot, step }) {
  step('navigating to the Demos view renders the discovered list')
  await openDemos(page)

  step('exactly the five fixture demo files are listed - no decoys')
  const rootLabel = (demo) => `${demo.installationName} / ${demo.gameDir}`
  const roots = [...new Set(REPLAYS_FIXTURE_DEMOS.map(rootLabel))]
  const names = []
  for (const root of roots) {
    await openFolder(page, root)
    names.push(...(await page.getByTestId('replays-demo-name').allTextContents()))
    await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })
    await page.getByTestId('replays-breadcrumb').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  }
  const expectedNames = REPLAYS_FIXTURE_DEMOS.map((demo) => demo.fileName)
  const sortedActual = [...names].sort()
  const sortedExpected = [...expectedNames].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `replays-discovered-list: expected exactly ${JSON.stringify(sortedExpected)}, got ${JSON.stringify(sortedActual)}`,
    )
  }

  step('a baseq2 row and a second-game-dir row both show the right source text')
  const finalDemo = REPLAYS_FIXTURE_DEMOS.find((demo) => demo.fileName === 'FINAL.DM2')
  await openFolder(page, rootLabel(finalDemo))
  const finalRow = page.getByTestId('replays-demo-row').filter({ hasText: 'FINAL.DM2' })
  const finalSource = await finalRow.getByTestId('replays-demo-source').textContent()
  const expectedFinalSource = `${finalDemo.installationName} · ${finalDemo.gameDir}`
  if (finalSource !== expectedFinalSource) {
    throw new Error(
      `replays-discovered-list: FINAL.DM2 source expected "${expectedFinalSource}", got "${finalSource}"`,
    )
  }

  await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })
  const teamDemo = REPLAYS_FIXTURE_DEMOS.find((demo) => demo.fileName === 'team_q2dm3.mvd2')
  await openFolder(page, rootLabel(teamDemo))
  const teamRow = page.getByTestId('replays-demo-row').filter({ hasText: 'team_q2dm3.mvd2' })
  const teamSource = await teamRow.getByTestId('replays-demo-source').textContent()
  const expectedTeamSource = `${teamDemo.installationName} · ${teamDemo.gameDir}`
  if (teamSource !== expectedTeamSource) {
    throw new Error(
      `replays-discovered-list: team_q2dm3.mvd2 source expected "${expectedTeamSource}", got "${teamSource}"`,
    )
  }

  await shot('replays-discovered-list')
}
