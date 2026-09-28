import { describe, expect, it } from 'vitest'
import { REPLAYS_HANDLERS } from '@shared/modules/replays'
import { getModuleManifest } from '@shared/types'
import type { AppContext } from '../../context'
import { MainModuleRegistry } from '../registry'
import { replaysModule } from './index'

/**
 * Story 135 D2: the replays module gets its main half - a single handler, `overview.read`,
 * answering a hardcoded zeroed overview. Mirrors
 * `src/main/modules/servers/index.test.ts`'s first `describe` block's shape (registration,
 * a successful round trip, a rejected bad payload) plus a check that the handler is only
 * reachable under this module's own id, not another module's.
 */
function fakeAppContext(): AppContext {
  const broadcast = { emit: () => {} }
  return { broadcast } as unknown as AppContext
}

describe('replays module', () => {
  it('the replays module registers its main half under its own id', async () => {
    const manifest = getModuleManifest('replays')
    expect(manifest).toBeDefined()

    const registry = new MainModuleRegistry()
    await registry.register(replaysModule, fakeAppContext())

    expect(registry.registered()).toContain('replays')

    const outcome = await registry.invoke({
      moduleId: 'replays',
      type: REPLAYS_HANDLERS.overviewRead,
      payload: undefined,
    })
    expect(outcome).toEqual({ ok: true, value: { scanning: false, demoCount: 0 } })

    // Story 140 D2 registers the seven `nameTemplates.*` handlers alongside `overview.read` -
    // `Object.values(REPLAYS_HANDLERS)` is exactly this module's full registered set.
    expect(Object.values(REPLAYS_HANDLERS)).toEqual([
      'overview.read',
      'nameTemplates.list',
      'nameTemplates.add',
      'nameTemplates.update',
      'nameTemplates.remove',
      'nameTemplates.reorder',
      'nameTemplates.reset',
      'nameTemplates.restore',
    ])
  })

  it('a bad overview.read payload is rejected', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(replaysModule, fakeAppContext())

    const outcome = await registry.invoke({
      moduleId: 'replays',
      type: REPLAYS_HANDLERS.overviewRead,
      payload: { foo: 'bar' },
    })

    expect(outcome).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })

  it('replays handlers are not reachable under another module\'s id', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(replaysModule, fakeAppContext())

    for (const moduleId of ['servers', 'home'] as const) {
      const outcome = await registry.invoke({
        moduleId,
        type: REPLAYS_HANDLERS.overviewRead,
        payload: undefined,
      })

      expect(outcome).toEqual({
        ok: false,
        error: { key: 'modules.error.notImplemented', params: { moduleId, type: REPLAYS_HANDLERS.overviewRead } },
      })
    }
  })
})
