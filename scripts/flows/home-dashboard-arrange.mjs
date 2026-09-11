// Story 086 D3 acceptance flow: the dashboard's read-only render path guarantees - AC2 and AC3 -
// proven against the real, running app. D4/D5/D6 append further steps to this same file (arrange
// mode entry, the catalog, pointer drag/resize, reset); these first two steps are what D3 alone
// has to prove:
//   - outside arrange mode (the only mode that exists until D4), nothing can be dragged at all;
//   - below the dashboard container's own 900px width the layout renders as one column in
//     row-major order, and never persists anything while doing it.
//
// Runs against the `populated` fixture (the flow's own default variant, `scripts/flow.mjs`), whose
// `homeLayout` (scripts/lib/fixture.mjs's `populatedStateDocument()`) seeds a gapped, non-default
// two-tile arrangement:
//   playtime         x:1 y:0 w:4 h:4
//   configProfiles   x:7 y:2 w:4 h:5
// `playtime` sits at the lower `y`, so `stack()`'s row-major order (src/renderer/src/modules/home/
// dashboard/layout.ts) puts it before `configProfiles` - `SEEDED_STACK_ORDER` below.
//
// Selectors, not guesses - read Dashboard.tsx/DashboardTile.tsx before changing any of these:
//   home-dashboard              Dashboard.tsx - the dashboard's own container
//   dashboard-tile-<moduleId>   DashboardTile.tsx - one per placed tile, keyed by its moduleId
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resize, variantUserDataDir } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors src/shared/modules/home.ts's `GRID_COLUMNS`/`NARROW_THRESHOLD_PX` - duplicated as a
 * literal rather than imported, the same reason every other `.mjs` script in this repo duplicates a
 * shared TS constant instead of importing it: this file runs directly under `node`, with no
 * TypeScript loader in the chain (see `scripts/lib/harness.mjs`'s own `EXPECTED_RENDERER_ORIGIN`
 * doc comment). */
const GRID_COLUMNS = 12
const NARROW_THRESHOLD_PX = 900
/** `GRID_ROW_HEIGHT + GRID_GAP_PX` - the real distance between two adjacent rows' top edges, and
 * exactly the pitch `Dashboard.tsx` converts a vertical drag with (story 086 D5). A drag distance
 * computed from the bare 40px row height would land a "2 row" gesture on row 1. */
const ROW_PITCH_PX = 40 + 12

const DEFAULT_VIEWPORT = { width: 1280, height: 800 }
/** Mirrors `scripts/lib/screens.mjs`'s `VIEWPORT_MIN` - below `NARROW_THRESHOLD_PX` at the
 * dashboard container's own measured width. */
const NARROW_VIEWPORT = { width: 940, height: 620 }

/** The seeded `homeLayout`'s two tiles, in `stack()`'s row-major (y-then-x) reading order -
 * `playtime` (y:0) before `configProfiles` (y:2). Mirrors `scripts/lib/fixture.mjs`'s
 * `populatedStateDocument()` exactly; if that seed ever changes, this must change with it. */
const SEEDED_STACK_ORDER = ['playtime', 'configProfiles']

/** Byte-identical to the fixture's own seeded `homeLayout` (see `SEEDED_STACK_ORDER` above) - used
 * to assert `state.json` was never touched by the narrow render. */
const EXPECTED_HOME_LAYOUT = {
  tiles: [
    { moduleId: 'playtime', x: 1, y: 0, w: 4, h: 4 },
    { moduleId: 'configProfiles', x: 7, y: 2, w: 4, h: 5 },
  ],
}

/** Mirrors src/shared/modules/home.ts's `DEFAULT_HOME_LAYOUT` - literal, same reason as
 * `EXPECTED_HOME_LAYOUT`/`GRID_COLUMNS` above (no TS loader in this file's chain). What D4's
 * "Reset to default" must restore both tiles to. */
