// Story 168 D3 acceptance flow (AC1, AC2, AC4, AC6): the Settings tab's "record every map
// automatically" switch, driven through the real UI per engine scope, asserted against the real
// profile file on disk (never against the renderer's own state).
//
// Selectors: nav-config, config-profile-row, config-tab-settings, config-autorecord-switch/-caveat
// (AutorecordSetting.tsx); the engine scope is the `EngineScopeSelect`'s `<select>` (option values are
// the engine kinds).
//
// `ui:flow` never reseeds, so the flow starts by switching off whatever a previous run left on.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000
const PROFILE_FILE_NAME = 'Autorecord-Profile.cfg'
const Q2PRO_RECORD = 'echo welcome; record ${cl_mapname}_${com_date}_${com_time}'

function readCfg() {
  return readFileSync(join(variantUserDataDir('populated'), PROFILE_FILE_NAME), 'latin1')
}

function lineFor(cfg, name) {
  return cfg.split(/\r?\n/).find((l) => new RegExp(`^\\s*seta?\\s+${name}\\s`).test(l)) ?? null
}

async function waitForCfg(predicate, what) {
  const deadline = Date.now() + TIMEOUT_MS
  let last = ''
  while (Date.now() < deadline) {
    try {
      last = readCfg()
      if (predicate(last)) return last
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(
    `timed out waiting for ${PROFILE_FILE_NAME} to ${what}; last content: ${JSON.stringify(last.slice(0, 600))}`,
  )
}

const valueOf = (line) => (line ? /"([^"]*)"/.exec(line)?.[1] : undefined)

export default async function autorecordSetting({ page, shot, step }) {
  step('open Config > Autorecord Profile > Settings')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Autorecord Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-settings').click({ timeout: TIMEOUT_MS })

  const sw = page.getByTestId('config-autorecord-switch')
  const scope = page
    .locator('select')
    .filter({ has: page.locator('option[value="q2pro"]') })
    .first()
  await sw.waitFor({ state: 'visible', timeout: 15_000 })

  async function setSwitch(on) {
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="config-autorecord-switch"]')?.disabled,
      null,
      { timeout: TIMEOUT_MS },
    )
    if ((await sw.getAttribute('aria-checked')) !== String(on))
      await sw.click({ timeout: TIMEOUT_MS })
    await page.waitForFunction(
      (want) =>
        document
          .querySelector('[data-testid="config-autorecord-switch"]')
          ?.getAttribute('aria-checked') === want,
      String(on),
      { timeout: TIMEOUT_MS },
    )
    // The switch edits the profile draft ("Unsaved"); the header's Save writes the .cfg to disk.
    const save = page.getByTestId('config-save')
    if ((await save.count()) > 0 && (await save.isEnabled())) {
      await save.click({ timeout: TIMEOUT_MS })
      await page
        .getByTestId('config-tab-unsaved')
        .waitFor({ state: 'detached', timeout: TIMEOUT_MS })
        .catch(() => {})
    }
  }

  async function pickScope(kind) {
    await scope.selectOption({ value: kind })
    await page
      .getByTestId('config-autorecord-caveat')
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    if ((await scope.inputValue()) !== kind)
      throw new Error(`engine scope did not switch to ${kind}`)
  }

  step('idempotence: switch off on both scopes if a previous run left it on')
  await pickScope('q2pro')
  await setSwitch(false)
  await pickScope('r1q2')
  await setSwitch(false)

  step('r1q2 scope: same-minute caveat visible, switch on writes cl_autorecord "1"')
  const r1q2Caveat = page.getByTestId('config-autorecord-caveat')
  await r1q2Caveat.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const r1q2Text = (await r1q2Caveat.innerText()).trim()
  if (!/minute/i.test(r1q2Text))
    throw new Error(`r1q2 caveat should mention the same-minute limit, got: ${r1q2Text}`)
  await shot('r1q2-off')
  await setSwitch(true)
  const onCfg = await waitForCfg(
    (c) => lineFor(c, 'cl_autorecord') !== null,
    'contain cl_autorecord',
  )
  const onLine = lineFor(onCfg, 'cl_autorecord')
  if (!/^\s*set\s/.test(onLine) || valueOf(onLine) !== '1')
    throw new Error(`expected a \`set cl_autorecord "1"\` line, got: ${onLine}`)
  await shot('r1q2-on')

  step('r1q2 scope: switch off removes cl_autorecord')
  await setSwitch(false)
  await waitForCfg((c) => lineFor(c, 'cl_autorecord') === null, 'drop cl_autorecord')

  step('Q2PRO scope: console-clock caveat visible, switch on chains record after the existing cmd')
  await pickScope('q2pro')
  const q2proText = (await page.getByTestId('config-autorecord-caveat').innerText()).trim()
  if (!/clock|time/i.test(q2proText))
    throw new Error(`Q2PRO caveat should mention the console clock, got: ${q2proText}`)
  await shot('q2pro-off')
  await setSwitch(true)
  const q2On = await waitForCfg(
    (c) => lineFor(c, 'com_time_format') !== null,
    'contain com_time_format',
  )
  const beginOn = lineFor(q2On, 'cl_beginmapcmd')
  if (!beginOn || !/^\s*set\s/.test(beginOn) || valueOf(beginOn) !== Q2PRO_RECORD)
    throw new Error(`expected \`set cl_beginmapcmd "${Q2PRO_RECORD}"\`, got: ${beginOn}`)
  const fmt = lineFor(q2On, 'com_time_format')
  if (!/^\s*set\s/.test(fmt) || valueOf(fmt) !== '%H-%M-%S')
    throw new Error(`expected \`set com_time_format "%H-%M-%S"\`, got: ${fmt}`)
  await shot('q2pro-on')

  step('Q2PRO scope: switch off restores cl_beginmapcmd and drops com_time_format')
  await setSwitch(false)
  const q2Off = await waitForCfg(
    (c) => lineFor(c, 'com_time_format') === null,
    'drop com_time_format',
  )
  const beginOff = lineFor(q2Off, 'cl_beginmapcmd')
  if (valueOf(beginOff) !== 'echo welcome')
    throw new Error(`expected cl_beginmapcmd back to "echo welcome", got: ${beginOff}`)
  if (lineFor(q2Off, 'cl_autorecord') !== null) throw new Error('cl_autorecord must stay absent')
  await shot('q2pro-off-again')
}
