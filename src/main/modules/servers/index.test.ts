import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MASTER_SOURCES,
  DEFAULT_SERVERS_STATE,
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  SERVERS_HANDLERS,
  type FavouriteServerEntry,
  type ServerHistoryEntry,
  type ServersOverview,
  type ServersState,
} from '@shared/modules/servers'
import { IDLE_LAUNCH_STATE, getModuleManifest, type LaunchState } from '@shared/types'
import { fakeAppContext } from '../../../test-support/app-context'
import { fakeSectionState } from '../../../test-support/state-sections'
import type { AppContext } from '../../context'
import { createFeatureGate } from '../../features/gate'
import { StateStore } from '../../services/state'
import { MainModuleRegistry } from '../registry'
import { serversModule } from './index'
import { serversState } from './persisted'

/**
 * Story 106 D2: the servers module gets its main half - a single handler,
 * `overview.read`, answering a hardcoded zeroed overview. Mirrors
 * `src/main/modules/home/index.test.ts`'s structure.
 *
 * Story 111 D3 adds the `sources.*` round trip below: a real `StateStore` over a temp file, driven
 * through the real registry (so the shared payload schemas run too), then *reloaded from disk* -
 * the only way to prove a mutation both persisted and survived `parseServersState`.
 *
 * Story 112 D3 adds the `favourites.*` handlers' round trip further below, mirroring
 * `src/main/modules/home/index.test.ts`'s shape for AC1 (handlers exist and are reachable through
 * the module's own `setup()`) and `src/main/services/state.test.ts`'s restart round-trip pattern
 * for AC3 (favourite state survives an app restart, read back from the `servers` state key
 * unchanged via a second, independent `StateStore` over the same file).
 */

/**
 * Story 125 D3: a controllable `app.launch` - `set(...)` drives every listener that subscribed
 * through `onStateChange`, exactly as the real `LaunchService` would, mirroring
 * `downloads/bootstrap/job.test.ts`'s `fakeLaunch`. Needed because `fakeAppContext`'s stub
 * `onStateChange` never actually calls its listener, which can't exercise the servers module's own
 * subscription (setup() above).
 */
function fakeAppContextWithControllableLaunch(state: StateStore): {
  context: AppContext
  setLaunchState: (next: LaunchState) => void
} {
  let launchState: LaunchState = IDLE_LAUNCH_STATE
  const listeners = new Set<(next: LaunchState) => void>()
  const launch = {
    getState: () => launchState,
    onStateChange: (listener: (next: LaunchState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const broadcast = { emit: () => {} }
  const features = createFeatureGate([])
  return {
    context: { state, broadcast, launch, features } as unknown as AppContext,
    setLaunchState: (next) => {
      launchState = next
      for (const listener of [...listeners]) listener(next)
    },
  }
}

/** An `app.launch` stub frozen in `launchState`; the shared helper's default is idle. */
function launchIn(launchState: LaunchState): AppContext['launch'] {
  return {
    getState: () => launchState,
    onStateChange: () => () => {},
  } as unknown as AppContext['launch']
}

describe('servers module', () => {
  it('the servers module registers its main half under its own id', async () => {
    const manifest = getModuleManifest('servers')
    expect(manifest).toBeDefined()

    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state: fakeSectionState() }))

    expect(registry.registered()).toContain('servers')
  })

  it('overview.read resolves the zeroed overview through the registry', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state: fakeSectionState() }))

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
    await registry.register(serversModule, fakeAppContext({ state: fakeSectionState() }))

    const outcome = await registry.invoke({
      moduleId: 'servers',
      type: 'overview.read',
      payload: { unexpected: 'value' },
    })

    expect(outcome).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })

  it('scan.setMode exists and rejects an unknown mode', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state: fakeSectionState() }))

    expect(
      await registry.invoke({
        moduleId: 'servers',
        type: SERVERS_HANDLERS.scanSetMode,
        payload: { mode: 'lan' },
      }),
    ).toEqual({ ok: true, value: undefined })
    expect(
      await registry.invoke({
        moduleId: 'servers',
        type: SERVERS_HANDLERS.scanSetMode,
        payload: { mode: 'wan' },
      }),
    ).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })

  it('detail.read rejects a malformed address payload', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state: fakeSectionState() }))

    const outcome = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.detailRead,
      payload: 'not-an-address',
    })

    expect(outcome).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })
})

