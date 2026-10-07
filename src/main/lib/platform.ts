/**
 * The one place that asks which OS we run on. Every function reads `process.platform` at call
 * time (never a module-level constant) so tests can switch host via `stubPlatform`. (story 222)
 */

export function isWindows(): boolean {
  return process.platform === 'win32'
}

export function isLinux(): boolean {
  return process.platform === 'linux'
}

/** Linux filesystems are case-sensitive; Windows and macOS default to case-insensitive. */
export function isCaseInsensitiveFs(): boolean {
  return !isLinux()
}

/** Lowercases only on case-insensitive filesystems; no resolving or separator work. */
export function foldPathCase(value: string): string {
  return isCaseInsensitiveFs() ? value.toLowerCase() : value
}

/** `${base}.exe` on Windows, `otherName` everywhere else. */
export function executableFileName(base: string, otherName: string = base): string {
  return isWindows() ? `${base}.exe` : otherName
}
