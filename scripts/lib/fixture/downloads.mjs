import { join } from 'node:path'
import { utimesSync, writeFileSync } from 'node:fs'
import { resetOwnedDir } from './core.mjs'

// --- downloads.ts DownloadsSettings shape + archive-cache fixture ----------
// Mirrors src/shared/modules/downloads.ts's `DownloadsSettings`/
// `DEFAULT_DOWNLOADS_SETTINGS` (2 / 5 GB / true) and
// src/main/lib/net/download-cache-paths.ts's `userData/cache/downloads/<fileName>` layout
// (verified files, no `.part` suffix).
//
// Story 072 D6: deliberately non-default on every field, so the
// `settings-downloads-section` flow's boot-side assertion (AC6) can tell "the fixture's
// seeded values" apart from "whatever DEFAULT_DOWNLOADS_SETTINGS would have rendered anyway".
/** Mirrors src/shared/modules/downloads.ts's `DownloadsSettings`. Exported so the flow asserts
 * against the exact seeded literals rather than a copy that could drift. */
export const DOWNLOADS_SETTINGS_SEED = {
  concurrentJobs: 4,
  archiveCacheBudgetGB: 10,
  downloadWhilePlayingAllowed: false,
}

/**
 * Two plain (non-`.part`) dummy archives under `userdata/cache/downloads/`, distinct sizes and
 * distinct mtimes - enough for `cacheStatus`'s sum/count (AC3) to be unambiguous without
 * exercising eviction ordering (D3/D4's unit tests already cover that exhaustively). Exported so
 * `scripts/flows/settings-downloads-section.mjs` asserts against the exact same literals.
 */
export const DOWNLOADS_CACHE_ARCHIVE_ONE = {
  fileName: 'fixture-archive-one.pk3',
  sizeBytes: 3 * 1024 * 1024,
  mtime: '2026-01-01T00:00:00.000Z',
}

export const DOWNLOADS_CACHE_ARCHIVE_TWO = {
  fileName: 'fixture-archive-two.pk3',
  sizeBytes: 1 * 1024 * 1024,
  mtime: '2026-01-02T00:00:00.000Z',
}

/** Total evictable bytes/count the two archives above sum to - what `cacheStatus` should report. */
export const DOWNLOADS_CACHE_TOTAL_BYTES =
  DOWNLOADS_CACHE_ARCHIVE_ONE.sizeBytes + DOWNLOADS_CACHE_ARCHIVE_TWO.sizeBytes

export const DOWNLOADS_CACHE_ITEM_COUNT = 2

/** Writes the two dummy archives above into `<userDataDir>/cache/downloads/`, each with its own
 * distinct mtime (`fs.utimesSync` - the only way to backdate a file Node itself just wrote). */
export function writeDownloadsCacheArchives(userDataDir) {
  const cacheDir = join(userDataDir, 'cache', 'downloads')
  resetOwnedDir(cacheDir)
  for (const archive of [DOWNLOADS_CACHE_ARCHIVE_ONE, DOWNLOADS_CACHE_ARCHIVE_TWO]) {
    const path = join(cacheDir, archive.fileName)
    writeFileSync(path, Buffer.alloc(archive.sizeBytes, 0))
    const mtime = new Date(archive.mtime)
    utimesSync(path, mtime, mtime)
  }
}
