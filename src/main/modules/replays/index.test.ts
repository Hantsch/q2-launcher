import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demosListResultSchema, REPLAYS_HANDLERS } from '@shared/modules/replays'
import { getModuleManifest } from '@shared/types'
import { canonicalizePath } from '../../lib/fs-utils'
import { UI_HARNESS_ENV } from '../../lib/ui-harness'
import type { AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { MainModuleRegistry } from '../registry'
import { discoveryHomeDir, replaysModule } from './index'

/**
 * `demos.list` calls `discoveryHomeDir()` with no overrides, which falls back to `userDataDir()` -
 * `electron.app.getPath('userData')`. Mocked the same way `downloads/index.test.ts` mocks it: a
 * per-test temp folder, never the real userData dir.
 */
const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

/**
 * Story 135 D2: the replays module gets its main half - a single handler, `overview.read`,
 * answering a hardcoded zeroed overview. Mirrors
 * `src/main/modules/servers/index.test.ts`'s first `describe` block's shape (registration,
 * a successful round trip, a rejected bad payload) plus a check that the handler is only
 * reachable under this module's own id, not another module's.
 */
function fakeAppContext(installations: unknown[] = []): AppContext {
  const broadcast = { emit: () => {} }
  return {
    broadcast,
    installations: { list: () => installations },
    state: { replaysState: () => ({ extraFolders: [] }) },
  } as unknown as AppContext
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
      'demos.list',
      'extraFolders.list',
      'extraFolders.add',
      'extraFolders.remove',
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

  describe('demos.list', () => {
    let dir: string

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'q2-launcher-replays-index-'))
      userDataBox.current = dir
    })

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    })

    it('demos.list returns the discovered demos without paths', async () => {
      const demosDir = join(dir, 'baseq2', 'demos')
      await mkdir(demosDir, { recursive: true })
      await writeFile(join(demosDir, 'x.dm2'), 'x')

      const installation = {
        id: 'inst-1',
        name: 'Installation One',
        rootPath: dir,
        gameDirs: ['baseq2'],
        engineKind: 'r1q2',
        recordedEngineKind: undefined,
        writeDirPath: undefined,
      }

      const registry = new MainModuleRegistry()
      await registry.register(replaysModule, fakeAppContext([installation]))

      const outcome = await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.demosList,
        payload: undefined,
      })

      expect(outcome.ok).toBe(true)
      if (!outcome.ok) throw new Error('expected ok outcome')
      const parsed = demosListResultSchema.parse(outcome.value)
      expect(parsed.map((d) => d.fileName)).toEqual(['x.dm2'])
      for (const entry of parsed) {
        expect(entry).not.toHaveProperty('absolutePath')
      }
    })

    it('a bad demos.list payload is rejected', async () => {
      const registry = new MainModuleRegistry()
      await registry.register(replaysModule, fakeAppContext())

      const outcome = await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.demosList,
        payload: { foo: 'bar' },
      })

      expect(outcome).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    })
  })

  describe('extraFolders.* handlers (story 142 D2)', () => {
    let filePath: string
    let state: StateStore
    let dir: string

    beforeEach(async () => {
      filePath = join(tmpdir(), `q2-launcher-replays-index-state-${randomUUID()}.json`)
      state = new StateStore(filePath)
      await state.load()
      dir = await mkdtemp(join(tmpdir(), 'q2-launcher-replays-index-extra-'))
    })

    afterEach(async () => {
      await rm(filePath, { force: true })
      await rm(`${filePath}.tmp`, { force: true })
      await rm(`${filePath}.bak`, { force: true })
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    })

    it('extra folders added through the handler survive a new StateStore on the same file', async () => {
      const appContext = {
        broadcast: { emit: () => {} },
        installations: { list: () => [] },
        state,
      } as unknown as AppContext

      const registry = new MainModuleRegistry()
      await registry.register(replaysModule, appContext)

      const outcome = await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.extraFoldersAdd,
        payload: { path: dir },
      })
      expect(outcome.ok).toBe(true)
      await state.settle()

      const reloaded = new StateStore(filePath)
      await reloaded.load()
      const expectedCanonical = await canonicalizePath(dir)
      expect(reloaded.replaysState().extraFolders).toEqual([
        expect.objectContaining({ path: expectedCanonical }),
      ])
    })
  })

  describe('discoveryHomeDir', () => {
    it('the harness never reads the real home dir', () => {
      const harnessEnv = { [UI_HARNESS_ENV]: '1' }
      const disabledEnv = {}
      const userData = 'C:\\fake\\userData'
      const osHome = 'C:\\fake\\real-home'

      expect(discoveryHomeDir({ env: harnessEnv, userData, osHome })).toBe(
        join(userData, 'harness-home'),
      )
      expect(discoveryHomeDir({ env: disabledEnv, userData, osHome })).toBe(osHome)
    })
  })
})
