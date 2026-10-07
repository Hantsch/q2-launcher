// Story 189 D5 acceptance flow: a catalog tile (also one with no directory on disk) opens a detail
// panel with the licence, Project page / Source links and the versions list.
//
// Like `mods-catalog`, the flow's own launch ('populated') is only the vehicle; the real run is a
// freshly seeded variant against the catalog fixture in `ok` mode.
//
// Selectors - read `src/renderer/src/modules/mods/components/ModDetailPanel.tsx`:
//   nav-mods, mods-tile-<dir>, mods-detail-panel, mods-detail-license, mods-detail-project-link,
//   mods-detail-source-link, mods-detail-versions, mods-detail-reveal

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir, withApp } from '../lib/harness.mjs'
import {
  modsCatalogFixtureEntries,
  startModsCatalogFixtureServer,
  writePopulatedFixture,
} from '../lib/fixture.mjs'
import { makeFail } from '../lib/flow-common.mjs'

export const variant = 'populated'

const TIMEOUT_MS = 8_000
const WRITEDIR_NAME = 'Fixture WriteDir Install'
/** Mirrors `HARNESS_CONTENT_REPO_BASE_ENV` (`src/main/lib/ui-harness.ts`). */
const HARNESS_CONTENT_REPO_BASE_ENV = 'Q2L_UI_CONTENT_REPO_BASE'
const DETAIL_VARIANT = 'mods-catalog-detail-ok'

const ENTRY = modsCatalogFixtureEntries().find((e) => e.gamedir === 'action')

let server

export async function setup() {
  server = await startModsCatalogFixtureServer({ mode: 'ok' })
  console.log(`  fixture server: ${server.baseUrl}`)
  return { env: { [HARNESS_CONTENT_REPO_BASE_ENV]: server.baseUrl } }
}

export async function teardown() {
  await server?.close()
}

const fail = makeFail('mods-catalog-detail')

/** Mirrors the idiom of `about-release-notes.mjs`: the harness records `app:openExternal` urls. */
function recordedExternalUrls() {
  try {
    const parsed = JSON.parse(
      readFileSync(join(variantUserDataDir(DETAIL_VARIANT), 'ui-harness-external.json'), 'utf8'),
    )
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function waitForUrl(url) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (recordedExternalUrls().includes(url)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  fail(`${url} never reached app:openExternal`)
}

export default async function modsCatalogDetail({ shot, step }) {
  writePopulatedFixture({ variant: DETAIL_VARIANT })
  await withApp(
    {
      variant: DETAIL_VARIANT,
      viewport: { width: 1280, height: 800 },
      env: { [HARNESS_CONTENT_REPO_BASE_ENV]: server.baseUrl },
    },
    async ({ page }) => {
      await page
        .getByRole('button', { name: WRITEDIR_NAME, exact: true })
        .click({ timeout: TIMEOUT_MS })
      await page.getByTestId('nav-mods').click({ timeout: TIMEOUT_MS })

      step('a catalog-only tile opens a detail panel with the licence')
      await page.getByTestId('mods-tile-action').click({ timeout: TIMEOUT_MS })
      const license = page.getByTestId('mods-detail-license')
      await license.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      if ((await license.innerText()).trim() !== ENTRY.license) fail('licence text differs')
      if ((await page.getByTestId('mods-detail-reveal').count()) !== 0) {
        fail('a gamedir that is not on disk must not offer Reveal folder')
      }

      step('versions: pinned is the default, the pre-release is marked')
      const versions = (await page.getByTestId('mods-detail-versions').innerText()).toLowerCase()
      const lines = versions.split('\n').map((l) => l.trim())
      const find = (v) => lines.findIndex((l) => l.startsWith(v.toLowerCase()))
      if (find('v1.0.0') < 0 || find('v1.1.0-rc1') < 0) fail(`versions missing: ${versions}`)
      const items = page.getByTestId('mods-detail-versions').locator('li')
      const first = (await items.nth(0).innerText()).toLowerCase()
      const second = (await items.nth(1).innerText()).toLowerCase()
      if (!first.includes('default') || first.includes('pre-release'))
        fail(`pinned version should read default only: ${first}`)
      if (!second.includes('pre-release') || second.includes('default'))
        fail(`rc version should read pre-release only: ${second}`)
      await shot('mods-catalog-detail')

      step('Project page and Source leave through app:openExternal')
      await page.getByTestId('mods-detail-project-link').click({ timeout: TIMEOUT_MS })
      await waitForUrl(ENTRY.projectUrl)
      await page.getByTestId('mods-detail-source-link').click({ timeout: TIMEOUT_MS })
      await waitForUrl(ENTRY.sourceUrl)

      step('a catalog gamedir on disk keeps Reveal folder')
      await page.getByTestId('mods-tile-ctf').click({ timeout: TIMEOUT_MS })
      await page
        .getByTestId('mods-detail-reveal')
        .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      await page
        .getByTestId('mods-detail-license')
        .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    },
  )
}
