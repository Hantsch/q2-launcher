// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import { DropToggles } from './DropToggles'

/**
 * Story 055 D3: the two icon toggles that replaced the drops row's two `Checkbox`es. Covers the
 * AC directly - `aria-pressed`, a non-colour-only pressed state (`variant` swaps, not just a class
 * toggle), the ammo toggle disabled with an explaining tooltip when the item has no ammo, and full
 * keyboard operability (a native `<button>`, so Tab/Space/Enter come for free from the DOM - this
 * only has to prove the click handler fires, same as every other `IconButton` test in this tree).
 *
 * `.ts` extension with `createElement`, matching `ControlsTab.dialogs.test.ts`'s own precedent for
 * a renderer test that mounts real components without a `.tsx` file.
 */

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

describe('DropToggles', () => {
  it('renders both toggles with their accessible names', () => {
    render(
      createElement(DropToggles, {
        ammoEnabled: true,
        ammoOn: false,
        messageOn: false,
        onToggleAmmo: () => {},
        onToggleMessage: () => {},
      }),
    )
    expect(screen.getByRole('button', { name: 'Drop ammo too' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Announce to team' })).toBeTruthy()
  })

  it('reflects on/off state via aria-pressed, not colour alone', () => {
    render(
      createElement(DropToggles, {
        ammoEnabled: true,
        ammoOn: true,
        messageOn: false,
        onToggleAmmo: () => {},
        onToggleMessage: () => {},
      }),
    )
    const ammoButton = screen.getByRole('button', { name: 'Drop ammo too' })
    const messageButton = screen.getByRole('button', { name: 'Announce to team' })
    expect(ammoButton.getAttribute('aria-pressed')).toBe('true')
    expect(messageButton.getAttribute('aria-pressed')).toBe('false')

    // Non-colour-only, asserted structurally (story 055 review, finding 7): "the two class lists
    // differ" was true of a pure hue swap too, which is exactly what the AC forbids. `Button.tsx`'s
    // `primary` and `ghost` variants differ in *shape*, not just hue - `primary` draws a visible
    // border (`border-flame-300` against `ghost`'s `border-transparent`) and an inset top
    // highlight (`shadow-[...inset]`) that `ghost` has no shadow at all for. Those two are what a
    // user perceives without colour vision, so those two are what this pins.
    const pressed = ammoButton.className.split(/\s+/)
    const unpressed = messageButton.className.split(/\s+/)
    expect(pressed).toContain('border-flame-300')
    expect(unpressed).toContain('border-transparent')
    expect(pressed.some((cls) => cls.startsWith('shadow-['))).toBe(true)
    expect(unpressed.some((cls) => cls.startsWith('shadow-['))).toBe(false)
  })

  it('calls onToggleAmmo/onToggleMessage with the flipped state on click', () => {
    const onToggleAmmo = vi.fn()
    const onToggleMessage = vi.fn()
    render(
      createElement(DropToggles, {
        ammoEnabled: true,
        ammoOn: false,
        messageOn: true,
        onToggleAmmo,
        onToggleMessage,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Drop ammo too' }))
    expect(onToggleAmmo).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Announce to team' }))
    expect(onToggleMessage).toHaveBeenCalledWith(false)
  })

  it('disables the ammo toggle reachably - aria-disabled, not the native attribute - with an explaining tooltip', () => {
    const onToggleAmmo = vi.fn()
    render(
      createElement(DropToggles, {
        ammoEnabled: false,
        ammoOn: false,
        messageOn: false,
        onToggleAmmo,
        onToggleMessage: () => {},
      }),
    )
    const ammoButton = screen.getByRole('button', { name: 'Drop ammo too' }) as HTMLButtonElement
    // Story 055 review, finding 3: a natively `disabled` button is out of the tab order and gets
    // `disabled:pointer-events-none` from `Button.tsx`, so neither hovering for the tooltip nor
    // focusing it was possible - AC 4's explanation was unreachable by mouse AND keyboard.
    expect(ammoButton.disabled).toBe(false)
    expect(ammoButton.getAttribute('aria-disabled')).toBe('true')
    expect(ammoButton.title).toBe('This item has no ammo of its own to drop')
    // Still inert: the click handler no-ops rather than the browser swallowing the event.
    fireEvent.click(ammoButton)
    expect(onToggleAmmo).not.toHaveBeenCalled()
  })

  it('renders the given test ids for the live-smoke flow', () => {
    render(
      createElement(DropToggles, {
        ammoEnabled: true,
        ammoOn: false,
        messageOn: false,
        onToggleAmmo: () => {},
        onToggleMessage: () => {},
        ammoTestId: 'drop-ammo-x',
        messageTestId: 'drop-message-x',
      }),
    )
    expect(screen.getByTestId('drop-ammo-x')).toBeTruthy()
    expect(screen.getByTestId('drop-message-x')).toBeTruthy()
  })
})
