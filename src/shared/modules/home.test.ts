import { describe, expect, it } from 'vitest'
import {
  HOME_EVENTS,
  HOME_HANDLERS,
  NEWS_BUTTON_HOST_ALLOWLIST,
  NEWS_HANDLER_SCHEMAS,
  NEWS_SCHEMA_VERSION,
  isAllowedButtonHost,
  newsBannerContentSchema,
  newsButtonSchema,
  openSlideUrlInputSchema,
  newsSplitContentSchema,
  newsTextContentSchema,
} from './home'

describe('home module contract (story 082 D1)', () => {
  it('every handler has an exported payload schema', () => {
    for (const name of Object.values(HOME_HANDLERS)) {
      expect(NEWS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('the no-input news handlers accept undefined', () => {
    expect(NEWS_HANDLER_SCHEMAS[HOME_HANDLERS.newsGet].safeParse(undefined).success).toBe(true)
    expect(NEWS_HANDLER_SCHEMAS[HOME_HANDLERS.newsRefresh].safeParse(undefined).success).toBe(true)
  })

  it('openSlideUrl requires a non-empty string, not undefined (story 083 D5)', () => {
    expect(openSlideUrlInputSchema.safeParse(undefined).success).toBe(false)
    expect(openSlideUrlInputSchema.safeParse('').success).toBe(false)
    expect(openSlideUrlInputSchema.safeParse('https://github.com/x').success).toBe(true)
  })

  it('names news.get / news.refresh / news.changed / slide.openUrl exactly', () => {
    expect(HOME_HANDLERS).toEqual({
      newsGet: 'news.get',
      newsRefresh: 'news.refresh',
      openSlideUrl: 'slide.openUrl',
    })
    expect(HOME_EVENTS).toEqual({ newsChanged: 'news.changed' })
  })

  it('pins the schema version this launcher understands', () => {
    expect(NEWS_SCHEMA_VERSION).toBe(1)
  })
})

describe('newsButtonSchema', () => {
  it('accepts a label and a well-formed url', () => {
    expect(newsButtonSchema.safeParse({ label: 'Get it', url: 'https://github.com/x' }).success).toBe(
      true,
    )
  })

  it('rejects a missing label, an empty label, or a malformed url', () => {
    expect(newsButtonSchema.safeParse({ url: 'https://github.com/x' }).success).toBe(false)
    expect(newsButtonSchema.safeParse({ label: '', url: 'https://github.com/x' }).success).toBe(false)
    expect(newsButtonSchema.safeParse({ label: 'Get it', url: 'not-a-url' }).success).toBe(false)
  })

  it('rejects unknown fields', () => {
    expect(
      newsButtonSchema.safeParse({ label: 'Get it', url: 'https://github.com/x', extra: 1 }).success,
    ).toBe(false)
  })
})

describe('per-template content schemas', () => {
  it('newsTextContentSchema needs only title and body', () => {
    expect(newsTextContentSchema.safeParse({ title: 't', body: 'b' }).success).toBe(true)
    expect(newsTextContentSchema.safeParse({ title: 't' }).success).toBe(false)
    expect(newsTextContentSchema.safeParse({ body: 'b' }).success).toBe(false)
  })

  it('newsTextContentSchema rejects an image field', () => {
    expect(newsTextContentSchema.safeParse({ title: 't', body: 'b', image: 'x.png' }).success).toBe(
      false,
    )
  })

  it('newsSplitContentSchema/newsBannerContentSchema accept title+body with an optional image', () => {
    expect(newsSplitContentSchema.safeParse({ title: 't', body: 'b' }).success).toBe(true)
    expect(newsSplitContentSchema.safeParse({ title: 't', body: 'b', image: 'x.png' }).success).toBe(
      true,
    )
    expect(newsBannerContentSchema.safeParse({ title: 't', body: 'b', image: 'x.png' }).success).toBe(
      true,
    )
    expect(newsSplitContentSchema.safeParse({ body: 'b' }).success).toBe(false)
  })

  it('every content schema caps buttons at 3', () => {
    const buttons = Array.from({ length: 4 }, (_, i) => ({
      label: `b${i}`,
      url: 'https://github.com/x',
    }))
    expect(newsTextContentSchema.safeParse({ title: 't', body: 'b', buttons }).success).toBe(false)
    expect(newsTextContentSchema.safeParse({ title: 't', body: 'b', buttons: buttons.slice(0, 3) }).success).toBe(
      true,
    )
  })
})

describe('NEWS_BUTTON_HOST_ALLOWLIST / isAllowedButtonHost', () => {
  it('lists exactly the community content repo hosts', () => {
    expect(NEWS_BUTTON_HOST_ALLOWLIST).toEqual(['github.com', 'raw.githubusercontent.com'])
  })

  it('allows an exact, https, allowlisted host', () => {
    expect(isAllowedButtonHost('https://github.com/Hantsch/q2_community_content/releases')).toBe(
      true,
    )
    expect(isAllowedButtonHost('https://raw.githubusercontent.com/a/b/main/c.md')).toBe(true)
  })

  it('rejects http, a subdomain, an unlisted host, and a malformed url', () => {
    expect(isAllowedButtonHost('http://github.com/x')).toBe(false)
    expect(isAllowedButtonHost('https://gist.github.com/x')).toBe(false)
    expect(isAllowedButtonHost('https://example.com/x')).toBe(false)
    expect(isAllowedButtonHost('not-a-url')).toBe(false)
  })
})
