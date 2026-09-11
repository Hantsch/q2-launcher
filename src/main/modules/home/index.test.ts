import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_HARNESS_ENV } from '../../lib/ui-harness'
import { getModuleManifest } from '@shared/types'
import type { AppContext } from '../../context'
import { MainModuleRegistry } from '../registry'
import { homeModule } from './index'

/**
 * Story 081 D1: home becomes a registered module rather than a shell-hardcoded
 * screen. Its manifest is `available` and must stay that way once its
 * main-process half is registered - `MainModuleRegistry.manifests()`
 * downgrades any manifest whose module never registered to `planned`.
 *
 * Story 082 D6 gives it `network` (the news feed) and its first handlers - registering it now
 * kicks off one fire-and-forget `refreshNews()` (see `index.ts`), so `isDev: true` with the
 * UI-harness gate open and no fixture base named is set here to make `resolveNewsSource()` answer
 * `skip`: this test registers the module, it does not want a real outbound request.
 *
 * That skip path is only reached after `refreshNews()` has already awaited `ensureLoaded()`, which
 * builds a real `NewsFeedCache` and calls `app.getPath('userData')` - a real Electron API, unusable
 * outside an Electron runtime. A clean-agent review found that with `electron` left unmocked here,
 * that call throws before `resolveNewsSource()` is ever consulted, so this test previously proved
 * nothing about the skip path it claims to cover. `electron` is mocked exactly as in
 * `feed-cache.test.ts`/`manifest-service.test.ts` (a per-test temp `userData` dir) so the module
 * genuinely reaches `resolveNewsSource()` and answers `skip`, without a real Electron dependency
 * throwing first.
 */

const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

function fakeAppContext(): AppContext {
  return { isDev: true } as unknown as AppContext
}

describe('home module', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-home-module-'))
    userDataBox.current = dir
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(dir, { recursive: true, force: true })
  })

  it('the home module is registered and stays available', async () => {
    vi.stubEnv(UI_HARNESS_ENV, '1')

    const manifest = getModuleManifest('home')

    expect(manifest).toBeDefined()
    expect(manifest?.route).toBe('/home')
    expect(manifest?.nav).toBeNull()
    expect(manifest?.status).toBe('available')
    expect(manifest?.capabilities).toEqual(['network'])

    const registry = new MainModuleRegistry()
    await registry.register(homeModule, fakeAppContext())

    const registeredManifest = registry.manifests().find((m) => m.id === 'home')
    expect(registeredManifest?.status).toBe('available')

    // Proves the skip path was actually reached end-to-end: `news.get` resolves (no cache on disk,
    // no fetch attempted) rather than the registration merely having survived a swallowed rejection.
    const outcome = await registry.invoke({ moduleId: 'home', type: 'news.get' })
    expect(outcome).toEqual({
      ok: true,
      value: { slides: [], retrievedAt: expect.any(String), schemaAhead: false, lastRefreshFailed: false },
    })
  })

  /**
   * The app-start `refreshNews()` call itself is unconditional - it is `resolveNewsSource()`
   * (called *inside* `refreshNews()`) that decides whether that turns into a real network request
   * or a no-op, based on the harness gate and whether a loopback base is configured
   * (`news/harness.ts`). An earlier version of `index.ts` gated the call itself behind
   * `isUiHarnessEnabled()`, which broke any harness-gated launch that *did* name a loopback base
   * (`scripts/flows/news-feed.mjs`) by never calling `refreshNews()` at all - a regression found by
   * running that flow against the full sprint branch. This test replaces `news/news-service` with a
   * bare double (`createNewsService` returning `refreshNews`/`getNews` spies, same shape
   * `homeModule.setup` calls against) so the startup call itself - not its downstream fetch/cache
   * behaviour, already covered by `news-service.test.ts` - can be asserted directly, with the
   * harness gate both on and off, without a real `fetch`/`shell.openExternal` ever running.
   */
  describe('the app-start refresh call', () => {
    afterEach(() => {
      vi.doUnmock('./news/news-service')
      vi.resetModules()
    })

    it.each([
      ['harness enabled', '1'],
      ['harness disabled', undefined],
    ])('runs the start refresh exactly once (%s)', async (_label, harnessValue) => {
      if (harnessValue !== undefined) {
        vi.stubEnv(UI_HARNESS_ENV, harnessValue)
      }
      vi.resetModules()
      const refreshNews = vi.fn(async () => undefined)
      const getNews = vi.fn(async () => undefined)
      vi.doMock('./news/news-service', () => ({
        createNewsService: () => ({ getNews, refreshNews }),
      }))

      const { homeModule: testedHomeModule } = await import('./index')
      const registry = new MainModuleRegistry()
      await registry.register(testedHomeModule, fakeAppContext())

      expect(refreshNews).toHaveBeenCalledTimes(1)
    })
  })
})
