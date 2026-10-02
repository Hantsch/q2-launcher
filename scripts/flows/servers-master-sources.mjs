// Story 111 (docs/requirements/111-master-sources-are-a-list-i-edit.md) D5: the story's own
// end-to-end proof. Stories 106/110/111 D1-D4 (already applied to the tree, not yet committed)
// built the master-source list: shared contract + validation in `src/shared/`, persistence in
// `src/main/lib/schemas.ts` (a fresh/missing `servers` state key defaults its `sources` array to
// `DEFAULT_MASTER_SOURCES`, the shipped default sources), CRUD in
// `src/main/modules/servers/master-sources.ts` + `index.ts`, and the renderer surface in
// `src/renderer/src/modules/servers/ServersSettingsSection.tsx` + `MasterSourceRow.tsx`.
//
// Mirrors `settings-downloads-section.mjs` for navigating to a contributed Settings section and
// driving its list/form, and `news-feed.mjs` for the restart phase: a SECOND, independent
// `withApp()` call over a fresh userData directory seeded with nothing but a copy of phase 1's own
// `state.json` - the same file a real second boot on the same machine would read.
//
// Selectors - read `ServersSettingsSection.tsx`/`MasterSourceRow.tsx` before changing any of these:
//   nav-settings                    TitleBar.tsx
//   settings-section-servers        SettingsView.tsx - the shell's own Panel wrapper
//   servers-sources-list            ServersSettingsSection.tsx - wraps the SortableList
//   servers-source-row-<id>         MasterSourceRow.tsx - one row, `id` is the source's own id
//   servers-source-add-type         ServersSettingsSection.tsx - the add form's type <Select> (the
//                                    testid lands on the <select> itself - `Select` spreads `...rest`
//                                    straight onto it, unlike DownloadsSettingsSection's wrapping
//                                    <label> idiom)
//   servers-source-add-address      ServersSettingsSection.tsx - the add form's address <input>
//   servers-source-add-submit       ServersSettingsSection.tsx
//   servers-source-toggle           MasterSourceRow.tsx - wraps the enabled <Switch>
//   servers-source-remove           MasterSourceRow.tsx
//   servers-source-error            ServersSettingsSection.tsx - the rendered refusal reason
//
// Reorder is driven by keyboard, not a real pointer drag: `SortableList`'s grip
// (`components/dnd/DragHandle.tsx`) is a real `<button>` carrying dnd-kit's own `attributes`/
// `listeners`, and `SortableZone` already wires a `KeyboardSensor` with
// `sortableKeyboardCoordinates` (`components/dnd/SortableList.tsx`) - the same path
// `SortableList.test.tsx` exercises ("Space picks up, ArrowDown moves, Space drops"). This avoids
// `controls-drag-reorder.mjs`'s low-level `page.mouse` choreography entirely; a plain list with no
// interleaved non-sortable content (unlike the Controls grid's sub-category dividers) has nothing
// that low-level dragging would prove that the keyboard path does not.
//
// Idempotency across repeated `npm run ui:flow -- servers-master-sources` runs without a reseed
// (`ui:flow` never reseeds between runs, per every other flow's own doc comment): every mutation
// this flow makes to the `populated` fixture's `servers.sources` is reverted before the flow
// returns - every added row is removed again, and the reorder that proves AC3 only ever moves an
// added row, so removing it at the very end restores the order too - so a second run without
// `npm run ui:seed` in between still finds the shipped defaults, in their original order.
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { waitForStateJson } from '../lib/state-json.mjs'
import { join } from 'node:path'
import { REPO_ROOT } from '../lib/paths.mjs'
import { variantUserDataDir, withApp } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors `module.servers.settings.type.*` (`src/renderer/src/i18n/locales/en.json`). */
const TYPE_LABEL = { 'udp-master': 'UDP master', 'http-list': 'HTTP list' }

/**
 * `DEFAULT_MASTER_SOURCES` as shipped, read out of `src/shared/modules/servers.ts` itself rather
 * than copied here: the shipped list has changed before, and a hand-kept copy goes stale silently.
 * The array is plain object literals with single-quoted strings, which is all this parser reads; a
 * shape it cannot read fails loudly instead of yielding an empty list.
 */
function readShippedDefaultSources() {
  const text = readFileSync(join(REPO_ROOT, 'src', 'shared', 'modules', 'servers.ts'), 'utf8')
  const block = /export const DEFAULT_MASTER_SOURCES: MasterSource\[\] = \[([\s\S]*?)\r?\n\]/.exec(
    text,
  )
  if (!block)
    throw new Error('could not find DEFAULT_MASTER_SOURCES in src/shared/modules/servers.ts')
  const sources = [...block[1].matchAll(/\{([^{}]*)\}/g)].map(([, body]) => {
    const field = (key) => new RegExp(`\\b${key}:\\s*'([^']*)'`).exec(body)?.[1]
    const source = {
      id: field('id'),
      type: field('type'),
      address: field('address'),
      enabled: /\benabled:\s*true\b/.test(body),
    }
    if (!source.id || !source.address || !(source.type in TYPE_LABEL)) {
      throw new Error(`could not parse a DEFAULT_MASTER_SOURCES entry: ${body.trim()}`)
    }
    return source
  })
  if (sources.length === 0) throw new Error('DEFAULT_MASTER_SOURCES parsed to an empty list')
  return sources
}

