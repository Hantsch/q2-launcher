// Story 291: Play in the integrated mode runs the demo inside the launcher's stage - no game window
// is launched, the engine gets the installation's game data under `/q2`, the demo plays to its end
// and stays on screen, Stop gives the data back, and a demo whose game data is too large says so and
// offers engine mode. The "engine" is the renderer's fake engine (see `replays-integrated-canvas.mjs`),
// whose counters live on `globalThis.__q2lFakeEngine` and whose console on `__q2lEngineConsole()`.
//
// Selectors: `replays-integrated-loading`, `replays-engine-canvas`, `replays-timeline`,
// `replays-timeline-state`, `replays-timeline-stop`, `replays-stage-reason`,
// `replays-stage-play-engine`, `replays-playback-mode-<mode>`, `actionbar-play[data-action="view"]`.
import { existsSync, readFileSync } from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  REPLAYS_INTEGRATED_GZ_DEMO,
  REPLAYS_INTEGRATED_VARIANT,
  REPLAYS_INTEGRATED_ZIP_ENTRY,
  REPLAYS_PLAY_CTF_DEMO,
  writeReplaysIntegratedPlayFixture,
} from '../lib/fixture.mjs'
import { makeFail } from '../lib/flow-common.mjs'
import { openDemos, openFolder, poll, selectDemo, TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_INTEGRATED_VARIANT

let zipped = false
let installRoot = ''

export async function setup() {
  const fixture = writeReplaysIntegratedPlayFixture()
  zipped = fixture.zipped
  installRoot = fixture.installRoot
  return { env: fixture.env }
}

const fail = makeFail('replays-play-integrated')

const launchCount = (logPath) =>
  (existsSync(logPath) ? readFileSync(logPath, 'utf8').match(/launching/g) : null)?.length ?? 0

export default async function replaysPlayIntegrated({ page, step, shot }) {
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  const canvas = page.getByTestId('replays-engine-canvas')
  const timeline = page.getByTestId('replays-timeline')
  const engineState = () => page.evaluate(() => ({ ...globalThis.__q2lFakeEngine }))
  const consoleLines = () => page.evaluate(() => window.__q2lEngineConsole?.() ?? [])

  async function playSelected() {
    await poll('Play to be enabled', async () => !(await play.isDisabled()), TIMEOUT_MS)
    await play.click({ timeout: TIMEOUT_MS })
  }

  async function expectFinished(label) {
    await canvas.waitFor({ state: 'visible', timeout: 15_000 })
    await poll(
      `${label}: the timeline to show the demo ended`,
      async () =>
        ((await page.getByTestId('replays-timeline-state').textContent()) ?? '').includes(
          'Finished',
        ),
      15_000,
    )
    if (!(await canvas.isVisible())) fail(`${label}: the picture must stay after the end`)
  }

  async function stop() {
    await page.getByTestId('replays-timeline-stop').click({ timeout: TIMEOUT_MS })
    await canvas.waitFor({ state: 'detached', timeout: 10_000 })
    await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  }

  step('the mode is integrated; playing the ctf demo shows loading, then the picture')
  await openDemos(page)
  await page.getByTestId('replays-playback-mode-integrated').click({ timeout: TIMEOUT_MS })
  await poll(
    'the integrated switch to be pressed',
    async () =>
      (await page.getByTestId('replays-playback-mode-integrated').getAttribute('aria-pressed')) ===
      'true',
    TIMEOUT_MS,
  )
  await openFolder(page, 'ctf')
  await selectDemo(page, REPLAYS_PLAY_CTF_DEMO)
  const launchesBefore = launchCount(logPath)
  await page.evaluate(() => {
    window.__q2lSawLoading = false
    window.__q2lFetched = []
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      window.__q2lFetched.push(String(input instanceof Request ? input.url : input))
      return realFetch(input, init)
    }
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="replays-integrated-loading"]'))
        window.__q2lSawLoading = true
    }).observe(document.body, { childList: true, subtree: true })
  })
  await playSelected()
  await canvas.waitFor({ state: 'visible', timeout: 15_000 })
  if (!(await page.evaluate(() => window.__q2lSawLoading))) fail('the loading text never showed')
  await shot('integrated-playing')

  step('the engine got the manifest under /q2, the launcher args and the session cvars')
  const engine = await engineState()
  const paths = Object.keys(engine.files)
  if (!paths.some((p) => p.startsWith('/q2/baseq2/') && p.endsWith('.pak')))
    fail(`no base pak under /q2: ${JSON.stringify(paths)}`)
  if (!paths.some((p) => /^\/q2\/ctf\/demos\/_launcher\/.+\.dm2$/.test(p)))
    fail(`the demo is not under demos/_launcher/: ${JSON.stringify(paths)}`)
  const args = (engine.mainArgs[0] ?? []).join(' ')
  for (const part of ['+set basedir /q2', '+set homedir ', '+set game ctf'])
    if (!args.includes(part)) fail(`callMain args lack "${part}": ${args}`)
  for (const [name, value] of [
    ['scr_showpause', '0'],
    ['cl_autopause', '0'],
    ['con_notifylines', '0'],
    ['scr_demobar', '0'],
    ['cl_demowait', '1'],
  ])
    if (engine.cvars[name] !== value)
      fail(`cvar ${name} is ${JSON.stringify(engine.cvars[name])}, not ${value}`)
  if (launchCount(logPath) !== launchesBefore) fail('integrated play must not launch a client')

  step('the demo plays to its end, the picture stays, the console shows no launcher plumbing')
  await expectFinished('ctf demo')
  await shot('integrated-finished')
  const lines = await consoleLines()
  const noisy = lines.filter((l) => l.includes('q2l_') || l.includes('Execing'))
  if (noisy.length) fail(`engine console shows plumbing: ${JSON.stringify(noisy)}`)

  step('Stop brings the placeholder back and releases the data')
  const token = await page.evaluate(() => {
    const urls = window.__q2lFetched.filter((n) => n.includes('/engine-data/'))
    const match = /\/engine-data\/([^/]+)\//.exec(urls[urls.length - 1] ?? '')
    return match ? match[1] : null
  })
  if (!token) fail('no /engine-data/ request was observed')
  await stop()
  await poll(
    'the old token to answer 404',
    async () =>
      (await page.evaluate((t) => fetch(`/engine-data/${t}/0`).then((r) => r.status), token)) ===
      404,
    TIMEOUT_MS,
  )
  await page.evaluate(() => {
    globalThis.__q2lFakeEngine.demoPlayMs = 300
  })

  step('the .dm2.gz demo plays')
  await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })
  await openFolder(page, 'baseq2')
  await selectDemo(page, REPLAYS_INTEGRATED_GZ_DEMO)
  await playSelected()
  await expectFinished('gz demo')
  if (
    !Object.keys((await engineState()).files).some((p) =>
      /^\/q2\/baseq2\/demos\/_launcher\/.+\.dm2\.gz$/.test(p),
    )
  )
    fail(
      `the gz demo is not under demos/_launcher/: ${JSON.stringify(Object.keys((await engineState()).files))}`,
    )
  await stop()

  if (!zipped)
    fail(
      'resources/bin/7za.exe is missing - the zip-entry step is mandatory; run `npm run fetch:7za`',
    )
  step('a zip-entry demo plays')
  await openFolder(page, 'pack-integrated.zip')
  await selectDemo(page, REPLAYS_INTEGRATED_ZIP_ENTRY)
  await playSelected()
  await expectFinished('zip-entry demo')
  if (
    !Object.keys((await engineState()).files).some((p) =>
      /^\/q2\/baseq2\/demos\/_launcher\/.+\.dm2$/.test(p),
    )
  )
    fail(
      `the zip demo is not under demos/_launcher/: ${JSON.stringify(Object.keys((await engineState()).files))}`,
    )
  await stop()
  if (launchCount(logPath) !== launchesBefore) fail('integrated play must not launch a client')

  step('a demo whose game data is too large says so and offers engine mode')
  const pak = join(installRoot, 'baseq2', 'pak1.pak')
  await writeFile(pak, 'x')
  const handle = await open(pak, 'r+')
  await handle.truncate(1024 ** 3 + 1024 ** 2)
  await handle.close()
  await page.getByTestId('replays-crumb').first().click({ timeout: TIMEOUT_MS })
  await openFolder(page, 'ctf')
  await selectDemo(page, REPLAYS_PLAY_CTF_DEMO)
  await playSelected()
  const reason = page.getByTestId('replays-stage-reason')
  await reason.waitFor({ state: 'visible', timeout: 15_000 })
  const reasonText = (await reason.textContent()) ?? ''
  const sizeMb = Number(/(\d+)\s*MB/.exec(reasonText)?.[1])
  if (!reasonText.includes('integrated playback') || !(sizeMb >= 1025))
    fail(`the reason must name the game data size (>= 1025 MB): ${JSON.stringify(reasonText)}`)
  await shot('integrated-too-large')
  const before = launchCount(logPath)
  await page.getByTestId('replays-stage-play-engine').click({ timeout: TIMEOUT_MS })
  await poll(
    'the mode switch to show the engine window',
    async () =>
      (await page.getByTestId('replays-playback-mode-engine').getAttribute('aria-pressed')) ===
      'true',
    TIMEOUT_MS,
  )
  await poll('the client to launch', async () => launchCount(logPath) > before, 15_000)
}
