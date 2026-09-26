// Story 115 (docs/requirements/115-how-hard-the-scan-works-is-a-setting.md) D5 acceptance flow:
// AC1's user-facing half (the servers scan settings group's 7 `servers-scan-settings-*` controls,
// D4) plus AC3 (the manual refresh control on the Servers view works regardless of the two auto
// settings). Mirrors `scripts/flows/settings-downloads-section.mjs`'s harness idiom: `withApp()`
// (`scripts/lib/harness.mjs:380`) asserts the app is still alive at the end, so this flow reads
// `state.json` off disk directly rather than closing/relaunching the app to prove persistence, and
// - like every flow in this directory (`ui:flow` never reseeds between runs) - reverts everything
// it changed before it finishes.
//
// Selectors, not guesses - read `src/renderer/src/modules/servers/ServersSettingsSection.tsx` and
// `src/renderer/src/modules/servers/ServersView.tsx` before changing any of these:
//   nav-settings                                TitleBar.tsx
//   settings-section-servers                    SettingsView.tsx - the shell's own Panel wrapper
//                                                around the contributed section (order: 20)
//   servers-scan-settings-auto-scan-on-open      ServersSettingsSection.tsx - wraps a <Switch>
//   servers-scan-settings-auto-refresh-enabled   ServersSettingsSection.tsx - wraps a <Switch>
//   servers-scan-settings-auto-refresh-interval  ServersSettingsSection.tsx - wraps a <Select>,
//                                                disabled while auto-refresh is off
//   servers-scan-settings-concurrency            ServersSettingsSection.tsx - wraps a <Select>
//   servers-scan-settings-timeout                ServersSettingsSection.tsx - wraps a <Select>
//   servers-scan-settings-retries                ServersSettingsSection.tsx - wraps a <Select>
//   servers-scan-settings-min-spacing            ServersSettingsSection.tsx - wraps a <Select>
//   nav-servers                                  TitleBar.tsx - `nav-${module.id}` (module 106)
//   servers-refresh                              ServersView.tsx - manual scan button (renamed
//                                                from `servers-manual-refresh` in story 116 D5,
//                                                which also disables it while a scan is blocked)
//   servers-scan-status                          ServersView.tsx - live status readout; carries
//                                                `data-running`/`data-finished-at` test-observability
//                                                attributes alongside its i18n-driven visible text
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import { SERVERS_SCAN_SETTINGS_SEED } from '../lib/fixture.mjs'

/** This flow's own dedicated fixture variant (review fix: it used to run against the shared
 * `populated` variant, which put a disabled-sources `servers` key on a fixture story 111's own
 * `servers-master-sources` flow also runs against and asserts ships its three defaults enabled -
 * see `scripts/lib/fixture.mjs`'s `servers.ts ServersState fixture` comment for the full story).
 * Honoured by `scripts/flow.mjs` the same way `news-cover-template.mjs` names `'news-cover'`. */
export const variant = 'servers-scan'

const TIMEOUT_MS = 8_000
// The fixture's one manual server is a dead loopback port with `timeoutMs: 500`/`retries: 0`
// (`SERVERS_SCAN_SETTINGS_SEED`) - the scan itself settles in well under a second, but this flow's
// own settle-wait gets real headroom rather than racing it.
const SCAN_SETTLE_TIMEOUT_MS = 15_000

function readPopulatedStateJson() {
  const path = join(variantUserDataDir(variant), 'state.json')
  return JSON.parse(readFileSync(path, 'utf8'))
}

