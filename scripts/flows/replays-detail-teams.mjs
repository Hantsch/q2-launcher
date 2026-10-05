// Story 245: the demo detail lists players by team, the POV marked and spectators tucked away.
// Fixture (`scripts/lib/fixture/replays.mjs`'s `writeReplaysTeamsFixture()`): the example demo
// (Home [maq], Away [shad], POV shad, spectators incl. HIMMO), `test.dm2` (Home [sd.kgm/sauDove])
// and a copy of the example whose sidecar sets one side, Wolves [maq].
import {
  REPLAYS_TEAMS_EXAMPLE_DEMO,
  REPLAYS_TEAMS_HEADER_DEMO,
  REPLAYS_TEAMS_SIDECAR_DEMO,
  REPLAYS_TEAMS_VARIANT,
  writeReplaysTeamsFixture,
} from '../lib/fixture.mjs'
import { openDemosRoot, rowFor } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

export const variant = REPLAYS_TEAMS_VARIANT

export async function setup() {
  writeReplaysTeamsFixture()
  return {}
}

function fail(message) {
  throw new Error(`replays-detail-teams: ${message}`)
}

/** Each team heading with the player names listed under it, in document order. */
async function teamsOf(panel) {
  return panel.evaluate((root) =>
    Array.from(root.querySelectorAll('tbody')).map((body) => ({
      team: body.querySelector('[data-testid="replays-detail-team"]')?.textContent?.trim() ?? null,
      players: Array.from(body.querySelectorAll('[data-testid="replays-detail-player-row"]')).map(
        (row) => row.textContent.replace(/POV$/, '').trim(),
      ),
    })),
  )
}

async function openRow(page, fileName) {
  await rowFor(page, fileName).first().click({ timeout: TIMEOUT_MS })
  const panel = page.getByTestId('replays-detail-field-sides')
  await panel
    .getByTestId('replays-detail-player-row')
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return panel
}

export default async function replaysDetailTeams({ page, step, shot }) {
  step('open the Demos view and the example demo')
  await openDemosRoot(page)
  let panel = await openRow(page, REPLAYS_TEAMS_EXAMPLE_DEMO)

  step('the players table lists names only - no score or ping header')
  const headers = await panel.getByRole('columnheader').allTextContents()
  if (headers.some((text) => /score|ping/i.test(text))) {
    fail(`expected no score or ping column, got ${JSON.stringify(headers)}`)
  }

  step('Home comes before Away, maq under Home and shad under Away')
  const teams = await teamsOf(panel)
  const names = teams.map((group) => group.team)
  if (names.indexOf('Home') < 0 || names.indexOf('Away') <= names.indexOf('Home')) {
    fail(`expected Home before Away, got ${JSON.stringify(names)}`)
  }
  const players = (team) => teams.find((group) => group.team === team)?.players ?? []
  if (JSON.stringify(players('Home')) !== '["maq"]')
    fail(`Home must be exactly maq: ${JSON.stringify(teams)}`)
  if (JSON.stringify(players('Away')) !== '["shad"]')
    fail(`Away must be exactly shad: ${JSON.stringify(teams)}`)

  step('the point-of-view player carries the POV marker')
  const shadRow = panel.getByTestId('replays-detail-player-row').filter({ hasText: 'shad' })
  const pov = shadRow.getByTestId('replays-detail-player-pov')
  await pov.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await pov.textContent())?.trim() !== 'POV') fail('expected the POV text on the shad row')

  step('spectators stay closed until opened, then list HIMMO')
  const spectators = panel.getByTestId('replays-detail-spectators')
  if (await spectators.evaluate((el) => el.open)) fail('spectators must start closed')
  await spectators.locator('summary').click({ timeout: TIMEOUT_MS })
  await spectators.getByText('HIMMO').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('players-panel')

  step('the test.dm2 demo lists sauDove under Home')
  panel = await openRow(page, REPLAYS_TEAMS_HEADER_DEMO)
  const headerTeams = await teamsOf(panel)
  if (!headerTeams.some((g) => g.team === 'Home' && g.players.some((n) => n.includes('sauDove')))) {
    fail(`expected sauDove under Home, got ${JSON.stringify(headerTeams)}`)
  }

  step('a sidecar side shows its team name with its players')
  panel = await openRow(page, REPLAYS_TEAMS_SIDECAR_DEMO)
  const sidecarTeams = await teamsOf(panel)
  if (!sidecarTeams.some((g) => g.team === 'Wolves' && g.players.includes('maq'))) {
    fail(`expected Wolves with maq, got ${JSON.stringify(sidecarTeams)}`)
  }

  console.log('replays-detail-teams: players by team, POV marked, spectators closed then listed')
}
