// Story 160 D3: shared helpers of the `replays-copy-in*` flows (opening a demo, clicking Play,
// watching `<gamedir>/demos/_launcher/` and main.log). Selectors: `nav-replays`, `replays-demo-row`,
// `replays-demo-play`, `replays-demo-play-error` (`DemoPlayAction.tsx`), `replays-refresh`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const TIMEOUT_MS = 8_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  await page.getByTestId('replays-demo-play').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
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