describe('servers module sources.* handlers (story 111 D3)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-sources-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  function invoke(type: string, payload?: unknown): Promise<unknown> {
    return registry.invoke({ moduleId: 'servers', type, payload })
  }

  /** What `state.json` actually holds, read back through a second store - not the in-memory copy. */
  async function reloaded(): Promise<ServersState> {
    await state.settle()
    const store = new StateStore(filePath, { migrations: 'none' })
    await store.load()
    return serversState(store).get()
  }

  it('sources.list answers the shipped default list without writing anything', async () => {
    expect(await invoke('sources.list')).toEqual({ ok: true, value: DEFAULT_MASTER_SOURCES })
  })

  it('sources.add persists the new list and leaves the other servers-state keys alone', async () => {
    const before = serversState(state).get()

    const outcome = (await invoke('sources.add', {
      type: 'udp-master',
      address: 'master.example.com',
    })) as { ok: true; value: { ok: true; sources: unknown[] } }

    expect(outcome.ok).toBe(true)
    expect(outcome.value.ok).toBe(true)
    expect(outcome.value.sources).toHaveLength(2)

    const persisted = await reloaded()
    // The full new list came back, and it is exactly what is on disk - no drop on reload.
    expect(persisted.sources).toEqual(outcome.value.sources)
    expect(persisted.sources[1]).toEqual({
      id: expect.any(String),
      type: 'udp-master',
      address: 'master.example.com:27900',
      enabled: true,
    })
    expect(persisted.favourites).toEqual(before.favourites)
    expect(persisted.manualServers).toEqual(before.manualServers)
    expect(persisted.history).toEqual(before.history)
    expect(persisted.scan).toEqual(before.scan)
  })

  it('sources.update toggles enabled and keeps the type and address of the disabled source', async () => {
    const target = DEFAULT_MASTER_SOURCES[0]!

    expect(await invoke('sources.update', { id: target.id, enabled: false })).toMatchObject({
      ok: true,
      value: { ok: true },
    })

    const persisted = await reloaded()
    expect(persisted.sources).toHaveLength(1)
    expect(persisted.sources[0]).toEqual({ ...target, enabled: false })
  })

  it('sources.reorder persists the new order', async () => {
    const ids = DEFAULT_MASTER_SOURCES.map((source) => source.id).reverse()

    expect(await invoke('sources.reorder', { ids })).toMatchObject({
      ok: true,
      value: { ok: true },
    })

    expect((await reloaded()).sources.map((source) => source.id)).toEqual(ids)
  })

  it('a refusal carries a reason code and persists nothing', async () => {
    const before = serversState(state).get()

    expect(await invoke('sources.remove', { id: 'no-such-source' })).toEqual({
      ok: true,
      value: { ok: false, reasonKey: 'servers.sources.reject.not-found' },
    })
    expect(await invoke('sources.add', { type: 'http-list', address: 'not a url' })).toEqual({
      ok: true,
      value: { ok: false, reasonKey: 'servers.sources.reject.invalid-url' },
    })
    expect(await invoke('sources.reorder', { ids: ['only-one'] })).toEqual({
      ok: true,
      value: { ok: false, reasonKey: 'servers.sources.reject.invalid-reorder' },
    })

    expect(serversState(state).get()).toEqual(before)
    expect((await reloaded()).sources).toEqual(DEFAULT_MASTER_SOURCES)
  })

  it('a refused sources mutation writes nothing and keeps a concurrent favourite', async () => {
    await invoke('favourites.add', '1.2.3.4:27910')
    const before = serversState(state).get()

    expect(await invoke('sources.remove', { id: 'no-such-source' })).toEqual({
      ok: true,
      value: { ok: false, reasonKey: 'servers.sources.reject.not-found' },
    })

    // The very same live object: a refusal neither replaced the slice nor dropped the favourite.
    expect(serversState(state).get()).toBe(before)
    expect(serversState(state).get().favourites).toHaveLength(1)
    await state.settle()
    expect((await reloaded()).favourites).toEqual(before.favourites)
  })

  it('rejects a payload that tries to bring its own id', async () => {
    // Ids are minted in main: `sources.add`'s schema has no `id` field, so a renderer-supplied one
    // is stripped by the schema rather than honoured.
    const outcome = (await invoke('sources.add', {
      id: 'renderer-chosen',
      type: 'udp-master',
      address: 'master.example.com',
    })) as { ok: true; value: { ok: true; sources: { id: string }[] } }

    expect(outcome.value.sources.map((source) => source.id)).not.toContain('renderer-chosen')
  })

  it('rejects a malformed sources.remove payload before the handler runs', async () => {
    expect(await invoke('sources.remove', { id: 42 })).toEqual({
      ok: false,
      error: { key: 'ipc.error.invalidPayload' },
    })
  })
})

