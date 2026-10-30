import { describe, expect, it } from 'vitest'
import { formatGeometry, parseGeometry } from './geometry'

describe('geometry', () => {
  it('both origin forms parse', () => {
    const expected = { width: 200, height: 100, x: -1920, y: -5 }
    expect(parseGeometry('200x100-1920-5')).toEqual(expected)
    expect(parseGeometry('200x100+-1920+-5')).toEqual(expected)
    expect(parseGeometry('200x100+10+20')).toEqual({ width: 200, height: 100, x: 10, y: 20 })
    expect(parseGeometry('nonsense')).toBeNull()
  })

  it('a formatted geometry parses back to its parts', () => {
    expect(formatGeometry(200, 100, -1920, 0)).toBe('200x100-1920+0')
    expect(parseGeometry(formatGeometry(200, 100, -1920, -7))).toEqual({
      width: 200,
      height: 100,
      x: -1920,
      y: -7,
    })
  })
})