const DEFAULT_HOME_LAYOUT = {
  tiles: [
    { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
    { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 },
  ],
}

async function openHomeDashboard(page) {
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('home-dashboard').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

async function tileRect(page, moduleId) {
  const box = await page.getByTestId(`dashboard-tile-${moduleId}`).boundingBox()
  if (!box) throw new Error(`dashboard-tile-${moduleId} has no bounding box - is it rendered?`)
  return box
}

function assertRectsEqual(before, after, label) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (Math.abs(before[key] - after[key]) > 0.01) {
      throw new Error(
        `${label}: ${key} changed - before=${before[key]} after=${after[key]} ` +
          `(full before=${JSON.stringify(before)} after=${JSON.stringify(after)})`,
      )
    }
  }
}

/** Waits for the dashboard container's own measured width to cross `NARROW_THRESHOLD_PX`, on the
 * side `expectBelow` names - never trusts a fixed timeout for a resize's re-render. */
async function waitForContainerWidthCross(page, expectBelow) {
  await page.waitForFunction(
    ({ threshold, expectBelow: below }) => {
      const el = document.querySelector('[data-testid="home-dashboard"]')
      if (!el) return false
      const width = el.getBoundingClientRect().width
      return below ? width < threshold : width >= threshold
    },
    { threshold: NARROW_THRESHOLD_PX, expectBelow },
    { timeout: TIMEOUT_MS },
  )
}

/** Reads a placed tile's own inline `gridColumn`/`gridRow` (the exact strings `DashboardGrid.tsx`
 * sets via the `style` prop, e.g. `"6 / span 6"`) straight off the DOM - `null` if the tile isn't
 * rendered at all. Used by the reset step below to assert exact cell geometry without going
 * through pixel math (which `columnWidthPx` above already covers for the drag/narrow steps). */
async function tileGridCell(page, moduleId) {
  return page.evaluate((testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`)
    if (!el || !(el instanceof HTMLElement)) return null
    return { gridColumn: el.style.gridColumn, gridRow: el.style.gridRow }
  }, `dashboard-tile-${moduleId}`)
}

/** Parses a `"<line> / span <count>"` grid-placement string into 0-based cell coordinates. */
function parseGridCell(value) {
  const match = /^(\d+)\s*\/\s*span\s*(\d+)$/.exec(value ?? '')
  if (!match) throw new Error(`unexpected grid placement value: ${JSON.stringify(value)}`)
  return { start: Number(match[1]) - 1, span: Number(match[2]) }
}

/** Asserts a rendered tile's own inline grid placement matches `expected`'s `x`/`y`/`w`/`h` cells
 * exactly - the reset step's own acceptance ("the two 6x5 tiles", AC12). */
function assertTileAtCell(cell, expected, label) {
  if (!cell) throw new Error(`${label}: tile has no rendered grid placement - is it mounted?`)
  const column = parseGridCell(cell.gridColumn)
  const row = parseGridCell(cell.gridRow)
  const actual = { x: column.start, w: column.span, y: row.start, h: row.span }
  const mismatched = ['x', 'y', 'w', 'h'].filter((key) => actual[key] !== expected[key])
  if (mismatched.length > 0) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)} ` +
        `(mismatched keys: ${mismatched.join(', ')})`,
    )
  }
}

/** Polls a tile's own inline grid placement until it reaches `expected`, then asserts it exactly.
 * Every layout change goes through an IPC round trip that the UI does not await before returning
 * (`Dashboard.tsx`'s handlers are fire-and-forget from their callers' point of view), so the tile is
 * already on screen with its PRE-change placement - waiting on mere visibility would race the state
 * update. */
async function waitForTileAtCell(page, moduleId, expected, label) {
  const expectedColumn = `${expected.x + 1} / span ${expected.w}`
  const expectedRow = `${expected.y + 1} / span ${expected.h}`
  await page.waitForFunction(
    ({ testId, expectedColumn, expectedRow }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`)
      return (
        el instanceof HTMLElement &&
        el.style.gridColumn === expectedColumn &&
        el.style.gridRow === expectedRow
      )
    },
    { testId: `dashboard-tile-${moduleId}`, expectedColumn, expectedRow },
    { timeout: TIMEOUT_MS },
  )
  assertTileAtCell(await tileGridCell(page, moduleId), expected, label)
}

/** `state.json`'s `homeLayout` as it is on disk right now - read fresh, no restart (AC10). */
function readPersistedHomeLayout() {
  const statePath = join(variantUserDataDir('populated'), 'state.json')
  return JSON.parse(readFileSync(statePath, 'utf8')).homeLayout
}

function assertPersistedLayout(expected, label) {
  const actual = JSON.stringify(readPersistedHomeLayout())
  if (actual !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected state.json's homeLayout to be ${JSON.stringify(expected)}, got ${actual}`)
  }
}