describe('servers module favourites handlers (story 112 D3)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-favourites-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('AC1: registers favourites.add/remove, reachable through setup() and behaving correctly', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))

    const afterAdd = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesAdd,
      payload: '1.2.3.4:27910',
    })
    expect(afterAdd.ok).toBe(true)
    const added = (afterAdd as { ok: true; value: FavouriteServerEntry[] }).value
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ address: '1.2.3.4:27910' })
    expect(serversState(state).get().favourites).toEqual(added)

    const afterRemove = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesRemove,
      payload: '1.2.3.4:27910',
    })
    expect(afterRemove).toEqual({ ok: true, value: [] })
    expect(serversState(state).get().favourites).toEqual([])
  })

  it("AC1: a favourites write never clobbers the rest of the servers state's snapshot", async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))

    const sourcesBefore = serversState(state).get().sources

    await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesAdd,
      payload: '1.2.3.4:27910',
    })

    expect(serversState(state).get().sources).toEqual(sourcesBefore)
    expect(serversState(state).get().manualServers).toEqual([])
    expect(serversState(state).get().history).toEqual([])
  })

  it('AC3: favourites survive a restart of the state store', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))

    const outcome = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesAdd,
      payload: '5.6.7.8:27911',
    })
    expect(outcome.ok).toBe(true)
    await state.settle()

    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()

    expect(serversState(reloaded).get().favourites).toEqual(serversState(state).get().favourites)
    expect(serversState(reloaded).get().favourites).toEqual([
      { address: '5.6.7.8:27911', addedAt: expect.any(String) },
    ])
  })
})

/** `history.read` over the state slice; history is seeded through `updateSlice` because main is the only writer. */
describe('servers module history.read handler', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-history-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  function invoke(type: string, payload?: unknown): Promise<unknown> {
    return registry.invoke({ moduleId: 'servers', type, payload })
  }

  it('history.read is reachable through setup() and answers the stored history', async () => {
    expect(await invoke(SERVERS_HANDLERS.historyRead)).toEqual({ ok: true, value: [] })

    const history: ServerHistoryEntry[] = [
      { address: '9.9.9.9:27910', connectedAt: '2026-01-03T00:00:00.000Z' },
      { address: '1.2.3.4:27910', connectedAt: '2026-01-02T00:00:00.000Z' },
    ]
    serversState(state).update((s) => ({ ...s, history }))

    expect(await invoke(SERVERS_HANDLERS.historyRead)).toEqual({ ok: true, value: history })
  })
})

