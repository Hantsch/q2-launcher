/**
 * Pure Quake II command-line tokenizer primitives, shared by main and
 * renderer.
 *
 * Extracted out of `src/main/modules/config/core/config-parser.ts` (story
 * 041 D1) because alias-body splitting needs to use the exact same
 * comment/`;`/quoting rules the import parser uses, and alias bodies are
 * split by shared code (`src/shared/config/alias-import.ts`), not by main.
 * No `node:*`, no Electron, no DOM - this file only ever sees a string and
 * returns data.
 *
 * ## Rules (Quake II's own, not reinvented)
 *
 *  - `"` starts a quoted argument. There is NO in-quote escaping: the next
 *    `"` always ends the span, and a backslash inside one is a literal
 *    character, never an escape. An unterminated quote (no closing `"`
 *    before the line ends) simply runs to the end of the line - config
 *    files are line-based, there is no multi-line string.
 *  - Outside quotes, whitespace separates tokens.
 *  - `//` starts a line comment, but only when it appears outside a quoted
 *    span (`set motd "see http://example.com"` keeps its URL intact).
 *  - `;` separates multiple commands on one physical line, again only
 *    outside quotes.
 */

/**
 * Returns the portion of `line` before an unquoted `//`, or the whole line
 * if there is none. Quote state is tracked char-by-char so a `//` inside a
 * quoted value (a URL in a motd, say) is not mistaken for a comment.
 */
export function stripLineComment(line: string): string {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i)
    }
  }
  return line
}

/** Splits `line` on `;` that appear outside a quoted span. */
export function splitTopLevelSemicolons(line: string): string[] {
  const parts: string[] = []
  let inQuotes = false
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && ch === ';') {
      parts.push(line.slice(start, i))
      start = i + 1
    }
  }
  parts.push(line.slice(start))
  return parts
}

const WHITESPACE = /\s/

/**
 * Tokenizes one command segment the way Quake II's `COM_Parse` does: skip
 * whitespace, then if the next character is a `"`, the token is everything
 * up to (not including) the next `"` - or the end of the segment if there
 * isn't one, since there is no escaping and no multi-line strings here.
 * Otherwise the token runs to the next whitespace. A `"` that appears mid
 * token (not right after whitespace) is not special - it is only quoting
 * syntax as the first character of a token.
 */
export function tokenize(segment: string): string[] {
  const tokens: string[] = []
  const n = segment.length
  let i = 0

  while (i < n) {
    while (i < n && WHITESPACE.test(segment[i])) i++
    if (i >= n) break

    if (segment[i] === '"') {
      i++
      const start = i
      while (i < n && segment[i] !== '"') i++
      tokens.push(segment.slice(start, i))
      if (i < n) i++ // consume the closing quote, if there was one
    } else {
      const start = i
      while (i < n && !WHITESPACE.test(segment[i])) i++
      tokens.push(segment.slice(start, i))
    }
  }

  return tokens
}
