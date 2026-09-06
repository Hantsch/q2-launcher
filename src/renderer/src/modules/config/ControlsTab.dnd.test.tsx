// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { SPRING_LOAD_MS } from './components/ControlsDragZone'
import { ProfileChangesProvider } from './lib/profile-changes'

/**
 * Story 054 D5: cross-category drops.
 *
 * These tests drive the *real* `ControlsTab` - its rail, its grid, its save path - through real
 * pointer events, because every part of D5 is an interaction between pieces that are individually
 * unremarkable: a chip is only a drop target because it is inside the same `DndContext` as the
 * rows, and a spring-load is only safe because the category it switches to is provisional state
 * that a cancel drops. A test of any one of those in isolation would prove none of it.
 *
 * A pointer drag rather than D4's keyboard sensor: reaching a chip is by definition a pointer
 * gesture (`controlsCollisionDetection` only ever offers a chip while the pointer is inside it -
 * the keyboard path for a cross-category move is D8's row menu). jsdom has no layout engine, so
 * every rect the drag needs is stubbed below; what is *not* stubbed is dnd-kit itself, the
 * collision detection, the 600 ms timer or any of `ControlsTab`'s own logic.
 */

// `ControlsTab`'s import chain reaches `lib/bridge.ts`, which resolves `window.q2` at *module*
// scope and throws when it is missing - so the bridge has to exist before this file's imports are
// evaluated (same idiom as `ControlsTab.dialogs.test.ts`). `invoke` is replaced per test below.
const bridge = vi.hoisted(() => {
  const stub = {
    invoke: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    on: () => () => {},
  }
  ;(globalThis as unknown as { q2: unknown }).q2 = stub
  return stub
})

// eslint-disable-next-line import/first -- must be imported after the bridge stub above exists.
const { ControlsTab } = await import('./ControlsTab')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CATEGORIES: ConfigActionCategory[] = [
  { id: 'movement', name: 'Movement' },
  { id: 'weapons', name: 'Weapons', subcategories: [{ id: 'sub-1', name: 'Use weapon' }] },
]

function action(id: string, categoryId: string, subcategoryId?: string): ConfigAction {
  return {
    id,
    categoryId,
    name: id,
    kind: 'bind',
    commands: [],
    ...(subcategoryId ? { subcategoryId } : {}),
  }
}

/** Two categories, and `weapons` deliberately has both an ungrouped row and a sub-category: a row
 * dropped into it must land at an exact position *and* pick up the sub-category of the run it was
 * dropped into, which a single-run category could not tell apart. */
const ACTIONS: ConfigAction[] = [
  action('m1', 'movement'),
  action('m2', 'movement'),
  action('w0', 'weapons'),
  action('w1', 'weapons', 'sub-1'),
  action('w2', 'weapons', 'sub-1'),
]

function profileFixture(): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    categories: CATEGORIES.map((category) => ({ ...category })),
    actions: ACTIONS.map((entry) => ({ ...entry })),
  }
}

let container: HTMLDivElement
let root: Root
/** Every `actions` array `ControlsTab` tried to persist, in order. Empty means the model was never
 * touched - which is exactly what "Escape leaves the model untouched" has to assert. */
let saved: ConfigAction[][]
/** The draft as the tab last rendered it - the in-memory half of "the model", which `patch` is
 * what writes to. Read alongside `saved` so a cancel is proven not to have moved anything either on
 * disk or in the draft the save bar diffs against. */
let latestDraft: ConfigProfile

beforeAll(async () => {
  await initI18n('en')
})

/**
 * jsdom reports a 0x0 rect for everything, so the drag is given a layout: the category rail across
 * the top, the grid's rows underneath it in the order they are currently rendered in. Rows are
 * measured by their *live* DOM position rather than a fixed id map, because the whole point of a
 * spring-load is that the rendered row list changes mid-drag.
 */
const CHIP_RECTS: Record<string, { left: number; width: number }> = {
  movement: { left: 0, width: 100 },
  weapons: { left: 120, width: 100 },
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

const ROWS_TOP = 100
const ROW_HEIGHT = 40

/** The vertical middle of the n-th rendered row. */
function rowCentreY(index: number): number {
  return ROWS_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2
}

function stubRects(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const categoryId = this.getAttribute('data-drop-category')
    if (categoryId && CHIP_RECTS[categoryId]) {
      const chip = CHIP_RECTS[categoryId]
      return rect(chip.left, 0, chip.width, 30)
    }
    // The floating copy inside dnd-kit's `DragOverlay`: in a real browser it lies exactly over the
    // row that was picked up, and it is what the drag's collision rect is measured from.
    const overlay = [this, this.firstElementChild, this.firstElementChild?.firstElementChild].some(
      (element) => element?.classList.contains('ctrl-drag-preview'),
    )
    const rows = [...document.querySelectorAll('[role="rowgroup"][data-row-id]')]
    if (overlay) {
      const dragged = document.querySelector('.ctrl-rowgroup.is-dragging')
      const index = dragged ? rows.indexOf(dragged) : -1
      return rect(0, index >= 0 ? ROWS_TOP + index * ROW_HEIGHT : 0, 800, ROW_HEIGHT)
    }
    if (this.getAttribute('role') === 'rowgroup' && this.hasAttribute('data-row-id')) {
      return rect(0, ROWS_TOP + rows.indexOf(this) * ROW_HEIGHT, 800, ROW_HEIGHT)
    }
    return rect(0, 0, 0, 0)
  })
}

