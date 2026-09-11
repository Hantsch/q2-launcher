// Story 086 D6 acceptance flow: keyboard parity and announcements - AC8 and AC9 - proven against
// the real, running app. Everything here is real key input on a focused move grip; no pointer
// gesture is involved at all (the pointer half is `scripts/flows/home-dashboard-arrange.mjs`).
//
// Unlike that flow, this one does not depend on the fixture's seeded `homeLayout`: it starts by
// resetting the dashboard to `DEFAULT_HOME_LAYOUT` and returning `configProfiles` to the catalog, so
// every expectation below is built off one known state no matter what ran before it. It does leave
// the layout mutated when it finishes, so `npm run ui:seed` before `ui:flow home-dashboard-arrange`
// (which does assert the seeded layout byte for byte) still applies, same as for every other flow.
//
// Runs against the `populated` fixture (the flow runner's default variant, `scripts/flow.mjs`).
//
// Selectors, not guesses - read DashboardTile.tsx/ArrangeBar.tsx before changing any of these:
//   dashboard-arrange-toggle          HomeHeader.tsx - enters/leaves arrange mode
//   dashboard-tile-grip-<moduleId>    DashboardTile.tsx - the move grip: the lift's own control,
//                                     carrying `data-lifted` while a lift is in flight
//   dashboard-status-line             ArrangeBar.tsx - the visible status line, which IS the
//                                     aria-live region (AC9: one element, two roles)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors src/shared/modules/home.ts's `GRID_COLUMNS`, and `GRID_ROW_HEIGHT + GRID_GAP_PX` -
 * duplicated as literals rather than imported for the same reason every other `.mjs` script in this
 * repo duplicates a shared TS constant: this file runs directly under `node`, with no TypeScript
 * loader in the chain (see `scripts/lib/harness.mjs`'s own `EXPECTED_RENDERER_ORIGIN` comment). */
const GRID_COLUMNS = 12
const ROW_PITCH_PX = 40 + 12

/** Mirrors src/shared/modules/home.ts's `DEFAULT_HOME_LAYOUT` - what this flow's own opening reset
 * puts the dashboard back to before it starts pressing keys. */
const DEFAULT_HOME_LAYOUT = {
  tiles: [
    { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
    { moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 },
  ],
}

/** Fragments of en.json's `home.dashboard.status.*` - the announcement text is this deliverable's
 * observable contract (AC9), so the flow asserts the real user-visible wording rather than merely
 * "some text appeared". Keep in sync with src/renderer/src/i18n/locales/en.json. */
const STATUS = {
  lifted: 'lifted',
  dropped: 'placement confirmed',
  cancelled: 'back where it was',
  refused: "Can't move",
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

/** Reads a placed tile's own inline `gridColumn`/`gridRow` (the exact strings `DashboardGrid.tsx`
 * writes through the `style` prop) back as 0-based cells. */
async function tileCells(page, moduleId) {
  const cell = await page.evaluate((testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`)
    if (!(el instanceof HTMLElement)) return null
    return { gridColumn: el.style.gridColumn, gridRow: el.style.gridRow }
  }, `dashboard-tile-${moduleId}`)
  if (!cell) throw new Error(`dashboard-tile-${moduleId} is not rendered in grid mode`)
  const column = parseGridCell(cell.gridColumn)
  const row = parseGridCell(cell.gridRow)
  return { moduleId, x: column.start, y: row.start, w: column.span, h: row.span }
}

/** Parses a `"<line> / span <count>"` grid-placement string into 0-based cell coordinates. */
function parseGridCell(value) {
  const match = /^(\d+)\s*\/\s*span\s*(\d+)$/.exec(value ?? '')
  if (!match) throw new Error(`unexpected grid placement value: ${JSON.stringify(value)}`)
  return { start: Number(match[1]) - 1, span: Number(match[2]) }
}

/** Polls a tile's inline grid placement until it reaches `expected`, then asserts it. Every accepted
 * keystroke goes through an IPC round trip the key handler does not await, so the tile is still on
 * screen with its previous placement for a moment - waiting on mere visibility would race it. */
async function waitForTileAtCells(page, expected, label) {
  const expectedColumn = `${expected.x + 1} / span ${expected.w}`
  const expectedRow = `${expected.y + 1} / span ${expected.h}`
  try {
    await page.waitForFunction(
      ({ testId, column, row }) => {
        const el = document.querySelector(`[data-testid="${testId}"]`)
        return (
          el instanceof HTMLElement && el.style.gridColumn === column && el.style.gridRow === row
        )
      },
      { testId: `dashboard-tile-${expected.moduleId}`, column: expectedColumn, row: expectedRow },
      { timeout: TIMEOUT_MS },
    )
  } catch {
    const actual = await tileCells(page, expected.moduleId)
    throw new Error(
      `${label}: expected ${expected.moduleId} at ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

/** `state.json`'s `homeLayout` as it is on disk right now - read fresh, no restart (AC10). */
function readPersistedHomeLayout() {
  const statePath = join(variantUserDataDir('populated'), 'state.json')
  return JSON.parse(readFileSync(statePath, 'utf8')).homeLayout
}

function assertPersistedLayout(expected, label) {
  const actual = JSON.stringify(readPersistedHomeLayout())
  if (actual !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected state.json's homeLayout to be ${JSON.stringify(expected)}, got ${actual}`,
    )
  }
}

async function statusText(page) {
  return (await page.getByTestId('dashboard-status-line').textContent()) ?? ''
}

function assertStatusContains(text, fragment, label) {
  if (!text.includes(fragment)) {
    throw new Error(
      `${label}: expected the status line to contain ${JSON.stringify(fragment)}, got ${JSON.stringify(text)}`,
    )
  }
}

/** Waits until the status line contains `fragment` - the announcement is written from the same
 * React update as the layout commit, but a cancel's revert is one IPC round trip further out. */
async function waitForStatusContaining(page, fragment, label) {
  try {
    await page.waitForFunction(
      (expected) =>
        (
          document.querySelector('[data-testid="dashboard-status-line"]')?.textContent ?? ''
        ).includes(expected),
      fragment,
      { timeout: TIMEOUT_MS },
    )
  } catch {
    assertStatusContains(await statusText(page), fragment, label)
  }
}

async function liftedFlag(page, moduleId) {
  return page.getByTestId(`dashboard-tile-grip-${moduleId}`).getAttribute('data-lifted')
}

async function assertLifted(page, moduleId, expected, label) {
  const actual = await liftedFlag(page, moduleId)
  if (actual !== String(expected)) {
    throw new Error(
      `${label}: expected the ${moduleId} grip's data-lifted to be "${expected}", got "${actual}"`,
    )
  }
}

/** Focuses the move grip and lifts it with Space (AC8) - the entry point of every case below. */
async function liftPlaytime(page, label) {
  await page.getByTestId('dashboard-tile-grip-playtime').focus({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Space')
  await assertLifted(page, 'playtime', true, label)
  assertStatusContains(await statusText(page), STATUS.lifted, label)
}

export default async function homeDashboardKeyboard({ page, shot, step }) {
  step('arrange mode, from a layout this flow put in a known state')
  await openHomeDashboard(page)
  await page.getByTestId('dashboard-arrange-toggle').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('dashboard-catalog').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // Reset first, so this flow is independent of whatever the fixture (or a previous flow) left
  // behind - see the header comment.
  await page.getByTestId('dashboard-reset-trigger').click({ timeout: TIMEOUT_MS })
  const resetDialog = page.getByRole('dialog')
  await resetDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await resetDialog.getByRole('button', { name: 'Reset to default' }).click({ timeout: TIMEOUT_MS })
  await resetDialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  for (const expected of DEFAULT_HOME_LAYOUT.tiles) {
    await waitForTileAtCells(page, expected, "after this flow's opening reset")
  }

  // `configProfiles` goes back to the catalog: the default layout fills all 12 columns, so with it
  // in place a single arrow press to the right would be a legal-looking move that the reducer
  // refuses on collision - which is a refusal case (covered further down on purpose), not the plain
  // "arrows move one cell" case AC8 asks for first.
  await page.getByTestId('dashboard-tile-remove-configProfiles').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('dashboard-catalog-entry-configProfiles')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  let expectedLayout = { tiles: [{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }] }
  assertPersistedLayout(expectedLayout, 'the known starting state of this flow')
  console.log(
    'arrange mode is on and the dashboard holds exactly one tile - playtime at {0,0,6,5}, with ' +
      'configProfiles parked in the catalog',
  )

  const dashboardBox = await page.getByTestId('home-dashboard').boundingBox()
  if (!dashboardBox) throw new Error('home-dashboard has no bounding box')
  // Same convention Dashboard.tsx converts a pointer drag with. It is ~1px short of the true column
  // step, which is far inside the tolerance the pixel assertions below use.
  const columnPitchPx = dashboardBox.width / GRID_COLUMNS

  step('lift, move, resize, drop')
  const beforeMove = await tileRect(page, 'playtime')
  await liftPlaytime(page, 'Space on the playtime grip')
  console.log(`Space lifted playtime: ${JSON.stringify(await statusText(page))}`)
  await shot('lifted')

  await page.keyboard.press('ArrowRight')
  const movedCells = { moduleId: 'playtime', x: 1, y: 0, w: 6, h: 5 }
  await waitForTileAtCells(page, movedCells, 'playtime after one ArrowRight')
  const afterMove = await tileRect(page, 'playtime')
  const travelled = afterMove.x - beforeMove.x
  if (Math.abs(travelled - columnPitchPx) > 3) {
    throw new Error(
      `playtime's bounding box did not travel exactly one column - expected ~${columnPitchPx}px, got ${travelled}px`,
    )
  }
  expectedLayout = { tiles: [movedCells] }
  assertPersistedLayout(expectedLayout, 'after one accepted ArrowRight')
  console.log(
    `ArrowRight moved playtime one cell right (${Math.round(travelled)}px) and state.json already ` +
      'carries the new column - an accepted keystroke is persisted as it happens (AC8/AC10)',
  )

  await page.keyboard.press('Shift+ArrowDown')
  const resizedCells = { moduleId: 'playtime', x: 1, y: 0, w: 6, h: 6 }
  await waitForTileAtCells(page, resizedCells, 'playtime after one Shift+ArrowDown')
  const afterResize = await tileRect(page, 'playtime')
  const grewBy = afterResize.height - afterMove.height
  if (Math.abs(grewBy - ROW_PITCH_PX) > 3) {
    throw new Error(
      `playtime did not grow by exactly one row - expected ~${ROW_PITCH_PX}px, got ${grewBy}px`,
    )
  }
  expectedLayout = { tiles: [resizedCells] }
  assertPersistedLayout(expectedLayout, 'after one accepted Shift+ArrowDown')
  console.log(
    `Shift+ArrowDown grew playtime by one row (${Math.round(grewBy)}px), persisted immediately - ` +
      'a single lift session mixed a move and a resize (AC8)',
  )
  await shot('moved-and-resized')

  await page.keyboard.press('Enter')
  await waitForStatusContaining(page, STATUS.dropped, 'Enter on a lifted tile')
  await assertLifted(page, 'playtime', false, 'after Enter dropped the tile')
  await waitForTileAtCells(page, resizedCells, 'playtime after the drop')
  assertPersistedLayout(expectedLayout, 'after the drop itself')
  console.log(
    `Enter dropped playtime - ${JSON.stringify(await statusText(page))} - and changed no geometry: ` +
      'every accepted keystroke had already been committed, so the drop has nothing left to write',
  )
  await shot('dropped')

  step('Esc, blur and Tab each restore the pre-lift placement')
  // Three independent sub-cases, each lifting fresh, each making ONE accepted move that really
  // lands on disk, and each then exiting a different way. The assertion is deliberately "back to
  // the pre-lift placement", not "no new move applied" - the in-between move was committed, so a
  // cancel has to actively revert it (AC8).
  const exits = [
    {
      name: 'Escape',
      async run() {
        await page.keyboard.press('Escape')
      },
    },
    {
      name: 'blur',
      async run() {
        // Moving focus to another control in the same tile is the smallest real blur there is - a
        // click would additionally fire that control's own action.
        await page.getByTestId('dashboard-tile-remove-playtime').focus({ timeout: TIMEOUT_MS })
      },
    },
    {
      name: 'Tab',
      async run() {
        await page.keyboard.press('Tab')
      },
    },
  ]

  for (const exit of exits) {
    const before = await tileCells(page, 'playtime')
    const beforeRect = await tileRect(page, 'playtime')
    const beforeLayout = readPersistedHomeLayout()

    await liftPlaytime(page, `Space before the ${exit.name} sub-case`)
    await page.keyboard.press('ArrowRight')
    const moved = { ...before, x: before.x + 1 }
    await waitForTileAtCells(page, moved, `playtime after ArrowRight in the ${exit.name} sub-case`)
    assertPersistedLayout(
      { tiles: [moved] },
      `the ArrowRight before ${exit.name} must really be committed`,
    )

    await exit.run()
    await waitForStatusContaining(page, STATUS.cancelled, `${exit.name} cancelling the lift`)
    await assertLifted(page, 'playtime', false, `after ${exit.name} cancelled the lift`)
    await waitForTileAtCells(
      page,
      before,
      `playtime after ${exit.name} restored the pre-lift cells`,
    )
    assertPersistedLayout(
      beforeLayout,
      `state.json after ${exit.name} reverted the in-between move`,
    )

    const restoredRect = await tileRect(page, 'playtime')
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Math.abs(restoredRect[key] - beforeRect[key]) > 0.01) {
        throw new Error(
          `${exit.name}: playtime's ${key} did not come back - before=${beforeRect[key]}, ` +
            `after=${restoredRect[key]}`,
        )
      }
    }
    console.log(
      `${exit.name} cancelled the lift and put playtime back at ${JSON.stringify(before)}, on screen ` +
        'and in state.json - the accepted move in between was reverted, not merely stopped (AC8)',
    )
  }
  await shot('cancel-restored')

  step('every step is announced and mirrored in the status line')
  const liveAttributes = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="dashboard-status-line"]')
    if (!el) return null
    return {
      live: el.getAttribute('aria-live'),
      atomic: el.getAttribute('aria-atomic'),
      text: el.textContent,
    }
  })
  if (!liveAttributes) throw new Error('dashboard-status-line is not in the DOM')
  if (liveAttributes.live !== 'polite' || liveAttributes.atomic !== 'true') {
    throw new Error(
      `expected the status line itself to be a polite, atomic live region, got ${JSON.stringify(liveAttributes)}`,
    )
  }
  console.log(
    'the visible status line IS the aria-live="polite" aria-atomic="true" region - one element, so ' +
      'what is announced and what is shown cannot differ (AC9)',
  )

  // Every key below must produce its OWN announcement: the text is captured after each press and
  // asserted to have actually changed, which is what a stale-text implementation fails.
  const seen = [await statusText(page)]
  const announced = []
  async function pressAndCaptureAnnouncement(keys, label) {
    await page.keyboard.press(keys)
    const previous = seen[seen.length - 1]
    await page.waitForFunction(
      (stale) => {
        const text =
          document.querySelector('[data-testid="dashboard-status-line"]')?.textContent ?? ''
        return text.length > 0 && text !== stale
      },
      previous,
      { timeout: TIMEOUT_MS },
    )
    const text = await statusText(page)
    seen.push(text)
    announced.push(`${label}: ${JSON.stringify(text)}`)
    return text
  }

  await page.getByTestId('dashboard-tile-grip-playtime').focus({ timeout: TIMEOUT_MS })
  assertStatusContains(
    await pressAndCaptureAnnouncement('Space', 'lift'),
    STATUS.lifted,
    'the lift announcement',
  )
  await pressAndCaptureAnnouncement('ArrowRight', 'move')
  await pressAndCaptureAnnouncement('Shift+ArrowDown', 'resize')
  // A refused keystroke is announced too, with the pure reducer's own reason: playtime sits on row
  // 0, so one press up leaves the grid. Nothing moves, and the user is told why (AC9).
  const refusal = await pressAndCaptureAnnouncement('ArrowUp', 'refused move')
  assertStatusContains(refusal, STATUS.refused, 'the refusal announcement')
  assertStatusContains(
    await pressAndCaptureAnnouncement('Enter', 'drop'),
    STATUS.dropped,
    'the drop announcement',
  )

  console.log(`each key produced its own announcement:\n  ${announced.join('\n  ')}`)
  await shot('announcements')
}
