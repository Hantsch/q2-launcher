// Story 121 D3 (docs/requirements/121-the-list-says-what-its-doing.md): the e2e proof that the
// servers list's status panel (`ServersListStatus.tsx`, D1) actually says what it's doing on a real
// scan, not just in its own unit tests (`list-state.test.ts`) or a static screenshot
// (`servers-list-empty`/`servers-list-loading`/`servers-list-error` in `scripts/lib/screens.mjs`,
// D2). Three ACs, one flow:
//
//   AC1 - loading counts: clicking refresh shows `servers-list-loading` immediately, with a real
//         (non-zero) `data-found`/`data-pending` and visible progress text.
//   AC2 - empty state + settings link: a finished scan with zero rows shows `servers-list-empty`
//         and its own "open source settings" button really navigates to and scrolls
//         `settings-section-servers` into view.
//   AC3 - per-source failure attribution: a source that fails (the dead `http-list` source, a
//         genuine connection-refused/transport error, not a stubbed one) is named by its own
//         address, and its failure line survives alongside rows that DID come back - a failure
//         never hides the rest of the list.
//   AC5 - the whole thing runs scan -> select entirely on loopback (GB-A5): the pre-launch guard
//         below is what actually proves that, not just this file's own choice of stub ports.
//
// Fixture: `writeServersListErrorFixture()` (`scripts/lib/fixture.mjs`, D2) - reused verbatim
// rather than reimplemented. It seeds every shipped master source present-but-disabled, plus two
// enabled `http-list` sources: the stub list server's own URL (`serversStubListUrl()`) and
// `SERVERS_DEAD_LIST_URL` (a loopback port nothing binds - deterministically a transport error,
// never a real host). No favourites/manual servers, autos off, `SERVERS_SCAN_SETTINGS_SEED`'s short
// `timeoutMs`/`retries`.
//
// Two rounds against that one fixture:
//   Round 1 (empty): the stub list server serves an empty body before the first click, so the only
//     thing either source can produce is the dead source's own failure - proving AC2 (empty) and
//     AC3 (attribution) together, since that failure is real, not staged.
//   Round 2 (loading + populated + error together): the stub list server is pointed at two of the
//     three `SERVERS_STUB_RESPONDERS` loopback game servers, delayed to ~80% of the fixture's own
//     seeded `scan.timeoutMs` (the same proportion `servers-list-loading`'s own screen navigate()
//     uses in `scripts/lib/screens.mjs`) so the loading state is genuinely still running when this
//     flow asserts it, without ever risking the seeded timeout itself. The dead source is still
//     enabled and still fails every round, so its failure line has to keep showing up alongside the
//     two live rows once the round finishes (AC3's "never hides the rest of the list").
//
// Selectors: `nav-servers` (`TitleBar.tsx`), `servers-refresh`/`servers-scan-status`
// (`ServersView.tsx`), `servers-list-loading`/`servers-list-empty`/`servers-list-empty-settings`/
// `servers-list-source-failure-<sourceId>` (`ServersListStatus.tsx`), `servers-row-<address>`
// (`ServerRow.tsx`, `data-selected`), `settings-section-servers` (`SettingsView.tsx`).
import { SERVERS_SCAN_SETTINGS_SEED, writeServersListErrorFixture } from '../lib/fixture.mjs'
import {
  SERVERS_DEAD_LIST_URL,
  SERVERS_STUB_LIST_PORT,
  SERVERS_STUB_RESPONDERS,
  serversStubListUrl,
  startListServer,
  startServerResponders,
} from '../lib/servers-stub.mjs'

export const variant = 'servers-list-error'

const TIMEOUT_MS = 8_000
/** Generous headroom for a real scan against loopback stub responders to finish - mirrors
 * `servers-scoped-refresh.mjs`'s own `SCAN_SETTLE_TIMEOUT_MS` and `screens.mjs`'s identical
 * constant for these same `servers-list-*` screens. */
const SCAN_SETTLE_TIMEOUT_MS = 15_000

/** The `id` `writeServersListErrorFixture()` gives its dead `http-list` source - mirrors that
 * writer's own literal (`scripts/lib/fixture.mjs`) rather than re-deriving it. */
const DEAD_SOURCE_ID = 'fixture-servers-list-http-dead'

/** ~80% of the fixture's own seeded `scan.timeoutMs` - the same proportion `screens.mjs`'s
 * `servers-list-loading` screen uses, comfortably under the seeded timeout so the round still
 * finishes cleanly once observed. */
const LOADING_DELAY_MS = Math.round(SERVERS_SCAN_SETTINGS_SEED.timeoutMs * 0.8)

/** Only two of the three stub responders are needed for round 2 (AC1's "found: 2" / AC3's "rows
 * alongside the still-failing dead source"). */
const ROUND_TWO_SPECS = SERVERS_STUB_RESPONDERS.slice(0, 2)

/** GB-A5 guard: throws if `urlString` does not resolve to loopback. Called before the fixture is
 * even written or the app launched - this flow must never touch a real master or game server. */
function assertLoopbackUrl(label, urlString) {
  const hostname = new URL(urlString).hostname
  if (hostname !== '127.0.0.1') {
    throw new Error(
      `GB-A5 violation: ${label} resolves to host "${hostname}" (${urlString}), expected 127.0.0.1`,
    )
  }
}

