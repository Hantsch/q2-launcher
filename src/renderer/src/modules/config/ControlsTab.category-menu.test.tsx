// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigActionCategory, ConfigProfile } from '@shared/modules/config'
import { initI18n } from '../../i18n'
import { ProfileChangesProvider } from './lib/profile-changes'

/**
 * Story 062 D1: the category rail's kebab takes over move up/down, rename and delete from the
 * four inline icon buttons every chip used to carry. These tests drive the real `ControlsTab` -
 * its kebab, its portalled `Menu`, the rename/delete dialogs it opens - through real DOM events,
 * mirroring `ControlsTab.row-menu.test.tsx` (story 054 D8's row kebab).
 */

// `ControlsTab`'s import chain reaches `lib/bridge.ts`, which resolves `window.q2` at *module*
// scope and throws when it is missing - so the bridge has to exist before this file's imports are
// evaluated (same idiom as `ControlsTab.row-menu.test.tsx`). `invoke` is replaced per test below.
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
]

// Every action lives in `movement` - `weapons` is the empty category the inline-confirm-vs-modal
// delete tests need (story 052 D9: an empty category skips the delete-or-move modal).
const ACTIONS: ConfigAction[] = [
  {
    id: 'f',
    categoryId: 'movement',
    name: 'movement:forward',
    catalogId: 'movement:forward',
    kind: 'bind',
    commands: [],
  },
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

/** The rail's own container - scopes queries so a same-named icon/label used elsewhere in the tab
 * (e.g. a subcategory header's own rename/delete) can never false-positive a rail assertion. */
function categoryRail(): HTMLElement {
  const rail = container.querySelector<HTMLElement>('.ctrl-category-rail')
  if (!rail) throw new Error('no category rail')
  return rail
}

/** The chip's kebab trigger - the one button every category chip now carries in place of the old
 * inline move-up/move-down/rename/delete icon buttons. */
function categoryMenuTriggerFor(name: string): HTMLButtonElement {
  const button = categoryRail().querySelector<HTMLButtonElement>(
    `button[aria-label="Actions for “${name}”"]`,
  )
  if (!button) throw new Error(`no category menu trigger for "${name}"`)
  return button
}

/** One chip, by the `data-category-name` handle story 062 D2 put on the chip container - the same
 * node that carries the drop-target/sortable-item/scroll-into-view roles, and the handle the
 * `ui:flow` rail-order assertion uses instead of walking the chip's buttons by DOM order. */
function categoryChip(name: string): HTMLElement {
  const chip = categoryRail().querySelector<HTMLElement>(`[data-category-name="${name}"]`)
  if (!chip) throw new Error(`no category chip for "${name}"`)
  return chip
}

/** The chip's label button - the "select this category" control, the only one of the chip's
 * buttons carrying visible text. */
function categoryLabelButton(name: string): HTMLButtonElement {
  const button = [...categoryChip(name).querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name,
  )
  if (!button) throw new Error(`no label button for "${name}"`)
  return button
}

/** A utility that paints a surface: a coloured `bg-*` or `border-*`. `border`/`rounded-*` (shape
 * without colour) and `*-transparent` are explicitly not a box level, and neither is a `hover:`/
 * `focus:` variant, whose class token does not start with `bg-`/`border-`. */
function paintsABox(element: Element): boolean {
  return [...element.classList].some((cls) => /^(?:bg|border)-(?!transparent$)/.test(cls))
}

function openCategoryMenu(name: string): void {
  act(() => {
    categoryMenuTriggerFor(name).click()
  })
}

/** The portalled menu's items, in DOM order - real `<button role="menuitem">`s, so a keyboard user
 * reaches every one of them by Tab and activates with Enter/Space exactly like this test's
 * `.click()` does. */
function categoryMenuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button[role="menuitem"]')]
}

function clickCategoryMenuItem(label: string): void {
  const item = categoryMenuItems().find((button) => button.textContent === label)
  if (!item) throw new Error(`no category menu item "${label}"`)
  act(() => {
    item.click()
  })
}

