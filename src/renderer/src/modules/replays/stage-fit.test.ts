import { describe, expect, it } from 'vitest'
import { fitAspect } from './stage-fit'

describe('fitAspect', () => {
  it('fits the largest centred 4:3 rect', () => {
    expect(fitAspect({ width: 1200, height: 600 }, 4 / 3)).toEqual({
      x: 200,
      y: 0,
      width: 800,
      height: 600,
    })
    expect(fitAspect({ width: 400, height: 900 }, 4 / 3)).toEqual({
      x: 0,
      y: 300,
      width: 400,
      height: 300,
    })
    expect(fitAspect({ width: 800, height: 600 }, 4 / 3)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    })
    expect(fitAspect({ width: 0, height: 600 }, 4 / 3)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
