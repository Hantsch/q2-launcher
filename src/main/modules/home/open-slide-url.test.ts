import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openSlideUrl } from './open-slide-url'
import type { Logger } from '../../lib/logger'

/**
 * Story 083 D5 (AC8): `openSlideUrl` opens only `http(s)` URLs whose host is on 082's
 * `NEWS_BUTTON_HOST_ALLOWLIST` and never throws.
 */

const shellOpenExternal = vi.fn()

function fakeLog(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

beforeEach(() => {
  shellOpenExternal.mockClear()
})

describe('openSlideUrl', () => {
  it('opens an allowed https host', async () => {
    const log = fakeLog()

    const result = await openSlideUrl(
      'https://github.com/Hantsch/q2_community_content',
      shellOpenExternal,
      log,
    )

    expect(shellOpenExternal).toHaveBeenCalledWith(
      'https://github.com/Hantsch/q2_community_content',
    )
    expect(result).toEqual({ ok: true, value: null })
  })

  it('opens an allowed http host - the scheme check accepts both http and https', async () => {
    const log = fakeLog()

    const result = await openSlideUrl(
      'http://raw.githubusercontent.com/a/b/c.md',
      shellOpenExternal,
      log,
    )

    expect(shellOpenExternal).toHaveBeenCalledWith('http://raw.githubusercontent.com/a/b/c.md')
    expect(result.ok).toBe(true)
  })

  it('refuses a host outside the allowlist and never opens it', async () => {
    const log = fakeLog()

    const result = await openSlideUrl('https://evil.example.com/x', shellOpenExternal, log)

    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: { key: 'app.error.invalidUrl' } })
  })

  it('refuses a non-http(s) scheme even when the host string matches the allowlist', async () => {
    const log = fakeLog()

    const fileResult = await openSlideUrl('file://github.com/x', shellOpenExternal, log)
    const jsResult = await openSlideUrl('javascript://github.com/alert(1)', shellOpenExternal, log)

    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(fileResult.ok).toBe(false)
    expect(jsResult.ok).toBe(false)
  })

  it('refuses a malformed url without throwing', async () => {
    const log = fakeLog()

    const result = await openSlideUrl('not-a-url', shellOpenExternal, log)

    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: { key: 'app.error.invalidUrl' } })
  })
})
