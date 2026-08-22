import { describe, expect, it } from 'vitest'
import { toAltCharset } from './q2-charset'
import { colorCvarTokens, isColorCvar } from './color-cvars'

describe('isColorCvar', () => {
  it('recognizes a value built entirely from high-bit alt-charset bytes', () => {
    expect(isColorCvar('g', toAltCharset('RED'))).toBe(true)
  })

  it('rejects the empty string', () => {
    expect(isColorCvar('g', '')).toBe(false)
  })

  it('rejects a value mixing high-bit bytes with even one normal ASCII character', () => {
    const mixed = toAltCharset('RE') + 'D' // last char left plain
    expect(hasOnlyHighBitBytes(mixed)).toBe(false)
    expect(isColorCvar('g', mixed)).toBe(false)
  })

  it('rejects an ordinary plain-ASCII cvar value', () => {
    expect(isColorCvar('name', 'Player')).toBe(false)
  })

  it('recognizes a real-world value bordered by 0x7F with high-bit glyphs in the middle', () => {
    // matches docs/fixtures/dmalias.cfg's `set g` value
    expect(isColorCvar('g', '\x7f\x88\x88\x88\x7f')).toBe(true)
  })

  it('rejects a value mixing 0x7F with even one normal ASCII character', () => {
    expect(isColorCvar('g', '\x7f\x88D\x88\x7f')).toBe(false)
  })
})

describe('colorCvarTokens', () => {
  it('filters a mixed cvar set down to only the colour cvars, keyed by name', () => {
    const cvars = {
      g: toAltCharset('RED'),
      name: 'Player',
      r: toAltCharset('!'),
      empty: '',
    }
    const tokens = colorCvarTokens(cvars)
    expect([...tokens.keys()].sort()).toEqual(['g', 'r'])
    expect(tokens.get('g')).toBe(cvars.g)
    expect(tokens.get('r')).toBe(cvars.r)
    expect(tokens.has('name')).toBe(false)
    expect(tokens.has('empty')).toBe(false)
  })

  it('accepts an array of { name, value } pairs producing the same result as the record form', () => {
    const cvars = { g: toAltCharset('RED'), name: 'Player' }
    const fromRecord = colorCvarTokens(cvars)
    const fromArray = colorCvarTokens(
      Object.entries(cvars).map(([name, value]) => ({ name, value })),
    )
    expect([...fromArray.entries()]).toEqual([...fromRecord.entries()])
  })

  it('returns an empty map when nothing qualifies', () => {
    expect(colorCvarTokens({ name: 'Player', crosshair: '3' }).size).toBe(0)
  })
})

function hasOnlyHighBitBytes(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x80 || code > 0xff) return false
  }
  return true
}
