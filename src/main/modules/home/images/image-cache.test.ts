import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pathExists } from '../../../lib/fs-utils'
import {
  enforceKeepSet,
  planImageEviction,
  type ImageCacheEntry,
} from './image-cache'
import { getNewsImagesCacheDir, isSafeNewsImageFileName, newsImageFileName } from './paths'

/**
 * Story 084 D1. Mirrors `downloads/cache.test.ts`'s split: `planImageEviction` is pure and gets
 * exercised with no disk at all, while `enforceKeepSet` is guarded by fs-backed tests that always
 * check the *directory listing* afterwards, not just the return value - a function that reports
 * the right count while removing the wrong file would pass the former and fail the latter.
 */

let userDataPath: string
let cacheDir: string

beforeEach(async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'q2-launcher-image-cache-'))
  cacheDir = getNewsImagesCacheDir(userDataPath)
  await mkdir(cacheDir, { recursive: true })
})

afterEach(async () => {
  await rm(userDataPath, { recursive: true, force: true })
})

/** A boring, content-addressed-shaped name, distinguished only by its first hex character. */
function imageName(seed: string, ext = 'png'): string {
  return newsImageFileName(`https://example.test/${seed}`, ext)
}

async function writeImage(fileName: string, mtimeMs: number): Promise<void> {
  const path = join(cacheDir, fileName)
  await writeFile(path, Buffer.alloc(16, 0x71))
  const when = new Date(mtimeMs)
  await utimes(path, when, when)
}

async function listCache(): Promise<string[]> {
  return (await readdir(cacheDir)).sort()
}

function entry(fileName: string, mtimeMs: number): ImageCacheEntry {
  return { fileName, mtimeMs }
}

const T0 = Date.UTC(2026, 0, 1)
const HOUR = 3_600_000

describe('paths: newsImageFileName / isSafeNewsImageFileName', () => {
  it('is content-addressed by the source URL, not by entry id', () => {
    const a = newsImageFileName('https://example.test/a.png', 'png')
    const again = newsImageFileName('https://example.test/a.png', 'png')
    const b = newsImageFileName('https://example.test/b.png', 'png')

    expect(a).toBe(again)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}\.png$/)
  })

  it('accepts only a bare 64-hex-plus-allowed-extension name', () => {
    expect(isSafeNewsImageFileName(imageName('ok', 'png'))).toBe(true)
    expect(isSafeNewsImageFileName(imageName('ok', 'jpg'))).toBe(true)
    expect(isSafeNewsImageFileName(imageName('ok', 'jpeg'))).toBe(true)
    expect(isSafeNewsImageFileName(imageName('ok', 'webp'))).toBe(true)

    expect(isSafeNewsImageFileName(imageName('ok', 'gif'))).toBe(false)
    expect(isSafeNewsImageFileName(imageName('ok', 'svg'))).toBe(false)
    expect(isSafeNewsImageFileName('not-hex-at-all.png')).toBe(false)
    expect(isSafeNewsImageFileName('../x.png')).toBe(false)
    expect(isSafeNewsImageFileName('a/b.png')).toBe(false)
    expect(isSafeNewsImageFileName(`${imageName('ok', 'png').slice(0, -4)}/../x.png`)).toBe(false)
    expect(isSafeNewsImageFileName('')).toBe(false)
  })
})

describe('planImageEviction (pure)', () => {
  it('eviction respects the item cap and never removes a current feed\'s image', () => {
    const keptA = imageName('kept-a')
    const keptB = imageName('kept-b')
    const oldest = imageName('oldest')
    const mid = imageName('mid')
    const newer = imageName('newer')
    const newest = imageName('newest')

    const entries = [
      entry(keptA, T0 - 10 * HOUR), // oldest of all, but kept - must never be evicted
      entry(oldest, T0),
      entry(mid, T0 + HOUR),
      entry(newer, T0 + 2 * HOUR),
      entry(newest, T0 + 3 * HOUR),
      entry(keptB, T0 + 4 * HOUR),
    ]
    const keep = new Set([keptA, keptB])

    // Cap of 2 unreferenced images: the two oldest unreferenced entries go, oldest first.
    const plan = planImageEviction({ entries, keep, maxItems: 2 })

    expect(plan.map((e) => e.fileName)).toEqual([oldest, mid])
    // (a) never includes a keep-set member
    expect(plan.some((e) => keep.has(e.fileName))).toBe(false)
  })

  it('respects the 24-item cap as the configured maxItems', () => {
    const keep = new Set<string>()
    const entries = Array.from({ length: 26 }, (_, i) => entry(imageName(`img-${i}`), T0 + i * HOUR))

    const plan = planImageEviction({ entries, keep, maxItems: 24 })

    expect(plan).toHaveLength(2)
    expect(plan.map((e) => e.fileName)).toEqual([entries[0].fileName, entries[1].fileName])
  })

  it('plans nothing when the count is already at or under the cap', () => {
    const keep = new Set<string>()
    const entries = [entry(imageName('a'), T0), entry(imageName('b'), T0 + HOUR)]

    expect(planImageEviction({ entries, keep, maxItems: 2 })).toEqual([])
    expect(planImageEviction({ entries, keep, maxItems: 24 })).toEqual([])
  })

  it('returns [] for a non-finite cap instead of throwing or evicting everything', () => {
    const keep = new Set<string>()
    const entries = [entry(imageName('a'), T0), entry(imageName('b'), T0 + HOUR)]

    expect(planImageEviction({ entries, keep, maxItems: Number.POSITIVE_INFINITY })).toEqual([])
    expect(planImageEviction({ entries, keep, maxItems: Number.NaN })).toEqual([])
  })

  it('breaks an mtime tie by name so the plan is reproducible', () => {
    const names = [imageName('b'), imageName('a'), imageName('c')].sort()
    const entries = names.map((name) => entry(name, T0))

    const plan = planImageEviction({ entries, keep: new Set(), maxItems: 1 })

    // All three share one mtime; the two whose name sorts first are evicted, in name order.
    expect(plan.map((e) => e.fileName)).toEqual(names.slice(0, 2))
  })

  it('excludes an unsafe name from consideration entirely, keeping it off both sides', () => {
    const entries = [
      entry('unsafe name.png', T0),
      entry(imageName('safe'), T0 + HOUR),
    ]

    // Cap of 0: only the safe candidate is evictable, the unsafe one is simply not this module's
    // business, so it must not appear in the plan.
    const plan = planImageEviction({ entries, keep: new Set(), maxItems: 0 })

    expect(plan.map((e) => e.fileName)).toEqual([imageName('safe')])
  })
})

