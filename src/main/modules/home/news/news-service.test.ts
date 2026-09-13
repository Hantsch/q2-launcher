import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { NewsFeed } from '@shared/modules/home'
import type { NewsFeedCacheData } from './feed-cache'
import type { FetchNewsResult } from './feed-fetcher'
import { createNewsService, type NewsServiceLog } from './news-service'

/**
 * Story 082 D6 acceptance tests. Every scenario injects `fetchDocuments` (the seam over
 * `fetchNewsDocuments`) and an in-memory `cache` stand-in rather than touching the real filesystem
 * or network - `feed-fetcher.test.ts`/`feed-cache.test.ts` already cover those files on their own.
 */

const NEWS_SERVICE_SOURCE = readFileSync(
  fileURLToPath(new URL('./news-service.ts', import.meta.url)),
  'utf8',
)

function fakeLog(): NewsServiceLog {
  return { info: vi.fn(), warn: vi.fn() }
}

/** Story 084 D4: `resolveFeedImages()` needs a `userDataPath`; none of this file's fixtures ever
 * declare a slide `image`, so nothing here actually reads or writes under it - a path that never
 * resolves to a real directory is deliberate, not a fixture oversight. */
const TEST_USER_DATA_PATH = '/q2-launcher-test-user-data-does-not-exist'

/** A minimal `NewsFeedCache` stand-in: an in-memory box, same `read()`/`write()` shape. */
function fakeCache() {
  let data: NewsFeedCacheData | undefined
  return {
    read: vi.fn(async () => data),
    write: vi.fn(async (next: NewsFeedCacheData) => {
      data = next
    }),
  }
}

const NOW = new Date('2026-01-15T12:00:00.000Z')

/** A minimal news document: frontmatter block, then a body. */
function md(frontmatter: string): string {
  return `---\n${frontmatter}---\nWorld\n`
}

function changedResult(overrides: Partial<Extract<FetchNewsResult, { kind: 'changed' }>> = {}) {
  return {
    kind: 'changed' as const,
    index: {
      schemaVersion: 1,
      entries: [{ id: 'a', file: 'a.md' }],
    },
    documents: { 'a.md': '---\ntitle: Hello\n---\nWorld\n' },
    etags: { 'news/index.json': 'idx-1', 'a.md': 'doc-1' },
    statuses: { 'a.md': 'fetched' as const },
    indexStatus: 'fetched' as const,
    failures: [],
    ...overrides,
  }
}

