import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pathExists } from '../../lib/fs-utils'
import {
  clear,
  enforceBudget,
  isEvictableCacheFileName,
  NOTHING_IN_USE,
  planEviction,
  status,
  type CacheEntry,
} from './cache'
import { MANIFEST_CACHE_FILE_NAME } from './manifest-service'
import { getDownloadsCacheDir, PART_SUFFIX } from './paths'

/**
 * Story 072 D3. This suite guards the only code in the launcher that deletes files inside the
 * user's data directory, so the fs-backed tests assert against real files in a real `mkdtemp`
 * directory (same fixture pattern as `verify.test.ts`) and always check the *directory listing*
 * afterwards, not just the return value: a function that reports the right numbers while removing
 * the wrong file would pass the former and fail the latter.
 *
 * `planEviction` is pure, so its own cases need no disk at all - which is the point of splitting it
 * out, since AC5's carve-outs are where an off-by-one would hurt.
 */

let userDataPath: string
let cacheDir: string

beforeEach(async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'q2-launcher-cache-'))
  cacheDir = getDownloadsCacheDir(userDataPath)
  await mkdir(cacheDir, { recursive: true })
})

afterEach(async () => {
  await rm(userDataPath, { recursive: true, force: true })
})

/** Writes an archive of exactly `sizeBytes` bytes with an exact mtime, so ordering is not a race. */
async function writeArchive(fileName: string, sizeBytes: number, mtimeMs: number): Promise<void> {
  const path = join(cacheDir, fileName)
  await writeFile(path, Buffer.alloc(sizeBytes, 0x71))
  const when = new Date(mtimeMs)
  await utimes(path, when, when)
}

async function listCache(): Promise<string[]> {
  return (await readdir(cacheDir)).sort()
}

const T0 = Date.UTC(2026, 0, 1)
const HOUR = 3_600_000

/** Four same-sized archives, oldest first: `old`, `mid`, `new`, `newest`. */
async function seedFourArchives(): Promise<void> {
  await writeArchive('old.zip', 100, T0)
  await writeArchive('mid.zip', 100, T0 + HOUR)
  await writeArchive('new.zip', 100, T0 + 2 * HOUR)
  await writeArchive('newest.zip', 100, T0 + 3 * HOUR)
}

function entry(fileName: string, sizeBytes: number, mtimeMs: number): CacheEntry {
  return { fileName, sizeBytes, mtimeMs }
}

describe('status', () => {
  it('status sums size and item count', async () => {
    await writeArchive('engine.zip', 100, T0)
    await writeArchive('demo.zip', 250, T0 + HOUR)
    await writeArchive('patch.zip', 7, T0 + 2 * HOUR)

    expect(await status({ userDataPath })).toEqual({ totalBytes: 357, itemCount: 3 })
  })

  it('reports an empty cache when the directory does not exist yet', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'q2-launcher-cache-fresh-'))
    try {
      expect(await status({ userDataPath: fresh })).toEqual({ totalBytes: 0, itemCount: 0 })
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })

  it('counts neither a .part file nor an entry a running job claims', async () => {
    await writeArchive('done.zip', 100, T0)
    await writeArchive(`inflight.zip${PART_SUFFIX}`, 4000, T0 + HOUR)
    await writeArchive('claimed.zip', 500, T0 + 2 * HOUR)

    // Everything `status` reports is everything a clear would free (AC3/AC4 agree by construction).
    expect(await status({ userDataPath, isInUse: (name) => name === 'claimed.zip' })).toEqual({
      totalBytes: 100,
      itemCount: 1,
    })
  })

  it('does not count the manifest cache file as an archive', async () => {
    await writeArchive('engine.zip', 100, T0)
    await writeArchive(MANIFEST_CACHE_FILE_NAME, 5000, T0 + HOUR)

    expect(await status({ userDataPath })).toEqual({ totalBytes: 100, itemCount: 1 })
  })

  it('ignores subdirectories', async () => {
    await writeArchive('engine.zip', 100, T0)
    await mkdir(join(cacheDir, 'extract'), { recursive: true })
    await writeFile(join(cacheDir, 'extract', 'q2.exe'), Buffer.alloc(9000))

    expect(await status({ userDataPath })).toEqual({ totalBytes: 100, itemCount: 1 })
  })
})

