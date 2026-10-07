// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TextArea } from './controls'

afterEach(() => {
  cleanup()
})

function Harness() {
  const [text, setText] = useState('hello')
  return (
    <TextArea aria-label="Notes" value={text} onChange={(event) => setText(event.target.value)} />
  )
}

describe('TextArea', () => {
  it('forwards value and onChange', () => {
    render(<Harness />)
    const area = screen.getByLabelText('Notes') as HTMLTextAreaElement
    expect(area.value).toBe('hello')
    fireEvent.change(area, { target: { value: 'changed' } })
    expect(area.value).toBe('changed')
  })
})
