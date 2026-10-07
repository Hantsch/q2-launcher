/**
 * Demo rename validation — pure. A demo's file name is user-editable via its stem (the file name
 * minus its recognised demo extension); this module extracts that extension and validates a
 * candidate replacement stem against filesystem-safety rules, reporting the first violated rule
 * as an i18n-friendly reason (never prose).
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC,
 * no electron.
 */

import { refuse, type DomainResult } from '../types/common'
import { endsWithDotOrSpace, firstInvalidChar, reservedNameIn } from './file-name-rules'

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

export type DemoRenameRefusalKey =
  | 'replays.rename.error.empty'
  | 'replays.rename.error.separator'
  | 'replays.rename.error.dotDot'
  | 'replays.rename.error.invalidChar'
  | 'replays.rename.error.trailingDotOrSpace'
  | 'replays.rename.error.reserved'
  | 'replays.rename.error.tooLong'

export type ValidateDemoRenameResult = DomainResult<{ fileName: string }, DemoRenameRefusalKey>

/**
 * Validates a candidate rename stem against `currentFileName`'s recognised extension. Checks run
 * in a fixed order (empty, separator, dotDot, invalidChar, trailingDotOrSpace, reserved, tooLong)
 * so the first violated rule is the one reported. On success, returns the file name to use:
 * `stem + ext`, with `ext` in its original case as extracted from `currentFileName`.
 */
export function validateDemoRename(
  stem: string,
  currentFileName: string,
): ValidateDemoRenameResult {
  const ext = demoExtension(currentFileName)

  let s = stem.trim()
  if (ext !== '' && endsWithCi(s, ext)) {
    s = s.slice(0, s.length - ext.length)
  }

  if (s.length === 0) return refuse('replays.rename.error.empty')

  if (s.includes('/') || s.includes('\\')) return refuse('replays.rename.error.separator')

  if (s.includes('..')) return refuse('replays.rename.error.dotDot')

  const badChar = firstInvalidChar(s)
  if (badChar !== null) return refuse('replays.rename.error.invalidChar', { char: badChar })

  if (endsWithDotOrSpace(s)) return refuse('replays.rename.error.trailingDotOrSpace')

  const reserved = reservedNameIn(s)
  if (reserved !== null) return refuse('replays.rename.error.reserved', { name: reserved })

  if (s.length > DEMO_RENAME_MAX_STEM)
    return refuse('replays.rename.error.tooLong', { max: DEMO_RENAME_MAX_STEM })

  return { ok: true, fileName: s + ext }
}
