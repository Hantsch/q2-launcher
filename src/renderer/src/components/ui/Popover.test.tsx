// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Popover } from './Popover'

/**
 * Story 098 D2: `Popover` mirrors `Menu`'s anchor-based positioning but adds
 * dialog behaviour on top - `role="dialog"`, Escape/outside-click dismissal,
 * and focus return to the trigger - because it carries rich content rather
 * than a flat item list.
 */

afterEach(() => {
  cleanup()
})

function renderPopover() {
  render(
    <Popover label="Test popover" content={({ close }) => <button onClick={close}>Close</button>}>
      {({ toggle }) => (
        <button onClick={toggle} data-testid="trigger">
          Trigger
        </button>
      )}
    </Popover>,
  )
  return screen.getByTestId('trigger')
}

describe('Popover', () => {
  it('opens on trigger click and closes when the content calls close()', () => {
    const trigger = renderPopover()

    expect(screen.queryByRole('dialog', { name: 'Test popover' })).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Test popover' })).toBeTruthy()

    fireEvent.click(screen.getByText('Close'))
    expect(screen.queryByRole('dialog', { name: 'Test popover' })).toBeNull()
  })

  it('closes on Escape', () => {
    const trigger = renderPopover()

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Test popover' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Test popover' })).toBeNull()
  })

  it('closes on an outside click', () => {
    const trigger = renderPopover()

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Test popover' })).toBeTruthy()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Test popover' })).toBeNull()
  })

  it('returns focus to the trigger after closing', () => {
    const trigger = renderPopover()

    // jsdom does not focus an element as a side effect of `fireEvent.click`
    // the way a real click does, so focus it explicitly first - this is what
    // lets `Popover` capture it as "previously focused" before opening.
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Test popover' })
    expect(document.activeElement).toBe(dialog)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })
})
