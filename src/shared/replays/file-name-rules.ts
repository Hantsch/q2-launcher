/**
 * Filesystem-safety rules shared by every user-typed file or folder name — pure (no node, DOM or
 * electron). Callers decide the order the rules run in and which refusal key each maps to.
 */

const INVALID_CHARS = '<>:"|?*'

const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

/** The first character Windows (or a control character) forbids in a name, or `null`. */
export function firstInvalidChar(s: string): string | null {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (INVALID_CHARS.includes(s[i]) || (code >= 0 && code <= 0x1f)) return s[i]
  }
  return null
}

export function endsWithDotOrSpace(s: string): boolean {
  return s.endsWith('.') || s.endsWith(' ')
}

/** The reserved Windows device name `s` collides with (the part before the first dot), or `null`. */
export function reservedNameIn(s: string): string | null {
  const dotIndex = s.indexOf('.')
  const namePart = dotIndex === -1 ? s : s.slice(0, dotIndex)
  return RESERVED_NAMES.has(namePart.toUpperCase()) ? namePart : null
}
