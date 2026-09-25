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
  type ManualServerAddResult,
  type ManualServerEntry,
  type ServerHistoryEntry,
  type ServersOverview,
  type ServersState,
} from '@shared/modules/servers'
import { IDLE_LAUNCH_STATE, getModuleManifest, type LaunchState } from '@shared/types'
import type { AppContext } from '../../context'
import { StateStore } from '../../services/state'
import { MainModuleRegistry } from '../registry'
import { serversModule } from './index'

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
 * Story 114 D6 adds a `broadcast.emit` stub: `scan.start`'s handler now calls `ModuleSetup.emit`,
 * which the real registry wires to `app.broadcast.emit` (`src/main/modules/registry.ts`) - every
 * caller of this helper needs that seam to exist, even the tests that never assert on an emitted
 * event.
 */
function fakeAppContext(state?: StateStore, launchState: LaunchState = IDLE_LAUNCH_STATE): AppContext {
  const broadcast = { emit: () => {} }
  // Story 116 D3: the scan service/cadence read `app.launch` at construction - an idle, silent stub
  // by default; story 117 D4's guard tests below pass a `'running'`/`'starting'` state instead.
  const launch = { getState: () => launchState, onStateChange: () => () => {} }
  return (state === undefined ? { broadcast, launch } : { state, broadcast, launch }) as unknown as AppContext
}

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
  return {
    context: { state, broadcast, launch } as unknown as AppContext,
    setLaunchState: (next) => {
      launchState = next
      for (const listener of [...listeners]) listener(next)
    },
  }
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

  it('detail.read rejects a malformed address payload', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext())

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
    state = new StateStore(filePath)
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext(state))
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
    const store = new StateStore(filePath)
    await store.load()
    return store.serversState()
  }

  it('sources.list answers the shipped default list without writing anything', async () => {
    expect(await invoke('sources.list')).toEqual({ ok: true, value: DEFAULT_MASTER_SOURCES })
  })

  it('sources.add persists the new list and leaves the other servers-state keys alone', async () => {
    const before = state.serversState()

    const outcome = (await invoke('sources.add', {
      type: 'udp-master',
      address: 'master.example.com',
    })) as { ok: true; value: { ok: true; sources: unknown[] } }

    expect(outcome.ok).toBe(true)
    expect(outcome.value.ok).toBe(true)
    expect(outcome.value.sources).toHaveLength(4)

    const persisted = await reloaded()
    // The full new list came back, and it is exactly what is on disk - no drop on reload.
    expect(persisted.sources).toEqual(outcome.value.sources)
    expect(persisted.sources[3]).toEqual({
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
    expect(persisted.sources).toHaveLength(3)
    expect(persisted.sources[0]).toEqual({ ...target, enabled: false })
  })

  it('sources.reorder persists the new order', async () => {
    const ids = DEFAULT_MASTER_SOURCES.map((source) => source.id).reverse()

    expect(await invoke('sources.reorder', { ids })).toMatchObject({ ok: true, value: { ok: true } })

    expect((await reloaded()).sources.map((source) => source.id)).toEqual(ids)
  })

  it('a refusal carries a reason code and persists nothing', async () => {
    const before = state.serversState()

    expect(await invoke('sources.remove', { id: 'no-such-source' })).toEqual({
      ok: true,
      value: { ok: false, reason: 'not-found' },
    })
    expect(await invoke('sources.add', { type: 'http-list', address: 'not a url' })).toEqual({
      ok: true,
      value: { ok: false, reason: 'invalid-url' },
    })
    expect(await invoke('sources.reorder', { ids: ['only-one'] })).toEqual({
      ok: true,
      value: { ok: false, reason: 'invalid-reorder' },
    })

    expect(state.serversState()).toEqual(before)
    expect((await reloaded()).sources).toEqual(DEFAULT_MASTER_SOURCES)
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
    state = new StateStore(filePath)
    await state.load()
  })

  afterEach(async () => {
    await state.settle()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('AC1: registers favourites.list/add/remove, reachable through setup() and behaving correctly', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext(state))

    const emptyList = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesList,
    })
    expect(emptyList).toEqual({ ok: true, value: [] })

    const afterAdd = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesAdd,
      payload: '1.2.3.4:27910',
    })
    expect(afterAdd.ok).toBe(true)
    const added = (afterAdd as { ok: true; value: FavouriteServerEntry[] }).value
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ address: '1.2.3.4:27910' })

    const listAfterAdd = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesList,
    })
    expect(listAfterAdd).toEqual({ ok: true, value: added })

    const afterRemove = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesRemove,
      payload: '1.2.3.4:27910',
    })
    expect(afterRemove).toEqual({ ok: true, value: [] })

    const listAfterRemove = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesList,
    })
    expect(listAfterRemove).toEqual({ ok: true, value: [] })
  })

  it("AC1: a favourites write never clobbers the rest of the servers state's snapshot", async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext(state))

    const sourcesBefore = state.serversState().sources

    await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesAdd,
      payload: '1.2.3.4:27910',
    })

    expect(state.serversState().sources).toEqual(sourcesBefore)
    expect(state.serversState().manualServers).toEqual([])
    expect(state.serversState().history).toEqual([])
  })

  it('AC3: favourites survive a restart of the state store', async () => {
    const registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext(state))

    const outcome = await registry.invoke({
      moduleId: 'servers',
      type: SERVERS_HANDLERS.favouritesAdd,
      payload: '5.6.7.8:27911',
    })
    expect(outcome.ok).toBe(true)
    await state.settle()

    const reloaded = new StateStore(filePath)
    await reloaded.load()

    expect(reloaded.serversState().favourites).toEqual(state.serversState().favourites)
    expect(reloaded.serversState().favourites).toEqual([
      { address: '5.6.7.8:27911', addedAt: expect.any(String) },
    ])
  })
})