describe('news-service source', () => {
  it('only start and refresh trigger a fetch', () => {
    // AC1: the whole reason a fetch ever happens is `refreshNews()` being called - never a timer,
    // never a window-focus listener. Asserted directly against the source so a later edit cannot
    // reintroduce either without this test failing.
    expect(NEWS_SERVICE_SOURCE).not.toMatch(/setInterval\s*\(/)
    expect(NEWS_SERVICE_SOURCE).not.toMatch(/setTimeout\s*\(/)
    expect(NEWS_SERVICE_SOURCE).not.toMatch(/addEventListener/)
  })

  it('behaviorally: advancing virtual time alone never triggers another fetch', async () => {
    vi.useFakeTimers()
    try {
      const fetchDocuments = vi.fn(async (): Promise<FetchNewsResult> => changedResult())
      const service = createNewsService({
        isDev: false,
        userDataPath: TEST_USER_DATA_PATH,
        log: fakeLog(),
        onChanged: vi.fn(),
        cache: fakeCache(),
        fetchDocuments,
        now: () => NOW,
      })

      await service.refreshNews()
      expect(fetchDocuments).toHaveBeenCalledTimes(1)

      // A generous amount of virtual time - far beyond any plausible interval - with nothing else
      // calling refreshNews().
      await vi.advanceTimersByTimeAsync(1000 * 60 * 60 * 24 * 30)

      expect(fetchDocuments).toHaveBeenCalledTimes(1)

      // Read-only calls, however many of them, never fetch on their own.
      await service.getNews()
      await service.getNews()
      expect(fetchDocuments).toHaveBeenCalledTimes(1)

      // The only other thing that can move the count is an explicit refresh call.
      await service.refreshNews()
      expect(fetchDocuments).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('news-service: cold start', () => {
  it('no cache yet, no network attempted: an empty feed, not an error', async () => {
    const cache = fakeCache()
    const service = createNewsService({
      isDev: false,
      userDataPath: TEST_USER_DATA_PATH,
      log: fakeLog(),
      onChanged: vi.fn(),
      cache,
      fetchDocuments: vi.fn(),
      now: () => NOW,
    })

    const feed = await service.getNews()
    expect(feed.slides).toEqual([])
    expect(feed.schemaAhead).toBe(false)
    expect(cache.read).toHaveBeenCalledTimes(1)
  })
})

describe('news-service: AC7 a failed refresh delivers the cached feed with its retrievedAt', () => {
  it('a failed refresh delivers the cached feed with its retrievedAt', async () => {
    const cache = fakeCache()
    const onChanged = vi.fn()
    const fetchDocuments = vi
      .fn()
      .mockResolvedValueOnce(changedResult())
      .mockResolvedValueOnce({ kind: 'failed', reason: 'HTTP 500', etags: {} } satisfies FetchNewsResult)

    const service = createNewsService({
      isDev: false,
      userDataPath: TEST_USER_DATA_PATH,
      log: fakeLog(),
      onChanged,
      cache,
      fetchDocuments,
      now: () => NOW,
    })

    const first = await service.refreshNews()
    expect(first.slides).toHaveLength(1)
    expect(onChanged).toHaveBeenCalledTimes(1)

    const second = await service.refreshNews()

    expect(second.slides).toEqual(first.slides)
    // The retrieval that produced these slides is still the first one - a failed refresh must not
    // claim a fresher (or different) retrievedAt.
    expect(second.retrievedAt).toBe(first.retrievedAt)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})

describe('news-service: AC9 change detection', () => {
  it('a changed feed emits news.changed, an identical one does not', async () => {
    const cache = fakeCache()
    const onChanged = vi.fn()
    const fetchDocuments = vi
      .fn()
      .mockResolvedValueOnce(changedResult())
      // Same document content, re-fetched under a new ETag: buildFeed() rebuilds to identical
      // slides, so this is the "identical one does not" half of the test.
      .mockResolvedValueOnce(changedResult({ etags: { 'news/index.json': 'idx-2', 'a.md': 'doc-2' } }))

    const service = createNewsService({
      isDev: false,
      userDataPath: TEST_USER_DATA_PATH,
      log: fakeLog(),
      onChanged,
      cache,
      fetchDocuments,
      now: () => NOW,
    })

    const first = await service.refreshNews()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenLastCalledWith(first)

    const second = await service.refreshNews()
    expect(second.slides).toEqual(first.slides)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('an unchanged fetch result never emits, even though retrievedAt moves', async () => {
    const cache = fakeCache()
    const onChanged = vi.fn()
    const fetchDocuments = vi
      .fn()
      .mockResolvedValueOnce(changedResult())
      .mockResolvedValueOnce({ kind: 'unchanged', etags: {} } satisfies FetchNewsResult)

    const service = createNewsService({
      isDev: false,
      userDataPath: TEST_USER_DATA_PATH,
      log: fakeLog(),
      onChanged,
      cache,
      fetchDocuments,
      now: () => NOW,
    })

    await service.refreshNews()
    expect(onChanged).toHaveBeenCalledTimes(1)

    const feed = await service.refreshNews()
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(feed.slides).toHaveLength(1)
  })
})

describe('news-service: delivery-time visibility re-filter', () => {
  it('a slide that has since expired is filtered out even though it was cached while still visible', async () => {
    // Cached three days before "now", with a slide that was visible at cache time but has a
    // visibleUntil in between - the regression this fix targets (Decisions (Sprint), AC3 as applied
    // to cached delivery, not just a fresh build).
    const cache = fakeCache()
    await cache.write({
      slides: [
        {
          id: 'expired',
          template: 'text',
          order: 1,
          title: 'Expired',
          body: 'Old news.',
          buttons: [],
          visibleUntil: '2026-01-12T00:00:00.000Z',
        },
        {
          id: 'still-visible',
          template: 'text',
          order: 2,
          title: 'Still visible',
          body: 'Current.',
          buttons: [],
        },
      ],
      etags: {},
      retrievedAt: '2026-01-10T00:00:00.000Z',
    })

    const service = createNewsService({
      isDev: false,
      userDataPath: TEST_USER_DATA_PATH,
      log: fakeLog(),
      onChanged: vi.fn(),
      cache,
      fetchDocuments: vi.fn(),
      // "Now" is after the cached slide's visibleUntil - a cache read three days later, per the
      // story's Decision.
      now: () => new Date('2026-01-15T00:00:00.000Z'),
    })

    const feed = await service.getNews()
    expect(feed.slides.map((slide) => slide.id)).toEqual(['still-visible'])
  })
})

describe('news-service: a not-yet-visible cached slide surfaces once now catches up to it', () => {
  it('is excluded right after caching and included on a later delivery, with no new fetch in between', async () => {
    // The exact scenario Finding 1 was about: an entry published with `visibleFrom` in the future is
    // fetched and cached (unfiltered, per the story's Decision) before it is ever visible. A later
    // `getNews()` call - no refresh, no new fetch - must surface it once `now` passes `visibleFrom`,
    // proving the cache genuinely holds the unfiltered slide rather than one already dropped at
    // fetch time.
    const cache = fakeCache()
    const fetchDocuments = vi.fn(async (): Promise<FetchNewsResult> =>
      changedResult({
        documents: {
          'a.md': md(
            'id: a\ntemplate: text\norder: 1\ntitle: Hello\nvisibleFrom: 2026-01-20T00:00:00.000Z\n',
          ),
        },
      }),
    )

    const service = createNewsService({
      isDev: false,
      userDataPath: TEST_USER_DATA_PATH,
      log: fakeLog(),
      onChanged: vi.fn(),
      cache,
      fetchDocuments,
      // Before visibleFrom: the refresh caches the slide, but does not deliver it yet.
      now: () => new Date('2026-01-15T12:00:00.000Z'),
    })

    const afterRefresh = await service.refreshNews()
    expect(afterRefresh.slides).toEqual([])
    expect(fetchDocuments).toHaveBeenCalledTimes(1)

    // Now build a second service against the SAME cached data (simulating a later `getNews()` call
    // with no fetch in between - a fresh in-memory instance reading the same on-disk cache is the
    // cleanest way to prove this without any in-process state helping it along).
    const laterService = createNewsService({
      isDev: false,
      userDataPath: TEST_USER_DATA_PATH,
      log: fakeLog(),
      onChanged: vi.fn(),
      cache,
      fetchDocuments: vi.fn(),
      // After visibleFrom, with no refresh call at all.
      now: () => new Date('2026-01-25T00:00:00.000Z'),
    })

    const laterFeed = await laterService.getNews()
    expect(laterFeed.slides.map((slide) => slide.id)).toEqual(['a'])
  })
})

describe('news-service: getNews() delivery-time sort', () => {
  it('sorts by order ascending on every delivery', async () => {
    const cache = fakeCache()
    const fetchDocuments = vi.fn(async (): Promise<FetchNewsResult> =>
      changedResult({
        index: {
          schemaVersion: 1,
          entries: [
            { id: 'b', file: 'b.md' },
            { id: 'a', file: 'a.md' },
          ],
        },
        documents: {
          'a.md': '---\ntitle: A\norder: 2\n---\nA body\n',
          'b.md': '---\ntitle: B\norder: 1\n---\nB body\n',
        },
        etags: { 'news/index.json': 'idx-1', 'a.md': 'a-1', 'b.md': 'b-1' },
        statuses: { 'a.md': 'fetched', 'b.md': 'fetched' },
      }),
    )

    const service = createNewsService({
      isDev: false,
      userDataPath: TEST_USER_DATA_PATH,
      log: fakeLog(),
      onChanged: vi.fn(),
      cache,
      fetchDocuments,
      now: () => NOW,
    })

    await service.refreshNews()
    const feed: NewsFeed = await service.getNews()
    expect(feed.slides.map((slide) => slide.id)).toEqual(['b', 'a'])
  })
})
