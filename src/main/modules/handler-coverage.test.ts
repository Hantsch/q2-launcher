import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { CONFIG_HANDLERS } from '@shared/modules/config'
import { DOWNLOADS_HANDLERS } from '@shared/modules/downloads'
import { HOME_HANDLERS } from '@shared/modules/home'
import { LIBRARY_HANDLERS } from '@shared/modules/library'
import { MODS_HANDLERS } from '@shared/modules/mods'
import { REPLAYS_HANDLERS } from '@shared/modules/replays'
import { SERVERS_HANDLERS, SERVERS_WATCHLIST_HANDLERS } from '@shared/modules/servers'
import type { ModuleId } from '@shared/types'
import { ALL_UNLOCKED_FEATURE_GATE, stubbedAppContext } from '../../test-support/app-context'
import { MODULES } from './index'
import { MainModuleRegistry } from './registry'

/** Module setup builds its caches under `userData`; point that at a throwaway folder. */
const userData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => userData.dir } }))

userData.dir = mkdtempSync(join(tmpdir(), 'handler-coverage-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

/** Every handler type each loaded module must register; `assets` has no main half yet. */
const DECLARED: Partial<Record<ModuleId, readonly string[]>> = {
  config: Object.values(CONFIG_HANDLERS),
  downloads: Object.values(DOWNLOADS_HANDLERS),
  home: Object.values(HOME_HANDLERS),
  library: Object.values(LIBRARY_HANDLERS),
  mods: Object.values(MODS_HANDLERS),
  replays: Object.values(REPLAYS_HANDLERS),
  servers: [...Object.values(SERVERS_HANDLERS), ...Object.values(SERVERS_WATCHLIST_HANDLERS)],
}

describe('handler coverage', () => {
  it('declares every loaded module', () => {
    expect(MODULES.map((module) => module.id).sort()).toEqual(Object.keys(DECLARED).sort())
  })

  it.each(MODULES.map((module) => [module.id, module] as const))(
    'every module registers exactly its declared handlers (%s)',
    async (id, module) => {
      const registry = new MainModuleRegistry(ALL_UNLOCKED_FEATURE_GATE)
      try {
        await registry.register(module, stubbedAppContext())

        expect(registry.registered()).toContain(id)
        expect(registry.handlerTypes(id)).toEqual([...(DECLARED[id] ?? [])].sort())
      } finally {
        await registry.disposeAll()
      }
    },
  )
})
