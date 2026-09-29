// Story 167 D4 ui:flow: the "Demo playback" category in the Controls tab.
//
// - Q2PRO Profile (assigned to the Q2PRO fixture installation, `scripts/lib/fixture.mjs`): all seven
//   demo rows show, jump forward takes a key, Save writes a bind that resolves `y` to `seek +10`
//   (10 = JUMP_STEP_S, src/shared/replays/timeline.ts) in the profile file on disk - via one alias
//   (`bind y "seek_10"` + `alias seek_10 seek +10`, action-mirror.ts#bindValueFor: only a bare
//   `+command` is bound directly) - then the key is cleared and saved back so the flow ends where it started (ui:flow never reseeds).
// - Plain Profile (both assigned installations are r1q2): the jump and speed rows' bind slots are
//   disabled with their reason as visible text; Pause demo stays bindable.
//
// Selectors: nav-config, config-profile-row, config-tab-controls, config-save (ConfigView /
// ProfileSaveActions), the category chip's role=button "Demo playback", `.ctrl-row` rows filtered
// by their visible name, `.ctrl-keycell .ctrl-slot` (ControlsRow/BindSlot). Key capture and the
// DEL-clears convention mirror controls-extra-keys.mjs.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000
const KEY = 'y'
const JUMP_STEP_S = 10
const Q2PRO_FILE = 'Q2PRO-Profile.cfg'

const ROWS = [
  { name: 'Pause demo', reason: null },
  { name: 'Demo jump back', reason: 'Seeking needs Q2PRO' },
  { name: 'Demo jump forward', reason: 'Seeking needs Q2PRO' },
  { name: 'Demo long jump back', reason: 'Seeking needs Q2PRO' },
  { name: 'Demo long jump forward', reason: 'Seeking needs Q2PRO' },
  { name: 'Demo speed up', reason: 'Speed steps need Q2PRO' },
  { name: 'Demo speed down', reason: 'Speed steps need Q2PRO' },
]

/** The command `KEY` is bound to in `text`, following the one alias indirection the writer uses. */
function resolvedBind(text) {
  const bound = new RegExp(`^bind ${KEY} "([^"]*)"`, 'mi').exec(text)?.[1]
  if (bound === undefined) return undefined
  for (const line of text.split(/\r?\n/)) {
    const m = /^alias (\S+) (.*?)\s*(?:\/\/.*)?$/.exec(line)
    if (m && m[1] === bound) return m[2]
  }
  return bound
}
const EXPECTED_COMMAND = `seek +${JUMP_STEP_S}`

const rowFor = (page, name) =>
  page.locator('.ctrl-row').filter({ has: page.locator('.ctrl-label', { hasText: name }) })

async function openDemoCategory(page, profileName) {
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  // Already inside another profile: back to the list first (the list and a profile are two screens).
  const back = page.getByRole('button', { name: 'Back to profiles' })
  if (await back.isVisible()) await back.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-profile-row').filter({ hasText: profileName }).first().click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-controls').click({ timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Demo playback', exact: true }).click({ timeout: TIMEOUT_MS })
}

async function waitForFile(path, predicate, label) {
  const deadline = Date.now() + TIMEOUT_MS
  let text = ''
  for (;;) {
    try {
      text = readFileSync(path, 'latin1')
      if (predicate(text)) return text
    } catch {
      /* not written yet */
    }
    if (Date.now() >= deadline) throw new Error(`${label}: not satisfied after ${TIMEOUT_MS}ms in ${path}; got ${JSON.stringify(text.slice(-300))}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

export default async function demoActionsBind({ page, shot, step }) {
  step('open Q2PRO Profile > Controls > Demo playback')
  await openDemoCategory(page, 'Q2PRO Profile')

  step('all seven demo rows are shown and none is marked unavailable')
  for (const { name } of ROWS) {
    const row = rowFor(page, name)
    await row.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    if ((await row.count()) !== 1) throw new Error(`expected exactly one "${name}" row, found ${await row.count()}`)
    if ((await row.getAttribute('aria-disabled')) !== null) throw new Error(`"${name}" is aria-disabled on a Q2PRO profile`)
    if (await row.locator('.ctrl-keycell .ctrl-slot').first().isDisabled()) throw new Error(`"${name}" bind slot is disabled on a Q2PRO profile`)
  }
  for (const text of ['Seeking needs Q2PRO', 'Speed steps need Q2PRO']) {
    if (await page.getByText(text).count()) throw new Error(`"${text}" shown on a Q2PRO profile`)
  }
  await shot('q2pro-demo-rows')

  step('bind a key to Demo jump forward and save')
  const jump = rowFor(page, 'Demo jump forward')
  await jump.locator('.ctrl-keycell .ctrl-slot').first().click({ timeout: TIMEOUT_MS })
  await page.keyboard.press(KEY)
  await jump.locator('.ctrl-keycell .ctrl-slot.is-bound').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('config-save').click({ timeout: TIMEOUT_MS })

  const canonical = join(variantUserDataDir('populated'), Q2PRO_FILE)
const EXPECTED_COMMAND = `seek +${JUMP_STEP_S}`
  try {
    step('the profile file on disk holds the seek bind')
    await waitForFile(canonical, (text) => resolvedBind(text) === EXPECTED_COMMAND, `bind ${KEY} -> "${EXPECTED_COMMAND}"`)
    await shot('q2pro-bound-saved')
  } finally {
    step('unbind (DEL while capturing) and save back')
    const slot = jump.locator('.ctrl-keycell .ctrl-slot').first()
    if ((await slot.getAttribute('class'))?.includes('is-bound')) {
      await slot.click({ timeout: TIMEOUT_MS })
      await page.keyboard.press('Delete')
      await jump.locator('.ctrl-keycell .ctrl-slot.is-bound').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
      await page.getByTestId('config-save').click({ timeout: TIMEOUT_MS })
    }
  }
  step('the bind is gone from the file again')
  await waitForFile(canonical, (text) => resolvedBind(text) === undefined, `bind ${KEY} removed`)

  step('open Plain Profile (r1q2 only) > Controls > Demo playback')
  await openDemoCategory(page, 'Plain Profile')

  step('jump and speed rows are disabled with a visible reason; pause is bindable')
  for (const { name, reason } of ROWS) {
    const row = rowFor(page, name)
    await row.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const slots = row.locator('.ctrl-keycell .ctrl-slot')
    const n = await slots.count()
    if (n === 0) throw new Error(`"${name}" has no bind slot`)
    for (let i = 0; i < n; i += 1) {
      const disabled = await slots.nth(i).isDisabled()
      if (disabled !== (reason !== null)) throw new Error(`"${name}" slot ${i}: disabled=${disabled}, expected ${reason !== null}`)
    }
    if (reason) {
      await row.getByText(reason, { exact: true }).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      if ((await row.getAttribute('aria-disabled')) !== 'true') throw new Error(`"${name}" row lacks aria-disabled`)
    } else if ((await row.getAttribute('aria-disabled')) !== null) {
      throw new Error(`"${name}" must not be aria-disabled`)
    }
  }
  await shot('r1q2-demo-rows-disabled')
}
