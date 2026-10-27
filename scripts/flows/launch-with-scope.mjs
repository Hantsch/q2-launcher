// e2e: the footer's "Launch with" scopes to Play - it shows on Home and Library, never on Servers
// or Demos. Fixture: the play-with install (r1q2, game dirs baseq2 + ctf, spawnable stand-in client).
import { writePlayWithFixture } from '../lib/fixture.mjs'
import { invoke, launchLines, nextLaunchLine } from '../lib/flow-common.mjs'

export const variant = 'launch-with-scope'

const TIMEOUT_MS = 8_000

let spawnable = true

export async function setup() {
  spawnable = writePlayWithFixture({ variant }).spawnable
  return {}
}

export default async function launchWithScope({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'launch-with-scope: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so there is no spawnable stand-in client.',
    )
    return
  }

  const { logPath } = await invoke(page, 'app:getInfo')
  const footer = page.locator('footer')
  const select = footer.getByLabel('Launch with')
  const fail = (message) => {
    throw new Error(`launch-with-scope: ${message}`)
  }
  const goTo = async (id, viewMarker) => {
    await page.getByTestId(`nav-${id}`).click({ timeout: TIMEOUT_MS })
    await footer.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    // The footer is visible before the navigation lands; a view's own control proves it did.
    if (viewMarker)
      await page.getByTestId(viewMarker).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }

  step('AC3: Home and Library show Launch with')
  for (const id of ['home', 'library']) {
    await goTo(id)
    await select.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }

  step('AC7: Play launches with the saved mod')
  await goTo('home')
  await select.selectOption('ctf')
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="actionbar-play"]')?.hasAttribute('disabled'),
    undefined,
    { timeout: TIMEOUT_MS },
  )
  const before = launchLines(logPath).length
  await page.getByTestId('actionbar-play').click({ timeout: TIMEOUT_MS })
  const line = await nextLaunchLine(logPath, before)
  if (!line.includes('+set game ctf')) fail(`Play did not launch ctf: ${JSON.stringify(line)}`)

  step('AC1: Servers shows no Launch with')
  await goTo('servers', 'servers-filter-search')
  if ((await select.count()) !== 0) fail('Servers still shows Launch with')
  await shot('servers-footer')

  step('AC2: Demos shows no Launch with')
  await goTo('replays', 'replays-refresh')
  if ((await select.count()) !== 0) fail('Demos still shows Launch with')
  await shot('demos-footer')
}
