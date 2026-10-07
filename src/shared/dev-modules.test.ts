import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('./dev-modules')
  vi.resetModules()
})

async function manifestIds(devModules: boolean): Promise<string[]> {
  vi.resetModules()
  vi.doMock('./dev-modules', () => ({
    DEV_MODULES: devModules,
    DEV_MODULE_IDS: ['mods', 'assets'],
  }))
  const { MODULE_MANIFESTS } = await import('./types/module')
  return MODULE_MANIFESTS.map((manifest) => manifest.id)
}

describe('dev-only modules', () => {
  it('a dev build has every module', async () => {
    expect(await manifestIds(true)).toEqual(
      expect.arrayContaining(['home', 'library', 'config', 'downloads', 'mods', 'assets']),
    )
  })

  it('a release build has neither mods nor assets', async () => {
    const ids = await manifestIds(false)
    expect(ids).not.toContain('mods')
    expect(ids).not.toContain('assets')
    expect(ids).toEqual(
      expect.arrayContaining(['home', 'library', 'config', 'downloads', 'servers', 'replays']),
    )
  })
})
