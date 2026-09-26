/**
 * The tolerant "serverinfo" infostring splitter — Quake II servers report their config as a
 * backslash-delimited key/value string like `\gamename\baseq2\mapname\q2dm1\maxclients\8`. This
 * module only splits that string and reads integer values out of the result; it never invents a
 * default for a key that was not actually present, and it never throws on malformed input, since
 * the input is untrusted data off the wire.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

/**
 * Splits a backslash-delimited serverinfo string into key/value pairs.
 *
 * Tolerant of malformed input by design, never throws:
 *  - Leading and/or trailing backslashes are ignored.
 *  - An empty value is kept as `''`.
 *  - A dangling final key (an odd trailing segment with no following value) is dropped entirely.
 *  - A duplicate key: the last occurrence wins.
 *  - An empty line returns `{}`.
 *
 * The result holds exactly the keys actually present in `line` — never a key injected for a
 * default.
 */
export function splitInfostring(line: string): Record<string, string> {
  const segments = line.split('\\').filter((segment, index, all) => {
    const isLeadingEmpty = index === 0 && segment === ''
    const isTrailingEmpty = index === all.length - 1 && segment === ''
    return !(isLeadingEmpty || isTrailingEmpty)
  })

  const result: Record<string, string> = {}
  for (let i = 0; i + 1 < segments.length; i += 2) {
    const key = segments[i] as string
    const value = segments[i + 1] as string
    result[key] = value
  }
  return result
}

const INTEGER_PATTERN = /^-?\d+$/

/**
 * Reads `key` out of a split infostring as an integer, never inventing a default: returns
 * `undefined` when the key is absent, or present but not a clean decimal integer (empty string,
 * non-numeric text, a float, trailing garbage). Only returns a number when the value parses
 * cleanly — including `0` itself, which is a real reported value, not a fallback.
 */
export function readIntKey(info: Record<string, string>, key: string): number | undefined {
  if (!(key in info)) return undefined
  const value = info[key] as string
  if (!INTEGER_PATTERN.test(value)) return undefined
  return Number(value)
}
