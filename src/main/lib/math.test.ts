import { describe, expect, it } from 'vitest'
import { clamp01 } from './math'

describe('math', () => {
  it('clamp01 clamps and maps NaN to 0', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(7)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
