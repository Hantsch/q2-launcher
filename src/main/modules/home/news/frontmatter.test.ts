import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from './frontmatter'

/**
 * Story 082 D2: `parseFrontmatter`'s contract - a restricted-subset reader,
 * not a YAML parser. Malformed input answers `undefined`; a missing block
 * and an unterminated block are both treated as malformed, per the doc
 * comment on `parseFrontmatter`.
 */

describe('parseFrontmatter', () => {
  it('returns undefined when there is no frontmatter block at all', () => {
    const result = parseFrontmatter('Just some plain markdown, no block here.')
    expect(result).toBeUndefined()
  })

  it('returns undefined when the opening --- is never closed (unterminated block)', () => {
    const result = parseFrontmatter('---\nid: welcome\ntitle: Hello\n\nBody text.')
    expect(result).toBeUndefined()
  })

  it('parses CRLF line endings identically to LF', () => {
    const lf = '---\nid: welcome\ntitle: Hello\n---\nBody text.'
    const crlf = '---\r\nid: welcome\r\ntitle: Hello\r\n---\r\nBody text.'
    expect(parseFrontmatter(crlf)).toEqual(parseFrontmatter(lf))
  })

  it('strips quotes from quoted scalar values', () => {
    const result = parseFrontmatter(
      '---\ntitle: "Hello, world"\nsubtitle: \'Single quoted\'\nplain: unquoted\n---\nBody.',
    )
    expect(result?.data.title).toBe('Hello, world')
    expect(result?.data.subtitle).toBe('Single quoted')
    expect(result?.data.plain).toBe('unquoted')
  })

  it('returns an empty body when the block is immediately followed by end of string', () => {
    const result = parseFrontmatter('---\nid: welcome\n---')
    expect(result).toEqual({ data: { id: 'welcome' }, body: '' })
  })

  it('returns an empty body when only whitespace follows the closing block', () => {
    const result = parseFrontmatter('---\nid: welcome\n---\n\n   \n')
    expect(result).toEqual({ data: { id: 'welcome' }, body: '' })
  })

  it('parses a buttons list of label/url pairs', () => {
    const result = parseFrontmatter(
      [
        '---',
        'id: welcome',
        'buttons:',
        '  - label: Read more',
        '    url: https://example.com/a',
        '  - label: Download',
        '    url: https://example.com/b',
        '---',
        'Body.',
      ].join('\n'),
    )
    expect(result?.data.buttons).toEqual([
      { label: 'Read more', url: 'https://example.com/a' },
      { label: 'Download', url: 'https://example.com/b' },
    ])
    expect(result?.body).toBe('Body.')
  })

  it('drops a malformed button entry (missing url) instead of failing the whole document', () => {
    const result = parseFrontmatter(
      [
        '---',
        'id: welcome',
        'buttons:',
        '  - label: Broken entry',
        '  - label: Good entry',
        '    url: https://example.com/good',
        '---',
        'Body.',
      ].join('\n'),
    )
    expect(result).toBeDefined()
    expect(result?.data.buttons).toEqual([
      { label: 'Good entry', url: 'https://example.com/good' },
    ])
  })

  it('ignores unrecognized keys in the block', () => {
    const result = parseFrontmatter('---\nid: welcome\nsomethingWeird: [1, 2, 3]\n---\nBody.')
    expect(result?.data.id).toBe('welcome')
    expect(result?.data.somethingWeird).toBeDefined()
  })
})
