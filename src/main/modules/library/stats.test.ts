import { describe, expect, it, vi } from 'vitest'
import type { Installation } from '@shared/types'
import type { LibraryStats } from '@shared/modules/library'
import { LIBRARY_HANDLERS } from '@shared/modules/library'
import type { Logger } from '../../lib/logger'
import type { ModuleHandler, ModuleSetup } from '../types'
import { libraryModule } from './index'

/**
 * Story 087 D1: `stats` grows `lastSession` - the installation with the newest `lastPlayedAt`,
 * derived the same way the handler already derives `byEngine`/the `count()` totals. Mirrors the
 * `handle()`-collecting pattern `downloads/index.test.ts` uses: a fake `ModuleSetup.handle` stores
 * each registered handler by channel name, so the test calls the real handler rather than
 * reimplementing its logic.
 */

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

/** Collects `handle()` calls without the schema-parsing wrapper - `stats` takes `z.void()`, so
 * there is no payload shape worth re-validating here. */
function collectHandlers(handlers: Map<string, ModuleHandler>): ModuleSetup['handle'] {
  return (type, _schema, handler) => {
    handlers.set(type, (payload) => handler(payload as never))
  }
}

async function setUpLibraryModule(installations: Installation[]): Promise<LibraryStats> {
  const handlers = new Map<string, ModuleHandler>()
  await libraryModule.setup({
    handle: collectHandlers(handlers),
    emit: vi.fn(),
    app: { installations: { list: () => installations } } as unknown as ModuleSetup['app'],
    log: fakeLogger(),
  })

  const handler = handlers.get(LIBRARY_HANDLERS.stats)
  if (!handler) throw new Error('stats handler was never registered')
  return (await handler(undefined)) as LibraryStats
}

const BASE_INSTALLATION: Installation = {
  id: 'fixture-install',
  name: 'Fixture',
  rootPath: 'C:/games/fixture',
  engineKind: 'r1q2',
  launchArgs: [],
  activeGameDir: '',
  source: 'manual',
  status: 'ok',
  checks: [],
  gameDirs: ['baseq2'],
  favorite: false,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  totalPlaytimeSeconds: 0,
}

function installation(overrides: Partial<Installation> = {}): Installation {
  return { ...BASE_INSTALLATION, ...overrides }
}

describe('library module stats handler', () => {
  it('reports the newest session', async () => {
    const stats = await setUpLibraryModule([
      installation({
        id: 'install-oldest',
        name: 'Oldest',
        sortOrder: 0,
        lastPlayedAt: '2026-01-01T00:00:00.000Z',
      }),
      installation({
        id: 'install-newest',
        name: 'Newest',
        sortOrder: 1,
        lastPlayedAt: '2026-03-15T12:30:00.000Z',
      }),
      installation({
        id: 'install-middle',
        name: 'Middle',
        sortOrder: 2,
        lastPlayedAt: '2026-02-01T00:00:00.000Z',
      }),
    ])

    expect(stats.lastSession).toEqual({
      installationId: 'install-newest',
      name: 'Newest',
      at: '2026-03-15T12:30:00.000Z',
    })
  })

  it('leaves lastSession undefined when nothing has ever been played', async () => {
    const stats = await setUpLibraryModule([
      installation({ id: 'install-a', name: 'A', sortOrder: 0 }),
      installation({ id: 'install-b', name: 'B', sortOrder: 1 }),
    ])

    expect(stats.lastSession).toBeUndefined()
  })
})
