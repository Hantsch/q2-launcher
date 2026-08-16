/**
 * Quake II key-name layout data for the config module's keyboard overview
 * (concept doc §5 "Overview / keyboard", requirement CFG-7).
 *
 * Key names match the engine's own bind vocabulary (`Key_Names` in
 * `keys.c`): named keys are upper-case tokens (`ENTER`, `UPARROW`, `MOUSE1`),
 * printable keys are the literal ASCII character `bind` expects (lower-case
 * letters, digits, punctuation). SHIFT/CTRL/ALT are deliberately a single
 * name each - the engine does not distinguish left/right, so both physical
 * keys share one bind entry. That is what `keyOccurrenceCounts` below is
 * for: flagging a key name that appears at more than one physical position,
 * i.e. editing one visually "doubly-bound" key affects both.
 */

export interface KeyDef {
  /** The exact token used as a `profile.binds` key. */
  key: string
  /** Short label drawn on the keycap. */
  label: string
  /** Width in keycap units (1 unit = one standard key). Defaults to 1. */
  units?: number
}

const row = (defs: KeyDef[]): KeyDef[] => defs

const letterRow = (chars: string, extra: KeyDef[] = [], lead: KeyDef[] = []): KeyDef[] => [
  ...lead,
  ...chars.split('').map((char) => ({ key: char, label: char.toUpperCase() })),
  ...extra,
]

export const KEYBOARD_ROWS: KeyDef[][] = [
  row([
    { key: 'ESCAPE', label: 'Esc' },
    { key: 'F1', label: 'F1' },
    { key: 'F2', label: 'F2' },
    { key: 'F3', label: 'F3' },
    { key: 'F4', label: 'F4' },
    { key: 'F5', label: 'F5' },
    { key: 'F6', label: 'F6' },
    { key: 'F7', label: 'F7' },
    { key: 'F8', label: 'F8' },
    { key: 'F9', label: 'F9' },
    { key: 'F10', label: 'F10' },
    { key: 'F11', label: 'F11' },
    { key: 'F12', label: 'F12' },
    { key: 'PAUSE', label: 'Pause', units: 1.5 },
  ]),
  row([
    { key: '`', label: '`' },
    { key: '1', label: '1' },
    { key: '2', label: '2' },
    { key: '3', label: '3' },
    { key: '4', label: '4' },
    { key: '5', label: '5' },
    { key: '6', label: '6' },
    { key: '7', label: '7' },
    { key: '8', label: '8' },
    { key: '9', label: '9' },
    { key: '0', label: '0' },
    { key: '-', label: '-' },
    { key: '=', label: '=' },
    { key: 'BACKSPACE', label: 'Backspace', units: 2 },
  ]),
  letterRow(
    'qwertyuiop',
    [
      { key: '[', label: '[' },
      { key: ']', label: ']' },
      { key: '\\', label: '\\', units: 1.5 },
    ],
    [{ key: 'TAB', label: 'Tab', units: 1.5 }],
  ),
  letterRow(
    'asdfghjkl',
    [
      { key: ';', label: ';' },
      { key: "'", label: "'" },
      { key: 'ENTER', label: 'Enter', units: 2 },
    ],
    [],
  ),
  row([
    { key: 'SHIFT', label: 'Shift', units: 2.25 },
    ...letterRow('zxcvbnm', [
      { key: ',', label: ',' },
      { key: '.', label: '.' },
      { key: '/', label: '/' },
    ]),
    { key: 'SHIFT', label: 'Shift', units: 2.25 },
  ]),
  row([
    { key: 'CTRL', label: 'Ctrl', units: 1.5 },
    { key: 'ALT', label: 'Alt', units: 1.25 },
    { key: 'SPACE', label: 'Space', units: 6.5 },
    { key: 'ALT', label: 'Alt', units: 1.25 },
    { key: 'CTRL', label: 'Ctrl', units: 1.5 },
  ]),
]

export const NAV_CLUSTER: KeyDef[][] = [
  row([
    { key: 'INS', label: 'Ins' },
    { key: 'HOME', label: 'Home' },
    { key: 'PGUP', label: 'PgUp' },
  ]),
  row([
    { key: 'DEL', label: 'Del' },
    { key: 'END', label: 'End' },
    { key: 'PGDN', label: 'PgDn' },
  ]),
]