/**
 * Story 114 D6: `overview.read` now answers `createScanService`'s real numbers instead of the
 * hardcoded `{ scanning: false, knownServerCount: 0, lastScanAt: null }` object story 106 D2 shipped.
 * `sources`/`favourites`/`manualServers` are all cleared first, so `scan.start`'s address set is
 * empty - the sweep settles with no network/UDP I/O of its own (no `fetchImpl`/`udpImpl` fake is
 * needed, and nothing here waits on a real timer), which is enough to prove the wiring: a completed
 * scan moves `lastScanAt` from `null` to a real timestamp, which the old hardcoded object could
 * never do.
 */
describe('servers module overview.read reflects the scan service (story 114 D6)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-scan-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
    serversState(state).update((s) => ({
      ...s,
      sources: [],
      favourites: [],
      manualServers: [],
    }))
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  function invoke(type: string, payload?: unknown): Promise<unknown> {
    return registry.invoke({ moduleId: 'servers', type, payload })
  }

  it('reports scanning/knownServerCount/lastScanAt from the real service after a completed scan', async () => {
    expect(await invoke(SERVERS_HANDLERS.overviewRead)).toEqual({
      ok: true,
      value: { scanning: false, knownServerCount: 0, lastScanAt: null },
    })

    expect(await invoke(SERVERS_HANDLERS.scanStart)).toEqual({ ok: true, value: { ok: true } })

    // An empty address set (no sources/favourites/manual servers) settles almost immediately -
    // poll a handful of ticks rather than a real scan's timers.
    let overview = (
      (await invoke(SERVERS_HANDLERS.overviewRead)) as { ok: true; value: ServersOverview }
    ).value
    for (let i = 0; i < 20 && overview.scanning; i++) {
      await new Promise((resolve) => setImmediate(resolve))
      overview = (
        (await invoke(SERVERS_HANDLERS.overviewRead)) as { ok: true; value: ServersOverview }
      ).value
    }

    expect(overview).toEqual({
      scanning: false,
      knownServerCount: 0,
      lastScanAt: expect.any(String),
    })
  })

  it('scan.start refuses a second call while one is already running', async () => {
    expect(await invoke(SERVERS_HANDLERS.scanStart)).toEqual({ ok: true, value: { ok: true } })
    expect(await invoke(SERVERS_HANDLERS.scanStart)).toEqual({
      ok: true,
      value: { ok: false, reasonKey: 'servers.scan.error.already-running' },
    })
  })
})

/**
 * Story 115 D2: the `scan.getSettings`/`scan.patchSettings` handlers - same real-`StateStore`
 * round-trip harness as the `sources.*`/`favourites.*` blocks above, driven through the real
 * `MainModuleRegistry` so the shared payload schema (`scanPatchSettingsInputSchema`'s per-field
 * min/max) runs too. `scan.patchSettings` follows the read/merge/persist discipline: only `scan` is
 * replaced, every other `ServersState` key is carried over from the same snapshot untouched.
 */
describe('servers module scan.* settings handlers (story 115 D2)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-scan-settings-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  function invoke(type: string, payload?: unknown): Promise<unknown> {
    return registry.invoke({ moduleId: 'servers', type, payload })
  }

  it('scan.getSettings returns the persisted scan object', async () => {
    const before = serversState(state).get()

    expect(await invoke(SERVERS_HANDLERS.scanGetSettings)).toEqual({
      ok: true,
      value: before.scan,
    })
  })

  it('scan.patchSettings round-trips a partial patch through state.json and leaves the other keys untouched', async () => {
    const before = serversState(state).get()

    const outcome = await invoke(SERVERS_HANDLERS.scanPatchSettings, { concurrency: 16 })
    expect(outcome).toEqual({
      ok: true,
      value: { ...before.scan, concurrency: 16 },
    })

    await state.settle()
    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()
    const persisted = serversState(reloaded).get()

    expect(persisted.scan).toEqual({ ...before.scan, concurrency: 16 })
    expect(persisted.sources).toEqual(before.sources)
    expect(persisted.favourites).toEqual(before.favourites)
    expect(persisted.manualServers).toEqual(before.manualServers)
    expect(persisted.history).toEqual(before.history)
  })

  it('rejects an out-of-range scan.patchSettings payload before the handler runs', async () => {
    expect(await invoke(SERVERS_HANDLERS.scanPatchSettings, { concurrency: 999 })).toEqual({
      ok: false,
      error: { key: 'ipc.error.invalidPayload' },
    })
    expect(serversState(state).get().scan.concurrency).toBe(DEFAULT_SERVERS_STATE.scan.concurrency)
  })
})

