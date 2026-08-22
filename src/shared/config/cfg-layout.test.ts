import { describe, expect, it } from 'vitest'
import { alignRows, attachComment, banner, sanitizeComment, section } from './cfg-layout'

describe('banner', () => {
  it('renders a section banner (fill "-") as a single line, title embedded in the fill', () => {
    const [line] = banner('Player', { width: 30 })

    expect(line).toBe('// --- Player ----------------')
    expect(line!.length).toBe(30)
  })

  it('accepts a bare string the same as a one-element array', () => {
    expect(banner('Player', { width: 30 })).toEqual(banner(['Player'], { width: 30 }))
  })

  it('renders a header block (fill "=") as a full rule, the content lines, then the same rule again', () => {
    const lines = banner(['Hantsch - Test', 'Q2 Launcher - do not hand-edit'], { fill: '=', width: 20 })

    expect(lines).toEqual([
      '// =================',
      '//  Hantsch - Test',
      '//  Q2 Launcher - do not hand-edit',
      '// =================',
    ])
    expect(lines[0]!.length).toBe(20)
    expect(lines[3]).toBe(lines[0])
  })

  it('never truncates a line longer than the nominal width', () => {
    const longTitle = 'A'.repeat(100)

    const [line] = banner(longTitle, { width: 30 })

    expect(line).toContain(longTitle)
  })

  it('emits only ASCII "//", "-" and "=" as decoration, never an em dash or box-drawing glyph', () => {
    const decoOnly = (line: string): string => line.replace(/[^/=-]/g, '')

    expect(decoOnly(banner('X', { width: 40 })[0]!)).toMatch(/^\/\/---.*-+$/)
    expect(banner(['A', 'B'], { fill: '=', width: 40 })[0]).toMatch(/^\/\/ =+$/)
  })
})

describe('section', () => {
  it('emits a banner followed by the given lines when lines is non-empty', () => {
    expect(section('Player', ['set name "Hantsch"'])).toEqual([
      ...banner('Player'),
      'set name "Hantsch"',
    ])
  })

  it('omits itself entirely - no banner, no lines - when lines is empty', () => {
    expect(section('Player', [])).toEqual([])
  })

  it('forwards banner options through to the underlying banner', () => {
    expect(section('Hdr', ['x'], { fill: '=', width: 20 })).toEqual([
      ...banner('Hdr', { fill: '=', width: 20 }),
      'x',
    ])
  })
})

describe('alignRows', () => {
  it('pads the first column to the longest cell plus the configured margin', () => {
    const rows = alignRows(
      [
        ['sensitivity', '"3"'],
        ['cl_run', '"0"'],
      ],
      [{ margin: 1, cap: 40 }],
    )

    // "sensitivity" is 11 chars, +1 margin = width 12.
    expect(rows).toEqual([
      ['sensitivity ', '"3"'],
      ['cl_run      ', '"0"'],
    ])
    expect(rows[0]![0]!.length).toBe(12)
    expect(rows[1]![0]!.length).toBe(12)
  })

  it('returns [] for an empty row list', () => {
    expect(alignRows([], [{ margin: 1, cap: 40 }])).toEqual([])
  })

  it('leaves cells past the described columns untouched', () => {
    const rows = alignRows([['a', 'bbb'], ['aa', 'b']], [{ margin: 1, cap: 40 }])

    expect(rows[0]![1]).toBe('bbb')
    expect(rows[1]![1]).toBe('b')
  })

  it('falls back to a single trailing space per row when the natural width busts the cap', () => {
    const rows = alignRows(
      [
        ['short', 'v1'],
        [`pathological_${'x'.repeat(100)}`, 'v2'],
      ],
      [{ margin: 1, cap: 20 }],
    )

    // Natural width (100+ chars) exceeds the cap of 20, so every row gets exactly one space -
    // no row is padded out to a shared (still oversized) column.
    expect(rows[0]![0]).toBe('short ')
    expect(rows[1]![0]!.endsWith(' ')).toBe(true)
    expect(rows[1]![0]!.length).toBe(rows[1]![0]!.trimEnd().length + 1)
  })

  it('is deterministic: two calls with the same input return equal output', () => {
    const input: string[][] = [
      ['a', '1'],
      ['bb', '2'],
    ]

    expect(alignRows(input, [{ margin: 1, cap: 40 }])).toEqual(alignRows(input, [{ margin: 1, cap: 40 }]))
  })
})

describe('attachComment', () => {
  it('attaches the comment in full when it fits within budget', () => {
    expect(attachComment('set name "x"', 'Player name', 100)).toBe('set name "x"  // Player name')
  })

  it('returns the code unchanged when the comment is empty', () => {
    expect(attachComment('set name "x"', '', 100)).toBe('set name "x"')
  })

  it('truncates the comment (never the code) when it does not fit', () => {
    const code = 'set name "x"'
    const comment = 'a much longer comment than fits'
    const prefix = `${code}  // `
    const budget = prefix.length + 5

    const result = attachComment(code, comment, budget)

    expect(result.startsWith(code)).toBe(true)
    expect(result.length).toBe(budget)
    expect(result).toBe(`${prefix}${comment.slice(0, 5)}`)
  })

  it('drops the comment entirely when there is no room even for the bare "//" prefix', () => {
    const code = 'set name "a very long cvar value that already fills the whole budget"'

    const result = attachComment(code, 'anything', code.length + 2)

    expect(result).toBe(code)
  })

  it('never lengthens the code part itself, however long the comment is', () => {
    const code = 'bind w "+forward"'

    const result = attachComment(code, 'x'.repeat(500), 20)

    expect(result === code || result.startsWith(code)).toBe(true)
    expect(result.length).toBeLessThanOrEqual(Math.max(20, code.length))
  })
})

describe('sanitizeComment', () => {
  it('turns CR, LF and tab into a single space each', () => {
    expect(sanitizeComment('a\rb\nc\td')).toBe('a b c d')
  })

  it('keeps latin1-range characters (code point <= 0xFF) untouched', () => {
    expect(sanitizeComment('Bjørn Größe')).toBe('Bjørn Größe')
  })

  it('drops characters outside the latin1 range entirely', () => {
    // U+2014 EM DASH and an emoji, both outside latin1.
    expect(sanitizeComment('a—b\u{1F600}c')).toBe('abc')
  })

  it('round-trips its own output through latin1 byte-for-byte', () => {
    // This file is compiled under both TS projects (`docs/ARCHITECTURE.md`: shared may not use
    // node types), so the round-trip is asserted the same way `alt-layers.ts`'s own
    // `latin1ByteLength` doc comment does: latin1 is one byte per UTF-16 code unit exactly when
    // every character's code point is <= 0xFF, with no `Buffer` needed to prove it. `render.test.ts`
    // (main-only) is where the real `Buffer.from(..., 'latin1')` round-trip is exercised end to end.
    const sanitized = sanitizeComment('Bjørn\r\n\tsays—hi\u{1F600}')

    expect(Array.from(sanitized).every((ch) => ch.charCodeAt(0) <= 0xff)).toBe(true)
  })

  it('is a no-op on plain ASCII text', () => {
    expect(sanitizeComment('SSG + SG')).toBe('SSG + SG')
  })
})
