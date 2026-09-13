// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { getModuleManifest } from '@shared/types'

// `./index` pulls in `DownloadsView` -> the renderer store -> `lib/bridge.ts`, which resolves
// `window.q2` at *module* scope - stubbed here the same way `AppShell.test.tsx` stubs it, since
// this test only asserts on the registry, not on any IPC traffic.
;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }

const { rendererModule } = await import('./index')

/**
 * Story 073 D3 (AC4): "the downloads module is registered and its manifest is available."
 *
 * Uses the real registry/manifest rather than a stub - this test exists specifically to prove
 * the `downloads` entry left `PlannedModuleView` behind, which a mocked `../../modules` (as
 * `AppShell.test.tsx` uses for an unrelated fallback check) would hide.
 */
describe('module registration', () => {
  it('the downloads module is registered with a real View', () => {
    const module = rendererModule('downloads')
    expect(module).toBeDefined()
    expect(module?.View).toBeDefined()
  })

  it("the downloads module's manifest status is available", () => {
    const manifest = getModuleManifest('downloads')
    expect(manifest?.status).toBe('available')
    // The planned-module copy stays in place, unused, per Decisions (Sprint).
    expect(manifest?.plannedIntroKey).toBe('module.planned.downloads.intro')
    expect(manifest?.plannedHighlightKeys?.length).toBeGreaterThan(0)
  })
})
