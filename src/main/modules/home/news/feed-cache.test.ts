import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsSlide } from '@shared/modules/home'
import {
  NEWS_CACHE_VERSION,
  NEWS_FEED_CACHE_FILE,
  NewsFeedCache,
  newsFeedCacheFilePath,
  type NewsFeedCacheData,
} from './feed-cache'
import { NEWS_INDEX_DOCUMENT } from './feed-fetcher'

/**
 * Story 082 D5. Real files in an `mkdtemp` directory through the real `JsonStore` - the criterion
 * under test is what a *file on disk* does to the launcher, so a stubbed store would test nothing.
 *
 * `electron` is mocked exactly as in `src/main/modules/downloads/manifest-service.test.ts` (under
 * plain vitest `import('electron')` resolves to a path string), so `app.getPath('userData')` - which
 * `newsFeedCacheFilePath()` is built from - points at a per-test temp folder.
 *
 * The four degradation cases are the point: a cache file is regenerable, so anything the launcher
 * cannot fully vouch for has to become "no cache" - one wasted fetch - and never an exception on
 * the app-start path.
 */

const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-news-cache-'))
  userDataBox.current = dir
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const slide: NewsSlide = {
  id: 'q2pro-1-2',
  template: 'split',
  order: 10,
  title: 'Q2PRO 1.2 is out',
  body: 'Body text of the slide.',
  image: 'img/q2pro.png',
  buttons: [{ label: 'Changelog', url: 'https://github.com/skullernet/q2pro/releases' }],
  visibleFrom: '2026-09-01T00:00:00.000Z',
  visibleUntil: '2026-09-30T00:00:00.000Z',
}

function data(overrides: Partial<NewsFeedCacheData> = {}): NewsFeedCacheData {
  return {
    slides: [slide],
    etags: { [NEWS_INDEX_DOCUMENT]: '"i1"', 'a.md': '"ea1"' },
    retrievedAt: '2026-09-10T08:30:00.000Z',
    ...overrides,
  }
}

/** Writes `content` where the cache lives, without going through the store. */
async function writeRawCacheFile(content: string): Promise<void> {
  await writeFile(newsFeedCacheFilePath(), content, 'utf8')
}

describe('NewsFeedCache', () => {
  it('lives in its own userData file and round-trips slides, ETags and retrievedAt', async () => {
    // Its own file, not a section of state.json (Decisions (Sprint)).
    expect(newsFeedCacheFilePath()).toBe(join(dir, NEWS_FEED_CACHE_FILE))

    await new NewsFeedCache().write(data())

    // Read back by a second instance, so nothing is served out of the writer's own memory.
    expect(await new NewsFeedCache().read()).toEqual(data())

    // The ETag map really is on disk next to the slides - that is what makes the next start's
    // conditional GET possible at all.
    const raw = JSON.parse(await readFile(newsFeedCacheFilePath(), 'utf8')) as Record<
      string,
      unknown
    >
    expect(raw['cacheVersion']).toBe(NEWS_CACHE_VERSION)
    expect(raw['etags']).toEqual({ [NEWS_INDEX_DOCUMENT]: '"i1"', 'a.md': '"ea1"' })
    expect(raw['retrievedAt']).toBe('2026-09-10T08:30:00.000Z')
  })

  it('a missing cache file reads as no cache', async () => {
    await expect(new NewsFeedCache().read()).resolves.toBeUndefined()
  })

  it('an unparseable cache file degrades to no cache instead of throwing', async () => {
    await writeRawCacheFile('{"slides": [ this is not json')

    await expect(new NewsFeedCache().read()).resolves.toBeUndefined()
  })

  it('a cache file that is valid JSON but the wrong shape degrades to no cache', async () => {
    // Parses fine, and every field is wrong in a different way: no envelope version, slides that
    // are not slides, an ETag map that is not a string map.
    await writeRawCacheFile(
      JSON.stringify({ slides: [{ id: 'x' }], etags: { 'a.md': 7 }, retrievedAt: 'yesterday' }),
    )

    await expect(new NewsFeedCache().read()).resolves.toBeUndefined()
  })

  it('a cache file from another cache version degrades to no cache', async () => {
    await writeRawCacheFile(JSON.stringify({ ...data(), cacheVersion: NEWS_CACHE_VERSION + 1 }))

    await expect(new NewsFeedCache().read()).resolves.toBeUndefined()
  })

  it('an unreadable retrievedAt degrades to no cache, because the feed could not state its age', async () => {
    await writeRawCacheFile(
      JSON.stringify({
        ...data({ retrievedAt: 'the day before' }),
        cacheVersion: NEWS_CACHE_VERSION,
      }),
    )

    await expect(new NewsFeedCache().read()).resolves.toBeUndefined()
  })

  it('a hand-edited button pointing off the host allowlist is dropped on read', async () => {
    await writeRawCacheFile(
      JSON.stringify({
        cacheVersion: NEWS_CACHE_VERSION,
        retrievedAt: '2026-09-10T08:30:00.000Z',
        etags: {},
        slides: [
          {
            ...slide,
            buttons: [
              { label: 'Free coins', url: 'https://evil.example.com/x' },
              { label: 'Changelog', url: 'https://github.com/skullernet/q2pro/releases' },
            ],
          },
        ],
      }),
    )

    const cached = await new NewsFeedCache().read()

    // The slide survives; the off-allowlist button does not. The file is a second, independent
    // input - the pipeline's check on the network path does not cover it.
    expect(cached?.slides).toEqual([
      {
        ...slide,
        buttons: [{ label: 'Changelog', url: 'https://github.com/skullernet/q2pro/releases' }],
      },
    ])
  })
})
