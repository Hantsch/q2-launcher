/**
 * Colour cvars (story 041, D8).
 *
 * Quake II's alternate console charset (`q2-charset.ts`) is what makes the classic
 * "glowing"/coloured chat text: every byte has its high bit set (>= 0x80), and the
 * client renders the plain twin of that byte in a different colour. A cvar whose
 * whole value is built from those bytes - `set g "<high-bit bytes>"` - is a colour
 * cvar: a player-defined shorthand for a colour code, most often referenced from a
 * chat message as `$g`. Recognising that here, once, is what lets
 * `MessageEditor.tsx` render a `$name` reference as its actual glyph run (via
 * `q2-charset.toDisplaySegments`, reused rather than reimplemented) instead of
 * showing it as dead literal text.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM
 * types, no `Buffer`.
 */

/**
 * Whether `value` is a colour cvar's value: every character is either a
 * high-bit alt-charset byte (0x80-0xFF, the same bound `q2-charset.ts` uses
 * throughout) or 0x7F. In the real Quake II conchars font, 0x7F is a distinct
 * printable glyph (not a plain ASCII space/letter) that real-world colour
 * cvars use to border their high-bit glyphs, e.g. `"\x7f\x88\x88\x88\x7f"` -
 * so it belongs in this set even though it is technically below 0x80. The
 * empty string has no glyph to render and is not a colour cvar - narrow by
 * construction, not "vacuously true" - and a value mixing in even one normal
 * printable ASCII character (0x20-0x7E) is an ordinary cvar, not a colour one.
 *
 * `name` is taken for symmetry with `colorCvarTokens`'s per-entry shape (and to
 * leave room for a future name-based narrowing); the recognition itself only
 * looks at `value` today.
 */
export function isColorCvar(_name: string, value: string): boolean {
  if (value.length === 0) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code !== 0x7f && (code < 0x80 || code > 0xff)) return false
  }
  return true
}

/**
 * The subset of a profile's cvars that are colour cvars, keyed by cvar name for
 * O(1) lookup from a `$name` reference found in message text. Accepts either the
 * profile's own `cvars` map (`Record<name, value>`) or an array of `{ name, value }`
 * pairs, so either shape a caller already has on hand can be passed straight
 * through.
 */
export function colorCvarTokens(
  cvars: Record<string, string> | { name: string; value: string }[],
): Map<string, string> {
  const entries = Array.isArray(cvars)
    ? cvars.map(({ name, value }) => [name, value] as const)
    : Object.entries(cvars)
  const tokens = new Map<string, string>()
  for (const [name, value] of entries) {
    if (isColorCvar(name, value)) tokens.set(name, value)
  }
  return tokens
}
