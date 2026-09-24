import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MASTER_SOURCES, type ServersState } from '@shared/modules/servers'
import { getModuleManifest } from '@shared/types'
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

describe('servers module sources.* handlers (story 111 D3)', () => {
  let filePath: string
  let state: StateStore
  let registry: MainModuleRegistry

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-sources-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
    registry = new MainModuleRegistry()
    await registry.register(serversModule, { state } as unknown as AppContext)
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
