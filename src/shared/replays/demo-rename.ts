/**
 * Demo rename validation — pure. A demo's file name is user-editable via its stem (the file name
 * minus its recognised demo extension); this module extracts that extension and validates a
 * candidate replacement stem against filesystem-safety rules, reporting the first violated rule
 * as an i18n-friendly reason (never prose).
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC,
 * no electron.
 */

const DEMO_EXTENSIONS = ['.dm2.gz', '.mvd2.gz', '.dm2', '.mvd2'] as const

function asciiLower(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]
  }
  return out
}

function endsWithCi(s: string, suffix: string): boolean {
  return s.length >= suffix.length && asciiLower(s.slice(s.length - suffix.length)) === suffix
}

/**
 * Returns the trailing recognised demo extension (`.dm2`, `.mvd2`, `.dm2.gz`, `.mvd2.gz`), matched
 * case-insensitively but returned in `fileName`'s own original case. The `.gz` forms are checked
 * first so `.dm2.gz` isn't mistaken for a bare `.gz`. Returns `''` if nothing recognised matches.
 */
export function demoExtension(fileName: string): string {
  for (const ext of DEMO_EXTENSIONS) {
    if (endsWithCi(fileName, ext)) return fileName.slice(fileName.length - ext.length)
  }
  return ''
}

export const DEMO_RENAME_MAX_STEM = 100

export type DemoRenameReason =
  | 'empty'
  | 'separator'
  | 'dotDot'
  | 'invalidChar'
  | 'trailingDotOrSpace'
  | 'reserved'
  | 'tooLong'

export type ValidateDemoRenameResult =
  | { ok: true; fileName: string }
  | { ok: false; reason: DemoRenameReason; params?: Record<string, string | number> }

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

function fail(reason: DemoRenameReason, params?: Record<string, string | number>): ValidateDemoRenameResult {
  return params === undefined ? { ok: false, reason } : { ok: false, reason, params }
}

/**
 * Validates a candidate rename stem against `currentFileName`'s recognised extension. Checks run
 * in a fixed order (empty, separator, dotDot, invalidChar, trailingDotOrSpace, reserved, tooLong)
 * so the first violated rule is the one reported. On success, returns the file name to use:
 * `stem + ext`, with `ext` in its original case as extracted from `currentFileName`.
 */
export function validateDemoRename(stem: string, currentFileName: string): ValidateDemoRenameResult {
  const ext = demoExtension(currentFileName)

  let s = stem.trim()
  if (ext !== '' && endsWithCi(s, ext)) {
    s = s.slice(0, s.length - ext.length)
  }

  if (s.length === 0) return fail('empty')

  if (s.includes('/') || s.includes('\\')) return fail('separator')

  if (s.includes('..')) return fail('dotDot')

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const code = s.charCodeAt(i)
    if (INVALID_CHARS.includes(ch) || (code >= 0 && code <= 0x1f)) {
      return fail('invalidChar', { char: ch })
    }
  }

  if (s.endsWith('.') || s.endsWith(' ')) return fail('trailingDotOrSpace')

  const dotIndex = s.indexOf('.')
  const namePart = dotIndex === -1 ? s : s.slice(0, dotIndex)
  if (RESERVED_NAMES.has(namePart.toUpperCase())) {
    return fail('reserved', { name: namePart })
  }

  if (s.length > DEMO_RENAME_MAX_STEM) return fail('tooLong', { max: DEMO_RENAME_MAX_STEM })

  return { ok: true, fileName: s + ext }
}
