// @vitest-environment jsdom
import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { stubBridge } from './test/bridge'
import { profileFixture } from './test/fixtures'
import { renderWithProviders } from './test/render'
import { ControlsTab } from './ControlsTab'
import { useConfigProfiles } from './config-profiles-store'

let bindingKeys: string[] = []

let container: HTMLElement
/** Every `actions` array `ControlsTab` tried to persist, in order. */
let saved: ConfigAction[][]

function renderTab(): void {
  const base = profileFixture()
  ;({ container } = renderWithProviders(<ControlsTab />, {
    profile: {
      ...base,
      actions: base.actions!.map((entry) => ({
        ...entry,
        keys: bindingKeys.map((key) => ({ key })),
      })),
    },
  }))
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

describe('ControlsTab binding layout', () => {
  it.each(['f', 'free'])(
    'keeps two bindings inline for %s and folds the third by default',
    async (id) => {
      bindingKeys = ['g', 'h']
      renderTab()
      const row = () => container.querySelector<HTMLElement>('.ctrl-row[data-row-id="' + id + '"]')!
      const extras = () => container.querySelectorAll('.ctrl-keysub-row[data-row-id="' + id + '"]')
      const slots = () => row().querySelectorAll<HTMLButtonElement>('.ctrl-keycell .ctrl-slot')
      expect(slots()[0].textContent).toBe('g')
      expect(slots()[1].textContent).toBe('h')
      expect(extras()).toHaveLength(0)
      expect(row().querySelector('.ctrl-keymore')).toBeNull()
      await act(async () => {
        slots()[2].click()
      })
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }),
        )
      })
      expect(saved.at(-1)?.find((entry) => entry.id === id)?.keys).toHaveLength(3)
      const toggle = () => row().querySelector<HTMLButtonElement>('.ctrl-keymore')!
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(extras()).toHaveLength(0)
      act(() => toggle().click())
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      expect(extras()).toHaveLength(3)
      act(() => toggle().click())
      expect(extras()).toHaveLength(0)
      act(() => toggle().click())
      await act(async () => {
        slots()[0].click()
      })
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }),
        )
      })
      expect(slots()[0].textContent).toBe('h')
      expect(slots()[1].textContent).toBe('j')
      expect(extras()).toHaveLength(0)
      expect(row().querySelector('.ctrl-keymore')).toBeNull()
    },
  )
})

describe('ControlsTab category selection', () => {
  it('selecting a category clears the filter', () => {
    renderTab()
    const filter = container.querySelector<HTMLInputElement>('input[aria-label]')!
    fireEvent.change(filter, { target: { value: 'forw' } })
    expect(filter.value).toBe('forw')
    const chips = container.querySelectorAll<HTMLButtonElement>(
      '.ctrl-category-chip button[aria-pressed="false"]',
    )
    expect(chips.length).toBeGreaterThan(0)
    act(() => chips[0].click())
    expect(filter.value).toBe('')
  })
})
