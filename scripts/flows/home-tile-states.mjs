// Story 087 D7 acceptance flow: proves AC4 (loading, and error with a working retry) and AC5 (a
// fault in one dashboard tile's own data source does not break the dashboard - the other tile keeps
// working and arrange mode still functions) for the Home dashboard's two tiles
// (`PlaytimeTile.tsx`, `ConfigProfilesTile.tsx`), both riding `DashboardTileFrame.tsx`'s shared
// four-state frame. None of this is reachable through a fixture variant alone -
// `home-dashboard`/`home-dashboard-empty` in `scripts/lib/screens.mjs` already cover the
// `filled`/`empty` states for both tiles - it needs the in-memory `useTileData` fetch (see
// `src/renderer/src/modules/home/components/useTileData.ts`) to actually fail mid-flight, which
// only fault injection on the shell's one `module:invoke` channel can produce.
//
// ## Why every fault below keeps `home`'s `layout.get` alive
//
// `Dashboard.tsx` gates its ENTIRE render tree - `ArrangeToggle`, `ArrangeBar`, `DashboardGrid`
// and therefore every tile, including the two frames this flow asserts on - behind its own
// `getHomeLayout()` call (`moduleId: 'home', type: 'layout.get'`) having resolved; while `layout` is
// unresolved the dashboard is just the empty `home-dashboard` container with nothing inside it (see
// that component's own `{layout && (...)}` guard). Faulting `module:invoke` unconditionally would
// therefore not show "the tiles are loading/erroring" at all - it would blank the WHOLE dashboard,
// hiding the very testids this flow needs. Every fault mode installed below special-cases exactly
// that one call with a synthetic success response (mirroring `DEFAULT_HOME_LAYOUT`,
// `src/shared/modules/home.ts`) and only fault-injects `library` (`PlaytimeTile.tsx`'s
// `getLibraryStats`) and `config` (`ConfigProfilesTile.tsx`'s `listConfigProfiles`/
// `getProfileSyncState`) calls.
//
// ## Why nothing here tries to fault one moduleId while forwarding the rest to the real handler
//
// There is no public Electron API to wrap an already-registered `ipcMain.handle()` listener while
// still forwarding unmatched calls to it - `ipcMain.removeHandler(channel)` discards the original
// closure for good, so the very first fault installed below (the AC4 loading step) already retires
// the real, boot-time `module:invoke` handler (`src/main/ipc/modules.ts`) for the rest of this
// process's life. Every step from then on is sequenced so nothing ever needs that forwarding back:
//   - AC4's loading/error steps fault every moduleId identically (other than the `layout.get`
//     passthrough above), so nothing needs to distinguish moduleIds at all yet.
//   - AC5's "one tile's data source fails, the other keeps working" needs two DIFFERENT outcomes
//     for the SAME handler at the SAME time. Rather than a remount (which would re-trigger BOTH
//     tiles' fetches - and, per the note above, `home`'s own `layout.get` too), this uses
//     `useTileData`'s own `retry()`: a tile's Retry button re-invokes ONLY that tile's fetcher, in
//     place, with no remount of anything else. Clicking both tiles' retry buttons under one "reject
//     `library`, hang everything else" handler proves each tile's outcome is decided independently
//     by its own moduleId - exactly AC5's claim - without ever needing the discarded real handler
//     back. Review fix (second cycle): `config` (`ConfigProfilesTile.tsx`'s own data source) is now
//     answered with a fabricated success response instead of hanging forever - the stronger proof of
//     AC5's actual wording ("the other tile keeps working"), reaching a genuine `filled` state with
//     real (fixture-shaped) data rather than merely "still trying, never errored" - see the comment
//     on `installRejectLibraryFault` below for the exact response shapes.
//
// Selectors, not guesses:
//   nav-library / nav-home            TitleBar.tsx
//   dashboard-tile-playtime           DashboardTile.tsx (`data-testid={dashboard-tile-${moduleId}}`)
//   dashboard-tile-configProfiles     DashboardTile.tsx, same convention
//   dashboard-tile-frame-loading      DashboardTileFrame.tsx
//   dashboard-tile-frame-error        DashboardTileFrame.tsx
//   dashboard-tile-frame-filled       DashboardTileFrame.tsx (via `TileFrameBoundary`, the non-error render path)
//   dashboard-tile-frame-retry        DashboardTileFrame.tsx (the retry button inside the error state)
//   dashboard-arrange-toggle          ArrangeToggle.tsx
//   dashboard-catalog                 ArrangeBar.tsx
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../lib/paths.mjs'
import { AXE_RUN_OPTIONS } from '../lib/session.mjs'