/**
 * One real pointer drag: press on `testId`, travel `dx`/`dy`, optionally inspect the drag mid-flight,
 * release. Real mouse input, not a synthetic event dispatch - `@dnd-kit`'s `PointerSensor` only
 * activates once genuine pointer events have carried the cursor past its 8px activation distance.
 *
 * Waits for the ghost before calling `midDrag`, so a gesture that never activated at all fails here
 * with a clear message instead of further down as a mysterious "nothing moved".
 */
async function pointerDrag(page, testId, dx, dy, midDrag) {
  // `page.mouse` presses raw window coordinates and scrolls nothing into view itself, so a handle
  // below the fold would be "pressed" off screen. Every accepted change makes the grid taller, which
  // is exactly how a handle ends up down there between steps - hence a scroll per drag, and a
  // matching one in each step before it measures its own before/after rects (a scroll in between
  // would shift them).
  await page.getByTestId(testId).scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  const handle = await page.getByTestId(testId).boundingBox()
  if (!handle) throw new Error(`${testId} has no bounding box - is arrange mode on?`)
  const startX = handle.x + handle.width / 2
  const startY = handle.y + handle.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 })

  const ghost = page.getByTestId('dashboard-drag-ghost')
  await ghost.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (midDrag) await midDrag(ghost)

  await page.mouse.up()
}

async function assertGhostInvalid(ghost, expectInvalid, label) {
  const actual = await ghost.getAttribute('data-invalid')
  if (actual !== String(expectInvalid)) {
    throw new Error(`${label}: expected the drag ghost's data-invalid to be "${expectInvalid}", got "${actual}"`)
  }
}

