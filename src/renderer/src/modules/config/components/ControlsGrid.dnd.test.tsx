// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigActionSubcategory } from '@shared/modules/config'
import { initI18n } from '../../../i18n'
import { groupControlsRowEntries } from '../lib/controls-row-groups'
import { moveEntryToDropTarget, type EntryDropTarget } from '../lib/entry-order'
import { ControlsDragZone } from './ControlsDragZone'
import { ControlsGrid } from './ControlsGrid'
import { ControlsRow } from './ControlsRow'

/**
 * Story 054 D4: rows drag within a category.
 *
 * The drag itself is driven through dnd-kit's *keyboard* sensor, exactly like `SortableList`'s own
 * D1 test and for the same reason: jsdom has no layout engine, so a pointer drag's math (measured
 * `getBoundingClientRect` deltas) cannot be exercised here, while the keyboard sensor dispatches
 * plain `keydown` events and only needs the stubbed rects below. That path goes through the very
 * same `onDragEnd` mapping a mouse drop does, which is what these tests are actually about: which
 * position and which sub-category a drop resolves to. `npm run ui:flow` (D12) drives a real pointer
 * drag against the running app.
 *
 * Every case asserts the whole chain: the `EntryDropTarget` the grid reports *and* the `actions`
 * array `moveEntryToDropTarget` (what `ControlsTab.handleReorderRow` calls) produces from it - a
 * drop payload that looked plausible but reordered the wrong rows would pass the first assertion
 * and fail the second.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SUBCATEGORIES: ConfigActionSubcategory[] = [
  { id: 'sub-1', name: 'Use weapon' },
  { id: 'sub-2', name: 'Cycling' },
]

function action(id: string, subcategoryId?: string): ConfigAction {
  return {
    id,
    categoryId: 'weapons',
    name: `Action ${id}`,
    kind: 'bind',
    commands: [],
    ...(subcategoryId ? { subcategoryId } : {}),
  }
}

/** Deliberately *not* in rendered order: the grid renders the ungrouped run first, then one group
 * per sub-category, so these four actions render as u1, a1, a2, b1. A mapping that quietly used the
 * array order instead of the rendered order would move the wrong rows. */
const ACTIONS: ConfigAction[] = [
  action('a1', 'sub-1'),
  action('b1', 'sub-2'),
  action('u1'),
  action('a2', 'sub-1'),
]

/** The order the rows are rendered (and therefore dragged) in. */
const RENDERED_IDS = ['u1', 'a1', 'a2', 'b1']

function groups() {
  return groupControlsRowEntries(
    ACTIONS.map((entry) => ({ kind: 'action' as const, action: entry })),
    SUBCATEGORIES,
  )
}

let container: HTMLDivElement
let root: Root
let drops: EntryDropTarget[]

beforeAll(async () => {
  await initI18n('en')
})

/** A 40px row at its rendered position; a 0x0 box at the origin for anything that is not a row. */
function rectAt(index: number): DOMRect {
  const top = index >= 0 ? index * 40 : 0
  const height = index >= 0 ? 40 : 0
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 800,
    width: 800,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** jsdom reports a 0x0 rect for every element, and dnd-kit's keyboard sensor needs distinct
 * positions to tell one row from the next. Only the sortable items - the per-row `role="rowgroup"`
 * elements - get a real rect, in rendered order; everything else (dividers, sub-rows, the prompt
 * host) stays at 0x0, which is also a small proof in itself that nothing but a row is measured as a
 * drop target.
 *
 * The one exception is dnd-kit's `DragOverlay` element: while an overlay exists, *it* is what the
 * drag's collision rect is measured from, and in a real browser it is laid exactly over the row
 * that was picked up. Reporting the dragged row's box for it is what makes this stub a faithful
 * layout rather than one where the drag starts at the top of the document. */
function stubRowRects(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const overlay = [this, this.firstElementChild, this.firstElementChild?.firstElementChild].some(
      (element) => element?.classList.contains('ctrl-drag-preview'),
    )
    if (overlay) {
      const draggedId = document
        .querySelector('.ctrl-rowgroup.is-dragging')
        ?.getAttribute('data-row-id')
      return rectAt(draggedId ? RENDERED_IDS.indexOf(draggedId) : -1)
    }
    const rowId = this.getAttribute('role') === 'rowgroup' ? this.getAttribute('data-row-id') : null
    return rectAt(rowId ? RENDERED_IDS.indexOf(rowId) : -1)
  })
}

