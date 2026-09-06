// Story 054 D12 acceptance flow: a REAL drag through the running app, not a store-level call to
// `moveEntryToPosition`/`moveEntryToCategory` (D2's pure helpers already have their own unit
// tests) - the point is to prove dnd-kit's pointer sensor actually starts a drag and resolves a
// drop against the real DOM, the same "seen and driven in the real app" bar every other `ui:flow`
// in this repo holds itself to.
//
// Two gestures, both named in the story's own D12 text:
//   (a) reorder a row within its category (drag "Multi Bind" - `fixture-action-multibind`,
//       scripts/lib/fixture.mjs - onto "Attack" - `fixture-action-attack`, both `categoryId:
//       'movement'`, the rail's default first category so no chip click is needed to reach them),
//   (b) drop a row onto another category's chip (drag "Attack" onto the "Weapons" chip,
//       `data-drop-category="weapons"`, `ControlsDragZone.tsx`'s `CategoryDropTarget`).
//
// Low-level `page.mouse.move/down/up`, not `locator.dragTo()`: `SortableZone`'s `PointerSensor` has
// an 8px `activationConstraint.distance` (`SortableList.tsx`), so a drag has to actually move the
// pointer past that threshold before dnd-kit's drag starts at all, and dnd-kit's own collision
// detection only re-runs `onDragOver` when the pointer position changes - a single teleporting
// `move` would start the drag but might never register as "over" the target row/chip. Every drag
// below goes: move to the grip, down, a small move past the activation distance, several
// intermediate moves toward the target (letting dnd-kit's `onDragOver` fire and update `overId`
// along the way), a final move onto the target's centre, a short pause so the last `onDragOver`
// resolves, then up.
//
// The grip itself (`.ctrl-grip-handle`) is opacity-0 until its row is hovered/focus-within
// (controls-grid.css) - real pointer events still land on it regardless of visual opacity (that is
// a CSS `opacity`, not `visibility`/`pointer-events: none`), and `boundingBox()` reads its real
// layout position whether or not it is currently visible, so no hover-first step is needed before
// grabbing it.
//
// A row-to-row drag's path is kept vertical (the grip's own start x, only travelling in y) rather
// than aiming at the target row's raw on-screen centre - a `.ctrl-rowgroup` spans the grid's full
// width, so its horizontal centre sits far from the grip a real user would actually keep their
// pointer near while dragging a vertical list. Dropping onto a category chip does need the path to
// reach the chip's real position, since `CategoryDropTarget` is only ever a target while the raw
// pointer is literally inside it (`pointerWithin`, not the row zone's `closestCenter`).
//
// The other thing that made the difference, found by trial: the drop's own state update (and, for
// a category move, the profile persist it triggers) is not synchronous with the drag's final
// `mouseup` - reading the DOM's row order immediately after releasing the mouse observed the
// *pre*-drop order more than once. `realDrag` settles for 300ms after `mouse.up()` before
// returning, specifically so every assertion below reads the post-drop DOM, not a stale one.

const CLICK_TIMEOUT_MS = 8_000

/** Every rendered row's stable identity, in DOM order - `role="rowgroup"` is the per-row sortable
 * item (`ControlsGrid.tsx`), `data-row-id` its id. Mirrors `screens.mjs`'s own row selectors. */
async function rowOrder(page) {
  return page.locator('[role="rowgroup"][data-row-id]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-row-id')),
  )
}

/**
 * One real drag: pointer down on `from`'s centre, a small move past the pointer sensor's 8px
 * activation distance, several intermediate moves toward the target (so dnd-kit's collision
 * detection has a chance to register the hover-over-target along the way, not just teleport past
 * it), a final move onto the target, a short settle, then release.
 *
 * `verticalOnly` (row-to-row reorders) pins the path's x to `from`'s own start x and only travels
 * to `to`'s y - see the module doc comment. Omit it (the category-chip drop) to travel to `to`'s
 * real, full on-screen centre, which `pointerWithin` needs.
 */
