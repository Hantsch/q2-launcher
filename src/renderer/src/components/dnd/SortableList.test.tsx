// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../i18n'
import { DragHandle } from './DragHandle'
import { SortableList } from './SortableList'

// React 19's `act()` only relaxes its "not wrapped in act" warnings when this flag is set - jsdom
// itself does not set it, and there is no other test setup file in this repo to do it globally.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Story 054 D1's acceptance check: a throwaway sortable list reorders by keyboard (Space, arrow,
 * Space). jsdom has no layout engine, so dnd-kit's pointer-drag math (which depends on measured
 * `getBoundingClientRect` deltas) cannot be exercised meaningfully here - the keyboard sensor
 * dispatches plain `keydown` events and does not depend on layout, so it is the one path this
 * environment can prove end to end. `npm run ui:flow` (D12) is where a real pointer drag gets
 * verified against the running app.
 */

interface Row {
  id: string
  label: string
}

const ROWS: Row[] = [
  { id: 'a', label: 'Row A' },
  { id: 'b', label: 'Row B' },
  { id: 'c', label: 'Row C' },
]

function TestList({ onReorder }: { onReorder: (rows: Row[]) => void }) {
  return (
    <SortableList
      items={ROWS}
      getItemId={(row) => row.id}
      onReorder={onReorder}
      renderItem={(row, { setNodeRef, style, attributes, listeners }) => (
        <div key={row.id} ref={setNodeRef} style={style} data-testid={`row-${row.id}`}>
          <DragHandle attributes={attributes} listeners={listeners} />
          <span>{row.label}</span>
        </div>
      )}
    />
  )
}

let container: HTMLDivElement
let root: Root

beforeAll(async () => {
  await initI18n('en')
})

/** jsdom has no layout engine, so every real element reports a 0x0 rect at (0, 0) - dnd-kit's
 * keyboard sensor and collision detection need distinct positions to tell "the row above" from
 * "the row below". Stubbed by row id, in the fixed initial order (this test never re-renders the
 * list with a new order, so the id -> position mapping stays valid for the whole interaction). */
function stubRowRects(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const testId = this.getAttribute('data-testid')
    const index = testId?.startsWith('row-')
      ? ROWS.findIndex((row) => `row-${row.id}` === testId)
      : -1
    const top = index >= 0 ? index * 40 : 0
    return {
      top,
      bottom: top + 40,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  stubRowRects()
})

/** dnd-kit (re)measures droppable rects via `requestAnimationFrame` while a drag is active, which
 * runs on its own tick outside the synchronous keydown dispatch - the keyboard sensor's next move
 * needs that measurement to have landed first, or it sees the same (stale) rects as before. */
async function pressKey(target: HTMLElement, code: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('SortableList', () => {
  it('renders every item with its grip', () => {
    act(() => {
      root.render(<TestList onReorder={() => {}} />)
    })

    expect(container.querySelectorAll('[data-testid^="row-"]')).toHaveLength(3)
    expect(container.querySelectorAll('button[aria-label="Drag to reorder"]')).toHaveLength(3)
  })

  it('reorders by keyboard: Space picks up, ArrowDown moves, Space drops', async () => {
    let latest: Row[] = ROWS

    act(() => {
      root.render(
        <TestList
          onReorder={(rows) => {
            latest = rows
          }}
        />,
      )
    })

    const grips = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Drag to reorder"]',
    )
    const firstGrip = grips[0]
    firstGrip.focus()

    await pressKey(firstGrip, 'Space')
    await pressKey(firstGrip, 'ArrowDown')
    await pressKey(firstGrip, 'Space')

    expect(latest.map((row) => row.id)).toEqual(['b', 'a', 'c'])
  })

  it('cancels on Escape without reordering', async () => {
    let called = false

    act(() => {
      root.render(
        <TestList
          onReorder={() => {
            called = true
          }}
        />,
      )
    })

    const grips = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Drag to reorder"]',
    )
    const firstGrip = grips[0]
    firstGrip.focus()

    await pressKey(firstGrip, 'Space')
    await pressKey(firstGrip, 'ArrowDown')
    await pressKey(firstGrip, 'Escape')

    expect(called).toBe(false)
  })

  it('disables every grip and dims it, with the reason as its tooltip', () => {
    act(() => {
      root.render(
        <SortableList
          items={ROWS}
          getItemId={(row) => row.id}
          onReorder={() => {}}
          disabled
          renderItem={(row, { setNodeRef, style }) => (
            <div key={row.id} ref={setNodeRef} style={style}>
              <DragHandle disabled disabledReason="Filtered lists cannot be reordered." />
              <span>{row.label}</span>
            </div>
          )}
        />,
      )
    })

    const grip = container.querySelector<HTMLButtonElement>('button[aria-label="Drag to reorder"]')
    expect(grip).not.toBeNull()
    expect(grip?.getAttribute('aria-disabled')).toBe('true')
    expect(grip?.getAttribute('title')).toBe('Filtered lists cannot be reordered.')
  })
})
