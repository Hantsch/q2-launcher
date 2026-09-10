import { describe, expect, it } from 'vitest'
import { getModuleManifest } from '@shared/types'
import type { AppContext } from '../../context'
import { MainModuleRegistry } from '../registry'
import { homeModule } from './index'

/**
 * Story 081 D1: home becomes a registered module rather than a shell-hardcoded
 * screen. Its manifest is `available` and must stay that way once its
 * main-process half is registered - `MainModuleRegistry.manifests()`
 * downgrades any manifest whose module never registered to `planned`.
 */

function fakeAppContext(): AppContext {
  return {} as unknown as AppContext
}

describe('home module', () => {
  it('the home module is registered and stays available', async () => {
    const manifest = getModuleManifest('home')

    expect(manifest).toBeDefined()
    expect(manifest?.route).toBe('/home')
    expect(manifest?.nav).toBeNull()
    expect(manifest?.status).toBe('available')
    expect(manifest?.capabilities).toEqual([])

    const registry = new MainModuleRegistry()
    await registry.register(homeModule, fakeAppContext())

    const registeredManifest = registry.manifests().find((m) => m.id === 'home')
    expect(registeredManifest?.status).toBe('available')
  })
})