export default async function homeDashboardArrange({ page, app, shot, step }) {
  step('no drag outside arrange mode')
  await openHomeDashboard(page)

  const beforeDrag = await tileRect(page, 'playtime')
  const containerBox = await page.getByTestId('home-dashboard').boundingBox()
  if (!containerBox) throw new Error('home-dashboard has no bounding box')
  const columnWidthPx = containerBox.width / GRID_COLUMNS

  const startX = beforeDrag.x + beforeDrag.width / 2
  const startY = beforeDrag.y + beforeDrag.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + columnWidthPx * 3, startY, { steps: 10 })
  await page.waitForTimeout(100)
  await page.mouse.up()
  await page.waitForTimeout(100)

  const afterDrag = await tileRect(page, 'playtime')
  assertRectsEqual(beforeDrag, afterDrag, 'the playtime tile after a 3-cell pointer drag attempt')
  console.log(
    'a real pointer drag (down, move ~3 cells, up) on the playtime tile moved nothing - no drag ' +
      'sensor is mounted outside arrange mode (AC3)',
  )

  const gripCount = await page
    .getByTestId('dashboard-tile-playtime')
    .locator('[data-testid*="grip"]')
    .count()
  if (gripCount !== 0) {
    throw new Error(
      `expected zero grip/handle elements in the playtime tile outside arrange mode, found ${gripCount}`,
    )
  }
  console.log('no grip/handle element exists anywhere in the playtime tile outside arrange mode')

  await shot('no-drag-outside-arrange-mode')

  step('narrow stacks and widening restores')
  const wideRects = {}
  for (const moduleId of SEEDED_STACK_ORDER) {
    wideRects[moduleId] = await tileRect(page, moduleId)
  }

  await resize(app, NARROW_VIEWPORT)
  await waitForContainerWidthCross(page, true)

  const stackedTiles = []
  for (const moduleId of SEEDED_STACK_ORDER) {
    stackedTiles.push({ moduleId, box: await tileRect(page, moduleId) })
  }
  for (let i = 1; i < stackedTiles.length; i++) {
    const previous = stackedTiles[i - 1]
    const current = stackedTiles[i]
    if (current.box.y <= previous.box.y) {
      throw new Error(
        `narrow mode did not stack tiles in row-major order (AC2) - ${current.moduleId} ` +
          `(y=${current.box.y}) is not below ${previous.moduleId} (y=${previous.box.y})`,
      )
    }
  }
  console.log(
    `narrow mode (${NARROW_VIEWPORT.width}x${NARROW_VIEWPORT.height}) stacked the tiles in ` +
      `row-major order: ${SEEDED_STACK_ORDER.join(' -> ')}`,
  )
  await shot('narrow-stacked')

  await resize(app, DEFAULT_VIEWPORT)
  await waitForContainerWidthCross(page, false)
  // The container is wide again, but `useElementWidth`'s ResizeObserver reports a frame later than
  // the DOM width the check above reads, so the stack can still be on screen for one more paint.
  // Waiting for a tile's inline grid placement - which only the grid branch renders at all - is
  // what makes the rect comparison below measure the restored grid rather than the dying stack.
  for (const expected of EXPECTED_HOME_LAYOUT.tiles) {
    await waitForTileAtCell(page, expected.moduleId, expected, `${expected.moduleId} after widening`)
  }

  for (const moduleId of SEEDED_STACK_ORDER) {
    const restored = await tileRect(page, moduleId)
    assertRectsEqual(wideRects[moduleId], restored, `${moduleId} after widening back to 1280x800`)
  }
  console.log('widening back to 1280x800 restored every tile to its exact original rect (AC2)')

  const statePath = join(variantUserDataDir('populated'), 'state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  const actualHomeLayout = JSON.stringify(state.homeLayout)
  const expectedHomeLayout = JSON.stringify(EXPECTED_HOME_LAYOUT)
  if (actualHomeLayout !== expectedHomeLayout) {
    throw new Error(
      `state.json's homeLayout changed across the narrow/widen round trip - the narrow render must ` +
        `never call setHomeLayout. expected ${expectedHomeLayout}, got ${actualHomeLayout}`,
    )
  }
  console.log(
    "state.json's homeLayout is byte-identical to the seeded fixture - narrow-mode rendering wrote nothing",
  )

  await shot('widened-restored')

  // --- Story 086 D4: arrange mode, catalog, reset --------------------------------------------
  // Continues from here at DEFAULT_VIEWPORT (1280x800, non-narrow) with the seeded, still-untouched
  // `homeLayout` - both tiles are exactly where `EXPECTED_HOME_LAYOUT` says.

  step('entering arrange mode moves no tile')
  const beforeArrangeMode = {}
  for (const moduleId of SEEDED_STACK_ORDER) {
    beforeArrangeMode[moduleId] = await tileRect(page, moduleId)
  }

  await page.getByTestId('dashboard-arrange-toggle').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('dashboard-catalog').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  for (const moduleId of SEEDED_STACK_ORDER) {
    const afterArrangeMode = await tileRect(page, moduleId)
    assertRectsEqual(
      beforeArrangeMode[moduleId],
      afterArrangeMode,
      `${moduleId} across entering arrange mode`,
    )
  }
  console.log(
    'entering arrange mode moved neither seeded tile - the catalog bar and status line dock over ' +
      'the grid rather than pushing it into flow (AC4)',
  )
  await shot('arrange-mode-entered')

  step('the catalog lists exactly the unplaced modules and Enter places one')
  const placedCatalogCounts = {
    playtime: await page.getByTestId('dashboard-catalog-entry-playtime').count(),
    configProfiles: await page.getByTestId('dashboard-catalog-entry-configProfiles').count(),
  }
  if (placedCatalogCounts.playtime !== 0 || placedCatalogCounts.configProfiles !== 0) {
    throw new Error(
      `expected the catalog to be empty right after entering arrange mode (both seeded tiles are ` +
        `placed), found ${JSON.stringify(placedCatalogCounts)}`,
    )
  }
  console.log(
    'the catalog is empty right after entering arrange mode - both fixture tiles are already placed (AC6)',
  )

  // "a tile can be returned to the catalog" (AC7), folded into this step rather than repeated as
  // its own click sequence: remove configProfiles, and explicitly wait for it to actually leave the
  // grid (not just assume the click's side effect landed) before treating it as returned.
  await page.getByTestId('dashboard-tile-remove-configProfiles').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('dashboard-tile-configProfiles')
    .waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  console.log(
    "clicking configProfiles's remove affordance took it out of the grid (AC7)",
  )

  await page
    .getByTestId('dashboard-catalog-entry-configProfiles')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const playtimeStillAbsent = await page.getByTestId('dashboard-catalog-entry-playtime').count()
  if (playtimeStillAbsent !== 0) {
    throw new Error(
      `expected playtime to still be absent from the catalog (it was never removed from the grid), ` +
        `found ${playtimeStillAbsent}`,
    )
  }
  console.log('the catalog now lists exactly configProfiles - the one unplaced module, nothing more (AC6)')

  await page.getByTestId('dashboard-catalog-entry-configProfiles').focus()
  await page.keyboard.press('Enter')

  await page
    .getByTestId('dashboard-tile-configProfiles')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const catalogEntryAfterPlace = await page
    .getByTestId('dashboard-catalog-entry-configProfiles')
    .count()
  if (catalogEntryAfterPlace !== 0) {
    throw new Error(
      `expected the catalog entry for configProfiles to be gone again after Enter placed it, found ` +
        `${catalogEntryAfterPlace}`,
    )
  }
  console.log(
    'pressing Enter on the catalog entry placed configProfiles back into the grid at the first ' +
      'free spot that fits it, and it left the catalog again (AC6)',
  )
  await shot('catalog-place-with-enter')

  step('reset to default asks, then restores the two 6x5 tiles')
  await page.getByTestId('dashboard-reset-trigger').click({ timeout: TIMEOUT_MS })
  const resetDialog = page.getByRole('dialog')
  await resetDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await resetDialog.getByRole('button', { name: 'Reset to default' }).click({ timeout: TIMEOUT_MS })
  await resetDialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  for (const expected of DEFAULT_HOME_LAYOUT.tiles) {
    await waitForTileAtCell(page, expected.moduleId, expected, `${expected.moduleId} after reset`)
  }
  console.log(
    "reset restored both tiles to DEFAULT_HOME_LAYOUT's exact 6x5 cells, after a confirm dialog (AC12)",
  )

  const resetStatePath = join(variantUserDataDir('populated'), 'state.json')
  const resetState = JSON.parse(readFileSync(resetStatePath, 'utf8'))
  const actualResetLayout = JSON.stringify(resetState.homeLayout)
  const expectedResetLayout = JSON.stringify(DEFAULT_HOME_LAYOUT)
  if (actualResetLayout !== expectedResetLayout) {
    throw new Error(
      `state.json's homeLayout after reset does not match DEFAULT_HOME_LAYOUT - expected ` +
        `${expectedResetLayout}, got ${actualResetLayout}`,
    )
  }
  console.log("state.json's homeLayout now matches DEFAULT_HOME_LAYOUT - the reset was persisted immediately")

  await shot('reset-to-default')

  // --- Story 086 D5: pointer move and resize ---------------------------------------------------
  // Continues at DEFAULT_VIEWPORT with arrange mode still on and the layout freshly reset, i.e.
  // playtime at {0,0,6,5} and configProfiles at {6,0,6,5} - every expectation below is built off
  // THAT state, not the fixture's original seed.
  //
  // Both gestures are measured in whole cells, using the same two pitches Dashboard.tsx converts
  // with: `containerWidth / GRID_COLUMNS` horizontally and `ROW_PITCH_PX` (52) vertically. The
  // distances are deliberately round multiples of a cell, far from the half-cell rounding boundary.
  //
  // The home view scrolls (news hero + dashboard are taller than the window), and `page.mouse` does
  // not scroll anything into view the way `locator.click()` does - a grip below the fold would be
  // pressed at coordinates that are not on screen. So the dashboard is scrolled into view once,
  // here, and every box below is measured afterwards.
  await page.getByTestId('home-dashboard').scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  const dashboardBox = await page.getByTestId('home-dashboard').boundingBox()
  if (!dashboardBox) throw new Error('home-dashboard has no bounding box')
  const columnPitchPx = dashboardBox.width / GRID_COLUMNS

  step('a pointer drag moves a tile, and the accepted change is on disk immediately')
  await page
    .getByTestId('dashboard-tile-grip-playtime')
    .scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  const beforeMove = await tileRect(page, 'playtime')
  await pointerDrag(page, 'dashboard-tile-grip-playtime', 0, ROW_PITCH_PX * 2, async (ghost) => {
    await assertGhostInvalid(ghost, false, 'a 2-row move into free space')
  })

  const movedPlaytime = { moduleId: 'playtime', x: 0, y: 2, w: 6, h: 5 }
  await waitForTileAtCell(page, 'playtime', movedPlaytime, 'playtime after a 2-row pointer drag')
  const afterMove = await tileRect(page, 'playtime')
  const movedDownBy = afterMove.y - beforeMove.y
  if (Math.abs(movedDownBy - ROW_PITCH_PX * 2) > 2) {
    throw new Error(
      `playtime's bounding box did not travel two rows - expected ~${ROW_PITCH_PX * 2}px, got ${movedDownBy}px`,
    )
  }
  console.log(
    `dragging playtime's grip down ${ROW_PITCH_PX * 2}px moved it from row 0 to row 2, and its ` +
      `bounding box travelled with it (${Math.round(movedDownBy)}px)`,
  )

  const afterMoveLayout = { tiles: [movedPlaytime, { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 }] }
  assertPersistedLayout(afterMoveLayout, 'after an accepted pointer move')
  console.log(
    "state.json's homeLayout already carries the new row - an accepted drop is on disk immediately, " +
      'before any restart (AC10)',
  )
  await shot('pointer-move-accepted')

  step('a pointer drag resizes a tile, and the accepted change is on disk immediately')
  await page
    .getByTestId('dashboard-tile-resize-playtime')
    .scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  const beforeResize = await tileRect(page, 'playtime')
  // One column narrower and one row taller: playtime keeps columns 0-4 and rows 2-7, configProfiles
  // owns columns 6-11 - no overlap, inside the grid, above the 2x2 floor.
  await pointerDrag(
    page,
    'dashboard-tile-resize-playtime',
    -columnPitchPx,
    ROW_PITCH_PX,
    async (ghost) => {
      await assertGhostInvalid(ghost, false, 'shrinking playtime by one column, growing it by one row')
    },
  )

  const resizedPlaytime = { moduleId: 'playtime', x: 0, y: 2, w: 5, h: 6 }
  await waitForTileAtCell(page, 'playtime', resizedPlaytime, 'playtime after a 1x1 cell resize')
  const afterResize = await tileRect(page, 'playtime')
  if (afterResize.width >= beforeResize.width || afterResize.height <= beforeResize.height) {
    throw new Error(
      `playtime's bounding box did not follow the resize - before ${JSON.stringify(beforeResize)}, ` +
        `after ${JSON.stringify(afterResize)} (expected narrower and taller)`,
    )
  }
  console.log(
    "dragging playtime's resize grip one column left and one row down made it 5x6 cells, and its " +
      'bounding box shrank horizontally while growing vertically',
  )

  const afterResizeLayout = {
    tiles: [resizedPlaytime, { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 }],
  }
  assertPersistedLayout(afterResizeLayout, 'after an accepted pointer resize')
  console.log("state.json's homeLayout carries the new 5x6 size immediately as well (AC10)")
  await shot('pointer-resize-accepted')

  step('an invalid drop is shown invalid and not applied')
  await page
    .getByTestId('dashboard-tile-grip-playtime')
    .scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  const beforeInvalid = await tileRect(page, 'playtime')
  // Three columns right would put playtime at columns 3-7, straight through configProfiles'
  // columns 6-11 on rows 2-4 - the reducer refuses it, so the drop must change nothing at all.
  let invalidStatus = ''
  await pointerDrag(page, 'dashboard-tile-grip-playtime', columnPitchPx * 3, 0, async (ghost) => {
    await assertGhostInvalid(ghost, true, 'a 3-column move into configProfiles')
    invalidStatus = (await page.getByTestId('dashboard-status-line').textContent()) ?? ''
    // The only screenshot taken mid-gesture: what "shown as invalid rather than silently snapping
    // back" actually looks like (AC5).
    await shot('pointer-drop-invalid-ghost')
  })

  // Mirrors en.json's `home.dashboard.status.invalidDrop`, which interpolates the pure engine's own
  // refusal reason - the user is told WHY while still dragging (AC5), not just that it went red.
  if (!invalidStatus.includes('cannot go there')) {
    throw new Error(
      `expected the status line to explain the refusal while dragging, got ${JSON.stringify(invalidStatus)}`,
    )
  }
  console.log(
    `the ghost was marked invalid mid-drag and the status line said why: ${JSON.stringify(invalidStatus)}`,
  )

  // Give a wrong implementation time to write: a refused candidate must never reach setHomeLayout,
  // so nothing may arrive on disk or in the grid after the release either.
  await page.waitForTimeout(300)
  assertTileAtCell(
    await tileGridCell(page, 'playtime'),
    resizedPlaytime,
    'playtime after an overlapping drop',
  )
  assertRectsEqual(beforeInvalid, await tileRect(page, 'playtime'), 'playtime across an invalid drop')
  assertPersistedLayout(afterResizeLayout, 'after a refused pointer move')
  console.log(
    'the refused drop left playtime at its stored placement and state.json untouched - "shown as ' +
      'invalid" and "not applied" are the same code path (AC5)',
  )
  await shot('pointer-drop-invalid')

  step('a catalog entry can be dragged onto the grid')
  await page.getByTestId('dashboard-tile-remove-configProfiles').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('dashboard-catalog-entry-configProfiles')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // The grid's own box, not the dashboard container's: the container also spans the home header and
  // the arrange bar's reserved slot, so its top is not row 0's top. `.dashboard-grid` is
  // dashboard.css's own class on DashboardGrid's root - there is no testid on it.
  await page
    .getByTestId('dashboard-catalog-entry-configProfiles')
    .scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  const gridBox = await page.locator('.dashboard-grid').boundingBox()
  if (!gridBox) throw new Error('.dashboard-grid has no bounding box')
  const chip = await page.getByTestId('dashboard-catalog-entry-configProfiles').boundingBox()
  if (!chip) throw new Error('the configProfiles catalog entry has no bounding box')
  // Aim the pointer at the middle of cell (6, 0): configProfiles' default 6x5 then covers columns
  // 6-11 on rows 0-4, clear of playtime's columns 0-4.
  const targetX = gridBox.x + columnPitchPx * 6.5
  const targetY = gridBox.y + ROW_PITCH_PX * 0.5
  await pointerDrag(
    page,
    'dashboard-catalog-entry-configProfiles',
    targetX - (chip.x + chip.width / 2),
    targetY - (chip.y + chip.height / 2),
    async (ghost) => {
      await assertGhostInvalid(ghost, false, 'a catalog drag onto free cells')
    },
  )

  const placedConfigProfiles = { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 }
  await waitForTileAtCell(
    page,
    'configProfiles',
    placedConfigProfiles,
    'configProfiles after being dragged out of the catalog',
  )
  assertPersistedLayout(
    { tiles: [resizedPlaytime, placedConfigProfiles] },
    'after a catalog entry was dragged onto the grid',
  )
  console.log(
    'dragging the configProfiles catalog entry onto cell (6, 0) placed it there and persisted it - ' +
      "the pointer half of AC6's \"dragged into the grid or placed with Enter\"",
  )
  await shot('pointer-place-from-catalog')
}
