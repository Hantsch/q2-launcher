// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { ProfileChangesProvider } from './lib/profile-changes'

/**
 * Story 054 D6: sub-category headers reorder by drag.
 *
 * Mirrors `ControlsTab.dnd.test.tsx`'s real-pointer-drag idiom (jsdom has no layout engine, so
 * every rect a drag needs is stubbed), but over the *header* axis instead of rows - dragging a
 * sub-category's own grip has to move it among its category's other sub-categories, persist
 * through the same path the header's move up/down buttons already use, and never touch a row.
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
  {
    id: 'weapons',
    name: 'Weapons',
    subcategories: [
      { id: 'sub-1', name: 'Use weapon' },
      { id: 'sub-2', name: 'Reload' },
    ],
  },
]

function action(id: string, subcategoryId?: string): ConfigAction {
  return {
    id,
    categoryId: 'weapons',
    name: id,
    kind: 'bind',
    commands: [],
    ...(subcategoryId ? { subcategoryId } : {}),
  }
}

// One ungrouped row so the category's `rowEntries` is non-empty (the grid, and its headers, only
// render once a category has at least one entry) - it is never itself a drag target here.
const ACTIONS: ConfigAction[] = [action('w0'), action('w1', 'sub-1'), action('w2', 'sub-2')]

function profileFixture(): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    categories: CATEGORIES.map((category) => ({
      ...category,
      subcategories: category.subcategories?.map((subcategory) => ({ ...subcategory })),
    })),
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

const HEADERS_TOP = 500
const HEADER_HEIGHT = 40

/** The vertical middle of the n-th rendered sub-category header. */
function headerCentreY(index: number): number {
  return HEADERS_TOP + index * HEADER_HEIGHT + HEADER_HEIGHT / 2
}

function stubRects(): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const subcategoryId = this.getAttribute('data-subcategory-id')
    if (subcategoryId) {
      const headers = [...document.querySelectorAll('[data-subcategory-id]')]
      const index = headers.indexOf(this)
      return rect(0, HEADERS_TOP + index * HEADER_HEIGHT, 800, HEADER_HEIGHT)
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

/** The sub-category headers the grid is showing right now, in rendered order. */
function renderedSubcategoryIds(): string[] {
  return [...container.querySelectorAll('[data-subcategory-id]')].map(
    (element) => element.getAttribute('data-subcategory-id') ?? '',
  )
}

function headerGrip(subcategoryId: string): HTMLButtonElement {
  const grip = [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label="Drag to reorder"]'),
  ].find(
    (button) =>
      button.closest('[data-subcategory-id]')?.getAttribute('data-subcategory-id') ===
      subcategoryId,
  )
  if (!grip) throw new Error(`no grip for sub-category ${subcategoryId}`)
  return grip
}

async function pickUpHeader(subcategoryId: string): Promise<void> {
  const grip = headerGrip(subcategoryId)
  const index = renderedSubcategoryIds().indexOf(subcategoryId)
  const y = headerCentreY(index)
  await step(() => grip.dispatchEvent(pointer('pointerdown', 10, y)))
  await step(() => document.dispatchEvent(pointer('pointermove', 10, y + 20)))
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

describe('ControlsTab sub-category header drag (story 054 D6)', () => {
  it('reorders sub-categories within their category and persists the new order', async () => {
    renderTab()
    expect(renderedSubcategoryIds()).toEqual(['sub-1', 'sub-2'])

    // Drag "Reload" (sub-2) up onto "Use weapon" (sub-1)'s position.
    await pickUpHeader('sub-2')
    await moveTo(400, headerCentreY(0))
    await release(400, headerCentreY(0))

    expect(renderedSubcategoryIds()).toEqual(['sub-2', 'sub-1'])
    expect(savedCategories).toHaveLength(1)
    const weapons = savedCategories[0]!.find((category) => category.id === 'weapons')!
    expect(weapons.subcategories?.map((subcategory) => subcategory.id)).toEqual([
      'sub-2',
      'sub-1',
    ])
  })

  it('leaves sub-category order untouched when the header is dropped back where it started', async () => {
    renderTab()

    await pickUpHeader('sub-1')
    await moveTo(400, headerCentreY(0))
    await release(400, headerCentreY(0))

    expect(savedCategories).toEqual([])
    expect(renderedSubcategoryIds()).toEqual(['sub-1', 'sub-2'])
  })
})
