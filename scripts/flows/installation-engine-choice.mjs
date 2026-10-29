// A folder holding several engines lists them on the library card and the user picks the one Play
// starts (story 246). Fixture `engine-choice`: "Fixture Two Engines" (r1q2 + q2pro + kmquake2,
// stored r1q2) and "Fixture Missing Engine" (q2pro only, stored r1q2 whose executable is gone), both
// written without `detectedEngines`; "Fixture Q2PRO 64" (q2pro64.exe only) and "Fixture Two Builds"
// (q2pro.exe + q2pro64.exe), written without `detectedEngines` or an executable.
//
// Selectors: `installation-engine`, `installation-engine-option-<kind>`,
// `installation-engine-reason-<kind>`,
// `installation-engine-option-<kind>-<basename>` (engines with several builds), `installation-runner-preview`, `engine-badge`,
// `installation-remove-<id>` (row scope), `installation-checks`.
import { writeEngineChoiceFixture } from '../lib/fixture.mjs'

export const variant = 'engine-choice'

const TIMEOUT_MS = 8_000
const TWO_ID = 'fixture-engine-choice-two'
const MISSING_ID = 'fixture-engine-choice-missing'
const Q2PRO64_ID = 'fixture-engine-choice-q2pro64'
const BUILDS_ID = 'fixture-engine-choice-two-builds'
const CHOOSE_ENGINE_LABEL = 'Choose engine…'

// The flow changes the stored engine, so every run starts from a fresh legacy-shaped record.
export async function setup() {
  writeEngineChoiceFixture()
  return {}
}

function rowOf(page, id) {
  return page.locator('div.panel', { has: page.getByTestId(`installation-remove-${id}`) })
}

async function waitForText(locator, predicate, what) {
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const text = (await locator.innerText()).trim()
    if (predicate(text)) return text
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${what}, last seen ${JSON.stringify(text)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

async function waitForChecked(locator, expected, what) {
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    if ((await locator.getAttribute('aria-checked')) === expected) return
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

export default async function installationEngineChoice({ page, step, shot }) {
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })

  step('a folder with several engines lists them, the stored one checked')
  const two = rowOf(page, TWO_ID)
  await two.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const r1q2 = two.getByTestId('installation-engine-option-r1q2')
  const q2pro = two.getByTestId('installation-engine-option-q2pro')
  await r1q2.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await q2pro.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await r1q2.innerText()).trim() !== 'R1Q2' || (await q2pro.innerText()).trim() !== 'Q2PRO') {
    throw new Error('expected chips labelled R1Q2 and Q2PRO')
  }
  await waitForChecked(r1q2, 'true', 'R1Q2 to be checked')
  await shot('two-engines')

  step('an engine the launcher cannot start is disabled with its reason as text')
  const km = two.getByTestId('installation-engine-option-kmquake2')
  await km.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await km.isDisabled())) throw new Error('expected the kmquake2 chip to be disabled')
  const kmReason = two.getByTestId('installation-engine-reason-kmquake2')
  await kmReason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await kmReason.innerText()).includes('Not supported by the launcher yet')) {
    throw new Error('expected the kmquake2 reason to say it is not supported yet')
  }

  step('choosing Q2PRO checks it and the command and badge follow')
  const preview = two.getByTestId('installation-runner-preview')
  await waitForText(preview, (text) => text.includes('-nopathcheck'), 'the r1q2 command preview')
  await q2pro.click({ timeout: TIMEOUT_MS })
  await waitForChecked(q2pro, 'true', 'Q2PRO to be checked')
  const command = await waitForText(
    preview,
    (text) => text.toLowerCase().includes('q2pro') && !text.includes('-nopathcheck'),
    'the q2pro command preview',
  )
  if (command.toLowerCase().includes('r1q2'))
    throw new Error(`preview still names r1q2: ${command}`)
  await waitForText(
    two.getByTestId('engine-badge'),
    (text) => /q2pro/i.test(text),
    'the Q2PRO badge',
  )
  await shot('q2pro-chosen')

  step('a stored engine that is gone keeps its badge and offers "Choose engine…"')
  const missing = rowOf(page, MISSING_ID)
  await missing.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForText(missing.getByTestId('engine-badge'), (text) => /r1q2/i.test(text), 'R1Q2 badge')
  await waitForText(
    missing.getByTestId('installation-checks'),
    (text) => text.includes('The selected executable is gone:'),
    'the missing-executable check',
  )
  const fix = missing.getByRole('button', { name: CHOOSE_ENGINE_LABEL })
  await fix.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('missing-engine')
  await fix.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (id) => document.activeElement?.id === `installation-engine-${id}`,
    MISSING_ID,
    { timeout: TIMEOUT_MS },
  )

  step('choosing Q2PRO clears the check')
  await missing.getByTestId('installation-engine-option-q2pro').click({ timeout: TIMEOUT_MS })
  await fix.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await shot('missing-engine-resolved')

  step('a q2pro64.exe-only folder is Q2PRO and its command names q2pro64.exe')
  const solo = rowOf(page, Q2PRO64_ID)
  await solo.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForText(solo.getByTestId('engine-badge'), (text) => /q2pro/i.test(text), 'Q2PRO badge')
  await waitForText(
    solo.getByTestId('installation-runner-preview'),
    (text) => text.includes('q2pro64.exe'),
    'the q2pro64.exe command preview',
  )

  step('both Q2PRO builds are listed with q2pro64.exe checked')
  const builds = rowOf(page, BUILDS_ID)
  await builds.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const build32 = builds.getByTestId('installation-engine-option-q2pro-q2pro.exe')
  const build64 = builds.getByTestId('installation-engine-option-q2pro-q2pro64.exe')
  await build32.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await build64.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForChecked(build64, 'true', 'q2pro64.exe to be checked')
  await shot('two-builds')

  step('choosing q2pro.exe moves the command to it')
  await build32.click({ timeout: TIMEOUT_MS })
  await waitForChecked(build32, 'true', 'q2pro.exe to be checked')
  const buildsPreview = await waitForText(
    builds.getByTestId('installation-runner-preview'),
    (text) => text.includes('q2pro.exe') && !text.includes('q2pro64.exe'),
    'the q2pro.exe command preview',
  )
  if (buildsPreview.includes('q2pro64.exe')) throw new Error('preview still names q2pro64.exe')
}
