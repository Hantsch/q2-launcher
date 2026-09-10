import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isAllowedButtonHost } from '@shared/modules/home'
import { describe, expect, it } from 'vitest'
import { resolveFeed } from './feed-pipeline'

/**
 * Story 085 D2: proves the checked-in D1 fixture at
 * `content/q2_community_content/news/` actually survives the real 082 pipeline - not a
 * stand-in copy, but the very same files this repo ships. This test reads them straight
 * off disk (no mock, no fixtures/ dir of its own) and feeds them through `resolveFeed()`,
 * which is exactly the call `news-service.ts`'s `refreshNews()` makes on its `changed`
 * path (see that file's `resolveFeed({ index: result.index, documents: result.documents })`).
 * That IS this test's answer to "the fixture is the source of the harness news feed" -
 * D3 (separate deliverable) covers the harness wiring that hands these same files to the
 * pipeline through the fetch layer instead of straight off disk.
 *
 * Mirrors `archive-layouts.test.ts` for resolving the repo root from `__dirname` and
 * reading real files off disk from a vitest test; this file lives at the same depth
 * (`src/main/modules/home/news/`) so it needs the same number of `..` segments.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const NEWS_DIR = join(REPO_ROOT, 'content', 'q2_community_content', 'news')

function readIndex(): unknown {
  return JSON.parse(readFileSync(join(NEWS_DIR, 'index.json'), 'utf-8'))
}

/** Every `.md` file physically present in the fixture directory, keyed by filename - exactly
 * the shape `resolveFeed()`'s `documents: Readonly<Record<string, string>>` expects. */
function readDocuments(): Record<string, string> {
  const documents: Record<string, string> = {}
  for (const entry of readdirSync(NEWS_DIR)) {
    if (!entry.endsWith('.md')) continue
    documents[entry] = readFileSync(join(NEWS_DIR, entry), 'utf-8')
  }
  return documents
}

// `resolveFeed()` deliberately does not filter by visibility window (that's `filterAndSortSlides()`'s
// job against a caller-supplied `now`) - so no `now` is needed here. The fixture's own visibility
// bounds (2026-08-01 from; 2099-12-31 until on the banner entry only; the text entry unbounded) are
// exercised for real by AC7's e2e flow (`scripts/flows/news-feed.mjs`, D3), which does apply `now`.
describe('news fixture contract (real content/q2_community_content/news/)', () => {
  it('resolves the three checked-in entries into split/banner/text slides with zero warnings', () => {
    const index = readIndex()
    const documents = readDocuments()

    const result = resolveFeed({ index, documents })

    // AC6's "zero warnings": at this layer `resolveFeed()` never throws or logs - it only ever
    // reports drops through `result.warnings`, so an empty array here IS "the fixture is clean".
    expect(result.warnings).toEqual([])

    const slides = result.slides
    expect(slides.map((slide) => slide.id)).toEqual([
      'r1q2-in-the-bootstrap-wizard',
      'the-community-content-repository',
      'how-news-reaches-the-launcher',
    ])
    expect(slides.map((slide) => slide.order)).toEqual([10, 20, 30])
    expect(slides.map((slide) => slide.template)).toEqual(['split', 'banner', 'text'])
  })

  it('keeps all 3 buttons on the entry sitting exactly at the cap', () => {
    const result = resolveFeed({ index: readIndex(), documents: readDocuments() })
    const banner = result.slides.find((slide) => slide.id === 'the-community-content-repository')
    if (!banner) throw new Error('expected the banner entry to survive resolveFeed()')
    expect(banner.buttons).toHaveLength(3)
  })

  it('every delivered button url passes the pipeline\'s own allowlist predicate', () => {
    const result = resolveFeed({ index: readIndex(), documents: readDocuments() })
    const urls = result.slides.flatMap((slide) => slide.buttons.map((button) => button.url))
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(isAllowedButtonHost(url)).toBe(true)
  })

  it('the split and banner slides carry an image that exists on disk', () => {
    const result = resolveFeed({ index: readIndex(), documents: readDocuments() })
    const split = result.slides.find((slide) => slide.id === 'r1q2-in-the-bootstrap-wizard')
    const banner = result.slides.find((slide) => slide.id === 'the-community-content-repository')
    if (!split || !banner) throw new Error('expected the split and banner entries to survive')

    expect(split.image).toBeDefined()
    expect(banner.image).toBeDefined()
    expect(existsSync(join(NEWS_DIR, split.image as string))).toBe(true)
    expect(existsSync(join(NEWS_DIR, banner.image as string))).toBe(true)
  })

  it('the text entry keeps its single button and carries no image', () => {
    const result = resolveFeed({ index: readIndex(), documents: readDocuments() })
    const text = result.slides.find((slide) => slide.id === 'how-news-reaches-the-launcher')
    if (!text) throw new Error('expected the text entry to survive resolveFeed()')
    expect(text.template).toBe('text')
    expect(text.buttons).toHaveLength(1)
    expect(text.image).toBeUndefined()
  })
})
