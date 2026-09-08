import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fail, ok, type Outcome } from '@shared/types'

/**
 * Story 071 D3: the vendored 7-Zip extractor.
 *
 * Spawn pattern mirrors `src/main/services/launch.ts` (`spawn(cmd, args, { ... })`, arguments as
 * an array, `shell: false`, real events instead of buffering the whole process). This module
 * never re-verifies a file - that is D2's `verify.ts`/`fetcher.ts` job. Its own contract is
 * narrower and enforced at runtime, not just by the type checker: `extractArchive` only accepts
 * an archive whose `verified` field is the literal `true`. `markVerified()` is the only way to
 * produce that shape, so a raw string path (or an object with `verified: false`) is refused
 * before anything is spawned - see "extraction refuses an unverified file" in
 * `extractor.test.ts`. This is a programmer-contract violation (the pipeline calling this module
 * wrong), not a user-facing failure, so it throws rather than resolving an `Outcome`.
 */

/**
 * Marks a path as having passed D2's verification. The only way to construct this shape -
 * callers cannot forge it by hand-writing `{ verified: true, path }` and expect the type checker
 * to help catch that, but `extractArchive` checks the flag at runtime too, defending against a
 * caller that bypasses the type system (e.g. via `any`).
 */
export interface VerifiedArchivePath {
  readonly verified: true
  readonly path: string
}

export function markVerified(path: string): VerifiedArchivePath {
  return { verified: true, path }
}

export interface ExtractArchiveInput {
  /** Must come from `markVerified()` - an arbitrary path is refused, see module doc comment. */
  archive: VerifiedArchivePath
  /** Absolute directory to extract into; built entirely in main, never renderer-shaped. */
  extractDir: string
  /** Resolved by `resolveExtractorPath()` (`7za-path.ts`). */
  extractorPath: string
  /** Whether `extractorPath` actually exists - checked once by the caller so this module never
   * has to import `node:fs` just to repeat that check. */
  extractorExists: boolean
  /** Called with the extract phase's progress ratio (0-1), or `undefined` when a stdout line did
   * not parse (indeterminate progress) rather than crashing. */
  onProgress?: (ratio: number | undefined) => void
}

export interface ExtractorHandle {
  /** Resolves once the process exits (or is refused/killed). Never rejects. */
  result: Promise<Outcome<void>>
  /** Kills the spawned 7za process, if any was started (used by D4's cancel). Safe to call even
   * before the process starts or after it has already exited. */
  kill: () => void
}

const NOOP_KILL = (): void => {}

/**
 * The fixed, exact argument shape (Decisions (Sprint), AC5) - `-o<dir>` and the archive path are
 * the only two computed slots, both absolute paths the caller already built. Never accept or
 * interpolate any other externally-sourced string into this array.
 */
function buildArgs(extractDir: string, archivePath: string): string[] {
  return ['x', '-y', '-bso0', '-bse1', '-bsp1', `-o${extractDir}`, archivePath]
}

export function extractArchive(input: ExtractArchiveInput): ExtractorHandle {
  const { archive, extractDir, extractorPath, extractorExists, onProgress } = input

  // Runtime contract check - see module doc comment. A `false`/missing `verified` flag is a bug
  // in the caller (D4's pipeline), not a user-facing failure, so this throws instead of failing.
  if (archive.verified !== true) {
    throw new TypeError('extractArchive: archive must be produced by markVerified()')
  }

  if (!extractorExists) {
    return { result: Promise.resolve(fail('downloads.error.extractorMissing')), kill: NOOP_KILL }
  }

  let child: ChildProcess | undefined

  const result = new Promise<Outcome<void>>((resolve) => {
    try {
      child = spawn(extractorPath, buildArgs(extractDir, archive.path), {
        cwd: extractDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch {
      resolve(fail('downloads.error.extractionFailed'))
      return
    }

    if (onProgress && child.stdout) {
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => onProgress(parseBsp1ProgressLine(line)))
    }

    child.once('error', () => {
      resolve(fail('downloads.error.extractionFailed'))
    })

    child.once('exit', (code) => {
      resolve(code === 0 ? ok(undefined) : fail('downloads.error.extractionFailed'))
    })
  })

  return {
    result,
    kill: () => child?.kill(),
  }
}

/**
 * Parses one line of `7za -bsp1` stdout into a 0-1 ratio. 7-Zip's `-bsp1` progress lines carry a
 * bare percentage (e.g. `" 45%"`, sometimes followed by a filename); when a line does not contain
 * a recognisable percentage, returns `undefined` (indeterminate) rather than throwing - 7-Zip's
 * exact output format is not a stable contract to depend on.
 */
export function parseBsp1ProgressLine(line: string): number | undefined {
  const match = /(\d{1,3})%/.exec(line)
  if (!match) return undefined

  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0 || value > 100) return undefined

  return value / 100
}