/** jsdom has `PointerEvent`, and dnd-kit's `PointerSensor` only reads `clientX`/`clientY`/
 * `isPrimary`/`button` off it - so a real pointer drag is reproducible here without faking the
 * sensor itself. */
function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
    pointerId: 1,
  })
}

/** dnd-kit re-measures droppables on animation frames, so every step yields one before the next. */
async function step(fire: () => void): Promise<void> {
  await act(async () => {
    fire()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

function Harness() {
  const [draft, setDraft] = useState<ConfigProfile>(profileFixture)
  const profile = profileFixture()
  latestDraft = draft
  return (
    <ProfileChangesProvider profile={profile}>
      <ControlsTab
        profile={profile}
        draft={draft}
        patch={(partial) =>
          setDraft((prev) => ({
            ...prev,
            ...(typeof partial === 'function' ? partial(prev) : partial),
          }))
        }
        onChanged={() => {}}
      />
    </ProfileChangesProvider>
  )
}

function renderTab(): void {
  act(() => {
    root.render(<Harness />)
  })
}

/** The rows the grid is showing right now, in rendered order. */
function renderedRowIds(): string[] {
  return [...container.querySelectorAll('[role="rowgroup"][data-row-id]')].map(
    (element) => element.getAttribute('data-row-id') ?? '',
  )
}

function gripOf(rowId: string): HTMLButtonElement {
  const grip = [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Drag to reorder"]'),
  ].find((button) => button.closest('[role="rowgroup"]')?.getAttribute('data-row-id') === rowId)
  if (!grip) throw new Error(`no grip for row ${rowId}`)
  return grip
}

function chipCentre(categoryId: string): { x: number; y: number } {
  const chip = CHIP_RECTS[categoryId]!
  return { x: chip.left + chip.width / 2, y: 15 }
}

/** Picks `rowId` up: press on its grip, then move far enough to clear the 8px activation distance
 * `PointerSensor` is configured with (D1), so a click on the grip is never a drag. */
async function pickUp(rowId: string): Promise<void> {
  const grip = gripOf(rowId)
  const index = renderedRowIds().indexOf(rowId)
  const y = rowCentreY(index)
  await step(() => grip.dispatchEvent(pointer('pointerdown', 10, y)))
  await step(() => document.dispatchEvent(pointer('pointermove', 10, y + 20)))
}

async function moveTo(x: number, y: number): Promise<void> {
  await step(() => document.dispatchEvent(pointer('pointermove', x, y)))
}

async function release(x: number, y: number): Promise<void> {
  await step(() => document.dispatchEvent(pointer('pointerup', x, y)))
}

async function pressEscape(): Promise<void> {
  await step(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })),
  )
}

/** Only `setTimeout`/`clearTimeout` are faked: the spring-load timer is the one thing that must not
 * run in real time, while dnd-kit's own `requestAnimationFrame` measuring has to keep working. */
