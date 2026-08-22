/**
 * Quake II key-name layout data for the config module's keyboard overview
 * (concept doc §5 "Overview / keyboard", requirement CFG-7).
 *
 * Key names match the engine's own bind vocabulary (`Key_Names` in
 * `keys.c`): named keys are upper-case tokens (`ENTER`, `UPARROW`, `MOUSE1`),
 * printable keys are the literal ASCII character `bind` expects (lower-case
 * letters, digits, punctuation). SHIFT/CTRL/ALT are deliberately a single
 * name each - the engine does not distinguish left/right, so both physical
 * keys share one bind entry; editing one visually "doubly-bound" key affects
 * both (see `KeyBindDialog`'s `DOUBLY_PLACED_KEYS` note).
 */

import type { ConfigAction } from '@shared/modules/config'
import { aliasNameFor, commandLineFor } from '@shared/config/alias-render'

export interface KeyDef {
  /** The exact token used as a `profile.binds` key. */
  key: string
  /** Short label drawn on the keycap. */
  label: string
  /** Width in keycap units (1 unit = one standard key). Defaults to 1. */
  units?: number
  /**
   * M1/M2 only: render at the width that makes them, plus the gap between
   * them, exactly equal M3+M4+M5 plus their two gaps - keeps the wheel keys
   * (the third column in both mouse rows) pixel-aligned. The renderer
   * derives the exact width from its own key-unit/gap constants rather than
   * a value baked in here, since flex `gap` puts one more gap on the
   * three-key row than the two-key row above it.
   */
  wide?: boolean
  /** Numpad grid only: how many grid columns/rows this key spans. */
  colSpan?: number
  rowSpan?: number
}

const row = (defs: KeyDef[]): KeyDef[] => defs

/** An unlabelled, unbindable filler slot - reproduces a real keyboard's stagger and group gaps. */
const gap = (units = 1): KeyDef => ({ key: '', label: '', units })

const letterRow = (chars: string, extra: KeyDef[] = [], lead: KeyDef[] = []): KeyDef[] => [
  ...lead,
  ...chars.split('').map((char) => ({ key: char, label: char.toUpperCase() })),
  ...extra,
]