const TIMEOUT_MS = 8_000

// Story 026/027's `scripts/lib/session.mjs` reads axe-core the same way for the registry-driven
// path; this is the first `ui:flow` script that needs it, so there is no shared flow-facing helper
// to import yet (per this deliverable's own brief) - this replicates that file's exact idiom instead
// of adding one.
const AXE_SOURCE_PATH = join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js')
const axeSource = readFileSync(AXE_SOURCE_PATH, 'utf8')

async function ensureAxe(page) {
  const present = await page.evaluate(() => typeof window.axe !== 'undefined')
  if (!present) await page.evaluate(axeSource)
}

async function assertNoAxeViolations(page, label) {
  await ensureAxe(page)
  const results = await page.evaluate(
    async (options) => await window.axe.run(options),
    AXE_RUN_OPTIONS,
  )
  if (!Array.isArray(results?.violations)) {
    throw new Error(`axe.run() returned no violations array during '${label}' (got ${typeof results})`)
  }
  if (results.violations.length !== 0) {
    const ids = results.violations.map((violation) => `${violation.id} (${violation.impact})`).join(', ')
    throw new Error(
      `expected zero axe violations during '${label}', got ${results.violations.length}: ${ids}`,
    )
  }
}

function tile(page, tileId) {
  return page.getByTestId(`dashboard-tile-${tileId}`)
}

function tileFrame(page, tileId, stateSuffix) {
  return tile(page, tileId).getByTestId(`dashboard-tile-frame-${stateSuffix}`)
}

function tileRetry(page, tileId) {
  return tile(page, tileId).getByTestId('dashboard-tile-frame-retry')
}

/** AC4's loading state: every `module:invoke` call other than the `home`/`layout.get` passthrough
 * (see the file's own header comment) never resolves at all, so both tiles' first-ever fetch sits in
 * `loading` forever. */
async function installHangAllFault(app) {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('module:invoke')
    ipcMain.handle('module:invoke', (_event, request) => {
      if (request?.moduleId === 'home' && request?.type === 'layout.get') {
        return Promise.resolve({
          ok: true,
          value: {
            tiles: [
              { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
              { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 },
            ],
          },
        })
      }
      return new Promise(() => {})
    })
  })
}

/** AC4's error+retry state: every `module:invoke` call other than the passthrough rejects
 * immediately, every time - including a retry, which is the point (a retry against a still-faulted
 * source has to stay failed, proving the button re-invokes a real fetch rather than merely clearing
 * the error locally). */
async function installThrowAllFault(app) {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('module:invoke')
    ipcMain.handle('module:invoke', (_event, request) => {
      if (request?.moduleId === 'home' && request?.type === 'layout.get') {
        return Promise.resolve({
          ok: true,
          value: {
            tiles: [
              { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
              { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 },
            ],
          },
        })
      }
      return Promise.reject(new Error('fixture-injected fault'))
    })
  })
}

/**
 * AC5's partial failure: only `library` (`PlaytimeTile.tsx`'s own data source, `getLibraryStats`)
 * rejects; `config` (`ConfigProfilesTile.tsx`'s own data source) is answered with a fabricated
 * success response so the config tile reaches a genuine `filled` state instead of hanging forever -
 * the stronger proof of AC5's actual wording ("the other tile keeps working"). Every other moduleId
 * (still excepting the `layout.get` passthrough) hangs forever.
 *
 * The real, boot-time `module:invoke` handler was already discarded for good by `installHangAllFault`
 * above (see the file's header comment for why), so these fabricated responses have to match the real
 * handlers' own shapes exactly (`src/shared/modules/config.ts`, `src/renderer/src/modules/config/client.ts`)
 * or `ConfigProfilesTile.tsx`/`profile-rows.ts` would throw trying to read them:
 * - `list` (`CONFIG_HANDLERS.list`): `client.ts#listConfigProfiles` returns `callModule`'s result
 *   as-is, so the resolved value here is `ConfigProfile[]` directly - not double-wrapped.
 * - `syncState` (`CONFIG_HANDLERS.syncState`): `client.ts#getProfileSyncState` unwraps one more
 *   layer (`result.ok ? result.value : result`), so the resolved value here must itself be an
 *   `Outcome<ProfileSyncState>`.
 */
