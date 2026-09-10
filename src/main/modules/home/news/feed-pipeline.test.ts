import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NEWS_SCHEMA_VERSION, type NewsSlide } from '@shared/modules/home'
import { describe, expect, it } from 'vitest'
import { buildFeed, filterAndSortSlides, resolveFeed } from './feed-pipeline'

/**
 * Story 082 D3: AC2-AC6 (plus AC10's pure-module half) against the real pipeline.
 *
 * Every fixture here is a realistic document text that goes through the actual
 * `parseFrontmatter`, not a pre-parsed structure - handing the pipeline ready-made
 * objects would prove nothing about its integration with D2's reader.
 */

/** A news document: `---` frontmatter block, then the markdown body. */
function md(frontmatter: string[], body: string): string {
  return ['---', ...frontmatter, '---', body].join('\n')
}

const ALLOWED_URL = 'https://github.com/Hantsch/q2_community_content/releases'
const ALLOWED_RAW_URL = 'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/x.md'

function index(entries: { id: string; file: string }[], schemaVersion = NEWS_SCHEMA_VERSION) {
  return { schemaVersion, entries }
}

const NOW = new Date('2026-09-10T12:00:00.000Z')

describe('buildFeed', () => {
  it('an invalid entry is dropped with a warning and the rest of the feed survives', () => {
    const result = buildFeed({
      index: index([
        { id: 'good-one', file: 'good-one.md' },
        { id: 'no-such-file', file: 'never-fetched.md' },
        { id: 'broken-frontmatter', file: 'broken.md' },
        { id: 'no-title', file: 'no-title.md' },
        { id: 'good-one', file: 'duplicate.md' },
        { id: 'good-two', file: 'good-two.md' },
      ]),
      documents: {
        'good-one.md': md(
          ['id: good-one', 'template: text', 'order: 1', 'title: The first one'],
          'First body.',
        ),
        'broken.md': 'No frontmatter block at all, just prose.',
        'no-title.md': md(
          ['id: no-title', 'template: banner', 'order: 2'],
          'Body without a title.',
        ),
        'duplicate.md': md(
          ['id: good-one', 'template: text', 'order: 3', 'title: A second take'],
          'A second take.',
        ),
        'good-two.md': md(
          ['id: good-two', 'template: text', 'order: 4', 'title: The second one'],
          'Second body.',
        ),
      },
      now: NOW,
    })

    expect(result.slides.map((slide) => slide.id)).toEqual(['good-one', 'good-two'])
    expect(result.warnings.map((warning) => warning.id)).toEqual([
      'no-such-file',
      'broken-frontmatter',
      'no-title',
      'good-one',
    ])
    for (const warning of result.warnings) expect(warning.reason).not.toBe('')
    expect(result.schemaAhead).toBe(false)
  })

  it('an entry outside its visibility window never reaches the feed', () => {
    const result = buildFeed({
      index: index([
        { id: 'not-yet', file: 'not-yet.md' },
        { id: 'expired', file: 'expired.md' },
        { id: 'current', file: 'current.md' },
        { id: 'unbounded', file: 'unbounded.md' },
      ]),
      documents: {
        'not-yet.md': md(
          [
            'id: not-yet',
            'template: text',
            'order: 1',
            'title: Not yet',
            'visibleFrom: 2026-10-01T00:00:00Z',
          ],
          'Announced too early.',
        ),
        'expired.md': md(
          [
            'id: expired',
            'template: text',
            'order: 2',
            'title: Expired',
            'visibleUntil: 2026-09-01T00:00:00Z',
          ],
          'Old news.',
        ),
        'current.md': md(
          [
            'id: current',
            'template: text',
            'order: 3',
            'title: Current',
            'visibleFrom: 2026-09-01T00:00:00Z',
            'visibleUntil: 2026-09-30T00:00:00Z',
          ],
          'Inside the window.',
        ),
        'unbounded.md': md(
          ['id: unbounded', 'template: text', 'order: 4', 'title: Unbounded'],
          'Always visible.',
        ),
      },
      now: NOW,
    })

    expect(result.slides.map((slide) => slide.id)).toEqual(['current', 'unbounded'])
    // Being outside the window is normal content, not invalid data - it warns about nothing.
    expect(result.warnings).toEqual([])
  })

  it('order decides the sequence, filename and date do not', () => {
    const result = buildFeed({
      index: index([
        { id: 'a', file: 'zzz-oldest.md' },
        { id: 'b', file: 'aaa-newest.md' },
        { id: 'c', file: 'mmm-middle.md' },
        { id: 'd', file: 'ddd-tie.md' },
      ]),
      documents: {
        'zzz-oldest.md': md(
          [
            'id: a',
            'template: text',
            'order: 30',
            'title: Oldest file, last order',
            'date: 2020-01-01',
          ],
          'Sorts last.',
        ),
        'aaa-newest.md': md(
          ['id: b', 'template: text', 'order: 20', 'title: Newest date', 'date: 2026-09-09'],
          'Sorts second.',
        ),
        'mmm-middle.md': md(
          ['id: c', 'template: text', 'order: 10', 'title: First by order', 'date: 2024-06-01'],
          'Sorts first.',
        ),
        // Same `order` as c: keeps index.json's array order, so it lands right after c.
        'ddd-tie.md': md(
          ['id: d', 'template: text', 'order: 10', 'title: Ties with c', 'date: 2019-01-01'],
          'Ties with c.',
        ),
      },
      now: NOW,
    })

    expect(result.slides.map((slide) => slide.id)).toEqual(['c', 'd', 'b', 'a'])
    expect(result.slides.map((slide) => slide.order)).toEqual([10, 10, 20, 30])
  })

  it('each template is validated against its own fields, and an unknown template is delivered as text', () => {
    const result = buildFeed({
      index: index([
        { id: 'split-ok', file: 'split-ok.md' },
        { id: 'split-no-image', file: 'split-no-image.md' },
        { id: 'banner-ok', file: 'banner-ok.md' },
        { id: 'text-ok', file: 'text-ok.md' },
        { id: 'unknown-template', file: 'unknown-template.md' },
        { id: 'unknown-and-empty', file: 'unknown-and-empty.md' },
      ]),
      documents: {
        'split-ok.md': md(
          [
            'id: split-ok',
            'template: split',
            'order: 1',
            'title: A split slide',
            'image: img/a.png',
          ],
          'Body next to an image.',
        ),
        // Declared `split`, but a split has no second pane without an image -> text.
        'split-no-image.md': md(
          ['id: split-no-image', 'template: split', 'order: 2', 'title: No image here'],
          'Body only.',
        ),
        // `banner` is optionally backed by an image and stays a banner without one.
        'banner-ok.md': md(
          ['id: banner-ok', 'template: banner', 'order: 3', 'title: A banner slide'],
          'Full width body.',
        ),
        'text-ok.md': md(
          ['id: text-ok', 'template: text', 'order: 4', 'title: A text slide'],
          'Just prose.',
        ),
        // Unknown template, but title + body exist -> delivered as text (AC5).
        'unknown-template.md': md(
          ['id: unknown-template', 'template: carousel', 'order: 5', 'title: Still readable'],
          'Body survives the fallback.',
        ),
        // The folded decision: unknown template AND no image AND no title -> one drop.
        'unknown-and-empty.md': md(['id: unknown-and-empty', 'template: carousel', 'order: 6'], ''),
      },
      now: NOW,
    })

    expect(result.slides.map((slide) => [slide.id, slide.template])).toEqual([
      ['split-ok', 'split'],
      ['split-no-image', 'text'],
      ['banner-ok', 'banner'],
      ['text-ok', 'text'],
      ['unknown-template', 'text'],
    ])
    expect(result.slides[0].image).toBe('img/a.png')
    // The text fallback carries no image through, even though the source declared none.
    expect(result.slides[1].image).toBeUndefined()

    const warned = result.warnings.filter((warning) => warning.id === 'unknown-template')
    expect(warned).toHaveLength(1)
    expect(warned[0].reason).toContain('carousel')

    // One entry, one decision: the dropped one warns exactly once, not once per failed check.
    const dropped = result.warnings.filter((warning) => warning.id === 'unknown-and-empty')
    expect(dropped).toHaveLength(1)
    expect(dropped[0].reason).toContain('dropped')
  })

  it('a fourth button and an off-allowlist URL are dropped with a warning', () => {
    const result = buildFeed({
      index: index([{ id: 'buttons', file: 'buttons.md' }]),
      documents: {
        'buttons.md': md(
          [
            'id: buttons',
            'template: text',
            'order: 1',
            'title: Lots of buttons',
            'buttons:',
            '  - label: One',
            `    url: ${ALLOWED_URL}`,
            '  - label: Evil',
            '    url: https://evil.example.com/payload',
            '  - label: Two',
            `    url: ${ALLOWED_RAW_URL}`,
            '  - label: Insecure',
            '    url: http://github.com/insecure',
            '  - label: Three',
            `    url: ${ALLOWED_URL}#three`,
            '  - label: Four',
            `    url: ${ALLOWED_URL}#four`,
          ],
          'Body.',
        ),
      },
      now: NOW,
    })

    expect(result.slides).toHaveLength(1)
    // Filter first, then cap: the two rejected urls do not eat a slot from the allowed ones.
    expect(result.slides[0].buttons.map((button) => button.label)).toEqual(['One', 'Two', 'Three'])

    const reasons = result.warnings.map((warning) => warning.reason)
    expect(reasons).toHaveLength(3)
    expect(reasons.filter((reason) => reason.includes('allowlisted host'))).toHaveLength(2)
    expect(reasons.some((reason) => reason.includes('beyond the cap of 3'))).toBe(true)
    for (const warning of result.warnings) expect(warning.id).toBe('buttons')
  })

  it('the pipeline touches neither fs nor network', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'feed-pipeline.ts'),
      'utf8',
    )

    // Static: the module's entire import surface, nothing filesystem- or network-shaped.
    const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])
    expect(specifiers.length).toBeGreaterThan(0)
    expect(new Set(specifiers)).toEqual(new Set(['@shared/modules/home', 'zod', './frontmatter']))
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/Date\.now\s*\(/)
    expect(source).not.toMatch(/new Date\s*\(/)

    // Dynamic: it also cannot be reaching for them at runtime - a call with in-memory
    // inputs completes synchronously and never touches the global `fetch`.
    const original = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (() => {
      fetchCalls += 1
      throw new Error('the pipeline must not fetch')
    }) as typeof globalThis.fetch
    try {
      const result = buildFeed({
        index: index([{ id: 'pure', file: 'pure.md' }]),
        documents: {
          'pure.md': md(['id: pure', 'template: text', 'order: 1', 'title: Pure'], 'Body.'),
        },
        now: NOW,
      })
      expect(result.slides).toHaveLength(1)
      expect(result.slides).toBeInstanceOf(Array)
    } finally {
      globalThis.fetch = original
    }
    expect(fetchCalls).toBe(0)
  })

  it('reports a feed whose schemaVersion is ahead of this launcher', () => {
    const ahead = buildFeed({
      index: index([], NEWS_SCHEMA_VERSION + 1),
      documents: {},
      now: NOW,
    })
    expect(ahead.schemaAhead).toBe(true)

    const same = buildFeed({ index: index([]), documents: {}, now: NOW })
    expect(same.schemaAhead).toBe(false)
  })

  it('answers an empty feed with a warning when the index itself is unusable', () => {
    for (const bad of [
      undefined,
      null,
      42,
      'not json',
      {},
      { schemaVersion: 1 },
      { entries: {} },
    ]) {
      const result = buildFeed({ index: bad, documents: {}, now: NOW })
      expect(result.slides).toEqual([])
      expect(result.warnings).toHaveLength(1)
      expect(result.schemaAhead).toBe(false)
    }
  })

  it('keeps an entry whose visibility dates are malformed, and warns about them', () => {
    const result = buildFeed({
      index: index([{ id: 'typo', file: 'typo.md' }]),
      documents: {
        'typo.md': md(
          [
            'id: typo',
            'template: text',
            'order: 1',
            'title: Date typo',
            'visibleFrom: yesterday-ish',
            'visibleUntil: soon',
          ],
          'Body.',
        ),
      },
      now: NOW,
    })

    expect(result.slides.map((slide) => slide.id)).toEqual(['typo'])
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings.every((warning) => warning.reason.includes('not a date'))).toBe(true)
  })

  it('sorts an entry without a usable order after the ordered ones and warns', () => {
    const result = buildFeed({
      index: index([
        { id: 'unordered', file: 'unordered.md' },
        { id: 'ordered', file: 'ordered.md' },
      ]),
      documents: {
        'unordered.md': md(['id: unordered', 'template: text', 'title: No order'], 'Body.'),
        'ordered.md': md(['id: ordered', 'template: text', 'order: 7', 'title: Ordered'], 'Body.'),
      },
      now: NOW,
    })

    expect(result.slides.map((slide) => slide.id)).toEqual(['ordered', 'unordered'])
    expect(result.warnings.map((warning) => warning.id)).toEqual(['unordered'])
  })

  it('delivers an empty buttons list when the document declares none', () => {
    const result = buildFeed({
      index: index([{ id: 'plain', file: 'plain.md' }]),
      documents: {
        'plain.md': md(['id: plain', 'template: text', 'order: 1', 'title: Plain'], 'Body.'),
      },
      now: NOW,
    })

    expect(result.slides[0].buttons).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('carries visibleFrom/visibleUntil through onto the delivered slide', () => {
    const result = buildFeed({
      index: index([{ id: 'windowed', file: 'windowed.md' }]),
      documents: {
        'windowed.md': md(
          [
            'id: windowed',
            'template: text',
            'order: 1',
            'title: Windowed',
            'visibleFrom: 2026-09-01T00:00:00Z',
            'visibleUntil: 2026-09-30T00:00:00Z',
          ],
          'Body.',
        ),
      },
      now: NOW,
    })

    expect(result.slides[0].visibleFrom).toBe('2026-09-01T00:00:00Z')
    expect(result.slides[0].visibleUntil).toBe('2026-09-30T00:00:00Z')
  })
})