async function waitOutSpringLoad(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(SPRING_LOAD_MS)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // jsdom implements no scrolling at all, so `scrollIntoView` does not even exist to be spied on;
  // `ControlsTab` scrolls the selected chip into view on every category change.
  HTMLElement.prototype.scrollIntoView = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  saved = []
  bridge.invoke = vi.fn((_channel: string, payload: unknown) => {
    const envelope = payload as { type: string; payload?: { actions?: ConfigAction[] } }
    if (envelope.payload?.actions) saved.push(envelope.payload.actions)
    return Promise.resolve({ ok: true, value: [] })
  }) as unknown as typeof bridge.invoke
  stubRects()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('ControlsTab cross-category drag (story 054 D5)', () => {
  it('moves a row to another category when it is dropped straight on that category chip', async () => {
    renderTab()
    expect(renderedRowIds()).toEqual(['m1', 'm2'])

    await pickUp('m1')
    const weapons = chipCentre('weapons')
    await moveTo(weapons.x, weapons.y)
    await release(weapons.x, weapons.y)

    expect(saved).toHaveLength(1)
    const next = saved[0]!
    // Appended at the end of the target category's run (the story's decision), sub-category
    // dropped - the one it had belonged to its old category.
    expect(next.map((entry) => entry.id)).toEqual(['m2', 'w0', 'w1', 'w2', 'm1'])
    expect(next.find((entry) => entry.id === 'm1')?.categoryId).toBe('weapons')
    expect('subcategoryId' in next.find((entry) => entry.id === 'm1')!).toBe(false)
    // The source category lost it on screen too, and the tab did not follow the row.
    expect(renderedRowIds()).toEqual(['m2'])
  })

  it('leaves the model alone when a row is dropped back on its own category chip', async () => {
    renderTab()

    await pickUp('m1')
    const movement = chipCentre('movement')
    await moveTo(movement.x, movement.y)
    await release(movement.x, movement.y)

    expect(saved).toEqual([])
    expect(renderedRowIds()).toEqual(['m1', 'm2'])
  })

  it('spring-loads a foreign category after ~600ms and drops the row at an exact position in it', async () => {
    renderTab()

    await pickUp('m1')
    const weapons = chipCentre('weapons')
    await moveTo(weapons.x, weapons.y)
    // Nothing has switched yet - the pointer has only just arrived.
    expect(renderedRowIds()).toEqual(['m1', 'm2'])

    await waitOutSpringLoad()
    // The grid is the weapons grid now, with the dragged row carried into it (ungrouped, so it
    // renders in the ungrouped run after `w0`) - it has to stay a live sortable item, or there
    // would be no exact position to drop it at.
    expect(renderedRowIds()).toEqual(['w0', 'm1', 'w1', 'w2'])
    expect(saved).toEqual([])

    // Drop it onto `w1`, the first row of the `sub-1` run, moving downwards - so it lands after it.
    await moveTo(400, rowCentreY(2))
    await release(400, rowCentreY(2))

    expect(saved).toHaveLength(1)
    const next = saved[0]!
    expect(next.map((entry) => entry.id)).toEqual(['m2', 'w0', 'w1', 'm1', 'w2'])
    const moved = next.find((entry) => entry.id === 'm1')!
    expect(moved.categoryId).toBe('weapons')
    // Both halves of the drop: the new category *and* the sub-category run it was dropped into.
    expect(moved.subcategoryId).toBe('sub-1')
    // A spring-load that ended in a real drop commits the view it switched to, so the user can see
    // where the row landed.
    expect(renderedRowIds()).toEqual(['w0', 'w1', 'm1', 'w2'])
  })

  it('cancels the whole operation on Escape after a spring-load, leaving the model untouched', async () => {
    renderTab()
    const before = renderedRowIds()

    await pickUp('m1')
    const weapons = chipCentre('weapons')
    await moveTo(weapons.x, weapons.y)
    await waitOutSpringLoad()
    // The switch really happened - this test would otherwise pass by never spring-loading at all.
    expect(renderedRowIds()).toEqual(['w0', 'm1', 'w1', 'w2'])

    await pressEscape()

    // Nothing was persisted, and the draft is byte-for-byte what it was before the drag started -
    // no category change, no reorder, not even for the row that was carried into another category.
    expect(saved).toEqual([])
    expect(latestDraft.actions).toEqual(ACTIONS)
    expect(latestDraft.categories).toEqual(CATEGORIES)
    // ...and the visible grid is the category the tab was on before the drag, with its rows in
    // their original order. The spring-loaded category left no trace.
    expect(renderedRowIds()).toEqual(before)
    expect(before).toEqual(['m1', 'm2'])

    // A second drag still works afterwards - the cancel did not leave the tab in a drag state.
    await pickUp('m1')
    await moveTo(400, rowCentreY(1))
    await release(400, rowCentreY(1))
    expect(saved).toHaveLength(1)
    // "Appended" is the end of the whole array, which is exactly "last row of its own category" on
    // screen, since both the grid and the file writer bucket by category in array order (D4).
    expect(saved[0]!.map((entry) => entry.id)).toEqual(['m2', 'w0', 'w1', 'w2', 'm1'])
    expect(renderedRowIds()).toEqual(['m2', 'm1'])
  })

  it('does not switch when the pointer only brushes a chip for less than the spring-load delay', async () => {
    renderTab()

    await pickUp('m1')
    const weapons = chipCentre('weapons')
    await moveTo(weapons.x, weapons.y)
    await act(async () => {
      vi.advanceTimersByTime(SPRING_LOAD_MS - 100)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    // Back over the grid before the timer could elapse.
    await moveTo(400, rowCentreY(1))
    await waitOutSpringLoad()

    expect(renderedRowIds()).toEqual(['m1', 'm2'])

    await release(400, rowCentreY(1))
    // The drag still did what it was: a plain within-category reorder, no category change.
    expect(saved).toHaveLength(1)
    expect(saved[0]!.map((entry) => entry.id)).toEqual(['m2', 'w0', 'w1', 'w2', 'm1'])
    expect(saved[0]!.find((entry) => entry.id === 'm1')?.categoryId).toBe('movement')
    expect(renderedRowIds()).toEqual(['m2', 'm1'])
  })
})
