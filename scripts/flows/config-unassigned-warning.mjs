// Story 253 acceptance flow: a profile no installation uses says so in its own view, offers
// "Assign…" right there, and the warning disappears as soon as an installation is ticked.
//
// Selectors: config-profile-unassigned (the list row's "Not assigned" marker, ConfigListScreen.tsx),
// config-unassigned-banner / config-unassigned-assign (UnassignedProfileBanner.tsx),
// config-profile-row (ConfigView list), the assignments popover is the `panel-raised` ancestor of an
// installation row (AssignmentsMenu.tsx).
const TIMEOUT_MS = 8_000
const BANNER_TEXT = 'No installation uses this config'
const MARKER_TEXT = 'Not assigned'

function listRow(page, name) {
  return page.getByTestId('config-profile-row').filter({ hasText: name }).first()
}

async function expectMarker(page, name, expected) {
  const marker = listRow(page, name).getByTestId('config-profile-unassigned')
  const count = await marker.count()
  if (count !== (expected ? 1 : 0)) {
    throw new Error(`expected ${expected ? 'a' : 'no'} marker on ${name}, found ${count}`)
  }
  if (expected) {
    const text = (await marker.textContent()) ?? ''
    if (!text.includes(MARKER_TEXT)) {
      throw new Error(`expected ${JSON.stringify(MARKER_TEXT)} on ${name}, got ${JSON.stringify(text)}`)
    }
  }
}

async function openProfile(page, name) {
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: name })
    .first()
    .click({ timeout: TIMEOUT_MS })
}

export default async function configUnassignedWarning({ page, shot, step }) {
  const banner = page.getByTestId('config-unassigned-banner')

  step('the list marks the unassigned profile and not the assigned one')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await listRow(page, 'Imported Profile').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectMarker(page, 'Imported Profile', true)
  await expectMarker(page, 'Plain Profile', false)
  await shot('list-not-assigned-marker')

  step('open the unassigned Imported Profile')
  await openProfile(page, 'Imported Profile')

  step('the not-used warning is shown')
  await banner.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = (await banner.textContent()) ?? ''
  if (!text.includes(BANNER_TEXT)) {
    throw new Error(
      `expected the banner to contain ${JSON.stringify(BANNER_TEXT)}, got ${JSON.stringify(text)}`,
    )
  }
  await shot('unassigned-banner')

  step('Assign… opens the assignments popover')
  await page.getByTestId('config-unassigned-assign').click({ timeout: TIMEOUT_MS })
  const popover = page
    .locator('li')
    .filter({ has: page.getByRole('checkbox') })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"panel-raised")][1]')
  await popover.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('unassigned-assign-popover')

  step('ticking an installation removes the banner without leaving the profile')
  await popover.locator('li label').first().click({ timeout: TIMEOUT_MS })
  await banner.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await page.keyboard.press('Escape')
  await popover.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('back on the list the assigned Imported Profile no longer carries the marker')
  await page.getByRole('button', { name: /back/i }).first().click({ timeout: TIMEOUT_MS })
  await listRow(page, 'Imported Profile').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectMarker(page, 'Imported Profile', false)

  step('an assigned profile shows no banner')
  await openProfile(page, 'Plain Profile')
  await page.getByTestId('config-profile-header').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const count = await banner.count()
  if (count !== 0) throw new Error(`expected no unassigned banner on Plain Profile, found ${count}`)
}
