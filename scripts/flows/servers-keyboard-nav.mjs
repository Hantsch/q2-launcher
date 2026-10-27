// Keyboard use of the servers list: Arrow Up/Down move the selection (no wrap, the row stays in
// view), Enter joins the selected row - also with "double-click joins" off - and keys typed in the
// filter search field never reach the rows. Fixture shape mirrors `servers-actionbar-join.mjs`, with
// enough responders that the list overflows its scroll area.
import { SERVERS_DISABLED_SOURCES, writeJoinFixture } from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import { readFinishedAt, waitForFinishedAtChange, waitForRowCount } from '../lib/servers-flow.mjs'
import { invoke, launchLines, nextLaunchLine, sleep } from '../lib/flow-common.mjs'

export const variant = 'servers-keyboard-nav'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const NO_JOIN_WAIT_MS = 1_500
const SERVER_COUNT = 16
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

const bindResponder = makeResponderBinder((hostname, playerLines) => ({
  infoLine:
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    '\\maxclients\\8\\version\\3.20',
  playerLines,
}))

let responders = []
let spawnable = true

export async function setup() {
  for (let index = 0; index < SERVER_COUNT; index += 1) {
    const name = `Fixture Server ${String(index + 1).padStart(2, '0')}`
    responders.push(await bindResponder(name, ['5 20 "Bravo1"']))
  }
  const fixture = writeJoinFixture({
    variant,
    servers: {
      sources: SERVERS_DISABLED_SOURCES,
      favourites: [],
      manualServers: responders.map((responder) => ({
        address: responder.address,
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
  })
  spawnable = fixture.spawnable
  return {}
}

export async function teardown() {
  await Promise.all(responders.map((responder) => closeResponder(responder)))
}

export default async function serversKeyboardNav({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'servers-keyboard-nav: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so there is no spawnable stand-in client.',
    )
    return
  }

  const { logPath } = await invoke(page, 'app:getInfo')
  const rows = page.locator('[role="button"][data-testid^="servers-row-"]')
  const rowTestIds = () => rows.evaluateAll((els) => els.map((el) => el.dataset.testid))
  const selectedTestId = () =>
    page.evaluate(
      () =>
        document.querySelector('[role="button"][data-testid^="servers-row-"][data-selected="true"]')
          ?.dataset.testid ?? null,
    )
  const expectSelected = async (testId, what) => {
    await page
      .waitForFunction(
        (id) =>
          document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-selected') === 'true',
        testId,
        { timeout: TIMEOUT_MS },
      )
      .catch(async () => {
        throw new Error(`${what}: expected ${testId} selected, got ${await selectedTestId()}`)
      })
  }
  const expectDetailShows = async (testId) => {
    const address = testId.replace('servers-row-', '')
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="servers-detail-field-address"]')?.textContent ===
        expected,
      address,
      { timeout: TIMEOUT_MS },
    )
  }
  // The selected row must sit inside the list's scroll area and below its sticky column header.
  const expectSelectedInView = async (what) => {
    const verdict = await page.evaluate(() => {
      const row = document.querySelector('[role="button"][data-selected="true"]')
      const scroller = row?.closest('.overflow-y-auto')
      const header = document.querySelector('[data-testid^="servers-sort-"]')?.parentElement
      if (!row || !scroller || !header) return 'missing row, scroll area or header'
      const box = row.getBoundingClientRect()
      const area = scroller.getBoundingClientRect()
      const headerBottom = header.getBoundingClientRect().bottom
      if (box.top < headerBottom - 1) return `row top ${box.top} under the header (${headerBottom})`
      if (box.bottom > area.bottom + 1)
        return `row bottom ${box.bottom} below the area (${area.bottom})`
      return null
    })
    if (verdict) throw new Error(`${what}: ${verdict}`)
  }

  step('scan the fixtures into an overflowing list')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await waitForRowCount(page, SERVER_COUNT, { exact: true })
  const overflows = await rows
    .first()
    .evaluate(
      (el) =>
        (el.closest('.overflow-y-auto')?.scrollHeight ?? 0) >
        el.closest('.overflow-y-auto').clientHeight,
    )
  if (!overflows) throw new Error('the fixture list does not overflow its scroll area')
  const order = await rowTestIds()

  step('arrow down walks the selection through every row and keeps it in view')
  await rows.first().click({ timeout: TIMEOUT_MS })
  await expectSelected(order[0], 'first row clicked')
  for (let index = 1; index < order.length; index += 1) {
    await page.keyboard.press('ArrowDown')
    await expectSelected(order[index], `ArrowDown #${index}`)
    await expectDetailShows(order[index])
    await expectSelectedInView(`ArrowDown #${index}`)
  }
  await shot('arrow-down-last-row')

  step('arrow down on the last row keeps it selected')
  await page.keyboard.press('ArrowDown')
  await sleep(300)
  await expectSelected(order[order.length - 1], 'ArrowDown on the last row')

  step('arrow up walks back to the first row and stops there')
  for (let index = order.length - 2; index >= 0; index -= 1) {
    await page.keyboard.press('ArrowUp')
    await expectSelected(order[index], `ArrowUp to #${index}`)
    await expectSelectedInView(`ArrowUp to #${index}`)
  }
  await page.keyboard.press('ArrowUp')
  await sleep(300)
  await expectSelected(order[0], 'ArrowUp on the first row')
  await shot('arrow-up-first-row')

  step('keys typed in the filter search field never reach the rows')
  const launchesBefore = launchLines(logPath).length
  const search = page.getByTestId('servers-filter-search')
  await search.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await sleep(NO_JOIN_WAIT_MS)
  await expectSelected(order[0], 'keys in the search field')
  if (launchLines(logPath).length !== launchesBefore) {
    throw new Error('Enter in the search field launched the game')
  }

  step('Enter on the selected row joins even with double-click joining off')
  const patched = await invoke(page, 'module:invoke', {
    moduleId: 'servers',
    type: 'scan.patchSettings',
    payload: { doubleClickJoins: false },
  })
  if (!patched?.ok) throw new Error(`scan.patchSettings failed: ${JSON.stringify(patched)}`)
  // The mounted view read the setting once; leaving and returning makes it read the patched value.
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const firstRow = page.getByTestId(order[0])
  await firstRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const launchesBeforeEnter = launchLines(logPath).length
  await firstRow.dblclick({ timeout: TIMEOUT_MS })
  await expectSelected(order[0], 'double-click with the setting off')
  await sleep(NO_JOIN_WAIT_MS)
  if (launchLines(logPath).length !== launchesBeforeEnter) {
    throw new Error('the setting is not off in the UI: a double-click launched the game')
  }
  await firstRow.focus()
  await page.keyboard.press('Enter')
  const launchLine = await nextLaunchLine(logPath, launchesBeforeEnter)
  if (!launchLine.includes(`+connect ${order[0].replace('servers-row-', '')}`)) {
    throw new Error(`the "launching" line does not connect to the selected row: ${launchLine}`)
  }
  await shot('enter-joined')
}
