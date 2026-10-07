// @vitest-environment jsdom
import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { BindSlot } from './BindSlot'

describe('BindSlot', () => {
  it('an empty slot starts key capture', () => {
    const { getByRole } = renderWithProviders(
      <BindSlot
        label="Primary"
        boundKey={undefined}
        onAssign={vi.fn()}
        onAssignModifier={vi.fn()}
        onReplace={vi.fn()}
        onClear={vi.fn()}
        checkCollision={() => null}
        checkModifierCollision={() => null}
      />,
    )
    const slot = getByRole('button', { name: 'Primary: Empty' })
    expect(slot.textContent).toBe('Empty')
    fireEvent.click(slot)
    expect(getByRole('button', { name: 'Primary: Press a key…' }).textContent).toBe('Press a key…')
  })
})
