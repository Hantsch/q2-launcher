// @vitest-environment jsdom
import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { findCvar } from '@shared/config/catalog/cvar-catalog'
import { renderWithProviders } from '../test/render'
import { CvarRow } from './CvarRow'

describe('CvarRow', () => {
  it('editing the value reports the new cvar value', () => {
    const def = findCvar('name')!
    const onChange = vi.fn()
    const { getByRole } = renderWithProviders(
      <CvarRow def={def} engine={null} value="player" edited={false} onChange={onChange} />,
    )
    fireEvent.change(getByRole('textbox'), { target: { value: 'ranger' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('ranger')
  })
})
