import { describe, expect, it } from 'vitest'
import { HARNESS_CONTENT_REPO_BASE_ENV, parseHarnessBaseUrl } from './ui-harness'

/**
 * Story 082 D4: `HARNESS_CONTENT_REPO_BASE_ENV` and `parseHarnessBaseUrl()` moved here from
 * `src/main/modules/downloads/harness.ts` so `src/main/modules/home/news/harness.ts` can reuse them
 * without a module-to-module import. This file covers the parser itself; what each caller *does*
 * with an `undefined` result (fall back to production vs. skip) is that caller's own test -
 * `downloads/harness.test.ts` and `home/news/harness.test.ts` respectively.
 */

describe('HARNESS_CONTENT_REPO_BASE_ENV', () => {
  it('is the variable name downloads and news both read', () => {
    expect(HARNESS_CONTENT_REPO_BASE_ENV).toBe('Q2L_UI_CONTENT_REPO_BASE')
  })
})

describe('parseHarnessBaseUrl', () => {
  it('accepts a bare http 127.0.0.1 origin', () => {
    expect(parseHarnessBaseUrl('http://127.0.0.1:53129')).toBe('http://127.0.0.1:53129')
  })

  it('accepts an https 127.0.0.1 origin', () => {
    expect(parseHarnessBaseUrl('https://127.0.0.1:53129')).toBe('https://127.0.0.1:53129')
  })

  it('normalises a trailing slash away', () => {
    expect(parseHarnessBaseUrl('http://127.0.0.1:53129/')).toBe('http://127.0.0.1:53129')
  })

  it('preserves a non-trailing-slash path', () => {
    expect(parseHarnessBaseUrl('http://127.0.0.1:53129/fixtures')).toBe(
      'http://127.0.0.1:53129/fixtures',
    )
  })

  it('answers undefined for undefined', () => {
    expect(parseHarnessBaseUrl(undefined)).toBeUndefined()
  })

  it('answers undefined for an empty string', () => {
    expect(parseHarnessBaseUrl('')).toBeUndefined()
  })

  it('refuses a non-loopback host', () => {
    expect(parseHarnessBaseUrl('http://example.test:8080')).toBeUndefined()
  })

  it('refuses localhost - only the literal 127.0.0.1 counts', () => {
    expect(parseHarnessBaseUrl('http://localhost:53129')).toBeUndefined()
  })

  it('refuses a neighbouring loopback address', () => {
    expect(parseHarnessBaseUrl('http://127.0.0.2:53129')).toBeUndefined()
  })

  it('refuses a non-http(s) scheme', () => {
    expect(parseHarnessBaseUrl('file:///C:/tmp/manifests')).toBeUndefined()
  })

  it('refuses junk that is not a URL at all', () => {
    expect(parseHarnessBaseUrl('not-a-url')).toBeUndefined()
  })
})