/**
 * Story 119 D2: the `list.getSort`/`list.setSort` handlers - same real-`StateStore` round-trip
 * harness as the `scan.*` settings block above, driven through the real `MainModuleRegistry` so
 * `listSetSortInputSchema` (including its column-enum validation) runs too.
 */
describe('servers module list.*Sort handlers (story 119 D2)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-list-sort-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  function invoke(type: string, payload?: unknown): Promise<unknown> {
    return registry.invoke({ moduleId: 'servers', type, payload })
  }

  it('list.getSort returns null before any sort has been set', async () => {
    expect(await invoke(SERVERS_HANDLERS.listGetSort)).toEqual({ ok: true, value: null })
  })

  it('list.setSort persists the sort and list.getSort returns it', async () => {
    const sort = { column: 'players', direction: 'desc' }
    const outcome = await invoke(SERVERS_HANDLERS.listSetSort, { sort })
    expect(outcome).toEqual({ ok: true, value: sort })

    expect(await invoke(SERVERS_HANDLERS.listGetSort)).toEqual({ ok: true, value: sort })

    await state.settle()
    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()
    expect(serversState(reloaded).get().listSort).toEqual(sort)
  })

  it('list.setSort null clears the persisted sort', async () => {
    await invoke(SERVERS_HANDLERS.listSetSort, { sort: { column: 'name', direction: 'asc' } })
    const outcome = await invoke(SERVERS_HANDLERS.listSetSort, { sort: null })
    expect(outcome).toEqual({ ok: true, value: null })

    expect(await invoke(SERVERS_HANDLERS.listGetSort)).toEqual({ ok: true, value: null })

    await state.settle()
    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()
    expect(serversState(reloaded).get().listSort).toBeNull()
  })

  it('list.setSort rejects an unknown column', async () => {
    expect(
      await invoke(SERVERS_HANDLERS.listSetSort, { sort: { column: 'nope', direction: 'asc' } }),
    ).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(serversState(state).get().listSort).toBeNull()
  })
})

describe('servers module quick filter handlers (story 197 D2)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-quick-filters-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  function invoke(type: string, payload?: unknown): Promise<unknown> {
    return registry.invoke({ moduleId: 'servers', type, payload })
  }

  const criteria = {
    mod: 'ctf',
    gamemode: null,
    map: null,
    empty: false,
    hideBotsOnly: true,
    waitingForOpponent: false,
  }

  it('quick filter handlers persist to servers state', async () => {
    expect(await invoke(SERVERS_HANDLERS.quickFiltersList)).toEqual({ ok: true, value: [] })

    const saved = (await invoke(SERVERS_HANDLERS.quickFiltersSave, {
      name: ' CTF ',
      criteria,
      overwrite: false,
    })) as { ok: true; value: { ok: true; list: { id: string; name: string }[] } }
    expect(saved.value.list).toHaveLength(1)
    const { id } = saved.value.list[0]

    await invoke(SERVERS_HANDLERS.quickFiltersRename, { id, name: 'Capture' })
    await state.settle()
    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()
    expect(serversState(reloaded).get().quickFilters).toEqual([{ id, name: 'Capture', criteria }])

    // A refusal persists nothing.
    expect(
      await invoke(SERVERS_HANDLERS.quickFiltersSave, {
        name: 'capture',
        criteria,
        overwrite: false,
      }),
    ).toEqual({ ok: true, value: { ok: false, reasonKey: 'servers.quickFilter.error.taken' } })
    expect(serversState(state).get().quickFilters).toHaveLength(1)

    await invoke(SERVERS_HANDLERS.quickFiltersRemove, { id })
    expect(serversState(state).get().quickFilters).toEqual([])
  })

  it('quick filter save rejects a payload with an unknown criteria key', async () => {
    expect(
      await invoke(SERVERS_HANDLERS.quickFiltersSave, {
        name: 'x',
        criteria: { ...criteria, search: 'q' },
        overwrite: false,
      }),
    ).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
  })
})

