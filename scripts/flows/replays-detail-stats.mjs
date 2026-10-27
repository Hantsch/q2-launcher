// Story 262: the demo detail shows the recording player's OpenTDM accuracy stats.
// Fixture (`writeReplaysTeamsFixture()`): the example demo carries a stats table for shad;
// `test.dm2` carries none.
import {
  REPLAYS_TEAMS_EXAMPLE_DEMO,
  REPLAYS_TEAMS_HEADER_DEMO,
  REPLAYS_TEAMS_VARIANT,
  writeReplaysTeamsFixture,
} from '../lib/fixture.mjs'
import { assertNoAxeViolations } from '../lib/flow-axe.mjs'
import { makeFail } from '../lib/flow-common.mjs'
import { openDemosRoot, rowFor } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000
const COLUMNS = ['Item', 'Acc.', 'Kills', 'Deaths', 'Dealt', 'Recvd', 'Pick', 'Miss']

export const variant = REPLAYS_TEAMS_VARIANT

export async function setup() {
  writeReplaysTeamsFixture()
  return {}
}

const fail = makeFail('replays-detail-stats')

async function cellsOf(row) {
  return (await row.getByRole('cell').allTextContents()).map((text) => text.trim())
}

export default async function replaysDetailStats({ page, step, shot }) {
  step('open the Demos view and the example demo')
  await openDemosRoot(page)
  await rowFor(page, REPLAYS_TEAMS_EXAMPLE_DEMO).first().click({ timeout: TIMEOUT_MS })
  const panel = page.getByTestId('replays-detail-stats')
  await panel.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('the title names the recording player')
  const title = (await panel.getByTestId('replays-detail-stats-title').textContent())?.trim()
  if (title !== 'Stats for shad') fail(`expected "Stats for shad", got ${JSON.stringify(title)}`)

  step('the table has exactly the eight column headers')
  const headers = (await panel.getByRole('columnheader').allTextContents()).map((t) => t.trim())
  if (JSON.stringify(headers) !== JSON.stringify(COLUMNS)) {
    fail(`expected columns ${JSON.stringify(COLUMNS)}, got ${JSON.stringify(headers)}`)
  }

  step('the Railgun row reads its numbers')
  const rows = panel.getByTestId('replays-detail-stats-row')
  const railgun = await cellsOf(rows.filter({ hasText: 'Railgun' }).first())
  if (railgun.join(' ') !== '36% 3 11 1000 2000 6 3') {
    fail(`expected Railgun "36% 3 11 1000 2000 6 3", got ${JSON.stringify(railgun)}`)
  }

  step('a not-applicable cell shows a dash, not 0')
  const grenade = await cellsOf(rows.filter({ hasText: 'Grenade Launcher' }).first())
  if (grenade[0] !== '-') fail(`expected Grenade Launcher Acc. "-", got ${JSON.stringify(grenade)}`)
  if (grenade[2] !== '0')
    fail(`expected Grenade Launcher Deaths "0", got ${JSON.stringify(grenade)}`)

  step('the total list shows the kill and death counts')
  const pairs = await panel
    .getByTestId('replays-detail-stats-total')
    .evaluate((el) =>
      Object.fromEntries(
        Array.from(el.querySelectorAll('dt')).map((dt) => [
          dt.textContent.trim(),
          dt.nextElementSibling.textContent.trim(),
        ]),
      ),
    )
  if (pairs.Kills !== '10' || pairs.Deaths !== '27') {
    fail(`expected Kills 10 and Deaths 27, got ${JSON.stringify(pairs)}`)
  }
  await shot('stats-panel')

  step('the stats panel passes axe')
  await assertNoAxeViolations(page, 'stats panel', '[data-testid="replays-detail-stats"]')

  step('a demo without stats shows no stats section')
  await rowFor(page, REPLAYS_TEAMS_HEADER_DEMO).first().click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-detail-field-sides')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const count = await page.getByTestId('replays-detail-stats').count()
  if (count !== 0) fail(`expected no stats section for ${REPLAYS_TEAMS_HEADER_DEMO}, got ${count}`)

  console.log('replays-detail-stats: stats table, dash cells, totals; none for a demo without')
}
