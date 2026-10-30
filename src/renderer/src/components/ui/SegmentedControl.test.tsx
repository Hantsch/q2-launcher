// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

afterEach(() => {
  cleanup()
})

const OPTIONS = [
  { value: 'a', label: 'Alpha', testId: 'seg-a' },
  { value: 'b', label: 'Beta' },
] as const

describe('SegmentedControl', () => {
  it('the chosen option is pressed and a click reports the other value', () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Pick" options={OPTIONS} value="a" onChange={onChange} />)
    expect(screen.getByRole('group', { name: 'Pick' })).toBeTruthy()
    expect(screen.getByTestId('seg-a').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Beta').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByText('Beta'))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('a disabled control reports nothing', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl label="Pick" options={OPTIONS} value="a" onChange={onChange} disabled />,
    )
    fireEvent.click(screen.getByText('Beta'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