async function installRejectLibraryFault(app) {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('module:invoke')
    const fixtureProfile = {
      id: 'fixture-tile-states-profile',
      name: 'Fixture Profile',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      cvars: {},
      binds: {},
      assignments: [],
    }
    const fixtureSyncState = {
      own: {
        path: 'C:\\fixture\\fixture-tile-states-profile.cfg',
        fileName: 'fixture-tile-states-profile.cfg',
        status: 'inSync',
      },
      installations: [],
    }
    ipcMain.handle('module:invoke', (_event, request) => {
      if (request?.moduleId === 'home' && request?.type === 'layout.get') {
        return Promise.resolve({
          ok: true,
          value: {
            tiles: [
              { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
              { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 },
            ],
          },
        })
      }
      if (request?.moduleId === 'library') {
        return Promise.reject(new Error('fixture-injected library fault'))
      }
      if (request?.moduleId === 'config' && request?.type === 'list') {
        return Promise.resolve({ ok: true, value: [fixtureProfile] })
      }
      if (request?.moduleId === 'config' && request?.type === 'syncState') {
        return Promise.resolve({ ok: true, value: { ok: true, value: fixtureSyncState } })
      }
      return new Promise(() => {})
    })
  })
}

export default async function homeTileStates({ page, app, shot, step }) {
  step('clicking a config profile row opens that profile in the config editor (AC2)')
  // Nothing is faulted yet at this point in the flow, so both tiles fetch real data from the
  // `populated` fixture - this step MUST run before any of the faults below are installed, since
  // `ipcMain.removeHandler('module:invoke')` discards the real, boot-time handler for good (see
  // this file's own header comment).
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await tileFrame(page, 'configProfiles', 'filled').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const plainProfileRow = page
    .getByTestId('config-profiles-tile-list')
    .getByText('Plain Profile', { exact: false })
  await plainProfileRow.click({ timeout: TIMEOUT_MS })
  const profileIdentity = page.getByTestId('config-profile-identity')
  await profileIdentity.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const identityText = await profileIdentity.textContent()
  if (!identityText?.includes('Plain Profile')) {
    throw new Error(
      `expected the config profile identity block to contain 'Plain Profile', got: ${identityText}`,
    )
  }
  await page.getByTestId('config-tab-overview').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('profile-row-opens-editor')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })

  step('start from Library - a clean, not-yet-mounted moment for Home, before any fault exists')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })

  step('fault module:invoke so every tile fetch hangs forever, then open Home (AC4 loading)')
  await installHangAllFault(app)
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await tileFrame(page, 'playtime', 'loading').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoAxeViolations(page, 'loading')
  await shot('loading')

  step('fault module:invoke so every call rejects, and remount Home fresh (AC4 error)')
  await installThrowAllFault(app)
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  const playtimeError = tileFrame(page, 'playtime', 'error')
  await playtimeError.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const playtimeRetry = tileRetry(page, 'playtime')
  await playtimeRetry.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoAxeViolations(page, 'error')
  await shot('error')

  step("click retry against the still-faulted source - proves it re-invokes a real fetch (AC4)")
  await playtimeRetry.click({ timeout: TIMEOUT_MS })
  await playtimeError.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('error-after-retry')

  step('fault module:invoke so only "library" rejects and "config" gets fixture data, with no remount (AC5)')
  await installRejectLibraryFault(app)
  const configRetry = tileRetry(page, 'configProfiles')
  // Both tiles are still sitting in the `error` state the previous (unconditional) fault left them
  // in - their retry buttons are already visible from before this fault was even installed. This
  // wait is a safety net, not the proof; the proof is the assertions after the retries below.
  await configRetry.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step("retry both tiles under the new fault - each tile's outcome now depends only on its own moduleId (AC5)")
  await configRetry.click({ timeout: TIMEOUT_MS })
  await playtimeRetry.click({ timeout: TIMEOUT_MS })
  await playtimeError.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const configFilled = tileFrame(page, 'configProfiles', 'filled')
  await configFilled.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const configErrorCount = await tileFrame(page, 'configProfiles', 'error').count()
  if (configErrorCount !== 0) {
    throw new Error(
      'expected the config profiles tile to never show the error state once only "library" was faulted',
    )
  }

  step('arrange mode still functions while the playtime tile is broken (AC5)')
  await page.getByTestId('dashboard-arrange-toggle').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('dashboard-catalog').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoAxeViolations(page, 'partial-failure')
  await shot('partial-failure')
}
