import { describe, expect, it } from 'vitest'
import { visibleRange } from './visible-range'

describe('visibleRange (story 158/159 D4)', () => {
  it('the first window starts at row 0', () => {
    const result = visibleRange({ scrollTop: 0, viewportHeight: 400, rowHeight: 56, count: 3000 })
    expect(result.start).toBe(0)
    expect(result.end).toBeGreaterThan(0)
  })

  it('the window follows scrollTop', () => {
    const result = visibleRange({ scrollTop: 560, viewportHeight: 400, rowHeight: 56, count: 3000 })
    // scrollTop 560 / rowHeight 56 = row 10
    expect(result.start).toBe(10)
  })

  it('the window is clamped at the end', () => {
    const result = visibleRange({
      scrollTop: 1_000_000,
      viewportHeight: 400,
      rowHeight: 56,
      count: 100,
    })
    expect(result.end).toBe(100)
    expect(result.start).toBeLessThanOrEqual(100)
  })

  it('an empty list has an empty window', () => {
    const result = visibleRange({ scrollTop: 0, viewportHeight: 400, rowHeight: 56, count: 0 })
    expect(result).toEqual({ start: 0, end: 0 })
  })
})