/**
 * Story 117 D4: `scan.start`'s handler now passes both `scope` and `selectedAddress` through to
 * `ScanService.start`'s options-object signature. The guard (116) and the single-flight rule (114
 * D-L) already apply regardless of scope inside the service itself - these tests just prove that
 * holds through the handler for a *scoped* call, the same way the unscoped call is already covered
 * above (`servers module overview.read reflects the scan service`).
 */
describe('servers module scan.start is guarded and single-flight per scope (story 117 D4)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-scan-scope-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
    serversState(state).update((s) => ({
      ...s,
      sources: [],
      favourites: [],
      manualServers: [],
    }))
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('a scoped scan.start is refused with the game-running reason key while the game is running', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(
      serversModule,
      fakeAppContext({ state, launch: launchIn({ phase: 'running', installationId: 'inst-1' }) }),
    )

    const outcome = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.scanStart,
      payload: { scope: { kind: 'favourites' } },
    })

    expect(outcome).toEqual({
      ok: true,
      value: { ok: false, reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY },
    })
  })

  it('a scoped scan.start is refused, not queued, while a scan is already running', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext({ state }))

    expect(
      await registry.invoke({
        moduleId: 'servers',
        type: SERVERS_HANDLERS.scanStart,
        payload: { scope: { kind: 'favourites' } },
      }),
    ).toEqual({ ok: true, value: { ok: true } })

    // Not queued: the second scoped call while the first is still in flight is refused outright.
    expect(
      await registry.invoke({
        moduleId: 'servers',
        type: SERVERS_HANDLERS.scanStart,
        payload: { scope: { kind: 'all' } },
      }),
    ).toEqual({
      ok: true,
      value: { ok: false, reasonKey: 'servers.scan.error.already-running' },
    })
  })
})

/**
 * Story 125 D3: a successful join records exactly one history visit. Uses a real `StateStore` over a
 * temp file (same harness as the `manual.*`/`history.*` block above) and the controllable launch
 * host (`fakeAppContextWithControllableLaunch`) so `setLaunchState` drives the module's own
 * `app.launch.onStateChange` subscription the same way the real `LaunchService` would.
 */
describe('servers module records a history visit on a successful join (story 125 D3)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-join-history-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('a running launch with a connect records one history visit', async () => {
    const { context, setLaunchState } = fakeAppContextWithControllableLaunch(state)
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, context)

    setLaunchState({ phase: 'starting', installationId: 'inst-1', connect: '1.2.3.4:27910' })
    setLaunchState({
      phase: 'running',
      installationId: 'inst-1',
      connect: '1.2.3.4:27910',
      pid: 1234,
    })
    setLaunchState({
      phase: 'exited',
      installationId: 'inst-1',
      connect: '1.2.3.4:27910',
      exitCode: 0,
    })

    expect(serversState(state).get().history).toEqual([
      { address: '1.2.3.4:27910', connectedAt: expect.any(String) },
    ])

    await state.settle()
    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()
    expect(serversState(reloaded).get().history).toEqual(serversState(state).get().history)
  })

  it('a launch without connect, a failed launch or a refused join records nothing', async () => {
    const { context, setLaunchState } = fakeAppContextWithControllableLaunch(state)
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, context)

    setLaunchState({ phase: 'running', installationId: 'inst-1', pid: 1234 })
    setLaunchState({
      phase: 'failed',
      installationId: 'inst-1',
      error: { key: 'launch.error.somethingWentWrong' },
    })
    setLaunchState({ phase: 'handed-off', installationId: 'inst-1' })

    expect(serversState(state).get().history).toEqual([])
  })
})