export const KEYBOARD_ROWS: KeyDef[][] = [
  row([
    { key: 'ESCAPE', label: 'Esc' },
    gap(0.75),
    { key: 'F1', label: 'F1' },
    { key: 'F2', label: 'F2' },
    { key: 'F3', label: 'F3' },
    { key: 'F4', label: 'F4' },
    gap(0.5),
    { key: 'F5', label: 'F5' },
    { key: 'F6', label: 'F6' },
    { key: 'F7', label: 'F7' },
    { key: 'F8', label: 'F8' },
    gap(0.5),
    { key: 'F9', label: 'F9' },
    { key: 'F10', label: 'F10' },
    { key: 'F11', label: 'F11' },
    { key: 'F12', label: 'F12' },
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
    [{ key: 'CAPSLOCK', label: 'Caps', units: 1.75 }],
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

/**
 * Pause leads the cluster in its own row, directly above Ins - on a real
 * board it sits above Insert/Home/PgUp (alongside PrtScn/ScrLk, which the
 * engine doesn't bind), not squeezed onto the end of the F-key row. Placing
 * it here rather than in `KEYBOARD_ROWS` keeps the main block's width tied
 * to its letter rows instead of stretching to fit a trailing Pause key.
 */
export const NAV_CLUSTER: KeyDef[][] = [
  row([{ key: 'PAUSE', label: 'Pause' }]),
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

/**
 * Two rows, left-to-right: left/right click plus wheel-up above M3/M4/M5
 * plus wheel-down. M1/M2 are `wide` - see `KeyDef.wide`.
 */
export const MOUSE_ROWS: KeyDef[][] = [
  [
    { key: 'MOUSE1', label: 'M1', wide: true },
    { key: 'MOUSE2', label: 'M2', wide: true },
    { key: 'MWHEELUP', label: '↑ Wheel' },
  ],
  [
    { key: 'MOUSE3', label: 'M3' },
    { key: 'MOUSE4', label: 'M4' },
    { key: 'MOUSE5', label: 'M5' },
    { key: 'MWHEELDOWN', label: '↓ Wheel' },
  ],
]

/**
 * Numpad key names use navigation semantics, not digits - the engine reads
 * the physical scancode regardless of Num Lock state, so `bind KP_HOME`
 * (not `KP_7`) is what a config actually contains.
 *
 * A flat list rather than rows: it renders into a 4-column CSS grid, so
 * KP_PLUS and KP_ENTER can genuinely span two rows like their real-keyboard
 * counterparts (`rowSpan: 2`) and KP_INS (`0`) can span two columns. Reading
 * order plus each span is enough for the grid's own auto-placement to lay
 * this out correctly - no explicit row/column indices needed.
 */
export const NUMPAD_KEYS: KeyDef[] = [
  { key: 'KP_NUMLOCK', label: 'Num' },
  { key: 'KP_SLASH', label: '/' },
  { key: 'KP_STAR', label: '*' },
  { key: 'KP_MINUS', label: '-' },
  { key: 'KP_HOME', label: '7' },
  { key: 'KP_UPARROW', label: '8' },
  { key: 'KP_PGUP', label: '9' },
  { key: 'KP_PLUS', label: '+', rowSpan: 2 },
  { key: 'KP_LEFTARROW', label: '4' },
  { key: 'KP_5', label: '5' },
  { key: 'KP_RIGHTARROW', label: '6' },
  { key: 'KP_END', label: '1' },
  { key: 'KP_DOWNARROW', label: '2' },
  { key: 'KP_PGDN', label: '3' },
  { key: 'KP_ENTER', label: 'Enter', rowSpan: 2 },
  { key: 'KP_INS', label: '0', colSpan: 2 },
  { key: 'KP_DEL', label: '.' },
]

/**
 * Splits a bound command into the steps it would run in order (Quake II
 * chains multiple commands in one bind with `;`). This is the "resolved
 * alias chain" test mode shows.
 *
 * Story 008 decision 18: a bind whose value is one of the Advanced tab's
 * generated action aliases is expanded to that action's actual command lines
 * instead of being shown as the bare alias token - otherwise the overview
 * would show `q2l_a_help_ab12` (or, since story 039, a readable name like
 * `ssg_sg`) instead of the real chain for exactly the binds this story
 * creates. `actions` defaults to `[]` so every pre-story-008 call site keeps
 * compiling and behaving exactly as before.
 *
 * Looked up directly against `actions` by `aliasNameFor` (story 039, D5)
 * rather than gated by the legacy `q2l_a_` prefix first: once an alias name
 * can be any short readable word the user typed, there is no prefix left to
 * gate on, and the lookup alone is exactly as precise - a value that is not
 * any action's alias name falls through to the plain split below, whether or
 * not it happens to look like a generated name.
 */
export function resolveAliasChain(
  command: string | undefined,
  actions: readonly ConfigAction[] = [],
): string[] {
  if (!command) return []
  const trimmed = command.trim()
  const action = actions.find((candidate) => aliasNameFor(candidate) === trimmed)
  if (action) {
    return action.commands.map(commandLineFor).filter((line) => line.trim().length > 0)
  }
  // Not any action's alias name - either a stale bind pointing at an action that no longer
  // exists, or a plain command/chain the user typed. Same graceful-degradation either way: fall
  // through to the plain `;` split.
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
  CapsLock: 'CAPSLOCK',
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
  NumLock: 'KP_NUMLOCK',
  NumpadDivide: 'KP_SLASH',
  NumpadMultiply: 'KP_STAR',
  NumpadSubtract: 'KP_MINUS',
  NumpadAdd: 'KP_PLUS',
  NumpadEnter: 'KP_ENTER',
  Numpad7: 'KP_HOME',
  Numpad8: 'KP_UPARROW',
  Numpad9: 'KP_PGUP',
  Numpad4: 'KP_LEFTARROW',
  Numpad5: 'KP_5',
  Numpad6: 'KP_RIGHTARROW',
  Numpad1: 'KP_END',
  Numpad2: 'KP_DOWNARROW',
  Numpad3: 'KP_PGDN',
  Numpad0: 'KP_INS',
  NumpadDecimal: 'KP_DEL',
}

export function resolveQuakeKeyName(event: Pick<KeyboardEvent, 'code'>): string | null {
  return CODE_TO_QUAKE_KEY[event.code] ?? null
}