describe('resolveFeed', () => {
  it('returns not-yet-visible and expired entries unfiltered, while buildFeed drops both (Decisions (Sprint))', () => {
    const input = {
      index: index([
        { id: 'not-yet', file: 'not-yet.md' },
        { id: 'expired', file: 'expired.md' },
        { id: 'current', file: 'current.md' },
      ]),
      documents: {
        'not-yet.md': md(
          [
            'id: not-yet',
            'template: text',
            'order: 1',
            'title: Not yet',
            'visibleFrom: 2026-10-01T00:00:00Z',
          ],
          'Announced too early.',
        ),
        'expired.md': md(
          [
            'id: expired',
            'template: text',
            'order: 2',
            'title: Expired',
            'visibleUntil: 2026-09-01T00:00:00Z',
          ],
          'Old news.',
        ),
        'current.md': md(
          ['id: current', 'template: text', 'order: 3', 'title: Current'],
          'Always visible.',
        ),
      },
    }

    const resolved = resolveFeed(input)
    // Unfiltered: both the not-yet-visible and the already-expired entry are present.
    expect(resolved.slides.map((slide) => slide.id)).toEqual(['not-yet', 'expired', 'current'])
    expect(resolved.warnings).toEqual([])

    // The same inputs through buildFeed(), with `now` in between the two bounds, filter both out -
    // proving the two functions now differ exactly as intended.
    const built = buildFeed({ ...input, now: NOW })
    expect(built.slides.map((slide) => slide.id)).toEqual(['current'])
  })
})