const DEFAULT_SOURCES = readShippedDefaultSources()
const DEFAULT_IDS = DEFAULT_SOURCES.map((source) => source.id)

/** A source this flow adds and then removes again - never one of `DEFAULT_SOURCES`' addresses, so
 * "duplicate-address" can never fire, and the remove leaves no trace for the idempotency
 * requirement above. */
const ADDED_ADDRESS = 'https://example.com/serverlist?raw=1'

/** `ftp:` is a well-formed URL `new URL()` parses fine, but not `http:`/`https:` -
 * `validateMasterSourceAddress`'s `http-list` rulebook refuses it as `unsupported-protocol`
 * (`src/shared/servers/master-source-address.ts`), a clean, deterministic AC4 case. */
const INVALID_ADDRESS = 'ftp://example.com/list'
/** Mirrors `servers.sources.reject.unsupported-protocol` (`en.json`). */
const EXPECTED_INVALID_REASON_TEXT = 'Only http:// and https:// addresses are supported.'

function listContainer(page) {
  return page.getByTestId('servers-sources-list')
}

function rowsLocator(page) {
  return listContainer(page).locator('[data-testid^="servers-source-row-"]')
}

function rowLocator(page, id) {
  return page.getByTestId(`servers-source-row-${id}`)
}

/** Every rendered row's own id, in DOM order - the array-position identity dnd-kit and the source
 * list itself both track. */
async function rowIds(page) {
  return rowsLocator(page).evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute('data-testid').replace('servers-source-row-', ''),
    ),
  )
}

async function readRow(page, id) {
  const row = rowLocator(page, id)
  const paragraphs = row.locator('p')
  const address = await paragraphs.nth(0).innerText()
  const type = await paragraphs.nth(1).innerText()
  const enabled =
    (await row
      .getByTestId('servers-source-toggle')
      .getByRole('switch')
      .getAttribute('aria-checked')) === 'true'
  return { address, type, enabled }
}

async function waitForRowCount(page, count) {
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll(
        '[data-testid="servers-sources-list"] [data-testid^="servers-source-row-"]',
      ).length === expected,
    count,
    { timeout: TIMEOUT_MS },
  )
}

async function waitForRowOrder(page, expectedIds) {
  await page.waitForFunction(
    (expected) => {
      const elements = document.querySelectorAll(
        '[data-testid="servers-sources-list"] [data-testid^="servers-source-row-"]',
      )
      const actual = Array.from(elements).map((element) =>
        element.getAttribute('data-testid').replace('servers-source-row-', ''),
      )
      return JSON.stringify(actual) === JSON.stringify(expected)
    },
    expectedIds,
    { timeout: TIMEOUT_MS },
  )
}

/** One picked-up/moved/dropped keyboard cycle on `grip` - the "Space picks up, ArrowDown moves,
 * Space drops" pattern `SortableList.test.tsx` establishes. `steps` arrow presses move the item one
 * position per press. */
async function keyboardReorder(page, grip, arrowKey, steps) {
  await grip.focus()
  await grip.press('Space')
  await page.waitForTimeout(150)
  for (let i = 0; i < steps; i += 1) {
    await grip.press(arrowKey)
    await page.waitForTimeout(150)
  }
  await grip.press('Space')
  await page.waitForTimeout(300)
}

/**
 * `SortableZone`'s `DragOverlay` renders a second copy of the dragged row (same `renderItem`, same
 * `source`) while a drag is in flight - once picked up, both copies carry the row's
 * `servers-source-row-<id>` testid, which would make a bare `getByRole` ambiguous for every
 * keystroke after the first `Space`. `.first()` always resolves to the real, sortable copy (the
 * overlay is appended after it in DOM order).
 */
function gripFor(page, id) {
  return rowLocator(page, id).getByRole('button', { name: 'Drag to reorder' }).first()
}

