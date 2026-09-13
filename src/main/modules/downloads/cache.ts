import { readdir, stat, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { ArchiveCacheStatus, ClearArchiveCacheResult } from '@shared/modules/downloads'
import { getDownloadsCacheDir, isSafeDownloadFileName, PART_SUFFIX } from './paths'
import { MANIFEST_CACHE_FILE_NAME } from './manifest-service'

/**
 * The archive cache - story 072 D3 (AC3, AC4, AC5, AC6).
 *
 * This is the only code in the launcher that deletes files inside the user's data directory, so
 * the file is built around one rule and one code path:
 *
 *  - **one rule** - `isEvictableCacheFileName()` below decides, for every function here, whether a
 *    name may ever be deleted. `status()` counts exactly what an eviction could remove, and
 *    `clear()` removes exactly what `status()` counted, because both ask that same predicate.
 *  - **one code path** - `planEviction()` is pure and decides *what* goes; `enforceBudget()` is the
 *    only thing that unlinks; `clear()` is `enforceBudget()` with a budget of zero. There is no
 *    second place that could learn a slightly different idea of "evictable" (Decisions (Sprint):
 *    "`clearCache` deletes only evictable entries ... so AC4's stated size/count and the actual
 *    deletion cannot disagree").
 *
 * Layout and path safety are not re-implemented here: `./paths.ts` (story 071 D2) already owns
 * `userData/cache/downloads`, the `.part` suffix and the refuse-unless-boring file-name check.
 * `src/main/lib/paths.ts` is deliberately left untouched - its `userDataDir()` is what the module
 * already passes in as `userDataPath` (`./index.ts:90`), and a second `downloadsCacheDir()` there
 * would be a second definition of a directory this code deletes files from.
 */

/**
 * One file in the cache directory, as far as an eviction decision is concerned. Deliberately the
 * three facts and nothing else - a name to delete by, bytes to count against the budget, and an
 * mtime to order by - so that `planEviction()` can be exercised without a filesystem.
 */
export interface CacheEntry {
  /** Bare file name inside the cache directory; never a path. */
  fileName: string
  sizeBytes: number
  /** Last-modified time in epoch ms. Oldest goes first (AC5). */
  mtimeMs: number
}

/** Reports whether an archive is claimed by a running job. [[071]]/[[074]] supply the real one. */
export type IsInUse = (fileName: string) => boolean

/** This story's production provider: nothing is claimed yet, so nothing is protected by it. */
export const NOTHING_IN_USE: IsInUse = () => false

export interface PlanEvictionInput {
  entries: CacheEntry[]
  /** Size ceiling for the evictable part of the cache, in bytes. */
  budgetBytes: number
  isInUse: IsInUse
}

/** Only `warn`/`debug` are used; a module's scoped logger satisfies this structurally. */
export interface CacheLog {
  warn(message: string): void
  debug(message: string): void
}

export interface CacheFsInput {
  userDataPath: string
  isInUse?: IsInUse
  log?: CacheLog
}

export interface EnforceBudgetInput extends CacheFsInput {
  budgetBytes: number
}

/**
 * Whether a name in the cache directory may ever be deleted. Two carve-outs, both absolute:
 *
 *  - **`*.part`** - an in-flight, unverified download. Deleting one eats the archive of a running
 *    job, which is the exact failure this whole file is careful about. Note that the suffix comes
 *    from `./paths.ts` rather than a literal, so the two halves cannot drift apart.
 *  - **the manifest cache file** - `./manifest-service.ts` stores its offline-fallback manifest at
 *    the same `userData/cache/downloads/` directory (`MANIFEST_CACHE_FILE_NAME`), and its name
 *    passes `isSafeDownloadFileName()` like any other boring name. It is not an archive the download
 *    pipeline wrote, so it must never be counted or deleted here - doing so would destroy the exact
 *    offline fallback `ManifestUnavailableError` exists to prevent losing.
 *  - **anything the download pipeline could not have written** - `isSafeDownloadFileName()` is the
 *    gate every path builder in `./paths.ts` passes before a byte is written, so a name it rejects
 *    was put there by something else (a stray `.tmp`, a user's own copy). We do not know what it
 *    is, therefore we do not delete it.
 *
 * A rejected name is also excluded from `status()` and from the budget total, so the size the user
 * is shown, the size the budget is compared against, and the size a clear frees are one number.
 */
export function isEvictableCacheFileName(fileName: string): boolean {
  if (fileName.endsWith(PART_SUFFIX)) return false
  if (fileName === MANIFEST_CACHE_FILE_NAME) return false
  return isSafeDownloadFileName(fileName)
}

/** Non-negative, finite byte count; a `stat` can in principle hand us neither. */
function sizeOf(entry: CacheEntry): number {
  return Number.isFinite(entry.sizeBytes) && entry.sizeBytes > 0 ? entry.sizeBytes : 0
}

function sumBytes(entries: CacheEntry[]): number {
  return entries.reduce((total, entry) => total + sizeOf(entry), 0)
}

/**
 * Picks the entries to evict so that what remains fits inside `budgetBytes` (AC5): oldest `mtimeMs`
 * first, stopping the moment the remainder is at or under the budget - so a cache one byte over its
 * budget loses one archive, not two.
 *
 * Pure by design, which is what makes AC5's guarantee testable exhaustively: no `fs`, no clock, no
 * randomness. Everything it knows arrives in `entries`.
 *
 * Protected entries (see `isEvictableCacheFileName`, plus anything `isInUse` claims) are excluded
 * from consideration *entirely* - they are never evicted, and their bytes are not counted against
 * the budget either. The second half matters: were their bytes counted, a single 6 GB in-flight
 * `.part` under a 5 GB budget would evict the entire verified cache and still be over budget,
 * i.e. destroy every cached archive for no gain. The budget therefore governs the evictable cache -
 * the same set `status()` reports - and an entry re-enters it as soon as it stops being protected
 * (a `.part` loses its suffix on promotion).
 *
 * Consequently a budget that cannot be met is met as far as it can be: everything evictable goes,
 * nothing protected does, no matter what the budget says.
 */
export function planEviction({ entries, budgetBytes, isInUse }: PlanEvictionInput): CacheEntry[] {
  // A budget we cannot compare against (NaN, ±Infinity) must not be read as "delete everything":
  // `total <= NaN` is false for every total, which would evict the whole cache. Keep the files.
  if (!Number.isFinite(budgetBytes)) return []
  const ceiling = Math.max(0, budgetBytes)

  const candidates = entries.filter(
    (entry) => isEvictableCacheFileName(entry.fileName) && !isInUse(entry.fileName),
  )

  let remaining = sumBytes(candidates)
  if (remaining <= ceiling) return []

  // Oldest first; the name breaks a tie so that two files written in the same millisecond still
  // produce one stable, reproducible plan rather than whatever order `readdir` happened to give.
  const oldestFirst = [...candidates].sort(
    (a, b) => a.mtimeMs - b.mtimeMs || a.fileName.localeCompare(b.fileName),
  )

  const evict: CacheEntry[] = []
  for (const entry of oldestFirst) {
    if (remaining <= ceiling) break
    evict.push(entry)
    remaining -= sizeOf(entry)
  }
  return evict
}

/**
 * Reads every regular file in the cache directory with its size and mtime. A missing directory (or
 * any other read failure) is an empty cache, not an error - the directory is created on the first
 * download, so "not there yet" is the normal state of a fresh install, and `status()` must answer
 * zero for it rather than throw.
 *
 * Directories and symlinks are skipped: `readdir`'s dirents do not follow links, so a link reports
 * as neither file nor directory here and drops out. Nothing in this file ever removes a directory.
 */
async function readCacheEntries(dir: string, log?: CacheLog): Promise<CacheEntry[]> {
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const entries: CacheEntry[] = []
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue
    try {
      const stats = await stat(join(dir, dirent.name))
      entries.push({ fileName: dirent.name, sizeBytes: stats.size, mtimeMs: stats.mtimeMs })
    } catch {
      // Vanished between readdir and stat (a finishing download renaming its `.part`, say).
      // It is not on disk any more, so it is not part of the cache we are measuring.
      log?.debug(`cache entry ${dirent.name} disappeared while it was being measured`)
    }
  }
  return entries
}

