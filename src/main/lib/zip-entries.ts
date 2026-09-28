import { spawn, type ChildProcess } from 'node:child_process'

/**
 * Story 143 D1: a bounded, read-only zip reader over the vendored 7-Zip.
 *
 * Spawn pattern mirrors `src/main/modules/downloads/extractor.ts`: arguments as an array,
 * `shell: false`, `windowsHide: true`, stdin ignored, and the extractor path resolved once by the
 * caller (`resolveExtractorPath()` in `7za-path.ts`) and handed in as plain data.
 *
 * Read-only by construction: the only 7-Zip commands used are `l` (list) and `e -so` (extract to
 * stdout) - never `a`/`u`/`d`/`x` and never `-o`, so nothing is ever written next to the archive or
 * into it. The only two computed argv slots are `archivePath` and `entryPath`; `--` precedes the
 * entry path so a name starting with `-` is never parsed as a switch, `-spd` turns off wildcard
 * matching so `b [1].dm2` means that exact name, and `-p-` supplies a dummy password so an
 * encrypted entry fails instead of 7-Zip prompting on a stdin nobody is attached to.
 *
 * Every call is bounded three ways - bytes on stdout, wall-clock time and exit status - and every
 * public function resolves exactly once and never rejects.
 */

/** The largest single entry `readZipEntry` will hold in memory. */
export const ZIP_ENTRY_MAX_BYTES = 64 * 1024 * 1024
/** The largest `-slt` listing `listZipEntries` will buffer before calling the archive hostile. */
export const ZIP_LISTING_MAX_BYTES = 8 * 1024 * 1024
/** Wall-clock budget for one 7-Zip call (list or read). */
export const ZIP_CALL_TIMEOUT_MS = 30_000

export interface ZipEntry {
  /** Path inside the archive, backslashes normalised to `/`. */
  path: string
  isFolder: boolean
  /** Uncompressed size, or `null` when 7-Zip did not report a parseable one. */
  size: number | null
  /** 7-Zip's `Modified` stamp read as local time, or `null`. */
  modified: Date | null
  encrypted: boolean
}

export interface ZipDeps {
  /** Resolved by the caller via `resolveExtractorPath()` (`7za-path.ts`). */
  extractorPath: string
  /** Whether `extractorPath` exists - checked once by the caller, never re-checked here. */
  extractorExists: boolean
  /** Test seam; defaults to `node:child_process`'s `spawn`. */
  spawn?: typeof spawn
}

export type ListZipEntriesResult =
  | { ok: true; entries: ZipEntry[] }
  | { ok: false; code: 'extractor-missing' | 'archive-unreadable' | 'archive-too-large' }

export type ReadZipEntryResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; code: 'entry-too-large' | 'unreadable' | 'extractor-missing' }

const MODIFIED_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/
const KEY_VALUE_PATTERN = /^([A-Za-z][A-Za-z ]*?) =(?: (.*))?$/

function parseModified(value: string): Date | null {
  const match = MODIFIED_PATTERN.exec(value.trim())
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const millis = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null
  }
  const date = new Date(year, month - 1, day, hour, minute, second, millis)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseSize(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const size = Number(trimmed)
  return Number.isSafeInteger(size) ? size : null
}

function toEntry(block: Map<string, string>): ZipEntry | null {
  const path = block.get('Path')
  if (path === undefined) return null
  return {
    path: path.replace(/\\/g, '/'),
    isFolder: block.get('Folder')?.trim() === '+',
    size: block.has('Size') ? parseSize(block.get('Size') ?? '') : null,
    modified: block.has('Modified') ? parseModified(block.get('Modified') ?? '') : null,
    encrypted: block.get('Encrypted')?.trim() === '+',
  }
}

/**
 * Parses `7za l -slt` output: blocks of `Key = Value` lines separated by blank lines. Unknown keys
 * are ignored, a block without `Path` is dropped, and nothing here throws - 7-Zip's text output is
 * not a stable contract, so an unexpected line is skipped rather than trusted.
 */
