import { describe, expect, it } from 'vitest'
import type { ConfigSyntaxLine } from '@shared/config/config-syntax'
import { tokenizeConfigText } from '@shared/config/config-syntax'
import { findMatches, splitTokenByMatches, type ConfigSearchMatch } from './config-search'

/** Tokenizes `text` and returns just the lines, for tests that only care about search
 * behaviour and not about the tokenizer's own classification. */
function linesOf(text: string): ConfigSyntaxLine[] {
  return tokenizeConfigText(text)
}

describe('findMatches', () => {
  it('returns [] for an empty query', () => {
    expect(findMatches(linesOf('set name Ranger'), '')).toEqual([])
  })

  it('finds a single case-insensitive match on one line', () => {
    const matches = findMatches(linesOf('set name Ranger'), 'RANGER')
    expect(matches).toEqual([{ line: 1, start: 9, end: 15 }])
  })

  it('finds multiple occurrences on one line', () => {
    const matches = findMatches(linesOf('bind a +attack; bind b +attack'), '+attack')
    expect(matches).toEqual([
      { line: 1, start: 7, end: 14 },
      { line: 1, start: 23, end: 30 },
    ])
  })

  it('finds occurrences across multiple lines', () => {
    const matches = findMatches(linesOf('set foo bar\nset baz bar\n'), 'bar')
    expect(matches).toEqual([
      { line: 1, start: 8, end: 11 },
      { line: 2, start: 8, end: 11 },
    ])
  })

  it('returns no matches when the query is not present', () => {
    expect(findMatches(linesOf('set name Ranger'), 'nope')).toEqual([])
  })

  it('treats overlapping candidates as non-overlapping, left-to-right matches', () => {
    // "aa" against "aaa": a match at [0,2) consumes both its characters, so the scan resumes at
    // offset 2 and finds no second match in the single remaining "a" - see the doc comment on
    // findMatches for why this policy (not the overlapping [0,2)+[1,3) alternative) was chosen.
    const matches = findMatches(linesOf('aaa'), 'aa')
    expect(matches).toEqual([{ line: 1, start: 0, end: 2 }])
  })

  it('finds every non-overlapping occurrence when they tile exactly', () => {
    const matches = findMatches(linesOf('abab'), 'ab')
    expect(matches).toEqual([
      { line: 1, start: 0, end: 2 },
      { line: 1, start: 2, end: 4 },
    ])
  })

  it('treats regex-special characters in the query as a literal substring', () => {
    expect(findMatches(linesOf('set a.b 1'), 'a.b')).toEqual([{ line: 1, start: 4, end: 7 }])
    expect(findMatches(linesOf('echo (hi)'), '(')).toEqual([{ line: 1, start: 5, end: 6 }])
    expect(findMatches(linesOf('set a+b 1'), 'a+b')).toEqual([{ line: 1, start: 4, end: 7 }])
  })

  it('does not let a "." in the query match an unrelated character (proves it is not a regex)', () => {
    // If "." were a regex wildcard, this would match "axb" too. It must not.
    expect(findMatches(linesOf('set axb 1'), 'a.b')).toEqual([])
  })

  it('matches a high-ASCII / latin1 character correctly', () => {
    expect(findMatches(linesOf('echo café'), 'café')).toEqual([{ line: 1, start: 5, end: 9 }])
    expect(findMatches(linesOf('echo CAFÉ'), 'café')).toEqual([{ line: 1, start: 5, end: 9 }])
    expect(findMatches(linesOf('echo café'), 'é')).toEqual([{ line: 1, start: 8, end: 9 }])
  })
})

describe('splitTokenByMatches', () => {
  it('returns the token unmodified and unmarked for an empty match list', () => {
    expect(splitTokenByMatches('foo', 0, [], undefined)).toEqual([
      { text: 'foo', matched: false, current: false },
    ])
  })

  it('marks a match fully inside one token', () => {
    const match: ConfigSearchMatch = { line: 1, start: 2, end: 5 }
    const pieces = splitTokenByMatches('abcdefgh', 0, [match], undefined)
    expect(pieces).toEqual([
      { text: 'ab', matched: false, current: false },
      { text: 'cde', matched: true, current: false },
      { text: 'fgh', matched: false, current: false },
    ])
    expect(pieces.map((p) => p.text).join('')).toBe('abcdefgh')
  })

  it('marks the matching piece as current when it equals currentMatch by value', () => {
    const match: ConfigSearchMatch = { line: 3, start: 0, end: 3 }
    const pieces = splitTokenByMatches('foobar', 0, [match], { line: 3, start: 0, end: 3 })
    expect(pieces).toEqual([
      { text: 'foo', matched: true, current: true },
      { text: 'bar', matched: false, current: false },
    ])
  })

  it('does not mark current when currentMatch is a different match on the same line', () => {
    const match: ConfigSearchMatch = { line: 1, start: 0, end: 3 }
    const otherMatch: ConfigSearchMatch = { line: 1, start: 10, end: 13 }
    const pieces = splitTokenByMatches('foobar', 0, [match], otherMatch)
    expect(pieces[0]).toEqual({ text: 'foo', matched: true, current: false })
  })

  it('splits a match spanning a token boundary correctly across both tokens', () => {
    // Line "setoo bar" tokenized (hypothetically) as two tokens: "setoo" (0-5) and " bar" (5-9).
    // A match for "oo b" spans [3, 7) - the tail of the first token and the head of the second.
    const match: ConfigSearchMatch = { line: 1, start: 3, end: 7 }

    const firstToken = splitTokenByMatches('setoo', 0, [match], undefined)
    expect(firstToken).toEqual([
      { text: 'set', matched: false, current: false },
      { text: 'oo', matched: true, current: false },
    ])
    expect(firstToken.map((p) => p.text).join('')).toBe('setoo')

    const secondToken = splitTokenByMatches(' bar', 5, [match], undefined)
    expect(secondToken).toEqual([
      { text: ' b', matched: true, current: false },
      { text: 'ar', matched: false, current: false },
    ])
    expect(secondToken.map((p) => p.text).join('')).toBe(' bar')
  })

  it('marks both sides of a boundary-spanning match as current when it is the current match', () => {
    const match: ConfigSearchMatch = { line: 5, start: 3, end: 7 }
    const current: ConfigSearchMatch = { line: 5, start: 3, end: 7 }

    const firstToken = splitTokenByMatches('setoo', 0, [match], current)
    const secondToken = splitTokenByMatches(' bar', 5, [match], current)

    expect(firstToken.find((p) => p.matched)?.current).toBe(true)
    expect(secondToken.find((p) => p.matched)?.current).toBe(true)
  })

  it('handles a token with no overlap from any line match', () => {
    const match: ConfigSearchMatch = { line: 1, start: 100, end: 103 }
    const pieces = splitTokenByMatches('hello', 0, [match], undefined)
    expect(pieces).toEqual([{ text: 'hello', matched: false, current: false }])
  })

  it('handles two separate matches inside the same token', () => {
    const matchA: ConfigSearchMatch = { line: 1, start: 1, end: 2 }
    const matchB: ConfigSearchMatch = { line: 1, start: 3, end: 4 }
    const pieces = splitTokenByMatches('xaxbx', 0, [matchA, matchB], undefined)
    expect(pieces).toEqual([
      { text: 'x', matched: false, current: false },
      { text: 'a', matched: true, current: false },
      { text: 'x', matched: false, current: false },
      { text: 'b', matched: true, current: false },
      { text: 'x', matched: false, current: false },
    ])
    expect(pieces.map((p) => p.text).join('')).toBe('xaxbx')
  })
})
