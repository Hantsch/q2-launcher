import { describe, expect, it } from 'vitest'
import {
  KNOWN_META_KEYS,
  META_FORMAT_VERSION,
  escapeMetaValue,
  formatMetaComment,
  formatMetaTag,
  neutralizeProse,
  parseMetaTag,
  unescapeMetaValue,
} from './profile-metadata'

describe('META_FORMAT_VERSION', () => {
  it('is exported as a positive integer, starting at 1', () => {
    expect(META_FORMAT_VERSION).toBe(1)
    expect(Number.isInteger(META_FORMAT_VERSION)).toBe(true)
  })
})

describe('formatMetaTag', () => {
  it('renders known keys in the fixed registry order regardless of input order', () => {
    const inOrder = formatMetaTag({ v: '1', e: '3f9a1c22', k: 'alias', cid: 'ssg_sg', slot: '1', mod: 'shift' })
    const reversed = formatMetaTag({ mod: 'shift', slot: '1', cid: 'ssg_sg', k: 'alias', e: '3f9a1c22', v: '1' })

    expect(inOrder).toBe('[q2l v=1 e=3f9a1c22 k=alias cid=ssg_sg slot=1 mod=shift]')
    expect(reversed).toBe(inOrder)
  })

  it('omits keys whose value is undefined', () => {
    expect(formatMetaTag({ e: 'abc12345', k: undefined, cid: undefined })).toBe('[q2l e=abc12345]')
  })

  it('renders the bare sigil with no pairs for an empty fields object', () => {
    expect(formatMetaTag({})).toBe('[q2l]')
  })

  it('appends unknown keys after the known ones, sorted alphabetically for determinism', () => {
    const a = formatMetaTag({ e: 'abc', zeta: '1', alpha: '2' })
    const b = formatMetaTag({ zeta: '1', alpha: '2', e: 'abc' })

    expect(a).toBe('[q2l e=abc alpha=2 zeta=1]')
    expect(a).toBe(b)
  })

  it('percent-escapes space, %, ] and / in values', () => {
    expect(formatMetaTag({ k: 'a b' })).toBe('[q2l k=a%20b]')
    expect(formatMetaTag({ k: '50%' })).toBe('[q2l k=50%25]')
    expect(formatMetaTag({ k: 'a]b' })).toBe('[q2l k=a%5Db]')
    expect(formatMetaTag({ k: 'a/b' })).toBe('[q2l k=a%2Fb]')
  })

  it('never emits a literal "//" in the tag text, even when a value is packed with slashes', () => {
    const tag = formatMetaTag({ cid: '//weapons//layer//' })
    expect(tag).not.toContain('//')
  })

  it('drops characters above the latin-1 range rather than emitting them', () => {
    const tag = formatMetaTag({ k: 'a\u{1F600}b' })
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\xff]*$/.test(tag)).toBe(true)
    expect(tag).toBe('[q2l k=ab]')
  })
})

describe('escapeMetaValue / unescapeMetaValue', () => {
  it('round-trips space, %, ] and / byte-identically', () => {
    const original = 'weapons/melee 100% [done]'
    const escaped = escapeMetaValue(original)
    expect(unescapeMetaValue(escaped)).toBe(original)
  })

  it('round-trips a value containing a literal % followed by hex-looking digits', () => {
    const original = 'discount%25off'
    expect(unescapeMetaValue(escapeMetaValue(original))).toBe(original)
  })

  it('leaves an unrecognised %xx sequence alone on decode (defensive, not our escape vocabulary)', () => {
    expect(unescapeMetaValue('a%41b')).toBe('a%41b')
  })

  it('folds CR/LF/tab into an escaped space', () => {
    expect(escapeMetaValue('a\nb\tc\rd')).toBe('a%20b%20c%20d')
  })
})

