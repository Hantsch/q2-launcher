// "Scan now" refreshes only the servers the filter shows; "Scan all" is one click away (story 250)
// Same three-loopback-responder setup as servers-scoped-refresh.mjs; every packet is attributable to
// a deliberate click (sources disabled, auto-behaviours off).
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import { readFinishedAt, waitForFinishedAtChange } from '../lib/servers-flow.mjs'

export const variant = 'servers-refresh-shown'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

const bindResponder = makeResponderBinder(
  (hostname, playerLines) => ({
    infoLine:
      `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
      `\\maxclients\\8\\version\\3.20`,
    playerLines,
    extra: { hostname },
  }),
  { counted: true },
)

let responders = []

export async function setup() {
  const a = await bindResponder('Zulu Arena', ['5 20 "Alpha1"'])
  const b = await bindResponder('Zulu Duel', ['7 15 "Bravo1"'])
  const c = await bindResponder('Yankee Camp', ['9 25 "Charlie1"'])
  responders = [a, b, c]
  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: responders.map((r) => ({
          address: r.address,
          origin: 'manual',
          addedAt: FIXED_ADDED_AT,
        })),
        history: [],
        scan: {
          concurrency: 4,
          timeoutMs: 500,
          retries: 0,
          minSpacingMs: 0,
          autoScanOnOpen: false,
          autoRefreshEnabled: false,
          autoRefreshIntervalMs: 60_000,
        },
      },
    },
  })
  return {}
}

export async function teardown() {
  await Promise.all(responders.map((r) => closeResponder(r)))
}

const reset = () => {
  for (const r of responders) {
    r.log.info = 0
    r.log.status = 0
  }
}

function expectLog(responder, queried, what) {
  const { info, status } = responder.log
  const ok = queried ? info >= 1 && status >= 1 : info === 0 && status === 0
  if (!ok) {
    throw new Error(
      `expected ${responder.address} ${queried ? 'queried' : 'untouched'} by ${what}, got ` +
        JSON.stringify({ info, status }),
    )
  }
}

export default async function serversRefreshShown({ page, step, shot }) {
  const [a, b, c] = responders
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const button = page.getByTestId('servers-refresh')
  await button.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  async function clickAndSettle(target) {
    const before = await readFinishedAt(page)
    await target.click({ timeout: TIMEOUT_MS })
    await waitForFinishedAtChange(page, before, SCAN_SETTLE_TIMEOUT_MS)
  }

  step('no filter: "Scan now" queries all three')
  const label = async () => ((await button.textContent()) ?? '').trim()
  if (!(await label()).includes('Scan now')) {
    throw new Error(`expected "Scan now" without a filter, got ${JSON.stringify(await label())}`)
  }
  reset()
  await clickAndSettle(button)
  for (const r of responders) expectLog(r, true, '"Scan now"')

  step('search "zulu": button reads "Refresh 2 shown" and queries only A and B')
  await page.getByTestId('servers-filter-search').fill('zulu')
  await page.waitForFunction(
    () =>
      /Refresh 2 shown/.test(
        document.querySelector('[data-testid="servers-refresh"]')?.textContent ?? '',
      ),
    null,
    { timeout: TIMEOUT_MS },
  )
  reset()
  await clickAndSettle(button)
  expectLog(a, true, '"Refresh 2 shown"')
  expectLog(b, true, '"Refresh 2 shown"')
  expectLog(c, false, '"Refresh 2 shown"')
  const read = await page.evaluate(() =>
    window.q2.invoke('module:invoke', { moduleId: 'servers', type: 'scan.read' }),
  )
  const failures = read?.value?.state?.sourceFailures
  if (read?.ok !== true || !Array.isArray(failures) || failures.length !== 0) {
    throw new Error(`expected no source failures, got ${JSON.stringify(read)}`)
  }
  await shot('refresh-shown')

  step('"Scan all" from the options menu queries C too')
  await page.getByTestId('servers-refresh-options').click({ timeout: TIMEOUT_MS })
  reset()
  await clickAndSettle(page.getByRole('menuitem', { name: 'Scan all' }))
  expectLog(c, true, '"Scan all"')

  step('clearing the search restores "Scan now"')
  await page.getByTestId('servers-filter-search').fill('')
  await page.waitForFunction(
    () =>
      /Scan now/.test(document.querySelector('[data-testid="servers-refresh"]')?.textContent ?? ''),
    null,
    { timeout: TIMEOUT_MS },
  )

  console.log(
    'servers-refresh-shown: Refresh N shown queried only the shown servers; Scan all all.',
  )
}
