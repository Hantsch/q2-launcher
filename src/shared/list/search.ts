/**
 * Generic free-text search primitives for the launcher's lists: a list hands over the values a row
 * is searchable by, these decide whether the user's term matches.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * electron import.
 */

/**
 * Whether `term` matches any of `values`. An empty (or whitespace-only) term matches everything.
 * Otherwise a case-insensitive substring of any value matches. Never throws; a null/undefined
 * value never matches.
 *
 * Quoted mode: a trimmed term of at least three characters that starts and ends with a double
 * quote (`"ffa"`) matches exactly instead — the text between the quotes (case-insensitive, not
 * trimmed) must equal a whole value. Anything else (an unclosed quote, empty quotes, a lone quote,
 * single quotes) is plain text.
 */
export function matchesTerm(term: string, values: Iterable<string | null | undefined>): boolean {
  const raw = term.trim()
  if (raw === '') return true

  const quoted = raw.length >= 3 && raw.startsWith('"') && raw.endsWith('"')
  const needle = (quoted ? raw.slice(1, -1) : raw).toLowerCase()

  for (const value of values) {
    if (value === null || value === undefined) continue
    const candidate = value.toLowerCase()
    if (quoted ? candidate === needle : candidate.includes(needle)) return true
  }
  return false
}

/** Whether `value` equals `filter` ignoring case; a null/undefined value never matches. */
export function equalsIgnoreCase(value: string | null | undefined, filter: string): boolean {
  return value !== null && value !== undefined && value.toLowerCase() === filter.toLowerCase()
}
