import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MODS_HANDLERS, type ModCatalogState } from '@shared/modules/mods'
import type { Outcome } from '@shared/types'
import type { AppContext } from '../../context'
import type { Logger } from '../../lib/logger'
import { MainModuleRegistry } from '../registry'
import { resolveUiHarness } from '../../lib/ui-harness'
import { PersistenceRegistry } from '../../services/persistence'
import { CATALOG_FRESHNESS_MS, CatalogService } from './catalog-service'
import { modsModule } from './index'

const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
  shell: { openPath: vi.fn() },
}))

const T0 = Date.parse('2026-03-01T12:00:00.000Z')

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

const rogue = {
  id: 'rogue',
  gamedir: 'rogue',
  name: 'Rogue',
  description: 'A mission pack.',
  license: 'GPL-2.0',
  projectUrl: 'https://example.com/',
  sourceUrl: 'https://example.com/src',
  pinned: '1.0',
  versions: [
    {
      version: '1.0',
      prerelease: false,
      variants: [
        {
          platform: 'win32',
          arch: 'x64',
          packages: [
            {
              id: 'p1',
              version: '1',
              url: 'https://example.com/p1.zip',
              mirrors: [],
              sizeBytes: 10,
              sha256: 'a'.repeat(64),
              contents: [{ from: '.', to: 'gamedir' }],
            },
          ],
        },
      ],
      contentOnly: { packages: [] },
    },
  ],
}
const catalog = { schemaVersion: 1, entries: [rogue] }

let dir: string
let log: Logger
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-catalog-service-'))
  userDataBox.current = join(dir, 'userData')
  await mkdir(userDataBox.current, { recursive: true })
  log = fakeLogger()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

describe('CatalogService', () => {
  it('serves a catalog fetched within 15 minutes without refetching', async () => {
    fetchMock.mockResolvedValue(jsonResponse(catalog))
    const service = new CatalogService({ log })
    const first = await service.getCatalog()
    expect(first).toMatchObject({ status: 'ok', fromCache: false, ageMs: 0 })

    vi.setSystemTime(T0 + CATALOG_FRESHNESS_MS - 1000)
    const second = await service.getCatalog()
    expect(second).toMatchObject({
      status: 'ok',
      fromCache: false,
      ageMs: CATALOG_FRESHNESS_MS - 1000,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await service.getCatalog({ refresh: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a failed fetch serves the last good cache with its age', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(catalog))
    await new CatalogService({ log }).getCatalog()

    // A new process: the disk cache is never "fresh", so the fetch is attempted and fails.
    vi.setSystemTime(T0 + 20 * 60 * 1000)
    fetchMock.mockRejectedValue(new Error('offline'))
    const snapshot = await new CatalogService({ log }).getCatalog()
    expect(snapshot).toMatchObject({
      status: 'ok',
      fromCache: true,
      ageMs: 20 * 60 * 1000,
      fetchedAt: new Date(T0).toISOString(),
    })
    if (snapshot.status === 'ok') expect(snapshot.entries.map((e) => e.id)).toEqual(['rogue'])
  })

  it('a refused envelope with no cache is unavailable', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ schemaVersion: 99, entries: [] }))
    const snapshot = await new CatalogService({ log }).getCatalog()
    expect(snapshot).toEqual({ status: 'unavailable' })
  })

  it('a refused envelope serves the last good cache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(catalog))
    const service = new CatalogService({ log })
    await service.getCatalog()
    fetchMock.mockResolvedValue(jsonResponse({ nonsense: true }))
    const snapshot = await service.getCatalog({ refresh: true })
    expect(snapshot).toMatchObject({ status: 'ok', fromCache: true })
  })

  it('a non-empty list with every entry dropped is a failed fetch and keeps the cache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(catalog))
    const service = new CatalogService({ log })
    await service.getCatalog()
    fetchMock.mockResolvedValue(
      jsonResponse({ schemaVersion: 1, entries: [{ id: 'x', gamedir: '../escape', name: 'X' }] }),
    )
    const snapshot = await service.getCatalog({ refresh: true })
    expect(snapshot).toMatchObject({ status: 'ok', fromCache: true })
    if (snapshot.status === 'ok') expect(snapshot.entries.map((e) => e.id)).toEqual(['rogue'])

    // The cache on disk was not overwritten by the all-dropped fetch.
    const next = await new CatalogService({ log }).getCatalog({ refresh: true })
    if (next.status === 'ok') expect(next.entries.map((e) => e.id)).toEqual(['rogue'])
    else throw new Error('expected the cached catalog')
  })

  it('a genuinely empty entries list is an ok empty catalog', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ schemaVersion: 1, entries: [] }))
    const snapshot = await new CatalogService({ log }).getCatalog()
    expect(snapshot).toMatchObject({ status: 'ok', fromCache: false, entries: [] })
  })

  it('all-invalid entries with no cache are unavailable', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ schemaVersion: 1, entries: [{ id: 'x', gamedir: '../escape', name: 'X' }] }),
    )
    expect(await new CatalogService({ log }).getCatalog()).toEqual({ status: 'unavailable' })
  })
})

describe('mods catalog.get handler', () => {
  async function registry() {
    const app = {
      isDev: false,
      harness: resolveUiHarness({}),
      persistence: new PersistenceRegistry(),
      installations: { find: () => undefined },
    } as unknown as AppContext
    const r = new MainModuleRegistry()
    await r.register(modsModule, app)
    return r
  }
  const invoke = (r: MainModuleRegistry, payload: unknown) =>
    r.invoke({ moduleId: 'mods', type: MODS_HANDLERS.catalogGet, payload })

  it('rejects an invalid payload', async () => {
    const r = await registry()
    const result = (await invoke(r, { refresh: 'yes', extra: 1 })) as { ok: boolean }
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns only the DTO fields, never variants or packages', async () => {
    fetchMock.mockResolvedValue(jsonResponse(catalog))
    const r = await registry()
    const outcome = (await invoke(r, {})) as Outcome<ModCatalogState>
    expect(outcome.ok).toBe(true)
    if (!outcome.ok || outcome.value.status !== 'ok') throw new Error('expected ok state')
    const entry = outcome.value.entries[0]
    expect(Object.keys(entry).sort()).toEqual(
      [
        'description',
        'gamedir',
        'id',
        'license',
        'name',
        'pinned',
        'projectUrl',
        'sourceUrl',
        'versions',
      ].sort(),
    )
    expect(entry.versions[0]).toEqual({ version: '1.0', prerelease: false })
  })
})