describe('the cache location', () => {
  it('the cache lives under userData/cache/downloads', async () => {
    expect(cacheDir).toBe(join(userDataPath, 'cache', 'downloads'))

    // A file elsewhere under userData is not part of the cache and is not touched by a clear.
    const outsider = join(userDataPath, 'state.json')
    await writeFile(outsider, '{}')
    await mkdir(join(userDataPath, 'cache'), { recursive: true })
    const cacheSibling = join(userDataPath, 'cache', 'other.zip')
    await writeFile(cacheSibling, Buffer.alloc(64))
    await writeArchive('engine.zip', 100, T0)

    expect(await status({ userDataPath })).toEqual({ totalBytes: 100, itemCount: 1 })
    expect(await clear({ userDataPath })).toEqual({ removedBytes: 100, removedCount: 1 })

    expect(await listCache()).toEqual([])
    expect(await pathExists(outsider)).toBe(true)
    expect(await pathExists(cacheSibling)).toBe(true)
  })
})

describe('enforceBudget', () => {
  it('eviction removes the oldest archives first', async () => {
    await seedFourArchives()

    // 400 bytes cached, 250 allowed: the two oldest have to go, and only those two.
    const result = await enforceBudget({ userDataPath, budgetBytes: 250 })

    expect(result).toEqual({ removedBytes: 200, removedCount: 2 })
    expect(await listCache()).toEqual(['new.zip', 'newest.zip'])
  })

  it('stops as soon as the remainder fits the budget', async () => {
    await seedFourArchives()

    // One byte over: exactly one archive is worth deleting, not two.
    const result = await enforceBudget({ userDataPath, budgetBytes: 399 })

    expect(result).toEqual({ removedBytes: 100, removedCount: 1 })
    expect(await listCache()).toEqual(['mid.zip', 'new.zip', 'newest.zip'])
  })

  it('removes nothing when the cache already fits', async () => {
    await seedFourArchives()

    expect(await enforceBudget({ userDataPath, budgetBytes: 400 })).toEqual({
      removedBytes: 0,
      removedCount: 0,
    })
    expect(await listCache()).toEqual(['mid.zip', 'new.zip', 'newest.zip', 'old.zip'])
  })

  it('an archive in use by a running job is never evicted', async () => {
    await seedFourArchives()

    // The oldest archive is claimed, so eviction has to skip it and take the next-oldest ones -
    // and it must not "make up" for the skipped one by stopping early either.
    const result = await enforceBudget({
      userDataPath,
      budgetBytes: 100,
      isInUse: (name) => name === 'old.zip',
    })

    // 300 evictable bytes down to 100: two of the three unprotected archives go, the claimed one
    // stays even though it is the oldest and the budget is still exceeded with it counted.
    expect(result).toEqual({ removedBytes: 200, removedCount: 2 })
    expect(await listCache()).toEqual(['newest.zip', 'old.zip'])
  })

  it('never evicts a claimed archive even at a zero budget', async () => {
    await seedFourArchives()

    const result = await enforceBudget({
      userDataPath,
      budgetBytes: 0,
      isInUse: (name) => name === 'mid.zip' || name === 'newest.zip',
    })

    expect(result).toEqual({ removedBytes: 200, removedCount: 2 })
    expect(await listCache()).toEqual(['mid.zip', 'newest.zip'])
  })

  it('*.part files are never removed', async () => {
    // The `.part` file is both the oldest and by far the largest - the single entry a size- or
    // age-driven eviction would reach for first if the carve-out were missing.
    await writeArchive(`inflight.zip${PART_SUFFIX}`, 5000, T0 - HOUR)
    await seedFourArchives()

    const result = await enforceBudget({ userDataPath, budgetBytes: 0 })

    expect(result).toEqual({ removedBytes: 400, removedCount: 4 })
    expect(await listCache()).toEqual([`inflight.zip${PART_SUFFIX}`])
    expect(await pathExists(join(cacheDir, `inflight.zip${PART_SUFFIX}`))).toBe(true)
  })

  it('leaves a file the download pipeline could not have written alone', async () => {
    // Names `isSafeDownloadFileName` refuses were not put there by this app, so we do not delete
    // them - and they are not counted as cache either.
    await writeArchive('my archive.zip', 800, T0 - HOUR)
    await writeArchive('_leftover.tmp', 900, T0 - HOUR)
    await writeArchive('engine.zip', 100, T0)

    expect(await status({ userDataPath })).toEqual({ totalBytes: 100, itemCount: 1 })
    expect(await enforceBudget({ userDataPath, budgetBytes: 0 })).toEqual({
      removedBytes: 100,
      removedCount: 1,
    })
    expect(await listCache()).toEqual(['_leftover.tmp', 'my archive.zip'])
  })

  it('never evicts the manifest cache file, alongside real archives that do get evicted', async () => {
    await writeArchive('old.zip', 100, T0 - HOUR)
    await writeArchive(MANIFEST_CACHE_FILE_NAME, 5000, T0 - 2 * HOUR)

    const result = await enforceBudget({ userDataPath, budgetBytes: 0 })

    expect(result).toEqual({ removedBytes: 100, removedCount: 1 })
    expect(await listCache()).toEqual([MANIFEST_CACHE_FILE_NAME])
    expect(await pathExists(join(cacheDir, MANIFEST_CACHE_FILE_NAME))).toBe(true)
  })

  it('is a no-op on a cache directory that does not exist yet', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'q2-launcher-cache-fresh-'))
    try {
      expect(await enforceBudget({ userDataPath: fresh, budgetBytes: 0 })).toEqual({
        removedBytes: 0,
        removedCount: 0,
      })
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})

