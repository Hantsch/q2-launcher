import { describe, expect, it } from 'vitest'
import {
  Q2_GLYPHS,
  fromAltCharset,
  glyph,
  hasAltCharset,
  isLatin1Text,
  toAltCharset,
  toDisplaySegments,
} from './q2-charset'

describe('toAltCharset', () => {
  it('leaves a plain ASCII space untouched', () => {
    expect(toAltCharset(' ')).toBe(' ')
    expect(toAltCharset('a b').charCodeAt(1)).toBe(0x20)
  })

  it('leaves existing high bytes (0x80-0xFF) untouched instead of double-setting the bit', () => {
    const high = String.fromCharCode(0xe1) // already high-bit 'a'
    expect(toAltCharset(high)).toBe(high)
  })

  it('sets the high bit on plain ASCII letters', () => {
    expect(toAltCharset('a').charCodeAt(0)).toBe(0x61 | 0x80)
  })
})

describe('fromAltCharset', () => {
  it('clears the high bit on high-range bytes', () => {
    const high = String.fromCharCode(0x61 | 0x80)
    expect(fromAltCharset(high)).toBe('a')
  })

  it('leaves plain ASCII untouched', () => {
    expect(fromAltCharset('abc')).toBe('abc')
  })
})

describe('round trip', () => {
  it('a string in the 0x80-0xFF range is stable through toAltCharset -> fromAltCharset -> toAltCharset', () => {
    const original = 'Hello World 123'
    const alt = toAltCharset(original)
    for (let i = 0; i < alt.length; i++) {
      const code = alt.charCodeAt(i)
      expect(code === 0x20 || (code >= 0x80 && code <= 0xff)).toBe(true)
    }
    expect(fromAltCharset(alt)).toBe(original)
    // Re-applying toAltCharset to the already-alt string must not double-set bits.
    expect(toAltCharset(alt)).toBe(alt)
  })
})

describe('hasAltCharset', () => {
  it('detects a high byte anywhere in the string', () => {
    expect(hasAltCharset('plain')).toBe(false)
    expect(hasAltCharset(toAltCharset('plain'))).toBe(true)
  })
})

describe('glyph', () => {
  it('renders the raw byte as a one-character string', () => {
    expect(glyph(0x0b)).toBe(String.fromCharCode(0x0b))
    expect(glyph(0x0b).length).toBe(1)
  })
})

describe('Q2_GLYPHS', () => {
  it('carries an i18n key per glyph following the 0x-prefixed hex naming', () => {
    const bullet = Q2_GLYPHS.find((g) => g.byte === 0x0b)
    expect(bullet?.labelKey).toBe('config.q2Charset.glyph.0x0b.label')
    for (const g of Q2_GLYPHS) {
      expect(g.labelKey).toMatch(/^config\.q2Charset\.glyph\.0x[0-9a-f]{2}\.label$/)
    }
  })
})

describe('toDisplaySegments', () => {
  it('splits plain and alt-charset runs into separate flagged segments', () => {
    const alt = toAltCharset('RED')
    const text = `plain ${alt} plain`
    const segments = toDisplaySegments(text)
    expect(segments.some((s) => s.alt && s.text === 'RED')).toBe(true)
    expect(segments.every((s) => (s.alt ? true : !hasAltCharset(s.text)))).toBe(true)
  })

  it('returns a single non-alt segment for plain text', () => {
    expect(toDisplaySegments('hello')).toEqual([{ text: 'hello', alt: false }])
  })
})

describe('isLatin1Text', () => {
  it('accepts a string entirely within U+0000-U+00FF', () => {
    expect(isLatin1Text('Hello World 123')).toBe(true)
    expect(isLatin1Text(String.fromCharCode(0xff))).toBe(true)
  })

  it('rejects a string containing a code point above 0x00FF', () => {
    expect(isLatin1Text('em dash —')).toBe(false)
  })

  it('treats the empty string as latin1', () => {
    expect(isLatin1Text('')).toBe(true)
  })
})
