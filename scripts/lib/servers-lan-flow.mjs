// Story 196 D5: helpers shared by the four `servers-lan-*` flows (scripts/flows/). Selectors:
// `servers-mode-online`/`servers-mode-lan` (`ServersModeToggle.tsx`, `aria-pressed`),
// `servers-scan-status` (`data-running`/`data-finished-at`), `servers-row-<address>`.
// Loopback only (GB-A5): every LAN target is a literal 127.0.0.1:<port>.
import { SERVERS_STUB_RESPONDERS } from './servers-stub.mjs'

export const TIMEOUT_MS = 8_000
export const SCAN_SETTLE_TIMEOUT_MS = 15_000

/** `Q2L_UI_LAN_TARGETS` value for a list of ports (or the literal `none`). */
export function lanTargetsEnv(ports) {
  return ports === 'none' ? 'none' : ports.map((port) => `127.0.0.1:${port}`).join(',')
}

/** The two online responders the `servers-lan` fixture reaches: A as favourite, B via the stub list. */
export const ONLINE_RESPONDERS = SERVERS_STUB_RESPONDERS.slice(0, 2)

export const readFinishedAt = async (page) =>
  (await page.getByTestId('servers-scan-status').getAttribute('data-finished-at')) ?? ''

export async function waitForScanIdle(page, timeout = SCAN_SETTLE_TIMEOUT_MS) {
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="servers-scan-status"]')
        ?.getAttribute('data-running') === 'false',
    null,
    { timeout },
  )
}

export async function waitForFinishedAtChange(page, previous, timeout = SCAN_SETTLE_TIMEOUT_MS) {
  await page.waitForFunction(
    (before) => {
      const el = document.querySelector('[data-testid="servers-scan-status"]')
      const at = el?.getAttribute('data-finished-at') ?? ''
      return el?.getAttribute('data-running') === 'false' && at !== '' && at !== before
    },
    previous,
    { timeout },
  )
}

export async function openServers(page) {
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-refresh').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScanIdle(page, TIMEOUT_MS)
}

export async function assertMode(page, mode) {
  for (const m of ['online', 'lan']) {
    const pressed = await page.getByTestId(`servers-mode-${m}`).getAttribute('aria-pressed')
    if (pressed !== String(m === mode)) {
      throw new Error(`expected servers-mode-${m} aria-pressed=${m === mode}, got ${pressed}`)
    }
  }
}

export async function setMode(page, mode) {
  await page.getByTestId(`servers-mode-${mode}`).click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (m) =>
      document.querySelector(`[data-testid="servers-mode-${m}"]`)?.getAttribute('aria-pressed') ===
      'true',
    mode,
    { timeout: TIMEOUT_MS },
  )
}

/** Clicks Refresh and waits for the round it starts to finish. */
export async function refreshAndWait(page) {
  const before = await readFinishedAt(page)
  await page.getByTestId('servers-refresh').click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, before)
}

/** Addresses of every server row currently in the DOM (`servers-row-<ip>:<port>` only). */
export async function rowAddresses(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="servers-row-"]')]
      .map((el) => el.getAttribute('data-testid').slice('servers-row-'.length))
      .filter((id) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(id))
      .sort(),
  )
}

export function assertRows(actual, expected, what) {
  const a = JSON.stringify([...actual].sort())
  const e = JSON.stringify([...expected].sort())
  if (a !== e) throw new Error(`${what}: expected rows ${e}, got ${a}`)
}

/** Asserts the rows within a short grace (no scan, no wait for one): "at once" = render latency only. */
export async function assertRowsSoon(page, expected, what, graceMs = 1_500) {
  const deadline = Date.now() + graceMs
  let actual = await rowAddresses(page)
  while (JSON.stringify(actual) !== JSON.stringify([...expected].sort()) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    actual = await rowAddresses(page)
  }
  assertRows(actual, expected, what)
}
