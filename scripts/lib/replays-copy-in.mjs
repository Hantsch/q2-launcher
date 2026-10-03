// Shared helpers of the replays flows (waiting for the demo scan, finding rows, opening a demo,
// clicking Play, reading the engine stub's command/window logs, watching `<gamedir>/demos/_launcher/`
// and main.log). Selectors: `nav-replays`, `replays-demo-row`,
// `actionbar-play[data-action="view"]`, `actionbar-action-error` (`ActionBar.tsx`), `replays-refresh`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { makeFail, sleep } from './flow-common.mjs'

export const TIMEOUT_MS = 8_000

export async function poll(what, fn, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() >= deadline) throw new Error(`replays-copy-in: timed out waiting for ${what}`)
    await sleep(40)
  }
}

export async function openDemos(page) {
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await poll('the demo scan to finish', async () => !(await refresh.isDisabled()), TIMEOUT_MS)
}

export async function selectDemo(page, fileName) {
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: fileName })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await page
    .locator('[data-testid="actionbar-play"][data-action="view"]')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

export function copiesIn(demosDir) {
  try {
    return readdirSync(join(demosDir, '_launcher'))
  } catch {
    return []
  }
}

export function snapshot(path) {
  const info = statSync(path)
  return { bytes: readFileSync(path).toString('base64'), mtimeMs: info.mtimeMs }
}

export function assertUnchanged(label, path, before) {
  const after = snapshot(path)
  if (after.bytes !== before.bytes) throw new Error(`replays-copy-in: ${label} bytes changed`)
  if (after.mtimeMs !== before.mtimeMs) throw new Error(`replays-copy-in: ${label} mtime changed`)
}

export function launchLines(logPath) {
  const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  return content.split(/\r?\n/).filter((l) => l.includes('launching'))
}

/** Waits until the demo scan finished: the first `index.read` on mount can render a stale/empty
 * snapshot before the scan this same mount triggers swaps the whole list in, so `replays-refresh`
 * re-enabling is the real "settled" signal. */
export async function waitForDemosScanToFinish(
  page,
  { timeout = TIMEOUT_MS, label = 'replays' } = {},
) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + timeout
  while (await refresh.isDisabled()) {
    if (Date.now() >= deadline)
      throw new Error(`${label}: timed out waiting for the demo scan to finish`)
    await sleep(100)
  }
}

export const waitForScan = waitForDemosScanToFinish

export function rowFor(page, text, testId = 'replays-demo-row') {
  return page.getByTestId(testId).filter({ hasText: text })
}

export async function waitForRowCount(page, count, testId = 'replays-demo-row') {
  await page.waitForFunction(
    ([id, expected]) => document.querySelectorAll(`[data-testid="${id}"]`).length >= expected,
    [testId, count],
    { timeout: TIMEOUT_MS },
  )
}

function fileLines(path) {
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.length > 0)
    : []
}

/** Every command the engine stub ran (`Q2L_UI_ENGINE_COMMAND_LOG`). */
export const commands = fileLines

/** Every window-geometry line the engine stub logged (`Q2L_UI_ENGINE_WINDOW_LOG`). */
export const windowLines = fileLines

/** The stage geometry the game was launched with (`+set vid_geometry` on main.log's last launching line). */
export async function launchGeometry(logPath, { fail = defaultFail } = {}) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const line = launchLines(logPath).pop()
    const m = line ? /\+set vid_geometry ((\d+)x(\d+)\+(-?\d+)\+(-?\d+))/.exec(line) : null
    if (m) return { raw: m[1], w: Number(m[2]), h: Number(m[3]), x: Number(m[4]), y: Number(m[5]) }
    if (Date.now() >= deadline)
      fail(`main.log has no launching line with a vid_geometry: ${JSON.stringify(line)}`)
    await sleep(150)
  }
}

const defaultFail = makeFail('replays')