export function parseSltListing(text: string): ZipEntry[] {
  const entries: ZipEntry[] = []
  let block = new Map<string, string>()

  const flush = (): void => {
    const entry = toEntry(block)
    if (entry) entries.push(entry)
    block = new Map()
  }

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      flush()
      continue
    }
    const match = KEY_VALUE_PATTERN.exec(line)
    if (match) block.set(match[1], match[2] ?? '')
  }
  flush()

  return entries
}

type RunResult =
  | { kind: 'closed'; code: number | null; chunks: Buffer[]; total: number }
  | { kind: 'over-cap' }
  | { kind: 'failed' }

/**
 * Runs one 7-Zip call with a stdout byte cap and a wall-clock timeout. Settles exactly once: the
 * first of cap-exceeded, timeout, spawn error or `close` wins, and later events (e.g. the `close`
 * a `kill()` itself triggers) are ignored. `close` rather than `exit` marks completion because
 * `exit` can fire while stdout still holds unread data.
 */
function run7za(deps: ZipDeps, args: string[], maxBytes: number): Promise<RunResult> {
  const spawnFn = deps.spawn ?? spawn

  return new Promise<RunResult>((resolve) => {
    let child: ChildProcess
    try {
      child = spawnFn(deps.extractorPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch {
      resolve({ kind: 'failed' })
      return
    }

    let settled = false
    let chunks: Buffer[] = []
    let total = 0

    const settle = (result: RunResult, kill: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (kill) {
        try {
          child.kill()
        } catch {
          // Already gone - nothing left to stop.
        }
      }
      if (result.kind !== 'closed') chunks = []
      resolve(result)
    }

    const timer = setTimeout(() => settle({ kind: 'failed' }, true), ZIP_CALL_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      total += chunk.length
      if (total > maxBytes) {
        // The over-cap chunk is never retained: held bytes stay within the cap.
        settle({ kind: 'over-cap' }, true)
        return
      }
      chunks.push(chunk)
    })
    // stderr is drained and discarded so a chatty 7-Zip can never block on a full pipe.
    child.stderr?.resume()

    child.once('error', () => settle({ kind: 'failed' }, true))
    child.once('close', (code: number | null) =>
      settle({ kind: 'closed', code, chunks, total }, false),
    )
  })
}

/** Lists every entry of a zip. Never rejects. */
export async function listZipEntries(
  archivePath: string,
  deps: ZipDeps,
): Promise<ListZipEntriesResult> {
  if (!deps.extractorExists) return { ok: false, code: 'extractor-missing' }

  const result = await run7za(
    deps,
    ['l', '-slt', '-ba', '-sccUTF-8', '-tzip', '-p-', archivePath],
    ZIP_LISTING_MAX_BYTES,
  )
  if (result.kind === 'over-cap') return { ok: false, code: 'archive-too-large' }
  if (result.kind === 'failed' || result.code !== 0)
    return { ok: false, code: 'archive-unreadable' }

  return { ok: true, entries: parseSltListing(Buffer.concat(result.chunks).toString('utf8')) }
}

/**
 * Reads one entry's bytes. `expectedSize` is the size the listing reported; anything above
 * `ZIP_ENTRY_MAX_BYTES` is refused before spawning, a stream that runs past the cap anyway is
 * killed mid-flight, and a byte count that disagrees with `expectedSize` is unreadable. Never
 * rejects.
 */
export async function readZipEntry(
  archivePath: string,
  entryPath: string,
  expectedSize: number,
  deps: ZipDeps,
): Promise<ReadZipEntryResult> {
  if (!deps.extractorExists) return { ok: false, code: 'extractor-missing' }
  if (expectedSize > ZIP_ENTRY_MAX_BYTES) return { ok: false, code: 'entry-too-large' }

  const result = await run7za(
    deps,
    ['e', '-so', '-spd', '-bd', '-sccUTF-8', '-tzip', '-p-', archivePath, '--', entryPath],
    ZIP_ENTRY_MAX_BYTES,
  )
  if (result.kind === 'over-cap') return { ok: false, code: 'entry-too-large' }
  if (result.kind === 'failed' || result.code !== 0 || result.total !== expectedSize) {
    return { ok: false, code: 'unreadable' }
  }

  return { ok: true, bytes: Buffer.concat(result.chunks, result.total) }
}
