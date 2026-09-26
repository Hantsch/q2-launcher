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
    expect(manifest?.capabilities).toEqual(
      expect.arrayContaining(['network', 'game-lifecycle']),
    )
    expect(manifest?.capabilities).toHaveLength(2)
  })

  it('every module\'s ipcNamespace is module: plus its id', () => {
    for (const manifest of MODULE_MANIFESTS) {
      expect(manifest.ipcNamespace).toBe(`module:${manifest.id}`)
    }
  })
})
