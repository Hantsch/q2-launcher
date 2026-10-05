import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CachedDemo,
  REPLAYS_INDEX_CACHE_FILE,
  REPLAYS_INDEX_CACHE_VERSION,
  ReplaysIndexCache,
  replaysIndexCacheFilePath,
} from './index-cache'

/**
 * Story 144 D1. Real files in an `mkdtemp` directory through the real `JsonStore` - the criterion
 * under test is what a *file on disk* does to the launcher, so a stubbed store would test
 * nothing. Mirrors `src/main/modules/home/news/feed-cache.test.ts`.
 */

const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-replays-index-cache-'))
  userDataBox.current = dir
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const demoA: CachedDemo = {
  size: 12_345,
  mtimeMs: 1_726_000_000_000,
  patternFingerprint: 'default-v1',
  parsed: { map: 'q2dm1', durationMs: 60_000 },
  name: { players: ['Alice', 'Bob'] },
}

const demoB: CachedDemo = {
  size: 9_999,
  mtimeMs: 1_726_000_500_000,
  patternFingerprint: 'default-v1',
  parsed: { map: 'q2dm8', durationMs: 45_000 },
  name: { players: ['Carol'] },
}

/** Writes `content` where the cache lives, without going through the store. */
async function writeRawCacheFile(content: string): Promise<void> {
  await writeFile(replaysIndexCacheFilePath(), content, 'utf8')
}

describe('ReplaysIndexCache', () => {
  it('a written cache reads back identical', async () => {
    const entries = new Map<string, CachedDemo>([
      ['entry-1', demoA],
      ['entry-2', demoB],
    ])

    await new ReplaysIndexCache().write(entries)

    // Read back by a second instance, so nothing is served out of the writer's own memory.
    expect(await new ReplaysIndexCache().read()).toEqual(entries)
  })

  it('a missing cache file reads as empty', async () => {
    await expect(new ReplaysIndexCache().read()).resolves.toEqual(new Map())
  })

  it('an unparseable or schema-failing cache file reads as empty without throwing', async () => {
    await writeRawCacheFile('{"entries": [ this is not json')
    await expect(new ReplaysIndexCache().read()).resolves.toEqual(new Map())

    await writeRawCacheFile(
      JSON.stringify({
        cacheVersion: REPLAYS_INDEX_CACHE_VERSION,
        entries: { 'entry-1': { size: 'not-a-number' } },
      }),
    )
    await expect(new ReplaysIndexCache().read()).resolves.toEqual(new Map())
  })

  it('a cache with another cacheVersion is discarded, not misread', async () => {
    await writeRawCacheFile(JSON.stringify({ cacheVersion: 0, entries: { 'entry-1': demoA } }))
    await expect(new ReplaysIndexCache().read()).resolves.toEqual(new Map())

    const entries = new Map<string, CachedDemo>([['entry-1', demoA]])
    await new ReplaysIndexCache().write(entries)

    const raw = JSON.parse(await readFile(replaysIndexCacheFilePath(), 'utf8')) as Record<
      string,
      unknown
    >
    expect(raw['cacheVersion']).toBe(REPLAYS_INDEX_CACHE_VERSION)
    expect(await new ReplaysIndexCache().read()).toEqual(entries)
  })

  it('a version-1 cache is discarded', async () => {
    // Version-1 rows predate gameDir/pov/players/durationMs - never reused.
    expect(REPLAYS_INDEX_CACHE_VERSION).toBe(3)
    await writeRawCacheFile(JSON.stringify({ cacheVersion: 1, entries: { 'entry-1': demoA } }))
    await expect(new ReplaysIndexCache().read()).resolves.toEqual(new Map())
  })

  it('the cache lives in its own userData file, not state.json', () => {
    const path = replaysIndexCacheFilePath()
    expect(path.endsWith(REPLAYS_INDEX_CACHE_FILE)).toBe(true)
    expect(path).not.toContain('state.json')
    expect(path).not.toBe(join(dir, 'state.json'))
  })
})
