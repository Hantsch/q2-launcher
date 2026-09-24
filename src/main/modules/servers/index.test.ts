import { describe, expect, it } from 'vitest'
import { getModuleManifest } from '@shared/types'
import type { AppContext } from '../../context'
import { MainModuleRegistry } from '../registry'
import { serversModule } from './index'

/**
 * Story 106 D2: the servers module gets its main half - a single handler,
 * `overview.read`, answering a hardcoded zeroed overview. Mirrors
 * `src/main/modules/home/index.test.ts`'s structure.
 */

function fakeAppContext(): AppContext {
  return {} as unknown as AppContext
}

describe('servers module', () => {
  it('the servers module registers its main half under its own id', async () => {
    const manifest = getModuleManifest('servers')
    expect(manifest).toBeDefined()

    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext())

    expect(registry.registered()).toContain('servers')
  })

  it('overview.read resolves the zeroed overview through the registry', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext())

    const outcome = await registry.invoke({
      moduleId: 'servers',
      type: 'overview.read',
      payload: undefined,
    })

    expect(outcome).toEqual({
      ok: true,
      value: { scanning: false, knownServerCount: 0, lastScanAt: null },
    })
  })

  it('rejects a bad payload to overview.read', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext())

    const outcome = await registry.invoke({
      moduleId: 'servers',
      type: 'overview.read',
      payload: { unexpected: 'value' },
    })

    expect(outcome).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })
})