describe('clear', () => {
  it('clear returns the bytes/count it actually deleted', async () => {
    await writeArchive('old.zip', 100, T0)
    await writeArchive('mid.zip', 250, T0 + HOUR)
    await writeArchive('claimed.zip', 700, T0 + 2 * HOUR)
    await writeArchive(`inflight.zip${PART_SUFFIX}`, 4000, T0 + 3 * HOUR)

    const isInUse = (name: string): boolean => name === 'claimed.zip'
    const before = await status({ userDataPath, isInUse })
    const result = await clear({ userDataPath, isInUse })

    // What the confirm dialog was told (AC4) and what actually went are the same numbers, because
    // both come out of the same predicate.
    expect(result).toEqual({ removedBytes: 350, removedCount: 2 })
    expect(result.removedBytes).toBe(before.totalBytes)
    expect(result.removedCount).toBe(before.itemCount)

    // ... and the disk agrees: the two evictable archives are gone, the protected pair remains.
    expect(await listCache()).toEqual([`inflight.zip${PART_SUFFIX}`, 'claimed.zip'].sort())
    expect(await status({ userDataPath, isInUse })).toEqual({ totalBytes: 0, itemCount: 0 })
  })

  it('reports zero for an already empty cache', async () => {
    expect(await clear({ userDataPath })).toEqual({ removedBytes: 0, removedCount: 0 })
  })

  it('survives a clear alongside real archives that get evicted', async () => {
    await writeArchive('engine.zip', 100, T0)
    await writeArchive(MANIFEST_CACHE_FILE_NAME, 5000, T0 + HOUR)

    const result = await clear({ userDataPath })

    expect(result).toEqual({ removedBytes: 100, removedCount: 1 })
    expect(await listCache()).toEqual([MANIFEST_CACHE_FILE_NAME])
  })
})