beforeEach(() => {
  // jsdom implements no scrolling at all, so `scrollIntoView` does not even exist to be spied on;
  // `ControlsTab` scrolls the selected chip into view on every category change.
  HTMLElement.prototype.scrollIntoView = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  savedCategories = []
  bridge.invoke = vi.fn((_channel: string, payload: unknown) => {
    const envelope = payload as { type: string; payload?: { categories?: ConfigActionCategory[] } }
    if (envelope.payload?.categories) savedCategories.push(envelope.payload.categories)
    return Promise.resolve({ ok: true, value: [] })
  }) as unknown as typeof bridge.invoke
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('ControlsTab category menu (story 062 D1)', () => {
  it('has no move-up or move-down icon buttons left in the rail, only a kebab and a grip', () => {
    renderTab()
    const rail = categoryRail()
    expect(rail.querySelector('button[aria-label="Move category up"]')).toBeNull()
    expect(rail.querySelector('button[aria-label="Move category down"]')).toBeNull()
    expect(rail.querySelector('button[aria-label="Rename…"]')).toBeNull()
    expect(rail.querySelector('button[aria-label="Delete…"]')).toBeNull()
    // The kebab and the grip are there instead, for every chip.
    expect(() => categoryMenuTriggerFor('Movement')).not.toThrow()
    expect(() => categoryMenuTriggerFor('Weapons')).not.toThrow()
    expect(rail.querySelectorAll('.ctrl-grip-handle')).toHaveLength(CATEGORIES.length)
  })

  it('rename opens the rename dialog', async () => {
    renderTab()
    openCategoryMenu('Movement')
    clickCategoryMenuItem('Rename…')

    const dialog = await vi.waitFor(() => {
      const el = document.querySelector('[role="dialog"]')
      if (!el) throw new Error('dialog not open yet')
      return el
    })
    expect(dialog.textContent).toContain('Rename category')
    const input = dialog.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('Movement')
  })

  it('delete on a category with entries opens the delete-or-move modal', async () => {
    renderTab()
    openCategoryMenu('Movement')
    clickCategoryMenuItem('Delete…')

    const dialog = await vi.waitFor(() => {
      const el = document.querySelector('[role="dialog"]')
      if (!el) throw new Error('dialog not open yet')
      return el
    })
    expect(dialog.textContent).toContain('Delete “Movement”?')
    // The delete-or-move choice, not the plain inline confirm.
    expect(dialog.querySelectorAll('input[type="radio"]').length).toBeGreaterThan(0)
    expect(container.querySelector('.text-danger')).toBeNull()
  })

  it('delete on an empty category shows the inline confirm, not the modal', () => {
    renderTab()
    openCategoryMenu('Weapons')
    clickCategoryMenuItem('Delete…')

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(categoryRail().textContent).toContain(
      'Delete this category? Its actions are removed too.',
    )
  })

  it('the menu trigger and every item carry an accessible name and are reachable by keyboard', () => {
    renderTab()
    const trigger = categoryMenuTriggerFor('Movement')

    // A native, unmodified <button> - never removed from tab order, no custom role hijacking
    // Enter/Space away from it.
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.tabIndex).not.toBe(-1)
    expect(trigger.getAttribute('aria-label')).toBe('Actions for “Movement”')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    openCategoryMenu('Movement')
    const items = categoryMenuItems()
    expect(items.map((item) => item.textContent)).toEqual([
      'Move category up',
      'Move category down',
      'Rename…',
      'Delete…',
    ])
    for (const item of items) {
      expect(item.tagName).toBe('BUTTON')
      expect(item.getAttribute('role')).toBe('menuitem')
    }

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(savedCategories).toEqual([])
  })

  it('every action the chip used to carry is still reachable: select, drag grip, move up, move down, rename, delete', async () => {
    renderTab()

    // Select: clicking the chip's label button still selects the category.
    const weaponsButton = [...categoryRail().querySelectorAll('button')].find(
      (button) => button.textContent === 'Weapons',
    )!
    act(() => {
      weaponsButton.click()
    })
    expect(weaponsButton.getAttribute('aria-pressed')).toBe('true')

    // Drag grip: still present per chip (asserted more fully by the untouched
    // `ControlsTab.category-drag.test.tsx`).
    expect(categoryRail().querySelectorAll('.ctrl-grip-handle')).toHaveLength(CATEGORIES.length)

    // Move up/down: disabled on the first/last chip respectively.
    openCategoryMenu('Movement')
    let items = categoryMenuItems()
    expect(items[0]!.disabled).toBe(true) // Movement is first: no "up".
    expect(items[1]!.disabled).toBe(false)

    // Move down persists the reorder and the rail re-renders in the new order.
    await act(async () => {
      clickCategoryMenuItem('Move category down')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(savedCategories).toHaveLength(1)
    expect(savedCategories[0]!.map((category) => category.id)).toEqual(['weapons', 'movement'])

    // Weapons is now first (index 0): its "up" is disabled, its "down" is enabled.
    openCategoryMenu('Weapons')
    items = categoryMenuItems()
    expect(items[0]!.disabled).toBe(true)
    expect(items[1]!.disabled).toBe(false)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    // Rename and delete: reachable via the menu (asserted fully by the dedicated tests above).
    openCategoryMenu('Movement')
    expect(categoryMenuItems().map((item) => item.textContent)).toContain('Rename…')
    expect(categoryMenuItems().map((item) => item.textContent)).toContain('Delete…')
  })
})

/**
 * Story 062 D2: the chip collapses from "bordered box wrapping a bordered, filled button" to one
 * level. jsdom loads no stylesheet, so what these tests can assert is the class/attribute contract
 * the single level rests on: the container carries `.ctrl-category-chip` (whose `controls-grid.css`
 * rule owns the one border/background and the `data-selected` emphasis), and nothing inside it
 * paints a surface of its own any more.
 */
describe('ControlsTab category chip (story 062 D2)', () => {
  it('a category chip is one level: the label button carries no border or background of its own, and grip plus one menu trigger are its only other controls', () => {
    renderTab()
    const chip = categoryChip('Movement')
    const label = categoryLabelButton('Movement')

    // The container is the level that owns the border/background (via `.ctrl-category-chip`), and
    // it is the same node that carries the drop-target/sortable/scroll-into-view roles.
    expect(chip.classList.contains('ctrl-category-chip')).toBe(true)
    expect(chip.getAttribute('data-drop-category')).toBe('movement')
    expect(chip.getAttribute('data-category-id')).toBe('movement')
    expect(paintsABox(chip)).toBe(false)

    // The label button is a ghost: it declares both its border and its background transparent, so
    // it cannot be the second box the old `neutral`/`primary` variant was.
    expect([...label.classList]).toContain('bg-transparent')
    expect([...label.classList]).toContain('border-transparent')
    expect(paintsABox(label)).toBe(false)

    // Nothing else inside the chip paints one either - not the grip, not the kebab, not the label
    // span or the icons.
    expect([...chip.querySelectorAll('*')].filter(paintsABox)).toEqual([])

    // Grip, label, kebab - and nothing else.
    const buttons = [...chip.querySelectorAll('button')]
    expect(buttons).toHaveLength(3)
    expect(buttons).toContain(label)
    expect(buttons.filter((button) => button.classList.contains('ctrl-grip-handle'))).toHaveLength(
      1,
    )
    expect(
      buttons.filter((button) => button.getAttribute('aria-label') === 'Actions for “Movement”'),
    ).toHaveLength(1)
  })

  it('the selected chip is marked by `data-selected`, `aria-pressed` and a semibold label, not by colour alone', () => {
    renderTab()
    act(() => {
      categoryLabelButton('Weapons').click()
    })

    // Selecting still works by clicking the chip, and the grid's section header follows it.
    expect(container.textContent).toContain('Actions — Weapons')
    expect(container.textContent).not.toContain('Actions — Movement')

    // Three signals, none of them a colour: the container's `data-selected`, the button's
    // `aria-pressed`, the label's weight - plus the accent marker element.
    const selected = categoryChip('Weapons')
    expect(selected.getAttribute('data-selected')).toBe('true')
    expect(categoryLabelButton('Weapons').getAttribute('aria-pressed')).toBe('true')
    expect(selected.querySelector('.font-semibold')?.textContent).toBe('Weapons')
    expect(selected.querySelector('.ctrl-chip-marker')).not.toBeNull()

    // And absent on every other chip.
    const other = categoryChip('Movement')
    expect(other.getAttribute('data-selected')).toBeNull()
    expect(categoryLabelButton('Movement').getAttribute('aria-pressed')).toBe('false')
    expect(other.querySelector('.font-semibold')).toBeNull()
    expect(other.querySelector('.ctrl-chip-marker')).toBeNull()
  })
})