/**
 * Story 113 D4: the `manual.*`/`history.*` handlers over story 110's state key. Same harness as the
 * `favourites.*` block above - a real `StateStore` over a temp file, driven through the real
 * registry so the shared payload schemas run too. History is seeded through `setServersState`
 * directly rather than over IPC on purpose: there is no `history.record` channel (D-H), so main is
 * the only writer.
 */
describe('servers module manual.*/history.* handlers (story 113 D4)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-manual-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext(state))
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

  it('registers manual.list/add/remove and history.read, reachable through setup()', async () => {
    expect(await invoke(SERVERS_HANDLERS.manualList)).toEqual({ ok: true, value: [] })
    expect(await invoke(SERVERS_HANDLERS.historyRead)).toEqual({ ok: true, value: [] })
    expect(await invoke(SERVERS_HANDLERS.manualAdd, { address: '1.2.3.4:27910' })).toMatchObject({
      ok: true,
      value: { ok: true },
    })
    expect(await invoke(SERVERS_HANDLERS.manualRemove, { address: '1.2.3.4:27910' })).toEqual({
      ok: true,
      value: [],
    })
  })

  it('manual servers round-trip through add, list and remove', async () => {
    const added = (await invoke(SERVERS_HANDLERS.manualAdd, { address: '1.2.3.4:27910' })) as {
      ok: true
      value: ManualServerAddResult
    }
    expect(added.value).toEqual({
      ok: true,
      entry: { address: '1.2.3.4:27910', origin: 'manual', addedAt: expect.any(String) },
    })

    const listed = (await invoke(SERVERS_HANDLERS.manualList)) as {
      ok: true
      value: ManualServerEntry[]
    }
    expect(listed.value).toEqual([
      { address: '1.2.3.4:27910', origin: 'manual', addedAt: expect.any(String) },
    ])

    expect(await invoke(SERVERS_HANDLERS.manualRemove, { address: '1.2.3.4:27910' })).toEqual({
      ok: true,
      value: [],
    })
    expect(await invoke(SERVERS_HANDLERS.manualList)).toEqual({ ok: true, value: [] })

    // ...and it survived the trip to disk, not just the in-memory copy.
    await state.settle()
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(reloaded.serversState().manualServers).toEqual([])
  })

  it('a malformed address is refused as a value and persists nothing', async () => {
    const outcome = (await invoke(SERVERS_HANDLERS.manualAdd, { address: 'not a server' })) as {
      ok: true
      value: ManualServerAddResult
    }
    expect(outcome.value).toEqual({
      ok: false,
      reasonKey: 'servers.address.reject.extra-tokens',
    })
    expect(state.serversState().manualServers).toEqual([])
  })

  it('removing one manual server leaves the other manual entries and the history untouched', async () => {
    const history: ServerHistoryEntry[] = [
      { address: '9.9.9.9:27910', connectedAt: '2026-01-03T00:00:00.000Z' },
      { address: '1.2.3.4:27910', connectedAt: '2026-01-02T00:00:00.000Z' },
    ]
    state.setServersState({ ...state.serversState(), history })

    await invoke(SERVERS_HANDLERS.manualAdd, { address: '1.2.3.4:27910' })
    await invoke(SERVERS_HANDLERS.manualAdd, { address: '5.6.7.8:27911' })
    const sourcesBefore = state.serversState().sources

    const remaining = (await invoke(SERVERS_HANDLERS.manualRemove, {
      address: '1.2.3.4:27910',
    })) as { ok: true; value: ManualServerEntry[] }

    // The other manual entry is still there - only the named one went.
    expect(remaining.value).toEqual([
      { address: '5.6.7.8:27911', origin: 'manual', addedAt: expect.any(String) },
    ])
    // ...and the history is untouched, including its row for the very address just removed.
    expect(state.serversState().history).toEqual(history)
    expect(await invoke(SERVERS_HANDLERS.historyRead)).toEqual({ ok: true, value: history })
    expect(state.serversState().sources).toEqual(sourcesBefore)

    await state.settle()
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(reloaded.serversState().history).toEqual(history)
    expect(reloaded.serversState().manualServers).toEqual(remaining.value)
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
    state = new StateStore(filePath)
    await state.load()
    state.setServersState({
      ...state.serversState(),
      sources: [],
      favourites: [],
      manualServers: [],
    })
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext(state))
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
    state = new StateStore(filePath)
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext(state))
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
    const before = state.serversState()

    expect(await invoke(SERVERS_HANDLERS.scanGetSettings)).toEqual({
      ok: true,
      value: before.scan,
    })
  })

  it('scan.patchSettings round-trips a partial patch through state.json and leaves the other keys untouched', async () => {
    const before = state.serversState()

    const outcome = await invoke(SERVERS_HANDLERS.scanPatchSettings, { concurrency: 16 })
    expect(outcome).toEqual({
      ok: true,
      value: { ...before.scan, concurrency: 16 },
    })

    await state.settle()
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    const persisted = reloaded.serversState()

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
    expect(state.serversState().scan.concurrency).toBe(DEFAULT_SERVERS_STATE.scan.concurrency)
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
    state = new StateStore(filePath)
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, fakeAppContext(state))
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
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(reloaded.serversState().listSort).toEqual(sort)
  })

  it('list.setSort null clears the persisted sort', async () => {
    await invoke(SERVERS_HANDLERS.listSetSort, { sort: { column: 'name', direction: 'asc' } })
    const outcome = await invoke(SERVERS_HANDLERS.listSetSort, { sort: null })
    expect(outcome).toEqual({ ok: true, value: null })

    expect(await invoke(SERVERS_HANDLERS.listGetSort)).toEqual({ ok: true, value: null })

    await state.settle()
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(reloaded.serversState().listSort).toBeUndefined()
  })

  it('list.setSort rejects an unknown column', async () => {
    expect(
      await invoke(SERVERS_HANDLERS.listSetSort, { sort: { column: 'nope', direction: 'asc' } }),
    ).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(state.serversState().listSort).toBeUndefined()
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
    state = new StateStore(filePath)
    await state.load()
    state.setServersState({
      ...state.serversState(),
      sources: [],
      favourites: [],
      manualServers: [],
    })
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
      fakeAppContext(state, { phase: 'running', installationId: 'inst-1' }),
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
    await registry.register(serversModule, fakeAppContext(state))

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
    state = new StateStore(filePath)
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

    expect(state.serversState().history).toEqual([
      { address: '1.2.3.4:27910', connectedAt: expect.any(String) },
    ])

    await state.settle()
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(reloaded.serversState().history).toEqual(state.serversState().history)
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

    expect(state.serversState().history).toEqual([])
  })
})
