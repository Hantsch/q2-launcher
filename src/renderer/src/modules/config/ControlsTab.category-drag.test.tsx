// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { ProfileChangesProvider } from './lib/profile-changes'

/**
 * Story 054 D7: category chips reorder by drag.
 *
 * Mirrors `ControlsTab.subcategory-drag.test.tsx`'s real-pointer-drag idiom (jsdom has no layout
 * engine, so every rect the drag needs is stubbed), but over the *category rail* axis instead of
 * the sub-category headers - dragging a chip's own grip has to reorder `categories`, persist
 * through the same path the rail's move-left/move-right buttons already use, and never resolve as
 * a row dropped *on* the chip (D5's own drop-target gesture, which these tests also re-check still
 * works over the reordered rail).
 */

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
  { id: 'weapons', name: 'Weapons' },
  { id: 'drops', name: 'Drops' },
]

function action(id: string, categoryId: string): ConfigAction {
  return { id, categoryId, name: id, kind: 'bind', commands: [] }
}

// One row per category so every one of the rail's chips has something behind it (irrelevant to
// this story's own gesture, but keeps the fixture realistic).
const ACTIONS: ConfigAction[] = [
  action('m1', 'movement'),
  action('w1', 'weapons'),
  action('d1', 'drops'),
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
/** Every `categories` array `ControlsTab` tried to persist, in order. */
let savedCategories: ConfigActionCategory[][]

beforeAll(async () => {
  await initI18n('en')
})

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

const CHIP_TOP = 0
const CHIP_WIDTH = 100
const CHIP_GAP = 20

/** The horizontal middle of the n-th rendered chip - the rail is a `horizontalListSortingStrategy`
 * sortable list (story 054 D7), so position along x is what a chip drop resolves against, mirroring
 * `headerCentreY` for D6's vertical header axis. */
function chipCentreX(index: number): number {
  return index * (CHIP_WIDTH + CHIP_GAP) + CHIP_WIDTH / 2
}

function stubRects(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const categoryId = this.getAttribute('data-drop-category')
    if (categoryId) {
      const chips = [...document.querySelectorAll('[data-drop-category]')]
      const index = chips.indexOf(this)
      return rect(index * (CHIP_WIDTH + CHIP_GAP), CHIP_TOP, CHIP_WIDTH, 30)
    }
    return rect(0, 0, 0, 0)
  })
}

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

async function step(fire: () => void): Promise<void> {
  await act(async () => {
    fire()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

function Harness() {
  const [draft, setDraft] = useState<ConfigProfile>(profileFixture)
  const profile = profileFixture()
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

/** The category chips the rail is showing right now, in rendered order. */
function renderedCategoryIds(): string[] {
  return [...container.querySelectorAll('[data-drop-category]')].map(
    (element) => element.getAttribute('data-drop-category') ?? '',
  )
}

function chipGrip(categoryId: string): HTMLButtonElement {
  const grip = [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Drag to reorder"]'),
  ].find(
    (button) => button.closest('[data-drop-category]')?.getAttribute('data-drop-category') === categoryId,
  )
  if (!grip) throw new Error(`no grip for category ${categoryId}`)
  return grip
}

async function pickUpChip(categoryId: string): Promise<void> {
  const grip = chipGrip(categoryId)
  const index = renderedCategoryIds().indexOf(categoryId)
  const x = chipCentreX(index)
  await step(() => grip.dispatchEvent(pointer('pointerdown', x, 15)))
  await step(() => document.dispatchEvent(pointer('pointermove', x + 20, 15)))
}

async function moveTo(x: number, y: number): Promise<void> {
  await step(() => document.dispatchEvent(pointer('pointermove', x, y)))
}

async function release(x: number, y: number): Promise<void> {
  await step(() => document.dispatchEvent(pointer('pointerup', x, y)))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  HTMLElement.prototype.scrollIntoView = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  savedCategories = []
  bridge.invoke = vi.fn((_channel: string, payload: unknown) => {
    const envelope = payload as {
      type: string
      payload?: { categories?: ConfigActionCategory[] }
    }
    if (envelope.payload?.categories) savedCategories.push(envelope.payload.categories)
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

describe('ControlsTab category chip drag (story 054 D7)', () => {
  it('reorders the rail and persists the new category order', async () => {
    renderTab()
    expect(renderedCategoryIds()).toEqual(['movement', 'weapons', 'drops'])

    // Drag "Drops" (index 2) onto "Movement" (index 0)'s position.
    await pickUpChip('drops')
    await moveTo(chipCentreX(0), 15)
    await release(chipCentreX(0), 15)

    expect(renderedCategoryIds()).toEqual(['drops', 'movement', 'weapons'])
    expect(savedCategories).toHaveLength(1)
    expect(savedCategories[0]!.map((category) => category.id)).toEqual([
      'drops',
      'movement',
      'weapons',
    ])
  })

  it('leaves category order untouched when a chip is dropped back where it started', async () => {
    renderTab()

    await pickUpChip('movement')
    await moveTo(chipCentreX(0), 15)
    await release(chipCentreX(0), 15)

    expect(savedCategories).toEqual([])
    expect(renderedCategoryIds()).toEqual(['movement', 'weapons', 'drops'])
  })

  it('reads the reordered rail off persisted state, not local-only UI state - it survives a re-render', async () => {
    renderTab()

    await pickUpChip('weapons')
    await moveTo(chipCentreX(0), 15)
    await release(chipCentreX(0), 15)

    expect(renderedCategoryIds()).toEqual(['weapons', 'movement', 'drops'])
    const persisted = savedCategories[0]!.map((category) => category.id)

    // A fresh mount (the story's "survives a tab switch" - nothing about the rail's order lives in
    // this component instance's own state) renders straight off the persisted array, not the
    // now-unmounted instance's derived order.
    act(() => root.unmount())
    container.remove()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <ProfileChangesProvider
          profile={{ ...profileFixture(), categories: persisted.map((id) => ({ id, name: id })) }}
        >
          <ControlsTab
            profile={{ ...profileFixture(), categories: persisted.map((id) => ({ id, name: id })) }}
            draft={{ ...profileFixture(), categories: persisted.map((id) => ({ id, name: id })) }}
            patch={() => {}}
            onChanged={() => {}}
          />
        </ProfileChangesProvider>,
      )
    })
    expect(renderedCategoryIds()).toEqual(persisted)
  })
})
