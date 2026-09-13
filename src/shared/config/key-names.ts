/**
 * Canonical Quake II bind key-name tokens, ported from the external
 * q2-config-manager project (`src/core/keys.ts`'s `Q2_KEYS` name list and
 * `normaliseKeyName`). Named keys bind as an upper-case token (`ENTER`,
 * `SHIFT`, `MOUSE1`); every other bindable key is the literal printable
 * character the engine reads, always lower-case (`bind w`, not `bind W`).
 *
 * Exists so the parser (main) and the keyboard overview (renderer) agree on
 * one spelling. Configs in the wild mix casing (`ctrl`/`CTRL`, `Space`/
 * `SPACE`) - `normalizeBindKey` below is what makes that survive
 * round-tripping instead of silently landing on a keycap that never lights
 * up.
 */

export const NAMED_KEYS = [
  'ESCAPE',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'BACKSPACE',
  'TAB',
  'CAPSLOCK',
  'ENTER',
  'SHIFT',
  'CTRL',
  'ALT',
  'SPACE',
  'INS',
  'HOME',
  'PGUP',
  'DEL',
  'END',
  'PGDN',
  'PAUSE',
  'UPARROW',
  'DOWNARROW',
  'LEFTARROW',
  'RIGHTARROW',
  'MOUSE1',
  'MOUSE2',
  'MOUSE3',
  'MOUSE4',
  'MOUSE5',
  'MWHEELUP',
  'MWHEELDOWN',
  'KP_SLASH',
  'KP_STAR',
  'KP_MINUS',
  'KP_PLUS',
  'KP_HOME',
  'KP_UPARROW',
  'KP_PGUP',
  'KP_LEFTARROW',
  'KP_5',
  'KP_RIGHTARROW',
  'KP_END',
  'KP_DOWNARROW',
  'KP_PGDN',
  'KP_INS',
  'KP_DEL',
  'KP_ENTER',
] as const

const NAMED_KEY_SET = new Set<string>(NAMED_KEYS)

/**
 * Normalizes a raw key token as read from a config line to this app's
 * canonical spelling: a known named key upper-cased, or - for anything else
 * - a single printable character lower-cased. Anything longer that isn't a
 * known named key (a third-party engine's own extension) is passed through
 * untouched rather than guessed at.
 */
export function normalizeBindKey(raw: string): string {
  const upper = raw.toUpperCase()
  if (NAMED_KEY_SET.has(upper)) return upper
  if (raw.length === 1) return raw.toLowerCase()
  return raw
}