async function realDrag(page, from, to, { verticalOnly = false } = {}) {
  const fromBox = await from.boundingBox()
  const toBox = await to.boundingBox()
  if (!fromBox) throw new Error('drag source has no bounding box - is it actually rendered?')
  if (!toBox) throw new Error('drag target has no bounding box - is it actually rendered?')

  const startX = fromBox.x + fromBox.width / 2
  const startY = fromBox.y + fromBox.height / 2
  const endX = verticalOnly ? startX : toBox.x + toBox.width / 2
  const endY = toBox.y + toBox.height / 2

  // The first move past the activation distance has to head *toward* the target, not a fixed
  // direction - a fixed offset the wrong way first was observed reliably leaving the drag inert.
  const deltaX = endX - startX
  const deltaY = endY - startY
  const distance = Math.hypot(deltaX, deltaY) || 1
  const firstStepX = startX + (deltaX / distance) * 16
  const firstStepY = startY + (deltaY / distance) * 16

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // Past the 8px activation distance, so the pointer sensor actually starts the drag.
  await page.mouse.move(firstStepX, firstStepY, { steps: 5 })
  // Gives React/dnd-kit a tick to process the drag-start before the next move.
  await page.waitForTimeout(50)

  const STEPS = 10
  for (let i = 1; i <= STEPS; i += 1) {
    const x = firstStepX + ((endX - firstStepX) * i) / STEPS
    const y = firstStepY + ((endY - firstStepY) * i) / STEPS
    await page.mouse.move(x, y, { steps: 3 })
    await page.waitForTimeout(30)
  }
  await page.mouse.move(endX, endY, { steps: 5 })
  // Lets dnd-kit's own onDragOver resolve against the final position before release.
  await page.waitForTimeout(200)
  await page.mouse.up()
  // See the module doc comment: the drop's own state update is not synchronous with `mouseup`.
  await page.waitForTimeout(300)
}

export default async function controlsDragReorder({ page, shot, step }) {
  step('open Config > Plain Profile > Controls')
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: CLICK_TIMEOUT_MS })
  await page.getByTestId('config-tab-controls').click({ timeout: CLICK_TIMEOUT_MS })

  // Movement is the rail's default first category (BUILT_IN_ACTION_CATEGORIES[0]) and both fixture
  // rows this flow drags live there - no category chip click needed to reach them.
  const multibindRow = page.locator('[role="rowgroup"][data-row-id="fixture-action-multibind"]')
  const attackRow = page.locator('[role="rowgroup"][data-row-id="fixture-action-attack"]')
  await multibindRow.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await attackRow.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })

  step('record row order before any drag')
  const orderBefore = await rowOrder(page)
  if (!orderBefore.includes('fixture-action-multibind') || !orderBefore.includes('fixture-action-attack')) {
    throw new Error(`expected both fixture rows in the Movement grid, got: ${orderBefore.join(', ')}`)
  }

  step('drag "Multi Bind" onto "Attack" - reorder within the same category')
  await realDrag(page, multibindRow.locator('.ctrl-grip-handle'), attackRow, { verticalOnly: true })

  step('assert the Movement grid\'s row order actually changed')
  const orderAfterReorder = await rowOrder(page)
  const beforeIndex = orderBefore.indexOf('fixture-action-multibind')
  const afterIndex = orderAfterReorder.indexOf('fixture-action-multibind')
  if (afterIndex === -1) {
    throw new Error('"Multi Bind" row vanished from the Movement grid after the reorder drag')
  }
  if (afterIndex === beforeIndex) {
    throw new Error(
      `expected "Multi Bind" to move from index ${beforeIndex}, but it is still at ${afterIndex} - ` +
        `the drag did not reorder anything (before: ${orderBefore.join(', ')}; after: ${orderAfterReorder.join(', ')})`,
    )
  }
  await multibindRow.scrollIntoViewIfNeeded()
  await shot('row-reordered')

  step('drag "Attack" onto the "Weapons" category chip')
  const weaponsChip = page.locator('[data-drop-category="weapons"]')
  await weaponsChip.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await realDrag(page, attackRow.locator('.ctrl-grip-handle'), weaponsChip)

  step('assert "Attack" left the Movement grid')
  const orderAfterCategoryDrop = await rowOrder(page)
  if (orderAfterCategoryDrop.includes('fixture-action-attack')) {
    throw new Error(
      `expected "Attack" to have moved out of Movement after the chip drop, still present: ` +
        orderAfterCategoryDrop.join(', '),
    )
  }
  await shot('dropped-onto-category-chip-source')

  step('switch to Weapons and assert "Attack" landed at the end, appended')
  await page.getByRole('button', { name: 'Weapons' }).click({ timeout: CLICK_TIMEOUT_MS })
  const movedRow = page.locator('[role="rowgroup"][data-row-id="fixture-action-attack"]')
  await movedRow.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  const weaponsOrder = await rowOrder(page)
  if (weaponsOrder[weaponsOrder.length - 1] !== 'fixture-action-attack') {
    throw new Error(
      `expected "Attack" appended at the end of Weapons, order was: ${weaponsOrder.join(', ')}`,
    )
  }
  await movedRow.scrollIntoViewIfNeeded()
  await shot('dropped-onto-category-chip-target')
}