describe('planEviction (pure)', () => {
  it('orders strictly by mtime, not by size or by input order', () => {
    const entries = [
      entry('huge-but-new.zip', 900, T0 + 2 * HOUR),
      entry('tiny-but-old.zip', 10, T0),
      entry('mid.zip', 100, T0 + HOUR),
    ]

    const plan = planEviction({ entries, budgetBytes: 900, isInUse: NOTHING_IN_USE })

    expect(plan.map((e) => e.fileName)).toEqual(['tiny-but-old.zip', 'mid.zip'])
  })

  it('breaks an mtime tie by name so the plan is reproducible', () => {
    const entries = [entry('b.zip', 100, T0), entry('a.zip', 100, T0), entry('c.zip', 100, T0)]

    expect(
      planEviction({ entries, budgetBytes: 100, isInUse: NOTHING_IN_USE }).map((e) => e.fileName),
    ).toEqual(['a.zip', 'b.zip'])
  })

  it('plans nothing when the budget is already met, including at exactly the budget', () => {
    const entries = [entry('a.zip', 100, T0), entry('b.zip', 100, T0 + HOUR)]

    expect(planEviction({ entries, budgetBytes: 200, isInUse: NOTHING_IN_USE })).toEqual([])
    expect(planEviction({ entries, budgetBytes: 1_000_000, isInUse: NOTHING_IN_USE })).toEqual([])
  })

  it('excludes protected entries from the budget total as well as from the plan', () => {
    // A single in-flight file larger than the whole budget must not cost the user the entire
    // verified cache: were its bytes counted, everything else would be evicted and the cache would
    // still be over budget.
    const entries = [
      entry(`inflight.zip${PART_SUFFIX}`, 6_000_000_000, T0),
      entry('engine.zip', 100, T0 + HOUR),
    ]

    expect(planEviction({ entries, budgetBytes: 5_000_000_000, isInUse: NOTHING_IN_USE })).toEqual(
      [],
    )
  })

  it('never plans a protected entry, whatever the budget', () => {
    const entries = [
      entry(`inflight.zip${PART_SUFFIX}`, 500, T0),
      entry('claimed.zip', 500, T0 + HOUR),
    ]

    for (const budgetBytes of [0, -1, 250]) {
      expect(
        planEviction({ entries, budgetBytes, isInUse: (name) => name === 'claimed.zip' }),
      ).toEqual([])
    }
  })

  it('keeps every file when the budget is not a comparable number', () => {
    const entries = [entry('a.zip', 100, T0), entry('b.zip', 100, T0 + HOUR)]

    // `total <= NaN` is false for every total, so an unguarded comparison would evict the lot.
    expect(planEviction({ entries, budgetBytes: Number.NaN, isInUse: NOTHING_IN_USE })).toEqual([])
    expect(
      planEviction({ entries, budgetBytes: Number.POSITIVE_INFINITY, isInUse: NOTHING_IN_USE }),
    ).toEqual([])
  })

  it('treats a nonsensical size as zero rather than as a credit against the budget', () => {
    const entries = [entry('bad.zip', Number.NaN, T0), entry('good.zip', 300, T0 + HOUR)]

    // `good.zip` alone is over budget, so it goes; `bad.zip` contributes nothing but is still
    // evictable, and it is the older of the two.
    expect(
      planEviction({ entries, budgetBytes: 100, isInUse: NOTHING_IN_USE }).map((e) => e.fileName),
    ).toEqual(['bad.zip', 'good.zip'])
  })
})

describe('isEvictableCacheFileName', () => {
  it('refuses .part files and names the pipeline could not have written', () => {
    expect(isEvictableCacheFileName('engine.zip')).toBe(true)
    expect(isEvictableCacheFileName(`engine.zip${PART_SUFFIX}`)).toBe(false)
    expect(isEvictableCacheFileName('..')).toBe(false)
    expect(isEvictableCacheFileName('../state.json')).toBe(false)
    expect(isEvictableCacheFileName('.hidden')).toBe(false)
    expect(isEvictableCacheFileName('nul')).toBe(false)
  })

  it('refuses the manifest cache file specifically, not every safe name', () => {
    expect(isEvictableCacheFileName(MANIFEST_CACHE_FILE_NAME)).toBe(false)
    // A naive "exclude everything" fix would also refuse this, so it must still pass.
    expect(isEvictableCacheFileName('engine.zip')).toBe(true)
  })
})
