import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  demosListResultSchema,
  REPLAYS_HANDLERS,
  REPLAYS_SIDECAR_WRITING_HANDLERS,
} from '@shared/modules/replays'
import { getModuleManifest } from '@shared/types'
import { EMPTY_DEMO_LIST_FILTER } from '@shared/replays/list-filter'
import en from '../../../renderer/src/i18n/locales/en.json'
import { canonicalizePath } from '../../lib/fs-utils'
import { UI_HARNESS_ENV } from '../../lib/ui-harness'
import type { AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { MainModuleRegistry } from '../registry'
import { resolveExtractorPath } from '../downloads/7za-path'
import { discoveryHomeDir, replaysModule, scanHoldMs } from './index'

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
    state: {
      replaysState: () => ({
        extraFolders: [],
        listFilter: EMPTY_DEMO_LIST_FILTER,
        modWarning: { enabled: true, trustedMods: [] },
      }),
    },
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
      'scan.start',
      'index.read',
      'sidecar.read',
      'sidecar.write',
      'list.getSort',
      'list.setSort',
      'listFilter.read',
      'listFilter.write',
      'modWarning.read',
      'modWarning.setEnabled',
      'modWarning.trustMod',
      'modWarning.resetTrusted',
      'demos.reveal',
      'demos.copyPath',
      'demo.rename',
      'demo.play',
      'playback.timeline',
      'playback.consoleSend',
      'playback.stage',
      'playback.stop',
      'playback.cinema',
      'playback.display.read',
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

    // Story 160 D2: module setup sweeps leftover staged copies, fire-and-forget.
    it('startup sweeps _launcher of every installation', async () => {
      const rootA = join(dir, 'A')
      const rootB = join(dir, 'B')
      const staged = [
        join(rootA, 'baseq2', 'demos', '_launcher', 'a.dm2'),
        join(rootA, 'ctf', 'demos', '_launcher', 'b.mvd2.gz'),
        join(rootB, 'baseq2', 'demos', '_launcher', 'c.dm2'),
      ]
      const kept = [join(rootA, 'baseq2', 'demos', 'mine.dm2'), join(rootA, 'baseq2', 'demos', '_launcher', 'sub', 'x.dm2')]
      for (const file of [...staged, ...kept]) {
        await mkdir(join(file, '..'), { recursive: true })
        await writeFile(file, 'demo')
      }
      const installation = (id: string, rootPath: string, gameDirs: string[]) => ({
        id,
        name: id,
        rootPath,
        gameDirs,
        engineKind: 'q2pro',
        recordedEngineKind: undefined,
        writeDirPath: undefined,
      })

      const registry = new MainModuleRegistry()
      await registry.register(
        replaysModule,
        fakeAppContext([installation('a', rootA, ['baseq2', 'ctf']), installation('b', rootB, ['baseq2'])]),
      )

      await vi.waitFor(async () => {
        expect((await readdir(join(rootA, 'baseq2', 'demos', '_launcher'))).sort()).toEqual(['sub'])
        expect(await readdir(join(rootA, 'ctf', 'demos', '_launcher'))).toEqual([])
        expect(await readdir(join(rootB, 'baseq2', 'demos', '_launcher'))).toEqual([])
      })
      for (const file of kept) expect(await readFile(file, 'utf8')).toBe('demo')

      // A sweep that cannot even list the installations never breaks the module's start.
      const broken = { ...fakeAppContext(), installations: { list: () => { throw new Error('boom') } } }
      const second = new MainModuleRegistry()
      await second.register(replaysModule, broken as unknown as AppContext)
      expect(second.registered()).toContain('replays')
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

  /**
   * Story 152 D2: the `list.getSort`/`list.setSort` handlers - same real-`StateStore` round-trip
   * harness as the `extraFolders.*` block above, mirroring
   * `src/main/modules/servers/index.test.ts`'s `list.*Sort` handlers block exactly.
   */
  describe('list.*Sort handlers (story 152 D2)', () => {
    let filePath: string
    let state: StateStore
    let registry: MainModuleRegistry

    beforeEach(async () => {
      filePath = join(tmpdir(), `q2-launcher-replays-index-list-sort-${randomUUID()}.json`)
      state = new StateStore(filePath)
      await state.load()
      registry = new MainModuleRegistry()
      const appContext = {
        broadcast: { emit: () => {} },
        installations: { list: () => [] },
        state,
      } as unknown as AppContext
      await registry.register(replaysModule, appContext)
    })

    afterEach(async () => {
      await state.settle()
      await rm(filePath, { force: true })
      await rm(`${filePath}.tmp`, { force: true })
      await rm(`${filePath}.bak`, { force: true })
    })

    function invoke(type: string, payload?: unknown): Promise<unknown> {
      return registry.invoke({ moduleId: 'replays', type, payload })
    }

    it('list.setSort persists the sort and list.getSort returns it; null clears it', async () => {
      expect(await invoke(REPLAYS_HANDLERS.listGetSort)).toEqual({ ok: true, value: null })

      const before = state.replaysState()

      const sort = { column: 'players', direction: 'desc' }
      const setOutcome = await invoke(REPLAYS_HANDLERS.listSetSort, { sort })
      expect(setOutcome).toEqual({ ok: true, value: sort })

      expect(await invoke(REPLAYS_HANDLERS.listGetSort)).toEqual({ ok: true, value: sort })

      await state.settle()
      const reloaded = new StateStore(filePath)
      await reloaded.load()
      expect(reloaded.replaysState().listSort).toEqual(sort)
      expect(reloaded.replaysState().extraFolders).toEqual(before.extraFolders)
      expect(reloaded.replaysState().nameTemplates).toEqual(before.nameTemplates)

      const clearOutcome = await invoke(REPLAYS_HANDLERS.listSetSort, { sort: null })
      expect(clearOutcome).toEqual({ ok: true, value: null })
      expect(await invoke(REPLAYS_HANDLERS.listGetSort)).toEqual({ ok: true, value: null })

      await state.settle()
      const rawJson = JSON.parse(await readFile(filePath, 'utf8')) as { replays?: { listSort?: unknown } }
      expect(rawJson.replays?.listSort).toBeUndefined()
    })
  })

  /**
   * Story 153 D3: the `listFilter.read`/`listFilter.write` handlers - same real-`StateStore`
   * round-trip harness as the `list.*Sort handlers` block above.
   */
  describe('listFilter.* handlers (story 153 D3)', () => {
    let filePath: string
    let state: StateStore
    let registry: MainModuleRegistry

    beforeEach(async () => {
      filePath = join(tmpdir(), `q2-launcher-replays-index-list-filter-${randomUUID()}.json`)
      state = new StateStore(filePath)
      await state.load()
      registry = new MainModuleRegistry()
      const appContext = {
        broadcast: { emit: () => {} },
        installations: { list: () => [] },
        state,
      } as unknown as AppContext
      await registry.register(replaysModule, appContext)
    })

    afterEach(async () => {
      await state.settle()
      await rm(filePath, { force: true })
      await rm(`${filePath}.tmp`, { force: true })
      await rm(`${filePath}.bak`, { force: true })
    })

    function invoke(type: string, payload?: unknown): Promise<unknown> {
      return registry.invoke({ moduleId: 'replays', type, payload })
    }

    it('listFilter.write persists the filter and listFilter.read returns it', async () => {
      expect(await invoke(REPLAYS_HANDLERS.listGetFilter)).toEqual({
        ok: true,
        value: EMPTY_DEMO_LIST_FILTER,
      })

      const before = state.replaysState()

      const filter = { ...EMPTY_DEMO_LIST_FILTER, search: 'frag', favouritesOnly: true }
      const setOutcome = await invoke(REPLAYS_HANDLERS.listSetFilter, { filter })
      expect(setOutcome).toEqual({ ok: true, value: filter })

      expect(await invoke(REPLAYS_HANDLERS.listGetFilter)).toEqual({ ok: true, value: filter })

      await state.settle()
      const reloaded = new StateStore(filePath)
      await reloaded.load()
      expect(reloaded.replaysState().listFilter).toEqual(filter)
      expect(reloaded.replaysState().extraFolders).toEqual(before.extraFolders)
      expect(reloaded.replaysState().nameTemplates).toEqual(before.nameTemplates)
    })

    it('listFilter.write normalizes an invalid date filter (from > to) to null before persisting', async () => {
      const filter = {
        ...EMPTY_DEMO_LIST_FILTER,
        date: { kind: 'custom' as const, from: '2026-06-10', to: '2026-06-01' },
      }
      const setOutcome = await invoke(REPLAYS_HANDLERS.listSetFilter, { filter })
      expect(setOutcome).toEqual({ ok: true, value: { ...filter, date: null } })

      expect(await invoke(REPLAYS_HANDLERS.listGetFilter)).toEqual({
        ok: true,
        value: { ...filter, date: null },
      })

      await state.settle()
      const reloaded = new StateStore(filePath)
      await reloaded.load()
      expect(reloaded.replaysState().listFilter?.date).toBeNull()
    })
  })

  describe('modWarning.* handlers (story 182 D1)', () => {
    let filePath: string
    let state: StateStore
    let registry: MainModuleRegistry

    beforeEach(async () => {
      filePath = join(tmpdir(), `q2-launcher-replays-index-mod-warning-${randomUUID()}.json`)
      state = new StateStore(filePath)
      await state.load()
      registry = new MainModuleRegistry()
      await registry.register(replaysModule, {
        broadcast: { emit: () => {} },
        installations: { list: () => [] },
        state,
      } as unknown as AppContext)
    })

    afterEach(async () => {
      await state.settle()
      await rm(filePath, { force: true })
      await rm(`${filePath}.tmp`, { force: true })
      await rm(`${filePath}.bak`, { force: true })
    })

    function invoke(type: string, payload?: unknown): Promise<unknown> {
      return registry.invoke({ moduleId: 'replays', type, payload })
    }

    it('modWarning handlers persist enabled and trusted mods', async () => {
      expect(await invoke(REPLAYS_HANDLERS.modWarningRead)).toEqual({
        ok: true,
        value: { enabled: true, trustedMods: [] },
      })

      await invoke(REPLAYS_HANDLERS.modWarningTrustMod, { gameDir: 'OpenTDM' })
      expect(await invoke(REPLAYS_HANDLERS.modWarningTrustMod, { gameDir: 'opentdm' })).toEqual({
        ok: true,
        value: { enabled: true, trustedMods: ['opentdm'] },
      })

      // Turning the warning off keeps the trusted list.
      expect(await invoke(REPLAYS_HANDLERS.modWarningSetEnabled, { enabled: false })).toEqual({
        ok: true,
        value: { enabled: false, trustedMods: ['opentdm'] },
      })

      await state.settle()
      const reloaded = new StateStore(filePath)
      await reloaded.load()
      expect(reloaded.replaysState().modWarning).toEqual({ enabled: false, trustedMods: ['opentdm'] })

      // Reset clears the list but leaves the switch.
      expect(await invoke(REPLAYS_HANDLERS.modWarningResetTrusted)).toEqual({
        ok: true,
        value: { enabled: false, trustedMods: [] },
      })
      expect(await invoke(REPLAYS_HANDLERS.modWarningRead)).toEqual({
        ok: true,
        value: { enabled: false, trustedMods: [] },
      })
    })

    it('modWarning.trustMod rejects an unsafe game dir', async () => {
      for (const gameDir of ['..', '.', '', 'a/b', 'a\\b', 'C:\\x', 'x'.repeat(65), 'ctf mod']) {
        expect(await invoke(REPLAYS_HANDLERS.modWarningTrustMod, { gameDir })).toEqual({
          ok: false,
          error: { key: 'ipc.error.invalidPayload' },
        })
      }
      expect(state.replaysState().modWarning.trustedMods).toEqual([])
    })
  })

  describe('sidecar handlers (story 146)', () => {
    let dir: string
    let filePath: string
    let state: StateStore

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'q2-launcher-replays-sidecar-'))
      userDataBox.current = dir
      filePath = join(tmpdir(), `q2-launcher-replays-sidecar-state-${randomUUID()}.json`)
      state = new StateStore(filePath)
      await state.load()
    })

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      await rm(filePath, { force: true })
      await rm(`${filePath}.tmp`, { force: true })
      await rm(`${filePath}.bak`, { force: true })
    })

    /** Polls `index.read` until the scan started by `scan.start` has produced at least one row -
     * there is no existing wait helper in this file for this pair, so this is a small local
     * polling loop, capped at 50 tries of 10ms each. */
    async function waitForIndexed(
      registry: MainModuleRegistry,
    ): Promise<Array<{ id: string }>> {
      for (let i = 0; i < 50; i++) {
        const outcome = await registry.invoke({
          moduleId: 'replays',
          type: REPLAYS_HANDLERS.indexRead,
          payload: undefined,
        })
        if (outcome.ok && Array.isArray(outcome.value) && outcome.value.length > 0) {
          return outcome.value as Array<{ id: string }>
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('index.read never produced a row within the poll budget')
    }

    it('sidecar handlers address a demo by id only', async () => {
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

      const appContext = {
        broadcast: { emit: () => {} },
        installations: { list: () => [installation] },
        state,
        launch: { isRunning: () => false, isPlaybackRunning: () => false },
      } as unknown as AppContext

      const registry = new MainModuleRegistry()
      await registry.register(replaysModule, appContext)

      await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.scanStart,
        payload: undefined,
      })
      const rows = await waitForIndexed(registry)
      const demoId = rows[0].id

      const writeOutcome = await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.sidecarWrite,
        payload: { demoId, fields: { name: 'Final' } },
      })
      expect(writeOutcome.ok).toBe(true)

      const sidecarPath = join(demosDir, 'x.dm2.json')
      const raw = await readFile(sidecarPath, 'utf8')
      expect(JSON.parse(raw).name).toBe('Final')

      const afterWrite = (await readdir(demosDir)).sort()

      const badPayloads: unknown[] = [
        { demoId, fields: { name: 'Other' }, path: '/etc/passwd' },
        { demoId, fields: { name: 'Other' }, sidecarPath: '/etc/passwd' },
        { fields: { name: 'Other' } },
      ]
      for (const payload of badPayloads) {
        const outcome = await registry.invoke({
          moduleId: 'replays',
          type: REPLAYS_HANDLERS.sidecarWrite,
          payload,
        })
        expect(outcome).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
      }

      const afterBad = (await readdir(demosDir)).sort()
      expect(afterBad).toEqual(afterWrite)
    })

    it.skipIf(!resolveExtractorPath({ isPackaged: false }).exists)('sidecar write and demo rename both refuse an archive-entry demo id, at the registered-handler level', async () => {
      const demosDir = join(dir, 'baseq2', 'demos')
      await mkdir(demosDir, { recursive: true })

      // Story 143 D3: a real zip built with the vendored extractor, so the real scan/discovery
      // path assigns this demo a `kind: 'archive-entry'` resolved file, same as
      // `discovery.test.ts`'s "zip expansion" case.
      const extractor = resolveExtractorPath({ isPackaged: false })
      const zipSrc = await mkdtemp(join(tmpdir(), 'q2-launcher-replays-zip-src-'))
      await writeFile(join(zipSrc, 'archived.dm2'), 'archived-bytes')
      execFileSync(
        extractor.path,
        ['a', '-tzip', '-y', '-spd', '--', join(demosDir, 'pack.zip'), 'archived.dm2'],
        { cwd: zipSrc },
      )
      await rm(zipSrc, { recursive: true, force: true })

      const installation = {
        id: 'inst-1',
        name: 'Installation One',
        rootPath: dir,
        gameDirs: ['baseq2'],
        engineKind: 'r1q2',
        recordedEngineKind: undefined,
        writeDirPath: undefined,
      }

      const appContext = {
        broadcast: { emit: () => {} },
        installations: { list: () => [installation] },
        state,
        launch: { isRunning: () => false, isPlaybackRunning: () => false },
      } as unknown as AppContext

      const registry = new MainModuleRegistry()
      await registry.register(replaysModule, appContext)

      await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.scanStart,
        payload: undefined,
      })
      const rows = await waitForIndexed(registry)
      const archiveRow = rows.find(
        (r) => (r as unknown as { fileName?: string }).fileName === 'archived.dm2',
      )
      expect(archiveRow).toBeDefined()
      const archiveEntryId = archiveRow!.id

      const filesBefore = (await readdir(demosDir)).sort()

      const writeOutcome = await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.sidecarWrite,
        payload: { demoId: archiveEntryId, fields: { name: 'x' } },
      })
      // Story 146: `sidecarStore.write` returns its own Outcome as the handler's *value* - the
      // registry always wraps a successfully-invoked handler in `ok(...)` regardless of what the
      // handler's own result says (`registry.ts`'s `invoke`), so a typed rejection from the sidecar
      // store surfaces as `{ ok: true, value: { ok: false, error: { key } } }` here, same shape
      // `sidecar-store.test.ts` asserts directly against the service.
      expect(writeOutcome).toEqual({
        ok: true,
        value: { ok: false, error: { key: 'replays.sidecar.error.archiveEntry' } },
      })

      const renameOutcome = await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.demoRename,
        payload: { id: archiveEntryId, name: 'renamed' },
      })
      expect(renameOutcome).toEqual({
        ok: true,
        value: { ok: false, error: { key: 'replays.rename.error.archiveEntry' } },
      })

      const filesAfter = (await readdir(demosDir)).sort()
      expect(filesAfter).toEqual(filesBefore)
      expect(filesAfter.some((f) => f.endsWith('.json'))).toBe(false)
    })

    it('no replays handler except the sidecar writers creates a sidecar', async () => {
      const demosDir = join(dir, 'baseq2', 'demos')
      await mkdir(demosDir, { recursive: true })
      await writeFile(join(demosDir, 'x.dm2'), 'x')
      await writeFile(join(demosDir, 'y.dm2'), 'y')

      const installation = {
        id: 'inst-1',
        name: 'Installation One',
        rootPath: dir,
        gameDirs: ['baseq2'],
        engineKind: 'r1q2',
        recordedEngineKind: undefined,
        writeDirPath: undefined,
      }

      const appContext = {
        broadcast: { emit: () => {} },
        installations: { list: () => [installation] },
        state,
        launch: { isRunning: () => false, isPlaybackRunning: () => false },
      } as unknown as AppContext

      const registry = new MainModuleRegistry()
      await registry.register(replaysModule, appContext)

      await registry.invoke({
        moduleId: 'replays',
        type: REPLAYS_HANDLERS.scanStart,
        payload: undefined,
      })
      await waitForIndexed(registry)

      const payloadFor: Record<string, unknown> = {
        [REPLAYS_HANDLERS.overviewRead]: undefined,
        [REPLAYS_HANDLERS.demosList]: undefined,
        [REPLAYS_HANDLERS.extraFoldersList]: undefined,
        [REPLAYS_HANDLERS.indexRead]: undefined,
        [REPLAYS_HANDLERS.nameTemplatesList]: undefined,
        [REPLAYS_HANDLERS.nameTemplatesRestore]: undefined,
        [REPLAYS_HANDLERS.scanStart]: undefined,
        [REPLAYS_HANDLERS.nameTemplatesAdd]: { template: 'x' },
        [REPLAYS_HANDLERS.nameTemplatesUpdate]: { id: 'nope', template: 'x' },
        [REPLAYS_HANDLERS.nameTemplatesRemove]: { id: 'nope' },
        [REPLAYS_HANDLERS.nameTemplatesReset]: { id: 'nope' },
        [REPLAYS_HANDLERS.nameTemplatesReorder]: { ids: [] },
        [REPLAYS_HANDLERS.extraFoldersAdd]: { path: dir },
        [REPLAYS_HANDLERS.extraFoldersRemove]: { id: 'nope' },
        [REPLAYS_HANDLERS.sidecarRead]: { demoId: 'nope' },
        [REPLAYS_HANDLERS.demosReveal]: { demoId: 'nope' },
        [REPLAYS_HANDLERS.demosCopyPath]: { demoId: 'nope' },
        [REPLAYS_HANDLERS.demoRename]: { id: 'nope', name: 'renamed' },
        [REPLAYS_HANDLERS.demoPlay]: { demoId: 'nope', installationId: 'nope' },
        [REPLAYS_HANDLERS.playbackTimeline]: { kind: 'togglePause' },
        [REPLAYS_HANDLERS.playbackConsoleSend]: { line: 'echo hi' },
        [REPLAYS_HANDLERS.playbackStage]: { rect: { x: 0, y: 0, width: 640, height: 480 } },
        [REPLAYS_HANDLERS.playbackStop]: undefined,
        [REPLAYS_HANDLERS.playbackCinema]: { enter: true },
        [REPLAYS_HANDLERS.playbackDisplayRead]: {},
        [REPLAYS_HANDLERS.listGetSort]: undefined,
        [REPLAYS_HANDLERS.listSetSort]: { sort: null },
        [REPLAYS_HANDLERS.listGetFilter]: undefined,
        [REPLAYS_HANDLERS.listSetFilter]: { filter: EMPTY_DEMO_LIST_FILTER },
        [REPLAYS_HANDLERS.modWarningRead]: undefined,
        [REPLAYS_HANDLERS.modWarningSetEnabled]: { enabled: true },
        [REPLAYS_HANDLERS.modWarningTrustMod]: { gameDir: 'opentdm' },
        [REPLAYS_HANDLERS.modWarningResetTrusted]: undefined,
      }

      const handlersToExercise = Object.values(REPLAYS_HANDLERS).filter(
        (name) => !REPLAYS_SIDECAR_WRITING_HANDLERS.includes(name),
      )

      for (const name of handlersToExercise) {
        if (!(name in payloadFor)) {
          expect.fail(`no payload entry for handler "${name}" - add one to payloadFor above`)
        }
      }

      for (const name of handlersToExercise) {
        await registry.invoke({ moduleId: 'replays', type: name, payload: payloadFor[name] })
      }

      const filesAfter = await readdir(demosDir)
      expect(filesAfter.sort()).toEqual(['x.dm2', 'y.dm2'])
      expect(filesAfter.some((f) => f.endsWith('.json'))).toBe(false)
    })
  })

  describe('sidecar error i18n (story 146)', () => {
    it('sidecar error keys resolve to specific English text', () => {
      const sidecar = (en as { replays: { sidecar: { error: Record<string, string> } } }).replays.sidecar
        .error

      expect(sidecar.unknownDemo.length).toBeGreaterThan(0)
      expect(sidecar.archiveEntry.length).toBeGreaterThan(0)
      expect(sidecar.demoMissing.length).toBeGreaterThan(0)
      expect(sidecar.existingInvalid.length).toBeGreaterThan(0)
      expect(sidecar.notWritable.length).toBeGreaterThan(0)
      expect(sidecar.writeFailed.length).toBeGreaterThan(0)
      expect(sidecar.notWritable).toContain('{{folder}}')

      const rename = (en as unknown as { replays: { rename: { error: Record<string, string> } } })
        .replays.rename.error
      expect(rename.archiveEntry.length).toBeGreaterThan(0)
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

  describe('scanHoldMs (story 151 D2)', () => {
    let userData: string

    beforeEach(async () => {
      userData = await mkdtemp(join(tmpdir(), 'q2-launcher-replays-scan-hold-'))
    })

    afterEach(async () => {
      await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    })

    it('is 0 outside the harness, reads the file under it, and ignores garbage', async () => {
      const harnessEnv = { [UI_HARNESS_ENV]: '1' }
      const disabledEnv = {}
      const holdFile = join(userData, 'harness-replays-scan-hold-ms')

      // No file at all.
      expect(await scanHoldMs({ env: harnessEnv, userData })).toBe(0)

      await writeFile(holdFile, '250')
      // Outside the harness, the file is never read.
      expect(await scanHoldMs({ env: disabledEnv, userData })).toBe(0)
      expect(await scanHoldMs({ env: harnessEnv, userData })).toBe(250)

      // Garbage content reads back as 0.
      await writeFile(holdFile, 'not-a-number')
      expect(await scanHoldMs({ env: harnessEnv, userData })).toBe(0)

      await writeFile(holdFile, '-5')
      expect(await scanHoldMs({ env: harnessEnv, userData })).toBe(0)

      await writeFile(holdFile, '0')
      expect(await scanHoldMs({ env: harnessEnv, userData })).toBe(0)

      // Clamped to the ceiling.
      await writeFile(holdFile, '999999')
      expect(await scanHoldMs({ env: harnessEnv, userData })).toBe(60_000)
    })
  })
})