/**
 * The archive cache's current size and item count (AC3), over exactly the entries an eviction or a
 * clear could remove - `ArchiveCacheStatus`'s contract ("every evictable archive currently on
 * disk", `@shared/modules/downloads.ts`). Zero and empty for a cache directory that does not exist
 * yet.
 */
export async function status({
  userDataPath,
  isInUse = NOTHING_IN_USE,
  log,
}: CacheFsInput): Promise<ArchiveCacheStatus> {
  const dir = getDownloadsCacheDir(userDataPath)
  const entries = await readCacheEntries(dir, log)
  const evictable = entries.filter(
    (entry) => isEvictableCacheFileName(entry.fileName) && !isInUse(entry.fileName),
  )
  return { totalBytes: sumBytes(evictable), itemCount: evictable.length }
}

/**
 * Brings the cache down to `budgetBytes` by deleting the oldest evictable archives (AC5). Called
 * when the budget is lowered and after a clear (Decisions (Sprint)); there is no periodic sweeper.
 *
 * The only place in the launcher that unlinks a file under `userData`. Returns what it *actually*
 * removed: a file that could not be deleted (locked by another process, gone already) is skipped
 * and not counted, so the number a caller reports can never be larger than the number of bytes the
 * user got back.
 */
export async function enforceBudget({
  userDataPath,
  budgetBytes,
  isInUse = NOTHING_IN_USE,
  log,
}: EnforceBudgetInput): Promise<ClearArchiveCacheResult> {
  const dir = getDownloadsCacheDir(userDataPath)
  const entries = await readCacheEntries(dir, log)
  const planned = planEviction({ entries, budgetBytes, isInUse })

  let removedBytes = 0
  let removedCount = 0
  for (const entry of planned) {
    // Defence in depth. `planEviction` has already applied both carve-outs and every name came
    // from a `readdir` of this very directory - but this is the statement that actually deletes,
    // so it re-checks the rule itself instead of trusting the plan it was handed, and refuses any
    // name that does not resolve to a direct child of the cache directory.
    if (!isEvictableCacheFileName(entry.fileName) || isInUse(entry.fileName)) {
      log?.warn(`refused to evict protected cache entry ${entry.fileName}`)
      continue
    }
    const target = resolve(dir, entry.fileName)
    if (dirname(target) !== resolve(dir)) {
      log?.warn(`refused to evict ${entry.fileName}: not a direct child of the cache directory`)
      continue
    }

    try {
      await unlink(target)
    } catch (error) {
      log?.warn(`cache entry ${entry.fileName} could not be evicted: ${String(error)}`)
      continue
    }
    removedBytes += sizeOf(entry)
    removedCount += 1
  }

  if (removedCount > 0) {
    log?.debug(`evicted ${removedCount} cache entries (${removedBytes} bytes)`)
  }
  return { removedBytes, removedCount }
}

/**
 * Empties the archive cache of everything that may be deleted and reports exactly what went (AC4).
 * A `*.part` file and anything a running job claims stay - deliberately the same exclusion the
 * budget path uses, because this *is* the budget path: a budget of zero plans every unprotected
 * entry for eviction and nothing else.
 */
export async function clear(input: CacheFsInput): Promise<ClearArchiveCacheResult> {
  return enforceBudget({ ...input, budgetBytes: 0 })
}
