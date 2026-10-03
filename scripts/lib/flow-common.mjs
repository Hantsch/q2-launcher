import { existsSync, readFileSync } from 'node:fs'

// Primitives every flow script needs; flow-specific helpers live next to the flows that share them.
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** `fail(msg)` throws `<prefix>: <msg>`, so a failing run names the flow that threw. */
export const makeFail = (prefix) => (message) => {
  throw new Error(`${prefix}: ${message}`)
}

/** Plain-text read of a stand-in client's log; empty until the first write. */
export const readLog = (logPath) => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '')

export async function invoke(page, channel, payload) {
  return page.evaluate(({ ch, p }) => window.q2.invoke(ch, p), { ch: channel, p: payload })
}

/** Flips an installation's simulated launch phase through the dev-only channel, no game process. */
export async function simulateLaunch(page, installationId, phase) {
  const outcome = await invoke(page, 'dev:simulateLaunch', { installationId, phase })
  if (!outcome?.ok) {
    throw new Error(`dev:simulateLaunch(${phase}) failed: ${JSON.stringify(outcome)}`)
  }
}

/** A library entry, located by its name heading; `container` is the card's own selector (the
 * library renders cards as `div.items-start` rows, the repair list as `li`). */
export function libraryCard(page, name, container = 'div.items-start') {
  return page.locator(container).filter({ has: page.getByRole('heading', { name, exact: true }) })
}

/** A rail tile by installation name. `scope` picks how it is found: inside the `aside` rail
 * (default), anywhere on the page by role, or by its `installation-tile` testid + aria-label. */
export function railTile(page, name, scope = 'aside') {
  if (scope === 'testid') {
    return page.locator(`[data-testid="installation-tile"][aria-label="${name}"]`)
  }
  const root = scope === 'aside' ? page.locator('aside') : page
  return root.getByRole('button', { name, exact: true })
}
