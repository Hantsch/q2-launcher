// e2e: the action bar's "Play with..." dialog picks a mod and a map for one start.
// Fixture: one r1q2 installation with game dirs baseq2 + ctf - baseq2/maps/q2dm1.bsp ("The Edge"),
// an unsafe-named baseq2/maps/bad name.bsp, base1 inside baseq2/pak0.pak, and ctf/maps/ctf1.bsp.
import { writePlayWithFixture } from '../lib/fixture.mjs'
import { invoke, readLog, sleep } from '../lib/flow-common.mjs'

export const variant = 'play-with'

const TIMEOUT_MS = 8_000
const LAUNCH_TIMEOUT_MS = 10_000

let spawnable = true

export async function setup() {
  spawnable = writePlayWithFixture({ variant }).spawnable
  return {}
}

const launchLines = (logPath) =>
  readLog(logPath)
    .split(/\r?\n/)
    .filter((line) => line.includes('launching'))

/** Waits for a "launching" line beyond the `before` already seen and returns the newest. */
async function nextLaunchLine(logPath, before) {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS
  for (;;) {
    const lines = launchLines(logPath)
    if (lines.length > before) return lines[lines.length - 1]
    if (Date.now() >= deadline) throw new Error('timed out waiting for a new "launching" line')
    await sleep(150)
  }
}

export default async function playWith({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'play-with: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so there is no spawnable stand-in client.',
    )
    return
  }

  const { logPath } = await invoke(page, 'app:getInfo')
  const dialog = page.getByTestId('play-with-dialog')
  const modSelect = page.getByTestId('play-with-mod')
  const mapSelect = page.getByTestId('play-with-map')
  const fail = (message) => {
    throw new Error(`play-with: ${message}`)
  }

  // The stand-in client exits within milliseconds; both buttons are pressable again afterwards.
  const settled = () =>
    page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="actionbar-play-with"]')
        return !!el && !el.hasAttribute('disabled')
      },
      undefined,
      { timeout: TIMEOUT_MS },
    )
  const openDialog = async () => {
    await settled()
    await page.getByTestId('actionbar-play-with').click({ timeout: TIMEOUT_MS })
    await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await mapSelect.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="play-with-map"]')?.hasAttribute('disabled'),
      undefined,
      { timeout: TIMEOUT_MS },
    )
  }
  const mapOptions = async () =>
    (await mapSelect.locator('option').allTextContents()).map((text) => text.trim())
  const chooseMod = async (value) => {
    await modSelect.selectOption(value)
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="play-with-map"]')?.hasAttribute('disabled'),
      undefined,
      { timeout: TIMEOUT_MS },
    )
  }
  const startFromDialog = async (before) => {
    await page.getByTestId('play-with-start').click({ timeout: TIMEOUT_MS })
    return nextLaunchLine(logPath, before)
  }

  step('AC1: Play with opens a dialog with a mod and a map select')
  await openDialog()
  await modSelect.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('play-with-dialog')

  step('AC2: the map list follows the mod and is sorted')
  await chooseMod('ctf')
  const ctfMaps = await mapOptions()
  const ctfNames = ctfMaps.slice(1).map((label) => label.split(' ')[0])
  if (ctfNames.join(',') !== 'base1,ctf1,q2dm1' || !ctfMaps.some((l) => l.includes('The Edge'))) {
    fail(`ctf maps were ${JSON.stringify(ctfMaps)}`)
  }
  await chooseMod('')
  const baseMaps = (await mapOptions()).slice(1).map((label) => label.split(' ')[0])
  if (baseMaps.join(',') !== 'base1,q2dm1') fail(`base maps were ${JSON.stringify(baseMaps)}`)

  step('AC5: a map with an unsafe name is not offered')
  if ((await mapOptions()).some((label) => label.includes('bad name'))) {
    fail('"bad name" is offered in the base game list')
  }
  await chooseMod('ctf')
  if ((await mapOptions()).some((label) => label.includes('bad name'))) {
    fail('"bad name" is offered in the ctf list')
  }

  step('AC3: starting launches the chosen mod and map')
  await mapSelect.selectOption('ctf1')
  const withMap = await startFromDialog(launchLines(logPath).length)
  if (
    !withMap.includes('+set game ctf +set deathmatch 1') ||
    !withMap.trimEnd().endsWith('+map ctf1')
  ) {
    fail(`unexpected launching line ${JSON.stringify(withMap)}`)
  }
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('AC4: reopening the dialog shows the last choice')
  await openDialog()
  if ((await modSelect.inputValue()) !== 'ctf' || (await mapSelect.inputValue()) !== 'ctf1') {
    fail('the dialog did not restore ctf / ctf1')
  }
  await shot('play-with-remembered')

  step('AC3: No map starts at the menu')
  await mapSelect.selectOption('')
  const noMap = await startFromDialog(launchLines(logPath).length)
  if (noMap.includes('+map') || noMap.includes('deathmatch')) {
    fail(`a start without a map carried map arguments: ${JSON.stringify(noMap)}`)
  }
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('AC6: plain Play still launches without a map')
  await openDialog()
  await mapSelect.selectOption('ctf1')
  await startFromDialog(launchLines(logPath).length)
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  await settled()
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="actionbar-play"]')?.hasAttribute('disabled'),
    undefined,
    { timeout: TIMEOUT_MS },
  )
  const before = launchLines(logPath).length
  await page.getByTestId('actionbar-play').click({ timeout: TIMEOUT_MS })
  const plain = await nextLaunchLine(logPath, before)
  if (plain.includes('+map') || plain.includes('deathmatch') || plain.includes('+set game ctf')) {
    fail(`plain Play carried the dialog's choice: ${JSON.stringify(plain)}`)
  }
  await shot('play-plain')
}