/**
 * Story 131 D5: the `watchlist.*` handlers, the watchlist service and its regex worker only ever
 * exist when the `'watchlist'` feature is unlocked (AC10). Both halves of the gate have to agree
 * for a test to reflect the real app: `MainModuleRegistry`'s own constructor argument (what decides
 * whether a `{ feature: 'watchlist' }` `handle()` call is actually stored) and `fakeAppContext`'s
 * `features` (what `serversModule.setup()` itself reads to decide whether to construct
 * `watchlistService`/`createRegexHost()` at all) - exactly like `context.ts` wires the same
 * `FeatureGate` instance into both places in the real app.
 */
describe('servers module watchlist.* handlers are feature-gated (story 131 D5)', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-watchlist-gate-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('a locked servers module registers no watchlist handler and attaches no scan observer', async () => {
    const gate = createFeatureGate([])
    const registry = new MainModuleRegistry(gate)
    await registry.register(serversModule, fakeAppContext({ state, features: gate }))

    const outcome = await registry.invoke({
      moduleId: 'servers',
      type: 'watchlist.read',
      payload: undefined,
    })

    // Same answer a genuinely unknown type gets - never a distinct "locked"/"forbidden" response
    // (story 130's own rule, `registry.ts`'s doc comment).
    expect(outcome).toEqual({
      ok: false,
      error: {
        key: 'modules.error.notImplemented',
        params: { moduleId: 'servers', type: 'watchlist.read' },
      },
    })

    // No observer attached to the scan service either: a stage2 push resolves nothing watchlist-
    // shaped, proven here by starting a (network-free, empty-address-set) scan and confirming it
    // still settles - if `onStage2Row` had been wired to a `watchlistService` that no longer exists
    // this would throw instead of resolving.
    const start = await registry.invoke({
      moduleId: 'servers',
      type: 'scan.start',
      payload: undefined,
    })
    expect(start).toEqual({ ok: true, value: { ok: true } })
  })

  it('watchlist entries survive a locked start and come back unchanged when unlocked', async () => {
    const seeded = [{ id: 'entry-1', name: 'Ranger', mode: 'exact' as const, tooSlow: false }]
    serversState(state).update((s) => ({ ...s, watchlist: seeded }))
    await state.settle()

    // Locked: starting the module must not crash, must register no watchlist handler, and must not
    // touch `state.json`'s `watchlist` key at all.
    const lockedGate = createFeatureGate([])
    const lockedRegistry = new MainModuleRegistry(lockedGate)
    await lockedRegistry.register(serversModule, fakeAppContext({ state, features: lockedGate }))

    expect(
      await lockedRegistry.invoke({
        moduleId: 'servers',
        type: 'watchlist.read',
        payload: undefined,
      }),
    ).toEqual({
      ok: false,
      error: {
        key: 'modules.error.notImplemented',
        params: { moduleId: 'servers', type: 'watchlist.read' },
      },
    })
    expect(serversState(state).get().watchlist).toEqual(seeded)

    await lockedRegistry.disposeAll()

    // Unlocked: a fresh module start over the same store reads the same entries back unchanged.
    const unlockedGate = createFeatureGate(['watchlist'])
    const unlockedRegistry = new MainModuleRegistry(unlockedGate)
    await unlockedRegistry.register(
      serversModule,
      fakeAppContext({ state, features: unlockedGate }),
    )

    const read = await unlockedRegistry.invoke({
      moduleId: 'servers',
      type: 'watchlist.read',
      payload: undefined,
    })
    expect(read).toEqual({
      ok: true,
      value: { asOf: null, entries: [{ entry: seeded[0], state: 'offline', recheck: null }] },
    })
    expect(serversState(state).get().watchlist).toEqual(seeded)
  })
})

describe('serversModule source', () => {
  it('keeps no module-level mutable state', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

    const columnZeroLets = source.split(/\r?\n/).filter((line) => line.startsWith('let '))

    expect(columnZeroLets).toEqual([])
  })
})