function renderGrid(options: { dragDisabled?: boolean } = {}): void {
  const rendered = groups()
  act(() => {
    root.render(
      // Story 054 D5: the `DndContext` moved out of `ControlsGrid` and up to `ControlsTab`, so the
      // rail's category chips can be drop targets of the *same* drag. Nothing about what this file
      // asserts changed - the drop-to-`EntryDropTarget` mapping moved along with the zone, and the
      // grid is still what renders the sortable rows.
      <ControlsDragZone
        groups={rendered}
        disabled={options.dragDisabled}
        onReorderRow={(drop) => drops.push(drop)}
      >
        <ControlsGrid
          ariaLabel="Controls — Weapons"
          groups={rendered}
          rowCount={ACTIONS.length}
          boundCount={0}
          dragDisabled={options.dragDisabled}
          renderRow={(entry, index, grip) => (
            <ControlsRow
              key={entry.action.id}
              name={entry.action.name}
              resetLabel={`Reset ${entry.action.name}`}
              onReset={() => {}}
              odd={index % 2 === 0}
              rowId={entry.action.id}
              grip={grip}
              keyCell={<span>key</span>}
              optionsCell={<span>options</span>}
              // Story 056's extra-key sub-rows and story 029's message row, on one row, so the
              // "only the row itself is a drag target" case below has something to be wrong about.
              extraKeyRows={
                entry.action.id === 'a1' ? (
                  <div className="ctrl-keysub-row" data-row-id="a1">
                    extra key
                  </div>
                ) : undefined
              }
              subRow={entry.action.id === 'a1' ? <span>message</span> : undefined}
            />
          )}
        />
      </ControlsDragZone>,
    )
  })
}

/** Story 054 D6 gave the sub-category divider its own grip too, sharing the same accessible name -
 * scoped to `role="rowgroup"` (a row's own wrapper) so this file's "one grip per row" concern stays
 * about rows only; the divider's own grip is covered by `ControlsTab.subcategory-drag.test.tsx`. */
function grips(): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[role="rowgroup"] button[aria-label="Drag to reorder"]',
    ),
  ]
}

/** The grip of the row with this id - i.e. the one inside that row's own `role="rowgroup"`. */
function gripOf(rowId: string): HTMLButtonElement {
  const grip = grips().find(
    (button) => button.closest('[role="rowgroup"]')?.getAttribute('data-row-id') === rowId,
  )
  if (!grip) throw new Error(`no grip for row ${rowId}`)
  return grip
}

/** dnd-kit (re)measures droppable rects on an animation frame while a drag is active, so the next
 * keyboard move needs that measurement to have landed first. */
