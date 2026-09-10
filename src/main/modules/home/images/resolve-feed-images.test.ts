import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsSlide } from '@shared/modules/home'
import { NEWS_IMAGE_PATH_PREFIX, RENDERER_ORIGIN } from '../../../lib/renderer-source'
import { NEWS_DIRECTORY } from '../news/feed-fetcher'
import { contentRepoUrl } from '../../../lib/content-repo'
import { getNewsImagesCacheDir, newsImageFileName } from './paths'
import { resolveFeedImages, type ResolveFeedImagesOptions } from './resolve-feed-images'

/**
 * Story 084 D4. `enforceKeepSet()`/D1's eviction is exercised for real (real files, real
 * directory listing) - the same "always check the directory afterwards" discipline
 * `image-cache.test.ts` uses. Network behaviour is exercised through `fetchImage()`'s real logic
 * with a fake `fetchImpl` returning synthetic `Response` objects, never a real socket - this
 * module has no transport of its own to fake around.
 */

let userDataPath: string
let cacheDir: string

beforeEach(async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'q2-launcher-resolve-feed-images-'))
  cacheDir = getNewsImagesCacheDir(userDataPath)
  await mkdir(cacheDir, { recursive: true })
})

afterEach(async () => {
  await rm(userDataPath, { recursive: true, force: true })
})

function slide(overrides: Partial<NewsSlide> = {}): NewsSlide {
  return {
    id: 's1',
    template: 'split',
    order: 0,
    title: 'Title',
    body: 'Body',
    buttons: [],
    ...overrides,
  }
}

function sourceUrlFor(image: string, base?: string): string {
  return contentRepoUrl(`${NEWS_DIRECTORY}/${image}`, base)
}

async function writeCachedImage(sourceUrl: string, ext = 'png', mtimeMs = Date.now()): Promise<string> {
  const fileName = newsImageFileName(sourceUrl, ext)
  const path = join(cacheDir, fileName)
  await writeFile(path, Buffer.alloc(16, 0x71))
  const when = new Date(mtimeMs)
  await utimes(path, when, when)
  return fileName
}

async function listCache(): Promise<string[]> {
  return (await readdir(cacheDir)).sort()
}

function run(options: Partial<ResolveFeedImagesOptions> & Pick<ResolveFeedImagesOptions, 'slides'>) {
  return resolveFeedImages({
    userDataPath,
    networkReached: false,
    ...options,
  })
}