describe('enforceKeepSet', () => {
  it('evicts the oldest unreferenced images down to the cap, and leaves kept ones alone', async () => {
    const keptA = imageName('kept-a')
    const oldest = imageName('oldest')
    const mid = imageName('mid')
    const newest = imageName('newest')

    await writeImage(keptA, T0 - HOUR)
    await writeImage(oldest, T0)
    await writeImage(mid, T0 + HOUR)
    await writeImage(newest, T0 + 2 * HOUR)

    const result = await enforceKeepSet({ userDataPath, keep: new Set([keptA]), maxItems: 1 })

    // 3 unreferenced images, cap of 1: the two oldest unreferenced ones go, `newest` survives.
    expect(result).toEqual({ removedCount: 2 })
    expect(await listCache()).toEqual([keptA, newest].sort())
  })

  it('leaves alone a name directly in the cache dir that isSafeNewsImageFileName() rejects', async () => {
    // Not a 64-hex-plus-allowed-extension name - something this module would never have written
    // (a stray file, a leftover from a manual copy). It must be neither deleted nor counted, the
    // same "we do not know what it is, therefore we do not delete it" rule the download cache uses.
    await writeImage('notes.txt', T0 - HOUR)
    const legit = imageName('legit')
    await writeImage(legit, T0)

    const result = await enforceKeepSet({ userDataPath, keep: new Set(), maxItems: 0 })

    expect(result).toEqual({ removedCount: 1 })
    expect(await listCache()).toEqual(['notes.txt'])
  })

  it('rejects a name with a slash and a name with unsafe characters', () => {
    expect(isSafeNewsImageFileName('../x.png')).toBe(false)
    expect(isSafeNewsImageFileName('sub/dir.png')).toBe(false)
    expect(isSafeNewsImageFileName('has spaces and $ymbols.png')).toBe(false)
  })

  it('refuses to delete a path that would resolve outside the cache dir', async () => {
    // A nested subdirectory that happens to contain a safe-looking name: the file genuinely
    // exists on disk, but it is not a *direct* child of the cache directory, so it must survive
    // even though its bare name would pass isSafeNewsImageFileName().
    const nestedName = imageName('nested')
    await mkdir(join(cacheDir, 'nested'), { recursive: true })
    const nestedPath = join(cacheDir, 'nested', nestedName)
    await writeFile(nestedPath, Buffer.alloc(16))
    const when = new Date(T0 - 100 * HOUR)
    await utimes(nestedPath, when, when)

    // readCacheEntries only reads direct dirents of cacheDir and skips non-files, so the nested
    // file is never even seen as a candidate - readdir({recursive:true}) is not used precisely to
    // guarantee this. Confirm it survives an aggressive eviction.
    const result = await enforceKeepSet({ userDataPath, keep: new Set(), maxItems: 0 })

    expect(result).toEqual({ removedCount: 0 })
    expect(await pathExists(nestedPath)).toBe(true)
  })

  it('a genuinely-unreferenced safe file directly in the cache dir is unlinked', async () => {
    const safe = imageName('unreferenced')
    await writeImage(safe, T0)

    const result = await enforceKeepSet({ userDataPath, keep: new Set(), maxItems: 0 })

    expect(result).toEqual({ removedCount: 1 })
    expect(await listCache()).toEqual([])
  })

  it('is a no-op on a cache directory that does not exist yet', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'q2-launcher-image-cache-fresh-'))
    try {
      expect(
        await enforceKeepSet({ userDataPath: fresh, keep: new Set(), maxItems: 0 }),
      ).toEqual({ removedCount: 0 })
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})