async function pressKey(target: HTMLElement, code: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

/** Space picks the row up, each arrow moves it one position, Space drops it. */
async function dragBy(rowId: string, direction: 'ArrowUp' | 'ArrowDown', steps: number) {
  const grip = gripOf(rowId)
  grip.focus()
  await pressKey(grip, 'Space')
  for (let step = 0; step < steps; step += 1) await pressKey(grip, direction)
  await pressKey(grip, 'Space')
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  drops = []
  stubRowRects()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('ControlsGrid row drag', () => {
  it('reorders inside one sub-category: a1 dropped past a2 lands after it, still in sub-1', async () => {
    renderGrid()

    await dragBy('a1', 'ArrowDown', 1)

    expect(drops).toEqual([
      { id: 'a1', fromSubcategoryId: 'sub-1', toSubcategoryId: 'sub-1', before: 'end' },
    ])
    const next = moveEntryToDropTarget(ACTIONS, drops[0]!)
    // Rendered: ungrouped [u1], sub-1 [a2, a1], sub-2 [b1] - a1 is now the last row of its run,
    // which is what "appended to the array" means once the grid and the file writer bucket by
    // category and sub-category (both keep a bucket's members in array order).
    expect(next.map((entry) => entry.id)).toEqual(['b1', 'u1', 'a2', 'a1'])
    expect(next.map((entry) => entry.subcategoryId)).toEqual(['sub-2', undefined, 'sub-1', 'sub-1'])
  })

  it('moves into a sibling sub-category: b1 dragged up onto a1 lands before it and becomes sub-1', async () => {
    renderGrid()

    await dragBy('b1', 'ArrowUp', 2)

    expect(drops).toEqual([
      { id: 'b1', fromSubcategoryId: 'sub-2', toSubcategoryId: 'sub-1', before: 'a1' },
    ])
    const next = moveEntryToDropTarget(ACTIONS, drops[0]!)
    expect(next.map((entry) => entry.id)).toEqual(['b1', 'a1', 'u1', 'a2'])
    expect(next.find((entry) => entry.id === 'b1')?.subcategoryId).toBe('sub-1')
    // Nothing else changed sub-category.
    expect(
      next.filter((entry) => entry.subcategoryId === 'sub-1').map((entry) => entry.id),
    ).toEqual(['b1', 'a1', 'a2'])
  })

  it('moves into the ungrouped run: a1 dragged above u1 drops its subcategoryId entirely', async () => {
    renderGrid()

    await dragBy('a1', 'ArrowUp', 1)

    expect(drops).toEqual([
      { id: 'a1', fromSubcategoryId: 'sub-1', toSubcategoryId: undefined, before: 'u1' },
    ])
    const next = moveEntryToDropTarget(ACTIONS, drops[0]!)
    expect(next.map((entry) => entry.id)).toEqual(['b1', 'a1', 'u1', 'a2'])
    // Not `subcategoryId: ''` or a dangling id that merely *renders* as ungrouped - the key is gone.
    expect('subcategoryId' in next.find((entry) => entry.id === 'a1')!).toBe(false)
  })

  it('makes only the row itself a drag target - never a sub-row, prompt host or message row', () => {
    renderGrid()

    // One grip per row, and every sortable element inside a row's own `role="rowgroup"` is one of
    // those grips.
    expect(grips()).toHaveLength(RENDERED_IDS.length)
    const rowSortables = container.querySelectorAll('[role="rowgroup"] [aria-roledescription="sortable"]')
    expect([...rowSortables]).toEqual(grips())

    // The row's other elements carry `data-row-id` (story 056) but no drag wiring of their own.
    for (const selector of [
      '.ctrl-keysub-container',
      '.ctrl-subrow-host-row',
      '.ctrl-msgrow-row',
    ]) {
      const nodes = [...container.querySelectorAll(selector)]
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        expect(node.getAttribute('role')).not.toBe('rowgroup')
        expect(node.querySelector('[aria-roledescription="sortable"]')).toBeNull()
      }
    }

    // Story 054 D6: the sub-category dividers are sortable too now, but as their own distinct
    // group - one grip per divider (`sub-1`, `sub-2`), never among `grips()`'s row-scoped set above.
    const headerSortables = [...container.querySelectorAll('.ctrl-group [aria-roledescription="sortable"]')]
    expect(headerSortables).toHaveLength(SUBCATEGORIES.length)
    for (const sortable of headerSortables) expect(grips()).not.toContain(sortable)
  })

  it('disables every grip while the filter narrows the list, with the reason as its tooltip', async () => {
    renderGrid({ dragDisabled: true })

    for (const grip of grips()) {
      expect(grip.getAttribute('aria-disabled')).toBe('true')
      expect(grip.getAttribute('title')).toBe('Clear the filter to reorder by dragging')
    }

    await dragBy('a1', 'ArrowDown', 1)
    expect(drops).toEqual([])
  })
})
