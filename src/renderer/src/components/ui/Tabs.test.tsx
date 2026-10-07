// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabPanel, Tabs } from './Tabs'

afterEach(() => {
  cleanup()
})

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
]

describe('Tabs', () => {
  it('arrow keys move focus with a roving tabindex and a click (native Enter/Space activation) selects', () => {
    const onChange = vi.fn()
    render(
      <>
        <Tabs idBase="t" value="a" onChange={onChange} items={items} ariaLabel="Letters" />
        <TabPanel idBase="t" tabId="a">
          panel
        </TabPanel>
      </>,
    )
    const [a, b, c] = screen.getAllByRole('tab')
    expect(a.tabIndex).toBe(0)
    expect(b.tabIndex).toBe(-1)
    expect(a.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(a.id)

    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(b)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(b, { key: 'ArrowLeft' })
    fireEvent.keyDown(a, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(c)
    fireEvent.keyDown(c, { key: 'Home' })
    expect(document.activeElement).toBe(a)
    fireEvent.keyDown(a, { key: 'End' })
    expect(document.activeElement).toBe(c)
    expect(onChange).not.toHaveBeenCalled()

    // Enter/Space on a focused button is a native click, which the browser fires, not Tabs.
    fireEvent.click(c)
    expect(onChange).toHaveBeenCalledWith('c')
  })
})
