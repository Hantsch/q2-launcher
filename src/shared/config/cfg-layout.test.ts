import { describe, expect, it } from 'vitest'
import {
  alignRows,
  attachComment,
  attachTaggedComment,
  banner,
  fitProseAndTag,
  sanitizeComment,
  section,
} from './cfg-layout'

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

  it('leaves no trailing space on a section banner whose title already fills the width', () => {
    // A title at or past `width` leaves no `-` fill, and the space `// --- <title> ` puts after the
    // title would otherwise be the last character on the line. Reachable for every ordinary line
    // since story 042 made section titles carry a `[q2l ...]` tag.
    const [line] = banner('A'.repeat(100), { width: 30 })

    expect(line).toBe(`// --- ${'A'.repeat(100)}`)
    expect(line!.endsWith(' ')).toBe(false)
  })

  it('emits only ASCII "//", "-" and "=" as decoration, never an em dash or box-drawing glyph', () => {
    const decoOnly = (line: string): string => line.replace(/[^/=-]/g, '')

    expect(decoOnly(banner('X', { width: 40 })[0]!)).toMatch(/^\/\/---.*-+$/)
    expect(banner(['A', 'B'], { fill: '=', width: 40 })[0]).toMatch(/^\/\/ =+$/)
  })
})

describe('sectionHeaderStyle (story 042 D7)', () => {
  // Carries both a title and a `[q2l ...]` tag, exactly the shape `render.ts`'s `titledSection`
  // hands to `banner()` - the whole point of this block is proving the tag rides through
  // unchanged regardless of which decoration wraps it.
  const titledLine = 'Weapons [q2l cat=weapons]'

  it('style "dashes" renders byte-identical to today\'s existing default output - explicitly pinned, not just implied by the default', () => {
    const explicit = banner('Player', { width: 30, style: 'dashes' })
    const implicitDefault = banner('Player', { width: 30 })

    expect(explicit).toEqual(['// --- Player ----------------'])
    expect(explicit).toEqual(implicitDefault)
  })

  it('style "brackets" renders the literal "// ----- [ <title> ] -----" form', () => {
    const [line] = banner(titledLine, { style: 'brackets' })

    expect(line).toBe('// ----- [ Weapons [q2l cat=weapons] ] -----')
  })

  it('style "plain" renders a bare "// <title>" with no decoration at all', () => {
    const [line] = banner(titledLine, { style: 'plain' })

    expect(line).toBe('// Weapons [q2l cat=weapons]')
  })

  it('the tag\'s position and content are identical across all three styles - only the decoration differs', () => {
    const dashes = banner(titledLine, { width: 60, style: 'dashes' })[0]!
    const brackets = banner(titledLine, { style: 'brackets' })[0]!
    const plain = banner(titledLine, { style: 'plain' })[0]!

    // Every style embeds the exact same title+tag substring, verbatim - decoration is the only
    // thing that ever differs between them.
    for (const line of [dashes, brackets, plain]) {
      expect(line).toContain(titledLine)
    }
    expect(dashes).toBe('// --- Weapons [q2l cat=weapons] ---------------------------')
    expect(brackets).toBe('// ----- [ Weapons [q2l cat=weapons] ] -----')
    expect(plain).toBe('// Weapons [q2l cat=weapons]')
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

/**
 * Story 042 D2: the give-way order for a comment that carries a machine-readable tail. It is the
 * *inverse* of `attachComment`'s rule above - there the comment was pure decoration and went first,
 * here the tag carries state (which entry, which key slot, which layer) that nothing else in the
 * file records, so the prose is what gives. Both rules live in this file at once, which is exactly
 * why each has its own block.
 */
describe('fitProseAndTag', () => {
  const tag = '[q2l e=3f9a1c22 k=alias slot=1]'

  it('keeps prose and tag whole, one space apart, when both fit', () => {
    expect(fitProseAndTag('SSG + SG', tag, 100)).toBe(`SSG + SG ${tag}`)
  })

  it('truncates the prose from its own end and keeps the tag intact', () => {
    const result = fitProseAndTag('SSG + SG', tag, tag.length + 4)

    expect(result).toBe(`SSG ${tag}`)
    expect(result.length).toBeLessThanOrEqual(tag.length + 4)
  })

  it('drops the prose entirely rather than shortening the tag', () => {
    const result = fitProseAndTag('SSG + SG', tag, tag.length + 1)

    expect(result).toBe(tag)
  })

  it('gives up on the tag only when the budget cannot hold even the bare tag, falling back to the pre-042 rule', () => {
    // One byte short of the tag: it goes entirely, and the line degrades to exactly what story 040
    // would have written - as much of the display name as fits, and nothing else.
    expect(fitProseAndTag('SSG + SG', tag, tag.length - 1)).toBe('SSG + SG')
    expect(fitProseAndTag('SSG + SG', tag, 4)).toBe('SSG ')
    expect(fitProseAndTag('SSG + SG', tag, 0)).toBe('')
  })

  it('never emits a half tag - the result either contains the whole tag or none of it', () => {
    // A truncated `[q2l` with no closing `]` parses as malformed prose, which is worse than a line
    // with no tag at all: the degradation path has to lose the tag whole, never cut it.
    for (let budget = 0; budget <= tag.length + 12; budget++) {
      const result = fitProseAndTag('SSG + SG', tag, budget)
      expect(result.includes('[q2l') ? result.endsWith(tag) : true).toBe(true)
      expect(result.length).toBeLessThanOrEqual(budget)
    }
  })

  it('returns the bare tag when there is no prose at all', () => {
    expect(fitProseAndTag('', tag, 100)).toBe(tag)
  })

  it('leaves no double space when the prose truncation lands on a space', () => {
    const result = fitProseAndTag('SSG  SG', tag, tag.length + 5)

    expect(result).toBe(`SSG ${tag}`)
  })

  it('behaves exactly like the tagless rule when the tag is empty', () => {
    expect(fitProseAndTag('Player name', '', 100)).toBe('Player name')
    expect(fitProseAndTag('Player name', '', 6)).toBe('Player')
  })
})

describe('attachTaggedComment', () => {
  const tag = '[q2l e=3f9a1c22 k=bind slot=1]'

  it('attaches prose and tag after the code, two spaces before the //', () => {
    expect(attachTaggedComment('bind q "ssg_sg"', 'SSG + SG', tag, 200)).toBe(
      `bind q "ssg_sg"  // SSG + SG ${tag}`,
    )
  })

  it('keeps the tag and drops the prose when the code leaves room for only one of them', () => {
    const code = `bind q "${'z'.repeat(40)}"`
    const budget = `${code}  // `.length + tag.length

    expect(attachTaggedComment(code, 'A display name', tag, budget)).toBe(`${code}  // ${tag}`)
  })

  it('falls back to the plain display name when not even the bare tag fits, never a cut tag', () => {
    const code = `bind q "${'z'.repeat(40)}"`
    const budget = `${code}  // `.length + tag.length - 1

    expect(attachTaggedComment(code, 'A display name', tag, budget)).toBe(
      `${code}  // A display name`,
    )
  })

  it('returns the code verbatim when neither the tag nor a single character of prose fits', () => {
    const code = `bind q "${'z'.repeat(40)}"`

    expect(attachTaggedComment(code, 'A display name', tag, `${code}  // `.length)).toBe(code)
  })

  it('never lengthens or truncates the code part itself', () => {
    const code = 'bind w "+forward"'

    expect(attachTaggedComment(code, 'x'.repeat(500), tag, 20)).toBe(code)
  })

  it('is identical to attachComment for an empty tag', () => {
    for (const budget of [8, 20, 33, 100]) {
      expect(attachTaggedComment('set name "x"', 'Player name', '', budget)).toBe(
        attachComment('set name "x"', 'Player name', budget),
      )
    }
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