export default async function serversScanSettings({ page, shot, step }) {
  step('open Settings')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })

  const autoScanOnOpenSwitch = page
    .getByTestId('servers-scan-settings-auto-scan-on-open')
    .getByRole('switch')
  const autoRefreshEnabledSwitch = page
    .getByTestId('servers-scan-settings-auto-refresh-enabled')
    .getByRole('switch')
  const autoRefreshIntervalSelect = page
    .getByTestId('servers-scan-settings-auto-refresh-interval')
    .locator('select')
  const concurrencySelect = page.getByTestId('servers-scan-settings-concurrency').locator('select')
  const timeoutSelect = page.getByTestId('servers-scan-settings-timeout').locator('select')
  const retriesSelect = page.getByTestId('servers-scan-settings-retries').locator('select')
  const minSpacingSelect = page.getByTestId('servers-scan-settings-min-spacing').locator('select')

  step('the scan settings group renders in Settings')
  await autoScanOnOpenSwitch.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step(
    'boot-side: the 7 scan settings controls render the fixture-seeded values, not DEFAULT_SERVERS_STATE.scan',
  )
  const seedChecks = [
    [autoScanOnOpenSwitch, 'aria-checked', String(SERVERS_SCAN_SETTINGS_SEED.autoScanOnOpen)],
    [
      autoRefreshEnabledSwitch,
      'aria-checked',
      String(SERVERS_SCAN_SETTINGS_SEED.autoRefreshEnabled),
    ],
  ]
  for (const [locator, attr, expected] of seedChecks) {
    const actual = await locator.getAttribute(attr)
    if (actual !== expected) {
      throw new Error(`expected ${attr}=${expected}, got ${actual}`)
    }
  }
  const seedSelectChecks = [
    [autoRefreshIntervalSelect, SERVERS_SCAN_SETTINGS_SEED.autoRefreshIntervalMs, 'autoRefreshIntervalMs'],
    [concurrencySelect, SERVERS_SCAN_SETTINGS_SEED.concurrency, 'concurrency'],
    [timeoutSelect, SERVERS_SCAN_SETTINGS_SEED.timeoutMs, 'timeoutMs'],
    [retriesSelect, SERVERS_SCAN_SETTINGS_SEED.retries, 'retries'],
    [minSpacingSelect, SERVERS_SCAN_SETTINGS_SEED.minSpacingMs, 'minSpacingMs'],
  ]
  for (const [select, expected, fieldName] of seedSelectChecks) {
    await select.locator('option:checked').waitFor({ state: 'attached', timeout: TIMEOUT_MS })
    const actual = await select.inputValue()
    if (Number(actual) !== expected) {
      throw new Error(`expected ${fieldName} select to show the seeded ${expected}, got ${actual}`)
    }
  }

  await shot('boot-state')

  step('all 7 scan settings controls can each be changed to a different valid choice')
  // Every next value below is a different member of that field's own choice list
  // (`SCAN_*_CHOICES`/`SCAN_*_CHOICES_MS`, src/shared/modules/servers.ts) than the seed above.
  const nextConcurrency = 8
  const nextTimeoutMs = 1000
  const nextRetries = 1
  const nextMinSpacingMs = 30_000
  const nextAutoRefreshIntervalMs = 120_000
  const nextAutoScanOnOpen = !SERVERS_SCAN_SETTINGS_SEED.autoScanOnOpen
  const nextAutoRefreshEnabled = !SERVERS_SCAN_SETTINGS_SEED.autoRefreshEnabled

  async function selectAndWait(select, testId, value) {
    await select.selectOption(String(value), { timeout: TIMEOUT_MS })
    await page.waitForFunction(
      ({ testId, value }) =>
        document.querySelector(`[data-testid="${testId}"] select`)?.value === value,
      { testId, value: String(value) },
      { timeout: TIMEOUT_MS },
    )
  }

  async function clickSwitchAndWait(switchLocator, testId, expected) {
    await switchLocator.click({ timeout: TIMEOUT_MS })
    await page.waitForFunction(
      ({ testId, expected }) =>
        document
          .querySelector(`[data-testid="${testId}"] [role="switch"]`)
          ?.getAttribute('aria-checked') === expected,
      { testId, expected: String(expected) },
      { timeout: TIMEOUT_MS },
    )
  }

  await selectAndWait(concurrencySelect, 'servers-scan-settings-concurrency', nextConcurrency)
  await selectAndWait(timeoutSelect, 'servers-scan-settings-timeout', nextTimeoutMs)
  await selectAndWait(retriesSelect, 'servers-scan-settings-retries', nextRetries)
  await selectAndWait(minSpacingSelect, 'servers-scan-settings-min-spacing', nextMinSpacingMs)
  // Changed while still enabled (the seed's `autoRefreshEnabled: true`) - flipping the switch off
  // happens after, so this select is never touched while disabled.
  await selectAndWait(
    autoRefreshIntervalSelect,
    'servers-scan-settings-auto-refresh-interval',
    nextAutoRefreshIntervalMs,
  )
  await clickSwitchAndWait(
    autoScanOnOpenSwitch,
    'servers-scan-settings-auto-scan-on-open',
    nextAutoScanOnOpen,
  )
  await clickSwitchAndWait(
    autoRefreshEnabledSwitch,
    'servers-scan-settings-auto-refresh-enabled',
    nextAutoRefreshEnabled,
  )

  await shot('values-changed')

  step('the changed values persisted in state.json')
  const changed = readPopulatedStateJson()
  const expectedChanged = {
    concurrency: nextConcurrency,
    timeoutMs: nextTimeoutMs,
    retries: nextRetries,
    minSpacingMs: nextMinSpacingMs,
    autoScanOnOpen: nextAutoScanOnOpen,
    autoRefreshEnabled: nextAutoRefreshEnabled,
    autoRefreshIntervalMs: nextAutoRefreshIntervalMs,
  }
  for (const [field, expected] of Object.entries(expectedChanged)) {
    if (changed.servers?.scan?.[field] !== expected) {
      throw new Error(
        `expected state.json's servers.scan.${field} to be ${expected}, got ${JSON.stringify(changed.servers?.scan)}`,
      )
    }
  }

  // `ui:flow` never reseeds between runs - revert every control back to its seeded value so a
  // second run's boot-side assertions above (which compare against the fixture's fixed
  // `SERVERS_SCAN_SETTINGS_SEED`, not "whatever was last written") still pass.
  step('revert all 7 scan settings controls back to their seeded values')
  // Auto-refresh-enabled goes back to `true` FIRST, re-enabling the interval select before it is
  // touched again (a disabled <select> is not actionable to Playwright).
  await clickSwitchAndWait(
    autoRefreshEnabledSwitch,
    'servers-scan-settings-auto-refresh-enabled',
    SERVERS_SCAN_SETTINGS_SEED.autoRefreshEnabled,
  )
  await clickSwitchAndWait(
    autoScanOnOpenSwitch,
    'servers-scan-settings-auto-scan-on-open',
    SERVERS_SCAN_SETTINGS_SEED.autoScanOnOpen,
  )
  await selectAndWait(
    autoRefreshIntervalSelect,
    'servers-scan-settings-auto-refresh-interval',
    SERVERS_SCAN_SETTINGS_SEED.autoRefreshIntervalMs,
  )
  await selectAndWait(
    minSpacingSelect,
    'servers-scan-settings-min-spacing',
    SERVERS_SCAN_SETTINGS_SEED.minSpacingMs,
  )
  await selectAndWait(retriesSelect, 'servers-scan-settings-retries', SERVERS_SCAN_SETTINGS_SEED.retries)
  await selectAndWait(timeoutSelect, 'servers-scan-settings-timeout', SERVERS_SCAN_SETTINGS_SEED.timeoutMs)
  await selectAndWait(
    concurrencySelect,
    'servers-scan-settings-concurrency',
    SERVERS_SCAN_SETTINGS_SEED.concurrency,
  )

  const reverted = readPopulatedStateJson()
  for (const [field, expected] of Object.entries(SERVERS_SCAN_SETTINGS_SEED)) {
    if (reverted.servers?.scan?.[field] !== expected) {
      throw new Error(
        `expected the revert to restore state.json's servers.scan.${field} to the seeded ${expected}, got ${JSON.stringify(reverted.servers?.scan)}`,
      )
    }
  }

  step('AC3: both auto settings are explicitly turned off in Settings')
  // Regardless of what the fixture seeded (autoScanOnOpen is already false after the revert above;
  // autoRefreshEnabled is back to the seeded true) - the deliverable's own acceptance line is "the
  // flow turns both auto settings off in Settings", so this makes both `false` explicitly rather
  // than relying on already-off being good enough.
  if ((await autoScanOnOpenSwitch.getAttribute('aria-checked')) !== 'false') {
    await clickSwitchAndWait(autoScanOnOpenSwitch, 'servers-scan-settings-auto-scan-on-open', false)
  }
  if ((await autoRefreshEnabledSwitch.getAttribute('aria-checked')) !== 'false') {
    await clickSwitchAndWait(
      autoRefreshEnabledSwitch,
      'servers-scan-settings-auto-refresh-enabled',
      false,
    )
  }

  step('navigate to the Servers view')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const manualRefresh = page.getByTestId('servers-refresh')
  await manualRefresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await manualRefresh.isDisabled()) {
    throw new Error('expected servers-refresh to be enabled regardless of auto settings')
  }

  step('the manual refresh control starts a scan even with both auto settings off')
  const status = page.getByTestId('servers-scan-status')
  const finishedAtBefore = (await status.getAttribute('data-finished-at')) ?? ''

  await manualRefresh.click({ timeout: TIMEOUT_MS })

  step('the scan visibly ran: it starts running and settles with a new finished timestamp')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="servers-scan-status"]')?.getAttribute('data-running') === 'true',
    null,
    { timeout: TIMEOUT_MS },
  )
  await page.waitForFunction(
    (before) => {
      const el = document.querySelector('[data-testid="servers-scan-status"]')
      return (
        el?.getAttribute('data-running') === 'false' &&
        (el?.getAttribute('data-finished-at') ?? '') !== before &&
        (el?.getAttribute('data-finished-at') ?? '') !== ''
      )
    },
    finishedAtBefore,
    { timeout: SCAN_SETTLE_TIMEOUT_MS },
  )

  await shot('manual-scan-ran')

  // Leaving `autoScanOnOpen`/`autoRefreshEnabled` as this step set them (both off) would leave
  // `autoRefreshEnabled` diverged from the fixture's seeded `true` on disk - breaking a second
  // run's own boot-side assertion above, which is fixed against `SERVERS_SCAN_SETTINGS_SEED`, not
  // "whatever was last written". Restore it back on the Servers-view-adjacent Settings section one
  // more time so this flow leaves nothing changed on disk by the time it ends.
  step('restore auto-refresh-enabled back to its seeded value so a second run boots unchanged')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await autoRefreshEnabledSwitch.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (
    (await autoRefreshEnabledSwitch.getAttribute('aria-checked')) !==
    String(SERVERS_SCAN_SETTINGS_SEED.autoRefreshEnabled)
  ) {
    await clickSwitchAndWait(
      autoRefreshEnabledSwitch,
      'servers-scan-settings-auto-refresh-enabled',
      SERVERS_SCAN_SETTINGS_SEED.autoRefreshEnabled,
    )
  }
  // `autoScanOnOpen`'s seed is already `false`, and AC3 left it `false` too - nothing to restore.

  const finalOnDisk = readPopulatedStateJson()
  if (finalOnDisk.servers?.scan?.autoRefreshEnabled !== SERVERS_SCAN_SETTINGS_SEED.autoRefreshEnabled) {
    throw new Error(
      `expected state.json's servers.scan.autoRefreshEnabled to end back at the seeded ${SERVERS_SCAN_SETTINGS_SEED.autoRefreshEnabled}, got ${JSON.stringify(finalOnDisk.servers?.scan)}`,
    )
  }
  if (finalOnDisk.servers?.scan?.autoScanOnOpen !== SERVERS_SCAN_SETTINGS_SEED.autoScanOnOpen) {
    throw new Error(
      `expected state.json's servers.scan.autoScanOnOpen to end back at the seeded ${SERVERS_SCAN_SETTINGS_SEED.autoScanOnOpen}, got ${JSON.stringify(finalOnDisk.servers?.scan)}`,
    )
  }
}