describe('resolveFeedImages', () => {
  it('a resolved slide carries a q2launcher URL and no remote origin', async () => {
    const image = 'img/a.png'
    const fileName = await writeCachedImage(sourceUrlFor(image))

    const result = await run({ slides: [slide({ image })] })

    expect(result.slides).toHaveLength(1)
    const resolved = result.slides[0]
    expect(resolved.imageUrl).toBe(`${RENDERER_ORIGIN}${NEWS_IMAGE_PATH_PREFIX}${fileName}`)
    expect(resolved.imageUrl?.startsWith('q2launcher://')).toBe(true)

    // No field on the resolved slide may carry the original remote/http(s) path or URL.
    expect(resolved).not.toHaveProperty('image')
    for (const value of Object.values(resolved)) {
      if (typeof value === 'string') {
        expect(value.startsWith('http://')).toBe(false)
        expect(value.startsWith('https://')).toBe(false)
      }
    }
  })

  it('a cached image makes no network attempt', async () => {
    const image = 'img/a.png'
    const fileName = await writeCachedImage(sourceUrlFor(image))
    const fetchImpl = vi.fn()

    const result = await run({
      slides: [slide({ image })],
      networkReached: true,
      fetchImpl,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.slides[0].imageUrl).toBe(`${RENDERER_ORIGIN}${NEWS_IMAGE_PATH_PREFIX}${fileName}`)
  })

  it('a refresh evicts every cached image the new feed does not reference', async () => {
    const keptImage = 'img/kept.png'
    const keptFileName = await writeCachedImage(sourceUrlFor(keptImage), 'png', Date.now() - 1000)
    const staleFileNameA = await writeCachedImage('https://example.test/stale-a', 'png', Date.now() - 5000)
    const staleFileNameB = await writeCachedImage('https://example.test/stale-b', 'jpg', Date.now() - 9000)

    const result = await run({
      slides: [slide({ image: keptImage })],
      maxItems: 0,
    })

    expect(result.removedCount).toBe(2)
    const remaining = await listCache()
    expect(remaining).toEqual([keptFileName].sort())
    expect(remaining).not.toContain(staleFileNameA)
    expect(remaining).not.toContain(staleFileNameB)
  })

  it('a rejected/gone/unavailable fetch result leaves that slide with no imageUrl, without throwing or stopping the rest', async () => {
    const rejectedImage = 'img/rejected.png'
    const goneImage = 'img/gone.png'
    const unavailableImage = 'img/unavailable.png'
    const okImage = 'img/ok.png'

    const fetchImpl = vi.fn(async (url: string) => {
      if (url === sourceUrlFor(rejectedImage)) {
        return new Response('not-an-image', { status: 200, headers: { 'content-type': 'text/plain' } })
      }
      if (url === sourceUrlFor(goneImage)) {
        return new Response(null, { status: 404 })
      }
      if (url === sourceUrlFor(unavailableImage)) {
        return new Response(null, { status: 503 })
      }
      if (url === sourceUrlFor(okImage)) {
        return new Response(Buffer.alloc(16, 0x89), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`unexpected url ${url}`)
    })

    const call = run({
      slides: [
        slide({ id: 'rejected', image: rejectedImage }),
        slide({ id: 'gone', image: goneImage }),
        slide({ id: 'unavailable', image: unavailableImage }),
        slide({ id: 'ok', image: okImage }),
      ],
      networkReached: true,
      fetchImpl,
      decodeImage: () => ({ ok: true, width: 10, height: 10 }),
    })

    await expect(call).resolves.not.toThrow()
    const result = await call
    const byId = new Map(result.slides.map((s) => [s.id, s]))
    expect(byId.get('rejected')?.imageUrl).toBeUndefined()
    expect(byId.get('gone')?.imageUrl).toBeUndefined()
    expect(byId.get('unavailable')?.imageUrl).toBeUndefined()
    expect(byId.get('ok')?.imageUrl).toBeDefined()
    expect(byId.get('ok')?.imageUrl?.startsWith('q2launcher://')).toBe(true)
  })

  it('a slide with no declared image resolves with no imageUrl and needs no cache lookup', async () => {
    const result = await run({ slides: [slide()] })
    expect(result.slides).toHaveLength(1)
    expect(result.slides[0].imageUrl).toBeUndefined()
    expect(result.slides[0]).not.toHaveProperty('image')
  })

  it('refuses a traversal or absolute declared image path, leaving the slide with no imageUrl and making no fetch attempt', async () => {
    const fetchImpl = vi.fn()
    const warn = vi.fn()

    const result = await run({
      slides: [
        slide({ id: 'traversal', image: '../../etc/passwd' }),
        slide({ id: 'absolute', image: '/etc/passwd' }),
        slide({ id: 'scheme', image: 'http://evil.test/x.png' }),
      ],
      networkReached: true,
      fetchImpl,
      log: { warn },
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    for (const resolved of result.slides) {
      expect(resolved.imageUrl).toBeUndefined()
    }
    expect(warn).toHaveBeenCalled()
  })

  it('does not fetch on a cache miss when this cycle did not reach the network', async () => {
    const fetchImpl = vi.fn()
    const result = await run({
      slides: [slide({ image: 'img/missing.png' })],
      networkReached: false,
      fetchImpl,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.slides[0].imageUrl).toBeUndefined()
  })
})