describe('parseMetaTag', () => {
  it('returns fields: {} and malformed: false for a comment with no tag at all', () => {
    const result = parseMetaTag('SSG + SG')
    expect(result).toEqual({ prose: 'SSG + SG', fields: {}, unknownKeys: [], malformed: false })
  })

  it('returns fields: {} for an empty comment', () => {
    expect(parseMetaTag('')).toEqual({ prose: '', fields: {}, unknownKeys: [], malformed: false })
  })

  it('splits prose from a well-formed tag and decodes known fields', () => {
    const result = parseMetaTag('SSG + SG [q2l e=3f9a1c22 k=alias slot=1]')

    expect(result.prose).toBe('SSG + SG')
    expect(result.fields).toEqual({ e: '3f9a1c22', k: 'alias', slot: '1' })
    expect(result.unknownKeys).toEqual([])
    expect(result.malformed).toBe(false)
  })

  it('handles the bare-sigil tag with no pairs', () => {
    const result = parseMetaTag('just prose [q2l]')
    expect(result.prose).toBe('just prose')
    expect(result.fields).toEqual({})
    expect(result.malformed).toBe(false)
  })

  it('round-trips unknown keys into fields and reports them as unknown, not dropped', () => {
    const result = parseMetaTag('X [q2l e=abc12345 futureKey=hello]')

    expect(result.fields).toEqual({ e: 'abc12345', futureKey: 'hello' })
    expect(result.unknownKeys).toEqual(['futureKey'])
    expect(result.malformed).toBe(false)
  })

  it('decodes percent-escaped values back byte-identically', () => {
    const result = parseMetaTag('X [q2l k=a%20b%25c%5Dd%2Fe]')
    expect(result.fields.k).toBe('a b%c]d/e')
  })

  it('never throws on a missing closing bracket, and reports malformed with best-effort prose', () => {
    expect(() => parseMetaTag('X [q2l e=abc')).not.toThrow()
    const result = parseMetaTag('X [q2l e=abc')
    expect(result.malformed).toBe(true)
    expect(result.prose).toBe('X [q2l e=abc')
    expect(result.fields).toEqual({})
  })

  it('never throws on trailing garbage after the closing bracket', () => {
    expect(() => parseMetaTag('X [q2l e=abc] trailing junk')).not.toThrow()
    const result = parseMetaTag('X [q2l e=abc] trailing junk')
    expect(result.malformed).toBe(true)
  })

  it('never throws on a garbage token inside an otherwise well-formed tag, and keeps the good tokens', () => {
    const result = parseMetaTag('X [q2l e=abc12345 garbage k=alias]')

    expect(result.malformed).toBe(true)
    expect(result.fields).toEqual({ e: 'abc12345', k: 'alias' })
  })

  it('never throws on assorted hand-mangled input', () => {
    const inputs = [
      '[q2l',
      '[q2l]]',
      '[q2l =abc]',
      '[q2l ===]',
      'prose only, no tag whatsoever',
      '[q2l k=v] [q2l k2=v2]',
      '[q2l' + '  '.repeat(50) + ']',
    ]
    for (const input of inputs) {
      expect(() => parseMetaTag(input)).not.toThrow()
    }
  })

  it('anchors on the last [q2l occurrence, so a header carrying two would still resolve the trailing one', () => {
    const result = parseMetaTag('[q2l k=v] more prose [q2l e=abc12345]')
    expect(result.fields).toEqual({ e: 'abc12345' })
    expect(result.prose).toBe('[q2l k=v] more prose')
  })
})

describe('formatMetaTag / parseMetaTag round trip', () => {
  it('is a fixed point for known fields', () => {
    const fields = { v: String(META_FORMAT_VERSION), e: '3f9a1c22', k: 'alias', cid: 'ssg_sg', slot: '2', mod: 'shift' }
    const tag = formatMetaTag(fields)
    const parsed = parseMetaTag(`prose ${tag}`)

    expect(parsed.fields).toEqual(fields)
    expect(parsed.malformed).toBe(false)
  })

  it('round-trips values containing every escaped character byte-identically', () => {
    const value = 'a b%c]d/e f'
    const tag = formatMetaTag({ k: value })
    const parsed = parseMetaTag(tag)

    expect(parsed.fields.k).toBe(value)
  })

  it('round-trips every registered key name', () => {
    const fields: Record<string, string> = {}
    for (const key of KNOWN_META_KEYS) fields[key] = `val-${key}`

    const parsed = parseMetaTag(formatMetaTag(fields))
    expect(parsed.fields).toEqual(fields)
    expect(parsed.unknownKeys).toEqual([])
  })
})

describe('neutralizeProse', () => {
  it('rewrites a literal [q2l occurrence so it can never be mistaken for a tag', () => {
    const neutralised = neutralizeProse('GG [q2l cat=weapons]')
    expect(neutralised).not.toContain('[q2l')
    expect(neutralised).toBe('GG (q2l cat=weapons]')
  })

  it('leaves prose with no sigil untouched', () => {
    expect(neutralizeProse('SSG + SG')).toBe('SSG + SG')
  })

  it('handles multiple forged occurrences', () => {
    const neutralised = neutralizeProse('[q2l a] and [q2l b]')
    expect(neutralised).not.toContain('[q2l')
  })
})

describe('formatMetaComment', () => {
  it('neutralises forged prose on format, and the result does not parse as a tag on read', () => {
    const comment = formatMetaComment('GG [q2l cat=weapons]', { e: 'abc12345', k: 'alias' })

    expect(comment).not.toMatch(/GG \[q2l cat=weapons\] \[q2l/)

    const parsed = parseMetaTag(comment)
    // The only real tag recognised is the one this function appended — the forged one in prose
    // reads back as inert text, not as a second (or contradicting) set of fields.
    expect(parsed.fields).toEqual({ e: 'abc12345', k: 'alias' })
    expect(parsed.prose).toBe('GG (q2l cat=weapons]')
  })

  it('emits prose alone, with no bare tag, when fields carries nothing', () => {
    expect(formatMetaComment('SSG + SG', {})).toBe('SSG + SG')
    expect(formatMetaComment('SSG + SG', { v: undefined })).toBe('SSG + SG')
  })

  it('emits only the tag when prose is empty', () => {
    expect(formatMetaComment('', { e: 'abc12345' })).toBe('[q2l e=abc12345]')
  })

  it('emits a tag portion that is always latin-1 safe, even when a value carries non-latin1 input', () => {
    const comment = formatMetaComment('prose', { k: 'a\u{1F600}b/c%d]e' })
    const tag = comment.slice(comment.indexOf('[q2l'))
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\xff]*$/.test(tag)).toBe(true)
  })

  it('never produces a tag text containing a literal "//"', () => {
    const comment = formatMetaComment('name', { cid: '//a//b//' })
    const tag = comment.slice(comment.indexOf('[q2l'))
    expect(tag).not.toContain('//')
  })
})
