import { describe, expect, it } from 'vitest'
import { bestPing } from './ping-samples'

describe('bestPing', () => {
  it('the best sample is the lowest regardless of order', () => {
    expect(bestPing([90, 20, 40])).toBe(20)
  })

  it('the best sample is rounded to whole ms', () => {
    expect(bestPing([20.6, 31])).toBe(21)
  })

  it('does not reorder the caller array', () => {
    const samples = [30, 10, 20]
    bestPing(samples)
    expect(samples).toEqual([30, 10, 20])
  })
})
