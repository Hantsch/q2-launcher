import { homedir } from 'node:os'
import type {
  DownloadDiagnostics,
  DownloadDiagnosticsPackage,
  DownloadDiagnosticsTarget,
} from '@shared/modules/downloads'
import type { Job } from '@shared/types'
import type { BootstrapLog } from './bootstrap/ports'

/**
 * Story 075 D2: redaction, the collector that builds up one job's `DownloadDiagnostics` while it
 * runs, and the module-scoped registry that hands the finished record to `failureFor()`
 * (`index.ts`).
 *
 * `Job` is broadcast on every `jobs:changed` tick to every job surface in the app (Decisions
 * (Refine)) - diagnostics are deliberately *not* a field on it. Instead this registry holds the
 * in-progress record keyed by `jobId`, and `diagnosticsFor(job)` assembles the final
 * `DownloadDiagnostics` once the job has reached a terminal state - `startedAt`/`finishedAt`/
 * `errorKey` come from the job itself at that point, never duplicated into the collector.
 */

/** Placeholder a redacted home-directory prefix is replaced with. Never a real account name. */
export const HOME_PLACEHOLDER = '<home>'

/** Bounds `tee()`'s in-memory ring - "the tail of the job's own log lines" (AC3), not the whole
 * log. Oldest lines fall off the front as new ones arrive. */
export const DIAGNOSTICS_LOG_TAIL_LINES = 200

/** The reason attached when a job reaches `failed` with no `error` of its own - mirrors
 * `index.ts`'s `UNKNOWN_DOWNLOAD_FAILURE_KEY` (re-exported from there); not a member of
 * `DOWNLOADS_ERROR_KEYS`, which enumerates reasons the pipeline itself produces. */
export const UNKNOWN_DOWNLOAD_FAILURE_KEY = 'downloads.error.unknown'

function stripTrailingSeparators(value: string): string {
  let out = value
  while (out.length > 0 && (out.endsWith('\\') || out.endsWith('/'))) {
    out = out.slice(0, -1)
  }
  return out
}

/**
 * Replaces a leading `homeDir` segment of `value` with `HOME_PLACEHOLDER`, so a captured path
 * never carries a real account name (AC4). Redaction happens at capture time, in main
 * (Decisions (Refine)) - callers redact before anything reaches the registry, not later when a
 * report is assembled.
 *
 * - Case-insensitive on win32 (drive letter / path casing differences), case-sensitive
 *   elsewhere - the same convention `pathKey()` (`../../lib/fs-utils.ts`) already uses for "is
 *   this the same folder?" comparisons.
 * - A `value` outside `homeDir` is a prefix miss and comes back byte-identical.
 * - Never a partial match against a sibling directory: `C:\Users\bobby` is not treated as inside
 *   `C:\Users\bob` - whatever immediately follows a matched occurrence must not be a character
 *   that would extend the same path segment (a letter, a digit, `-` or `_`).
 * - Every occurrence is replaced, not just a leading one - `tee()` feeds this whole prose log
 *   lines, not just bare path values, and a home-directory path can appear mid-sentence in one
 *   (e.g. `"extracting to C:\Users\bob\AppData\..."`).
 * - Because those lines are arbitrary prose, the boundary is *anything* that cannot continue the
 *   segment, not just a separator or the end of the string: a home path followed directly by
 *   `:`, `)`, `,`, `.` or a newline is still redacted. Erring towards over-redaction here is
 *   deliberate - AC4 is a privacy guarantee, and an over-redacted sibling costs a reader nothing
 *   while an under-redacted one ships a real Windows account name into a public issue.
 * - Separators inside `homeDir` match any run of `\` or `/`, so the same home directory is found
 *   in its forward-slash form (`C:/Users/bob/...`) and in a JSON-escaped log line
 *   (`C:\\Users\\bob`), not only in the exact form `os.homedir()` happens to return.
 */
export function redactHome(value: string, homeDir: string = homedir()): string {
  const home = stripTrailingSeparators(homeDir)
  if (home.length === 0) return value

  const caseInsensitive = process.platform === 'win32'
  const pattern = new RegExp(
    `${homeDirPattern(home)}(?![A-Za-z0-9_-])`,
    caseInsensitive ? 'gi' : 'g',
  )
  return value.replace(pattern, HOME_PLACEHOLDER)
}

