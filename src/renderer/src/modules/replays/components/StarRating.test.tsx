// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import { StarRating } from './StarRating'

beforeAll(async () => {
  await initI18n('en')
})
afterEach(cleanup)

const star = (n: number) => screen.getByTestId(`replays-detail-rating-star-${n}`)
const filled = () =>
  Array.from({ length: 10 }, (_, i) => i + 1).filter((n) =>
    star(n).querySelector('svg')?.getAttribute('class')?.includes('fill-flame-500'),
  )

function Harness({ onChange }: { onChange?: (v: number | null) => void }) {
  const [value, setValue] = useState<number | null>(null)
  return (
    <StarRating
      label="Rating"
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

describe('StarRating', () => {
  it('shows the saved rating as filled stars and none as all empty', () => {
    render(<StarRating label="Rating" value={3} onChange={() => {}} />)
    expect(filled()).toEqual([1, 2, 3])
    expect(star(3).getAttribute('aria-checked')).toBe('true')
    expect(star(2).getAttribute('aria-checked')).toBe('false')
    cleanup()
    render(<StarRating label="Rating" value={null} onChange={() => {}} />)
    expect(filled()).toEqual([])
    expect(star(1).tabIndex).toBe(0)
    expect(star(2).tabIndex).toBe(-1)
  })

  it('clicking a star sets it and clicking the current star clears it', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(star(7))
    expect(onChange).toHaveBeenLastCalledWith(7)
    expect(filled()).toHaveLength(7)
    fireEvent.click(star(7))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(filled()).toEqual([])
  })

  it('arrow keys, Home/End and Delete change the rating; each star is named by its value', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(star(1).getAttribute('aria-label')).toBe('1 star')
    expect(star(7).getAttribute('aria-label')).toBe('7 stars')
    const group = screen.getByRole('radiogroup', { name: 'Rating' })
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(group, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(2)
    expect(document.activeElement).toBe(star(2))
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(group, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(group, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(10)
    expect(document.activeElement).toBe(star(10))
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(10)
    fireEvent.keyDown(group, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(group, { key: 'Delete' })
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(filled()).toEqual([])
  })

  it('a disabled selector fires nothing and is described by the reason', () => {
    const onChange = vi.fn()
    render(
      <>
        <p id="why">Read-only</p>
        <StarRating label="Rating" value={4} onChange={onChange} disabled describedBy="why" />
      </>,
    )
    for (let n = 1; n <= 10; n++) {
      expect((star(n) as HTMLButtonElement).disabled).toBe(true)
      expect(star(n).getAttribute('aria-describedby')).toBe('why')
    }
    fireEvent.click(star(6))
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'Delete' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