describe('filterAndSortSlides', () => {
  function slide(overrides: Partial<NewsSlide> = {}): NewsSlide {
    return {
      id: 'x',
      template: 'text',
      order: 1,
      title: 'T',
      body: 'B',
      buttons: [],
      ...overrides,
    }
  }

  it('sorts survivors by order, stable on incoming order for ties', () => {
    const result = filterAndSortSlides(
      [
        slide({ id: 'c', order: 10 }),
        slide({ id: 'a', order: 30 }),
        slide({ id: 'b', order: 10 }),
      ],
      NOW,
    )
    expect(result.map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('re-filters correctly when called again with a later now - the delivery-time regression', () => {
    // Visible when the feed was originally built...
    const buildTime = new Date('2026-09-10T12:00:00.000Z')
    const slides = [
      slide({ id: 'expires-soon', order: 1, visibleUntil: '2026-09-12T00:00:00Z' }),
      slide({ id: 'stays-visible', order: 2 }),
    ]
    const atBuildTime = filterAndSortSlides(slides, buildTime)
    expect(atBuildTime.map((s) => s.id)).toEqual(['expires-soon', 'stays-visible'])

    // ...but expired by the time of a later delivery (e.g. a cache read three days later, per the
    // story's Decision) - the same slides, the same function, only `now` has moved on.
    const laterDelivery = new Date('2026-09-15T00:00:00.000Z')
    const atLaterDelivery = filterAndSortSlides(slides, laterDelivery)
    expect(atLaterDelivery.map((s) => s.id)).toEqual(['stays-visible'])
  })
})
