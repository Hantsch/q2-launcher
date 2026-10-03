// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { stubBridge } from './test/bridge'
import { renderWithProviders } from './test/render'
import { ControlsTab } from './ControlsTab'
import { useConfigProfiles } from './config-profiles-store'

/**
 * Story 054 D8: the row menu takes over move up/down (and adds "Move to…") from the inline arrow
 * buttons every Controls row used to carry. These tests drive the real `ControlsTab` - its kebab,
 * its portalled `Menu`, its "Move to…" dialog - through real DOM events, for both a catalogue row
 * (`f`, backed by `movement:forward`) and a free-form one (`free`), because the row menu is wired
 * identically for both (`renderRowMenu`, shared by `renderCatalogRow`/`renderPlainActionRow`).
 */

let container: HTMLElement
/** Every `actions` array `ControlsTab` tried to persist, in order. */
let saved: ConfigAction[][]

function renderTab(): void {
  ;({ container } = renderWithProviders(<ControlsTab />))
}

/** The row's kebab trigger - the one button every row's action cluster now carries in place of the
 * old inline up/down arrow pair. */
function menuTriggerFor(name: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="Ordering options for “${name}”"]`,
  )
  if (!button) throw new Error(`no row menu trigger for "${name}"`)
  return button
}

function openMenu(name: string): void {
  act(() => {
    menuTriggerFor(name).click()
  })
}

/** The portalled menu's items, in DOM order - real `<button role="menuitem">`s, so a keyboard user
 * reaches every one of them by Tab and activates with Enter/Space exactly like this test's `.click()`
 * does. */
function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button[role="menuitem"]')]
}

function clickMenuItem(label: string): void {
  const item = menuItems().find((button) => button.textContent === label)
  if (!item) throw new Error(`no menu item "${label}"`)
  act(() => {
    item.click()
  })
}

beforeEach(() => {
  useConfigProfiles.setState({ profiles: [] })
  // jsdom implements no scrolling at all, so `scrollIntoView` does not even exist to be spied on;
  // `ControlsTab` scrolls the selected chip into view on every category change.
  HTMLElement.prototype.scrollIntoView = () => {}
  saved = []
  stubBridge().invoke.mockImplementation((...args: unknown[]) => {
    const envelope = args[1] as { payload?: { actions?: ConfigAction[] } }
    if (envelope.payload?.actions) saved.push(envelope.payload.actions)
    return Promise.resolve({ ok: true, value: [] })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ControlsTab row menu (story 054 D8)', () => {
  it('has no inline move-up/move-down arrow buttons left on a row', () => {
    renderTab()
    expect(container.querySelector('button[aria-label="Move entry up"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Move entry down"]')).toBeNull()
    // The kebab is there instead, for both a catalogue row and a free-form one.
    expect(() => menuTriggerFor('Forward')).not.toThrow()
    expect(() => menuTriggerFor('My own bind')).not.toThrow()
  })

  it('moves a catalogue row down through the kebab menu and persists the swap', async () => {
    renderTab()
    openMenu('Forward')

    const items = menuItems().map((button) => button.textContent)
    expect(items).toEqual(['Move entry up', 'Move entry down', 'Move to…'])
    // Already first in its group, so "Move entry up" is disabled.
    expect(menuItems()[0]!.disabled).toBe(true)
    expect(menuItems()[1]!.disabled).toBe(false)

    clickMenuItem('Move entry down')
    await act(async () => {})

    expect(saved).toHaveLength(1)
    expect(saved[0]!.map((entry) => entry.id)).toEqual(['free', 'f'])
    // The menu closed itself on selection.
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('moves a free-form row up through the kebab menu and persists the swap', async () => {
    renderTab()
    openMenu('My own bind')
    clickMenuItem('Move entry up')
    // The save settles after the click; flush it so its state update lands inside act().
    await act(async () => {})

    expect(saved).toHaveLength(1)
    expect(saved[0]!.map((entry) => entry.id)).toEqual(['free', 'f'])
  })

  it('moves a free-form row to another category through "Move to…"', async () => {
    renderTab()
    openMenu('My own bind')
    clickMenuItem('Move to…')

    const dialog = await vi.waitFor(() => {
      const el = document.querySelector('[role="dialog"]')
      if (!el) throw new Error('dialog not open yet')
      return el
    })
    expect(dialog.textContent).toContain('Move “My own bind”')

    const select = dialog.querySelector('select') as HTMLSelectElement
    // Options are every category (no sub-categories in this fixture): Movement, then Weapons.
    expect([...select.options].map((option) => option.text)).toEqual(['Movement', 'Weapons'])
    act(() => {
      select.value = '1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const submit = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Move')!
    await act(async () => {
      submit.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(saved).toHaveLength(1)
    const moved = saved[0]!.find((entry) => entry.id === 'free')!
    expect(moved.categoryId).toBe('weapons')
    expect('subcategoryId' in moved).toBe(false)
    // The dialog closed itself once the move persisted.
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('moves a catalogue row to another category through "Move to…"', async () => {
    renderTab()
    openMenu('Forward')
    clickMenuItem('Move to…')

    const dialog = await vi.waitFor(() => {
      const el = document.querySelector('[role="dialog"]')
      if (!el) throw new Error('dialog not open yet')
      return el
    })
    const select = dialog.querySelector('select') as HTMLSelectElement
    act(() => {
      select.value = '1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const submit = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Move')!
    await act(async () => {
      submit.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(saved).toHaveLength(1)
    const moved = saved[0]!.find((entry) => entry.id === 'f')!
    expect(moved.categoryId).toBe('weapons')
  })

  it('is reachable by keyboard alone: Tab focuses the kebab, its items are real buttons, Escape closes', () => {
    renderTab()
    const trigger = menuTriggerFor('Forward')

    // A native, unmodified <button> - never removed from tab order, no custom role hijacking
    // Enter/Space away from it.
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.tabIndex).not.toBe(-1)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    openMenu('Forward')
    const items = menuItems()
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.tagName).toBe('BUTTON')
      expect(item.getAttribute('role')).toBe('menuitem')
    }
    // Tab reaches every enabled item in order; Enter/Space on a focused native button fires the
    // same click this test issues below.
    items[1]!.focus()
    expect(document.activeElement).toBe(items[1])

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(saved).toEqual([])
  })
})