async function openServersSettings(page) {
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  const section = page.getByTestId('settings-section-servers')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await listContainer(page).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

export default async function serversMasterSources({ page, shot, step, variant }) {
  const userDataDir = variantUserDataDir(variant)

  step('open Settings and reach the Servers section')
  await openServersSettings(page)

  step('a fresh profile shows the shipped default sources, correctly typed (AC1)')
  await waitForRowCount(page, DEFAULT_SOURCES.length)
  const initialIds = await rowIds(page)
  if (JSON.stringify(initialIds) !== JSON.stringify(DEFAULT_IDS)) {
    throw new Error(
      `expected the shipped sources ${JSON.stringify(DEFAULT_IDS)} in their default order, got: ${JSON.stringify(initialIds)}`,
    )
  }
  for (const expected of DEFAULT_SOURCES) {
    const actual = await readRow(page, expected.id)
    if (actual.address !== expected.address || actual.type !== TYPE_LABEL[expected.type]) {
      throw new Error(
        `default source ${expected.id}: expected ${expected.address} / ${TYPE_LABEL[expected.type]}, ` +
          `got ${actual.address} / ${actual.type}`,
      )
    }
    if (!actual.enabled) {
      throw new Error(`default source ${expected.id} should ship enabled`)
    }
  }
  await shot('defaults')

  step('add, remove, reorder and toggle each persist immediately (AC2)')

  /** Adds `ADDED_ADDRESS` through the form and returns the new row's id. */
  async function addSource(expectedCount) {
    await page
      .getByTestId('servers-source-add-type')
      .selectOption('http-list', { timeout: TIMEOUT_MS })
    await page
      .getByTestId('servers-source-add-address')
      .fill(ADDED_ADDRESS, { timeout: TIMEOUT_MS })
    await page.getByTestId('servers-source-add-submit').click({ timeout: TIMEOUT_MS })
    await waitForRowCount(page, expectedCount)
    const row = rowsLocator(page).filter({ hasText: ADDED_ADDRESS })
    await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const id = (await row.getAttribute('data-testid')).replace('servers-source-row-', '')
    const rowState = await readRow(page, id)
    if (rowState.address !== ADDED_ADDRESS || rowState.type !== TYPE_LABEL['http-list']) {
      throw new Error(`added row shows ${JSON.stringify(rowState)}, expected the added source`)
    }
    return id
  }

  async function removeSource(id) {
    await rowLocator(page, id).getByTestId('servers-source-remove').click({ timeout: TIMEOUT_MS })
    await waitForRowCount(page, DEFAULT_SOURCES.length)
    if ((await rowsLocator(page).filter({ hasText: ADDED_ADDRESS }).count()) !== 0) {
      throw new Error('the added source is still in the list after removing it')
    }
  }

  // --- add ------------------------------------------------------------------------------------
  const firstAddedId = await addSource(DEFAULT_SOURCES.length + 1)
  await shot('added')

  // --- remove -----------------------------------------------------------------------------------
  await removeSource(firstAddedId)
  await shot('removed')

  // --- reorder ------------------------------------------------------------------------------------
  // A reorder needs a second row whatever the shipped list's length is, so the source is added
  // again and moved from the end to the front - a real, observable change from the default order
  // AC1 just asserted, so AC3's restart proves the EDITED list survives.
  const addedId = await addSource(DEFAULT_SOURCES.length + 1)
  const reorderedIds = [addedId, ...DEFAULT_IDS]
  await keyboardReorder(page, gripFor(page, addedId), 'ArrowUp', DEFAULT_SOURCES.length)
  await waitForRowOrder(page, reorderedIds)
  await shot('reordered')

  const expectedById = new Map(DEFAULT_SOURCES.map((source) => [source.id, source]))
  expectedById.set(addedId, { id: addedId, type: 'http-list', address: ADDED_ADDRESS })

  // --- toggle -------------------------------------------------------------------------------------
  const toggleId = DEFAULT_IDS[0]
  const toggleSwitch = rowLocator(page, toggleId)
    .getByTestId('servers-source-toggle')
    .getByRole('switch')
  await toggleSwitch.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(
          `[data-testid="servers-source-row-${id}"] [data-testid="servers-source-toggle"] [role="switch"]`,
        )
        ?.getAttribute('aria-checked') === 'false',
    toggleId,
    { timeout: TIMEOUT_MS },
  )
  await shot('disabled')
  await toggleSwitch.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(
          `[data-testid="servers-source-row-${id}"] [data-testid="servers-source-toggle"] [role="switch"]`,
        )
        ?.getAttribute('aria-checked') === 'true',
    toggleId,
    { timeout: TIMEOUT_MS },
  )
  await shot('re-enabled')

  step('a disabled source stays in the list and re-enables without re-entry (AC5)')
  const reenabledRow = await readRow(page, toggleId)
  const expectedToggleSource = expectedById.get(toggleId)
  if (
    reenabledRow.address !== expectedToggleSource.address ||
    reenabledRow.type !== TYPE_LABEL[expectedToggleSource.type] ||
    !reenabledRow.enabled
  ) {
    throw new Error(
      `expected ${toggleId} to keep its address/type and end re-enabled, got ${JSON.stringify(reenabledRow)}`,
    )
  }
  const idsAfterEdits = await rowIds(page)
  if (JSON.stringify(idsAfterEdits) !== JSON.stringify(reorderedIds)) {
    throw new Error(
      `the disable/re-enable round trip changed the list's order - expected ${JSON.stringify(reorderedIds)}, got ${JSON.stringify(idsAfterEdits)}`,
    )
  }

  step('an invalid address is refused with a visible reason (AC4)')
  await page
    .getByTestId('servers-source-add-type')
    .selectOption('http-list', { timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-source-add-address')
    .fill(INVALID_ADDRESS, { timeout: TIMEOUT_MS })
  await page.getByTestId('servers-source-add-submit').click({ timeout: TIMEOUT_MS })
  const errorText = page.getByTestId('servers-source-error')
  await errorText.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const rejectionText = await errorText.innerText()
  if (rejectionText !== EXPECTED_INVALID_REASON_TEXT) {
    throw new Error(
      `expected the rendered reason ${JSON.stringify(EXPECTED_INVALID_REASON_TEXT)}, got ${JSON.stringify(rejectionText)}`,
    )
  }
  if (rejectionText.includes('servers.sources.reject')) {
    throw new Error(`expected rendered prose, not a raw i18n key: ${JSON.stringify(rejectionText)}`)
  }
  const idsAfterInvalidAdd = await rowIds(page)
  if (JSON.stringify(idsAfterInvalidAdd) !== JSON.stringify(reorderedIds)) {
    throw new Error(
      `the list changed after a refused add - expected ${JSON.stringify(reorderedIds)}, got ${JSON.stringify(idsAfterInvalidAdd)}`,
    )
  }
  await shot('invalid-address-refused')

  // Snapshot exactly what phase 2 must see, read from disk rather than re-derived in JS, so AC3
  // proves the persisted bytes, not just this process's in-memory state.
  const onDiskAfterEdits = await waitForStateJson(
    userDataDir,
    (doc) =>
      JSON.stringify((doc.servers?.sources ?? []).map((source) => source.id)) ===
      JSON.stringify(reorderedIds),
    'servers.sources to hold the edited list',
  )
  const persistedSources = onDiskAfterEdits.servers?.sources
  if (!Array.isArray(persistedSources) || persistedSources.length !== reorderedIds.length) {
    throw new Error(
      `expected state.json's servers.sources to hold the edited list, got: ${JSON.stringify(persistedSources)}`,
    )
  }
  if (
    JSON.stringify(persistedSources.map((source) => source.id)) !== JSON.stringify(reorderedIds)
  ) {
    throw new Error(
      `state.json's servers.sources order does not match the edited list: ${JSON.stringify(persistedSources)}`,
    )
  }

  step('the edited list survives a restart with type and address intact (AC3)')
  const restartVariant = `${variant}-master-sources-restart`
  const restartUserDataDir = variantUserDataDir(restartVariant)
  mkdirSync(restartUserDataDir, { recursive: true })
  copyFileSync(join(userDataDir, 'state.json'), join(restartUserDataDir, 'state.json'))

  await withApp(
    { variant: restartVariant, viewport: { width: 1280, height: 800 } },
    async ({ page: secondPage }) => {
      await openServersSettings(secondPage)
      await waitForRowCount(secondPage, reorderedIds.length)
      const restartedIds = await rowIds(secondPage)
      if (JSON.stringify(restartedIds) !== JSON.stringify(reorderedIds)) {
        throw new Error(
          `expected the restarted app to show ${JSON.stringify(reorderedIds)}, got ${JSON.stringify(restartedIds)}`,
        )
      }
      for (const id of reorderedIds) {
        const expected = expectedById.get(id)
        const actual = await readRow(secondPage, id)
        if (
          actual.address !== expected.address ||
          actual.type !== TYPE_LABEL[expected.type] ||
          !actual.enabled
        ) {
          throw new Error(
            `after restart, ${id}: expected ${expected.address} / ${TYPE_LABEL[expected.type]} / enabled, ` +
              `got ${JSON.stringify(actual)}`,
          )
        }
      }
      await secondPage.screenshot({
        path: join(
          REPO_ROOT,
          '.ui-verify',
          'screenshots',
          'flows',
          'servers-master-sources-restarted.png',
        ),
      })
    },
  )

  step(
    'remove the added source so a second run without a reseed still starts from the shipped defaults',
  )
  await removeSource(addedId)
  await waitForRowOrder(page, DEFAULT_IDS)
  const finalIds = await rowIds(page)
  if (JSON.stringify(finalIds) !== JSON.stringify(DEFAULT_IDS)) {
    throw new Error(
      `revert left the list as ${JSON.stringify(finalIds)}, expected the shipped default order`,
    )
  }
}
