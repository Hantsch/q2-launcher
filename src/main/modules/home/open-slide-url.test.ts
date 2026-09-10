import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '../../lib/logger'

/**
 * Story 083 D5 (AC8): `openSlideUrl` opens only `http(s)` URLs whose host is on 082's
 * `NEWS_BUTTON_HOST_ALLOWLIST` and never throws. `electron` is mocked exactly as in
 * `main/ipc/app.test.ts` - just enough that `shell.openExternal` can be spied on without a real
 * Electron runtime.
 */

const shellOpenExternal = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  shell: { openExternal: shellOpenExternal },
}))

function fakeLog(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

beforeEach(() => {
  vi.resetModules()
  shellOpenExternal.mockClear()
})

describe('openSlideUrl', () => {
  it('opens an allowed https host', async () => {
    const { openSlideUrl } = await import('./open-slide-url')
    const log = fakeLog()

    const result = await openSlideUrl('https://github.com/Hantsch/q2_community_content', log)

    expect(shellOpenExternal).toHaveBeenCalledWith(
      'https://github.com/Hantsch/q2_community_content',
    )
    expect(result).toEqual({ ok: true, value: null })
  })

  it('opens an allowed http host - the scheme check accepts both http and https', async () => {
    const { openSlideUrl } = await import('./open-slide-url')
    const log = fakeLog()

    const result = await openSlideUrl('http://raw.githubusercontent.com/a/b/c.md', log)

    expect(shellOpenExternal).toHaveBeenCalledWith('http://raw.githubusercontent.com/a/b/c.md')
    expect(result.ok).toBe(true)
  })

  it('refuses a host outside the allowlist and never calls shell.openExternal', async () => {
    const { openSlideUrl } = await import('./open-slide-url')
    const log = fakeLog()

    const result = await openSlideUrl('https://evil.example.com/x', log)

    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: { key: 'home.error.urlNotAllowed' } })
  })

  it('refuses a non-http(s) scheme even when the host string matches the allowlist', async () => {
    const { openSlideUrl } = await import('./open-slide-url')
    const log = fakeLog()

    const fileResult = await openSlideUrl('file://github.com/x', log)
    const jsResult = await openSlideUrl('javascript://github.com/alert(1)', log)

    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(fileResult.ok).toBe(false)
    expect(jsResult.ok).toBe(false)
  })

  it('refuses a malformed url without throwing', async () => {
    const { openSlideUrl } = await import('./open-slide-url')
    const log = fakeLog()

    const result = await openSlideUrl('not-a-url', log)

    expect(shellOpenExternal).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: { key: 'home.error.urlNotAllowed' } })
  })
})
