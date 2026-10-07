import { describe, expect, it } from 'vitest'
import { getModuleManifest, MODULE_MANIFESTS } from './module'

describe('servers module manifest (story 106 D1)', () => {
  it('servers is registered in ModuleId and MODULE_MANIFESTS with the decided route, nav slot and status', () => {
    const manifest = getModuleManifest('servers')
    expect(manifest).toBeDefined()
    expect(manifest?.route).toBe('/servers')
    expect(manifest?.nav).toEqual({ section: 'primary', order: 20 })
    expect(manifest?.status).toBe('available')
    expect(manifest?.icon).toBe('Globe')
    expect(manifest?.ipcNamespace).toBe('module:servers')
    expect(manifest?.requiresInstallation).toBe(false)
  })

  it('the servers manifest declares exactly the network and game-lifecycle capabilities', () => {
    const manifest = getModuleManifest('servers')
    expect(manifest?.capabilities).toEqual(expect.arrayContaining(['network', 'game-lifecycle']))
    expect(manifest?.capabilities).toHaveLength(2)
  })

  it("every module's ipcNamespace is module: plus its id", () => {
    for (const manifest of MODULE_MANIFESTS) {
      expect(manifest.ipcNamespace).toBe(`module:${manifest.id}`)
    }
  })
})

describe('replays module manifest (story 135 D1)', () => {
  it('replays is registered in ModuleId and MODULE_MANIFESTS with the decided route, nav slot, icon and status', () => {
    const manifest = getModuleManifest('replays')
    expect(manifest).toBeDefined()
    expect(manifest?.route).toBe('/replays')
    expect(manifest?.nav).toEqual({ section: 'primary', order: 25 })
    expect(manifest?.icon).toBe('Film')
    expect(manifest?.status).toBe('available')

    const primaryOrdered = MODULE_MANIFESTS.filter((m) => m.nav?.section === 'primary')
      .slice()
      .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0))
      .map((m) => m.id)
    const serversIndex = primaryOrdered.indexOf('servers')
    const replaysIndex = primaryOrdered.indexOf('replays')
    const configIndex = primaryOrdered.indexOf('config')
    expect(replaysIndex).toBe(serversIndex + 1)
    expect(configIndex).toBe(replaysIndex + 1)
  })

  it('the replays manifest declares exactly the mutates-installation and game-lifecycle capabilities', () => {
    const manifest = getModuleManifest('replays')
    expect(manifest?.capabilities).toEqual(
      expect.arrayContaining(['mutates-installation', 'game-lifecycle']),
    )
    expect(manifest?.capabilities).toHaveLength(2)
  })
})