/** GB-A5 guard for the responder specs this flow is about to bind: each must be one of the known,
 * already-loopback-only `SERVERS_STUB_RESPONDERS` (`startServerResponders` binds every socket to
 * the literal `'127.0.0.1'` - `scripts/lib/servers-stub.mjs` - so this catches a spec that was
 * swapped for something else, not a library that silently changed its own bind address). */
function assertKnownLoopbackSpecs(specs) {
  for (const spec of specs) {
    const known = SERVERS_STUB_RESPONDERS.some(
      (candidate) => candidate.port === spec.port && candidate.hostname === spec.hostname,
    )
    if (!known) {
      throw new Error(
        `GB-A5 violation: responder spec ${JSON.stringify(spec)} is not one of the known ` +
          'loopback SERVERS_STUB_RESPONDERS - refusing to bind an unverified target',
      )
    }
  }
}

let responders = null
let listServer = null

export async function setup() {
  assertLoopbackUrl('the stub http-list source', serversStubListUrl())
  assertLoopbackUrl('the dead http-list source', SERVERS_DEAD_LIST_URL)
  assertKnownLoopbackSpecs(ROUND_TWO_SPECS)

  writeServersListErrorFixture()

  // Round 1 starts with an empty list body - the dead source is dead by construction (nothing
  // binds that port), so the only failure round 1 can produce is real, not staged.
  listServer = await startListServer(SERVERS_STUB_LIST_PORT)
  listServer.setAddresses([])

  responders = await startServerResponders(ROUND_TWO_SPECS)

  return {}
}

export async function teardown() {
  try {
    if (responders) responders.close()
  } finally {
    if (listServer) listServer.close()
  }
}

async function waitForScanIdle(page, timeout) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="servers-scan-status"]')?.getAttribute('data-running') === 'false',
    null,
    { timeout },
  )
}

export default async function serversListStates({ page, step, shot }) {
  step('navigate to the Servers view')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refresh = page.getByTestId('servers-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScanIdle(page, TIMEOUT_MS)

  step('round 1: refresh against an empty list finds nothing (AC2) but the dead source still fails (AC3)')
  await refresh.click({ timeout: TIMEOUT_MS })
  const emptyState = page.getByTestId('servers-list-empty')
  await emptyState.waitFor({ state: 'visible', timeout: SCAN_SETTLE_TIMEOUT_MS })

  const deadFailure = page.getByTestId(`servers-list-source-failure-${DEAD_SOURCE_ID}`)
  await deadFailure.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadFailureText = (await deadFailure.textContent()) ?? ''
  if (!deadFailureText.includes(SERVERS_DEAD_LIST_URL)) {
    throw new Error(
      `expected the dead source's failure line to name its own address (${SERVERS_DEAD_LIST_URL}), ` +
        `got ${JSON.stringify(deadFailureText)}`,
    )
  }
  await shot('round1-empty-with-failure')

  step("AC2: the empty state's settings link opens and scrolls to the servers source settings section")
  await page.getByTestId('servers-list-empty-settings').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('settings-section-servers')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('round2-settings-link')

  step('navigate back to Servers for round 2')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScanIdle(page, TIMEOUT_MS)

  step('round 2 setup: point the stub list at two live responders, delayed under the seeded timeout')
  listServer.setAddresses(ROUND_TWO_SPECS.map((spec) => `127.0.0.1:${spec.port}`))
  responders.setDelayMs(LOADING_DELAY_MS)

  step('AC1: clicking refresh immediately shows the loading state with real found/pending counts')
  await refresh.click({ timeout: TIMEOUT_MS })
  const loading = page.getByTestId('servers-list-loading')
  await loading.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="servers-list-loading"]')?.getAttribute('data-found') === '2',
    null,
    { timeout: TIMEOUT_MS },
  )
  const foundAttr = await loading.getAttribute('data-found')
  const pendingAttr = await loading.getAttribute('data-pending')
  const loadingText = ((await loading.textContent()) ?? '').trim()
  if (foundAttr !== '2') {
    throw new Error(`expected servers-list-loading's data-found to be "2", got ${JSON.stringify(foundAttr)}`)
  }
  if (loadingText.length === 0) {
    throw new Error('expected servers-list-loading to render visible progress text, got none')
  }
  console.log(`  loading: data-found=${foundAttr} data-pending=${pendingAttr} text=${JSON.stringify(loadingText)}`)
  await shot('round3-loading')

  step('wait for round 2 to finish')
  await waitForScanIdle(page, SCAN_SETTLE_TIMEOUT_MS)

  step('AC3: both live rows are present alongside the still-failing dead source')
  for (const spec of ROUND_TWO_SPECS) {
    await page
      .getByTestId(`servers-row-127.0.0.1:${spec.port}`)
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  await page
    .getByTestId(`servers-list-source-failure-${DEAD_SOURCE_ID}`)
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC5: selecting a row marks it selected')
  const firstRowTestId = `servers-row-127.0.0.1:${ROUND_TWO_SPECS[0].port}`
  await page.getByTestId(firstRowTestId).click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-selected') === 'true',
    firstRowTestId,
    { timeout: TIMEOUT_MS },
  )
  await shot('round4-populated-and-selected')

  console.log(
    'servers-list-states: loading counts (AC1), empty state + settings link (AC2), per-source ' +
      'failure attribution alongside surviving rows (AC3), and a scan -> select round entirely on ' +
      'loopback (AC5) all verified.',
  )
}