export const ARROW_CLUSTER: (KeyDef | null)[][] = [
  [null, { key: 'UPARROW', label: '↑' }, null],
  [
    { key: 'LEFTARROW', label: '←' },
    { key: 'DOWNARROW', label: '↓' },
    { key: 'RIGHTARROW', label: '→' },
  ],
]

export const MOUSE_KEYS: KeyDef[] = [
  { key: 'MOUSE1', label: 'M1' },
  { key: 'MOUSE2', label: 'M2' },
  { key: 'MOUSE3', label: 'M3' },
  { key: 'MOUSE4', label: 'M4' },
  { key: 'MOUSE5', label: 'M5' },
  { key: 'MWHEELUP', label: '↑ Wheel' },
  { key: 'MWHEELDOWN', label: '↓ Wheel' },
]

/**
 * Counts how many physical positions in the layout share each key name.
 * SHIFT/CTRL/ALT come out at 2 - everything else at 1. Used to flag
 * "doubly-bound" keys in the overview (CFG-7): visually two keys, one bind.
 */
export function keyOccurrenceCounts(): Map<string, number> {
  const counts = new Map<string, number>()
  const all = [
    ...KEYBOARD_ROWS.flat(),
    ...NAV_CLUSTER.flat(),
    ...ARROW_CLUSTER.flat().filter((def): def is KeyDef => def !== null),
  ]
  for (const def of all) counts.set(def.key, (counts.get(def.key) ?? 0) + 1)
  return counts
}

/**
 * Splits a bound command into the steps it would run in order (Quake II
 * chains multiple commands in one bind with `;`). This is the "resolved
 * alias chain" test mode shows - there is no separate alias-definition map
 * in the profile model yet, so a bind's own command string is the full
 * chain there is to resolve.
 */
export function resolveAliasChain(command: string | undefined): string[] {
  if (!command) return []
  return command
    .split(';')
    .map((step) => step.trim())
    .filter((step) => step.length > 0)
}

/**
 * Maps a captured `KeyboardEvent` to the Quake II key name it would bind as.
 * Keyed by `event.code` (physical position) rather than `event.key` so the
 * mapping is layout-independent, matching how `bind` addresses physical keys.
 */
const CODE_TO_QUAKE_KEY: Record<string, string> = {
  Escape: 'ESCAPE',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
  Pause: 'PAUSE',
  Backquote: '`',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  Digit0: '0',
  Minus: '-',
  Equal: '=',
  Backspace: 'BACKSPACE',
  Tab: 'TAB',
  KeyQ: 'q',
  KeyW: 'w',
  KeyE: 'e',
  KeyR: 'r',
  KeyT: 't',
  KeyY: 'y',
  KeyU: 'u',
  KeyI: 'i',
  KeyO: 'o',
  KeyP: 'p',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  KeyA: 'a',
  KeyS: 's',
  KeyD: 'd',
  KeyF: 'f',
  KeyG: 'g',
  KeyH: 'h',
  KeyJ: 'j',
  KeyK: 'k',
  KeyL: 'l',
  Semicolon: ';',
  Quote: "'",
  Enter: 'ENTER',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  KeyZ: 'z',
  KeyX: 'x',
  KeyC: 'c',
  KeyV: 'v',
  KeyB: 'b',
  KeyN: 'n',
  KeyM: 'm',
  Comma: ',',
  Period: '.',
  Slash: '/',
  ControlLeft: 'CTRL',
  ControlRight: 'CTRL',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  Space: 'SPACE',
  Insert: 'INS',
  Delete: 'DEL',
  Home: 'HOME',
  End: 'END',
  PageUp: 'PGUP',
  PageDown: 'PGDN',
  ArrowUp: 'UPARROW',
  ArrowDown: 'DOWNARROW',
  ArrowLeft: 'LEFTARROW',
  ArrowRight: 'RIGHTARROW',
}

export function resolveQuakeKeyName(event: Pick<KeyboardEvent, 'code'>): string | null {
  return CODE_TO_QUAKE_KEY[event.code] ?? null
}