/** Builds the regex source matching `home` with every separator run generalised to `[\\/]+`. */
function homeDirPattern(home: string): string {
  return home.split(/[\\/]+/).map(escapeForRegExp).join('[\\\\/]+')
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface DiagnosticsEntry {
  kind: string
  packages: DownloadDiagnosticsPackage[]
  target?: DownloadDiagnosticsTarget
  logTail: string[]
}

/**
 * `Map<jobId, DownloadDiagnostics>` per the Decisions - held as this narrower `DiagnosticsEntry`
 * instead, since the fields that mirror `Job` (`startedAt`/`finishedAt`/`errorKey`) do not exist
 * yet while the job is still running; `diagnosticsFor()` completes the shape once it does.
 */
const registry = new Map<string, DiagnosticsEntry>()

export interface DiagnosticsCollector {
  /** Records one package the job touched, in the order it processed them. `pkg.url` is redacted
   * before it is stored. */
  recordPackage(pkg: DownloadDiagnosticsPackage): void
  /** Records the install target the job reached (AC2). `target.targetPath` is redacted before it
   * is stored. Calling this again replaces the previous target. */
  recordTarget(target: DownloadDiagnosticsTarget): void
  /** Wraps `log` so every line it writes still goes to `log` exactly as before, and is also
   * pushed (redacted) into this job's bounded log-tail ring. */
  tee<T extends BootstrapLog>(log: T): T
}

/**
 * Creates a fresh registry entry for `jobId` and returns the collector that builds it up. `kind`
 * mirrors `Job.kind` and is carried through to the finished `DownloadDiagnostics`.
 *
 * `homeDir` defaults to `os.homedir()` and exists only so tests can pass a fixed value instead of
 * depending on the machine actually running them.
 */
export function createDiagnosticsCollector(
  jobId: string,
  kind: string,
  homeDir: string = homedir(),
): DiagnosticsCollector {
  const entry: DiagnosticsEntry = { kind, packages: [], logTail: [] }
  registry.set(jobId, entry)

  function pushLine(line: string): void {
    entry.logTail.push(redactHome(line, homeDir))
    if (entry.logTail.length > DIAGNOSTICS_LOG_TAIL_LINES) {
      entry.logTail = entry.logTail.slice(entry.logTail.length - DIAGNOSTICS_LOG_TAIL_LINES)
    }
  }

  return {
    recordPackage(pkg) {
      entry.packages.push({ ...pkg, url: redactHome(pkg.url, homeDir) })
    },
    recordTarget(target) {
      entry.target = { ...target, targetPath: redactHome(target.targetPath, homeDir) }
    },
    tee(log) {
      return {
        ...log,
        info(message: string) {
          pushLine(message)
          log.info(message)
        },
        warn(message: string) {
          pushLine(message)
          log.warn(message)
        },
        ...(log.debug
          ? {
              debug(message: string) {
                pushLine(message)
                log.debug?.(message)
              },
            }
          : {}),
      }
    },
  }
}

/**
 * Assembles the finished `DownloadDiagnostics` for `job` from whatever the registry holds,
 * combined with the job's own terminal fields - `undefined` when no collector was ever created
 * for this job id (every failure not produced by an instrumented job, e.g. the single-package
 * pipeline - Decisions (Refine): "Scope: bootstrap jobs only").
 */
export function diagnosticsFor(job: Job): DownloadDiagnostics | undefined {
  const entry = registry.get(job.id)
  if (!entry) return undefined

  return {
    jobId: job.id,
    kind: entry.kind,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt ?? new Date().toISOString(),
    errorKey: job.error?.key ?? UNKNOWN_DOWNLOAD_FAILURE_KEY,
    packages: entry.packages,
    ...(entry.target ? { target: entry.target } : {}),
    logTail: entry.logTail,
  }
}

/** Drops `jobId`'s entry, if any. Called on any terminal job status (success or failure) so the
 * registry cannot grow unbounded across a session - a no-op when nothing was ever recorded for
 * this id. */
export function dropDiagnostics(jobId: string): void {
  registry.delete(jobId)
}

/** Test-only: the registry's current size, so a test can assert "left empty" without reaching
 * into module-private state any other way. */
export function diagnosticsRegistrySize(): number {
  return registry.size
}
