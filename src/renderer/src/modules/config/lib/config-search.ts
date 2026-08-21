import type { ConfigSyntaxLine } from '@shared/config/config-syntax'

/**
 * Find-in-file support for `ConfigCodeView` (story 024 D3): a pure, DOM-free
 * substring search over the plain text of the tokenized lines D2 already
 * produces, plus a per-token slicer the renderer uses to paint match
 * highlights without ever touching a token's own text content.
 *
 * Pure - no DOM, no hooks, no IPC - so this file is fully unit-testable, the
 * same rule `bind-conflicts.ts` follows for this module's other helpers.
 */

/** One match of the search query, in a line's plain text coordinates. */
export interface ConfigSearchMatch {
  /** 1-based, matches `ConfigSyntaxLine.number`. */
  line: number
  /** Offset into the line's plain text (the concatenation of that line's token texts, in
   * order), inclusive. */
  start: number
  /** Offset into the line's plain text, exclusive. */
  end: number
}

/**
 * Case-insensitive, literal (never regex) substring search of `query` over each line's plain
 * text. `query`'s regex-special characters (`.`, `(`, `+`, ...) are never interpreted - this
 * scans with `String.prototype.indexOf`, not a constructed `RegExp`, so there is nothing to
 * escape and nothing that can misparse.
 *
 * Overlapping-match policy: matches are non-overlapping and left-to-right, exactly like a
 * browser's native find-in-page. After a match is recorded, the scan resumes at that match's own
 * end rather than one character later - so `findMatches(["aaa"], "aa")` returns one match at
 * `[0, 2)`, not two overlapping matches at `[0, 2)` and `[1, 3)`. This is a deliberate choice
 * (either policy is defensible), documented here and pinned by the test file.
 *
 * Empty query returns `[]` - there is no such thing as "everything matches an empty string" in
 * this UI; an empty search box means no highlight and no match count.
 */
export function findMatches(lines: ConfigSyntaxLine[], query: string): ConfigSearchMatch[] {
  if (query.length === 0) return []

  const needle = query.toLowerCase()
  const matches: ConfigSearchMatch[] = []

  for (const line of lines) {
    const haystack = line.tokens.map((token) => token.text).join('').toLowerCase()

    let searchFrom = 0
    while (searchFrom <= haystack.length) {
      const index = haystack.indexOf(needle, searchFrom)
      if (index === -1) break
      matches.push({ line: line.number, start: index, end: index + needle.length })
      searchFrom = index + needle.length
    }
  }

  return matches
}

/** One slice of a token's text, tagged with whether it falls inside a match and, if so,
 * whether that match is the current one. Concatenating a token's pieces' `text`, in order,
 * always reproduces the token's original text exactly - no character is ever added, removed or
 * reordered. */
export interface TokenMatchPiece {
  text: string
  matched: boolean
  current: boolean
}

/** A `TokenMatchPiece` array holding just the token unmodified, for the common "nothing to
 * highlight on this token" case. */
function unmarked(tokenText: string): TokenMatchPiece[] {
  return [{ text: tokenText, matched: false, current: false }]
}

/**
 * Splits one token's text into pieces for highlighting, intersecting the token's own
 * `[tokenStart, tokenStart + tokenText.length)` range (its offset within its line's plain text -
 * the same coordinate space `findMatches` returns) against `lineMatches`, the subset of
 * `findMatches`'s result that belongs to this token's line.
 *
 * `lineMatches` must already be filtered to one line and, per `findMatches`'s contract, is in
 * ascending, non-overlapping `start` order - this function relies on that order to build pieces
 * in a single left-to-right pass. Passing matches from a different line, or out of order,
 * produces undefined slicing (no crash, just meaningless output).
 *
 * `currentMatch` (when it falls on this token) is marked `current: true` on its piece, compared
 * by value (`line`/`start`/`end`) rather than by object identity, so a caller can hand this a
 * fresh match object each render without breaking the comparison. Pass `undefined` when nothing
 * is current on this line.
 *
 * A match spanning a token boundary is handled correctly because both tokens are sliced against
 * the SAME match objects (each with the match's absolute line-text offsets) - the tail of the
 * earlier token and the head of the later token each independently intersect their own
 * `[tokenStart, tokenEnd)` against that one match's `[start, end)`, so both come out marked.
 *
 * Empty `lineMatches` (including the "no active search" case) returns the token completely
 * unmarked, in one piece - the D2 rendering path this replaces when a search is active but this
 * particular line has no match.
 */
export function splitTokenByMatches(
  tokenText: string,
  tokenStart: number,
  lineMatches: ConfigSearchMatch[],
  currentMatch: ConfigSearchMatch | undefined,
): TokenMatchPiece[] {
  if (lineMatches.length === 0) return unmarked(tokenText)

  const tokenEnd = tokenStart + tokenText.length
  const pieces: TokenMatchPiece[] = []
  let cursor = 0 // relative to tokenText

  for (const match of lineMatches) {
    const overlapStart = Math.max(tokenStart, match.start)
    const overlapEnd = Math.min(tokenEnd, match.end)
    if (overlapStart >= overlapEnd) continue // this match does not touch this token at all

    const relStart = overlapStart - tokenStart
    const relEnd = overlapEnd - tokenStart

    if (relStart > cursor) {
      pieces.push({ text: tokenText.slice(cursor, relStart), matched: false, current: false })
    }

    const isCurrent =
      currentMatch !== undefined &&
      currentMatch.line === match.line &&
      currentMatch.start === match.start &&
      currentMatch.end === match.end

    pieces.push({ text: tokenText.slice(relStart, relEnd), matched: true, current: isCurrent })
    cursor = relEnd
  }

  if (cursor < tokenText.length) {
    pieces.push({ text: tokenText.slice(cursor), matched: false, current: false })
  }

  return pieces.length > 0 ? pieces : unmarked(tokenText)
}
