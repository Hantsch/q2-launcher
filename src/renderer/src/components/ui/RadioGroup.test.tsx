// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Radio, RadioGroup } from './RadioGroup'

afterEach(() => {
  cleanup()
})

function Harness() {
  const [value, setValue] = useState('one')
  return (
    <RadioGroup name="g" value={value} onChange={setValue} label="Numbers">
      <Radio value="one" label="One" />
      <Radio value="two" label="Two" />
      <Radio value="three" label="Three" disabled />
    </RadioGroup>
  )
}

describe('RadioGroup', () => {
  it('click changes the value and radios share one group name', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Numbers' })).toBeTruthy()
    const one = screen.getByLabelText('One') as HTMLInputElement
    const two = screen.getByLabelText('Two') as HTMLInputElement
    expect(one.checked).toBe(true)

    fireEvent.click(two)
    expect(two.checked).toBe(true)
    expect(one.checked).toBe(false)

    // Arrow-key movement is native browser behaviour for same-name radios; jsdom has none, so the
    // observable contract here is that all radios share one name and click drives the value.
    expect(one.name).toBe(two.name)
    fireEvent.click(one)
    expect(one.checked).toBe(true)
  })
})
