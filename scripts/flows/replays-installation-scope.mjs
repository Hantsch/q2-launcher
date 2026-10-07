// Story 238: the Demos list shows the rail's installation, with an "All installations" toggle.
// Selectors: `replays-scope-label`/`replays-scope-all` (ReplaysView.tsx header), `replays-demo-name`,
// `replays-folder-row`, `replays-filter-search`, `replays-refresh`, `replays-row-favourite`.
import { REPLAYS_FIXTURE_DEMOS } from '../lib/fixture.mjs'
import {
  openDemos,
  openFolder,
  poll,
  rowFor,
  showAllInstallations,
} from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000
const ONE = 'Fixture Favorite Install'
const TWO = 'Fixture WriteDir Install'
const TWO_DEMO = 'team_q2dm3.mvd2'

const namesIn = (page) => page.getByTestId('replays-demo-name').allTextContents()

async function expectNames(page, expected, what) {
  const actual = [...(await namesIn(page))].sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(
      `replays-installation-scope: ${what}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`,
    )
  }
}

export default async function replaysInstallationScope({ page, shot, step }) {
  const oneNames = REPLAYS_FIXTURE_DEMOS.filter((d) => d.installationName === ONE).map(
    (d) => d.fileName,
  )

  step('the default view lists the active installation demos and names it in the header')
  await page.getByRole('button', { name: ONE, exact: true }).click({ timeout: TIMEOUT_MS })
  await openDemos(page)
  const label = page.getByTestId('replays-scope-label')
  if (((await label.textContent()) ?? '') !== `${ONE}'s demos`) {
    throw new Error(`replays-installation-scope: header said "${await label.textContent()}"`)
  }
  const rootLabels = () => page.getByTestId('replays-folder-name').allTextContents()
  // One scope = one root, labelled by game dir alone; the second installation's root is absent.
  const roots = await rootLabels()
  if (roots.length !== 1 || roots[0] !== 'baseq2') {
    throw new Error(
      `replays-installation-scope: default roots should be only ${ONE}'s baseq2, got ${JSON.stringify(roots)}`,
    )
  }
  await openFolder(page, 'baseq2')
  await expectNames(page, oneNames, 'default scope')
  await shot('replays-installation-scope-default')

  step('a favourite set here shows on the same row after the toggle goes on and off')
  const target = 'FINAL.DM2'
  const favourite = rowFor(page, target).getByTestId('replays-row-favourite')
  const want = (await favourite.getAttribute('aria-pressed')) === 'true' ? 'false' : 'true'
  await favourite.click({ timeout: TIMEOUT_MS })
  await poll(
    'the favourite to show',
    async () =>
      (await rowFor(page, target)
        .getByTestId('replays-row-favourite')
        .getAttribute('aria-pressed')) === want,
    TIMEOUT_MS,
  )
  await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })
  const favouriteState = async () =>
    rowFor(page, target).getByTestId('replays-row-favourite').getAttribute('aria-pressed')
  await showAllInstallations(page)
  await openFolder(page, `${ONE} · baseq2`)
  await poll(
    'the favourite to show while the toggle is on',
    async () => (await favouriteState()) === want,
    TIMEOUT_MS,
  )
  await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-scope-all').click({ timeout: TIMEOUT_MS })
  await openFolder(page, 'baseq2')
  if ((await favouriteState()) !== want)
    throw new Error('replays-installation-scope: the favourite did not survive the toggle')
  await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })

  step(
    'with a search typed, switching installation in the rail swaps the list and keeps the search',
  )
  await page.getByTestId('replays-filter-search').fill('q2')
  await page.getByRole('button', { name: TWO, exact: true }).click({ timeout: TIMEOUT_MS })
  await poll(
    'the list to show only the second installation',
    async () => JSON.stringify(await namesIn(page)) === JSON.stringify([TWO_DEMO]),
    TIMEOUT_MS,
  )
  if ((await page.getByTestId('replays-filter-search').inputValue()) !== 'q2') {
    throw new Error('replays-installation-scope: the search text did not survive the switch')
  }
  if (await page.getByTestId('replays-refresh').isDisabled()) {
    throw new Error('replays-installation-scope: switching installation started a scan')
  }
  if (((await label.textContent()) ?? '') !== `${TWO}'s demos`) {
    throw new Error(
      `replays-installation-scope: header said "${await label.textContent()}" after the switch`,
    )
  }
  await shot('replays-installation-scope-switched')
}
