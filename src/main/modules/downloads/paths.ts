import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Story 071 D2: where a downloaded package lives while it is being fetched, and where it lives
 * once it has been verified (Decisions (Sprint), "Paths"):
 *
 * ```
 * userData/cache/downloads/<fileName>.part   in flight, unverified, deletable at any moment
 * userData/cache/downloads/<fileName>        verified - size and SHA256 matched the package
 * ```
 *
 * Every builder takes `userDataPath` as a parameter instead of calling
 * `app.getPath('userData')` itself. Two reasons, and the second is the important one:
 *
 *  - the tests (`fetcher.test.ts`, `verify.test.ts`) write real files, so they must be able to
 *    point the whole module at an `mkdtemp` directory without an Electron runtime; and
 *  - a scattered `app.getPath(...)` call is how a cache path quietly becomes two slightly
 *    different cache paths. There is exactly one place here that knows the layout.
 *
 * The caller for the real app is `src/main/lib/paths.ts`'s `userDataDir()` (D4).
 *
 * The `extract/<jobId>/` sibling directory named in the same decision belongs to the extraction
 * lifecycle (D3/D4) and is deliberately not built here.
 */

/** Under `userData`, so the whole cache can be dropped without touching `state.json`. */
export const DOWNLOADS_CACHE_SEGMENTS = ['cache', 'downloads'] as const

/** Suffix an in-flight, not-yet-verified file carries. Dropped on promotion. */
export const PART_SUFFIX = '.part'

/**
 * A `PackageSource.fileName` is foreign content: it arrives from a manifest fetched off the
 * internet, and it is used to build a path we then write to. So it is not a name that gets
 * sanitised, it is a name that gets *refused* unless it is a single, boring path segment:
 * ASCII letters/digits/`_`/`.`/`-`, starting with a letter or a digit.
 *
 * That single check rules out traversal (`..`, `../`), absolute paths and drive letters (`/`,
 * `\`, `:`), alternate data streams and leading dots/spaces in one go; NTFS reserved device
 * names (`CON`, `NUL`, `LPT1`, ...) would pass the pattern, so they are rejected separately
 * below, case-insensitively and extension-insensitively. Same shape as the mod directory token
 * in `docs/ARCHITECTURE.md`'s "Paths are never trusted".
 */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

/** NTFS refuses these as file names, with or without an extension. */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

/** Longest name accepted, leaving room for `.part` inside a 255-byte filesystem limit. */
const MAX_FILE_NAME_LENGTH = 200

export function isSafeDownloadFileName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_FILE_NAME_LENGTH) return false
  if (!SAFE_FILE_NAME.test(name)) return false
  if (name === '.' || name === '..') return false
  const stem = name.split('.')[0].toLowerCase()
  return !RESERVED_DEVICE_NAMES.has(stem)
}

/**
 * Thrown by the path builders for a name `isSafeDownloadFileName()` rejects. Carries a stable
 * `code` so a caller can tell it apart from a programming error without matching the message;
 * `fetcher.ts` catches it before any request is made and turns it into a failure key.
 */
export class UnsafeDownloadFileNameError extends Error {
  public readonly code = 'unsafe-download-file-name'

  constructor(fileName: string) {
    super(`refused download file name ${JSON.stringify(fileName)}: not a single safe path segment`)
    this.name = 'UnsafeDownloadFileNameError'
  }
}

/** `userData/cache/downloads`. */
export function getDownloadsCacheDir(userDataPath: string): string {
  return join(userDataPath, ...DOWNLOADS_CACHE_SEGMENTS)
}

/** `userData/cache/downloads/<fileName>` - the verified file. Throws on an unsafe name. */
export function getFinalPath(userDataPath: string, fileName: string): string {
  if (!isSafeDownloadFileName(fileName)) throw new UnsafeDownloadFileNameError(fileName)
  return join(getDownloadsCacheDir(userDataPath), fileName)
}

/** `userData/cache/downloads/<fileName>.part` - in flight. Throws on an unsafe name. */
export function getPartPath(userDataPath: string, fileName: string): string {
  return `${getFinalPath(userDataPath, fileName)}${PART_SUFFIX}`
}

/** Creates the cache directory if it does not exist yet and returns it. */
export async function ensureDownloadsCacheDir(userDataPath: string): Promise<string> {
  const dir = getDownloadsCacheDir(userDataPath)
  await mkdir(dir, { recursive: true })
  return dir
}
