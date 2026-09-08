import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNLOADS_HANDLERS, type ManifestSnapshot } from '@shared/modules/downloads'
import { fail, type Outcome } from '@shared/types'
import type { Logger } from '../../lib/logger'
import type { ModuleHandler, ModuleSetup } from '../types'
import { downloadsModule } from './index'

/**
 * Story 070 D4: the downloads module's main half. Covers the acceptance line verbatim - the
 * handler is registered under the exact channel `downloads/manifest.get`, a successful fetch
 * answers `ok` with a `ManifestSnapshot`, and a dead network with a cold cache answers a failure
 * `Outcome` carrying the i18n key `downloads.error.manifestUnavailable` - never prose.
 *
 * `electron` and `fetch` are mocked exactly as `manifest-service.test.ts` mocks them (this
 * handler constructs a real `ManifestService` internally, so there is no separate seam to fake):
 * `app.getPath('userData')` points at a per-test temp folder, and `fetch` is a stubbed global
 * routed by URL. `handle()` is collected the same way `config/index.test.ts` collects it - a
 * fake `ModuleSetup.handle` that mirrors `MainModuleRegistry.invoke()`'s own
 * `schema.safeParse` + call, so a test reaching the collected handler exercises the same
 * validation path production traffic does.
 */

const userDataBox = vi.hoisted(() => ({ current: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataBox.current },
}))

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
}

const enginePackage = {
  kind: 'engine',
  engine: 'q2pro',
  id: 'q2pro-1.0.0',
  version: '1.0.0',
  sizeBytes: 4096,
  sha256: 'a'.repeat(64),
  url: 'https://example.com/q2pro-1.0.0.zip',
  mirrors: [],
  contents: [{ from: 'q2pro.exe', to: 'root' }],
}

const enginesManifest = { schemaVersion: 1, packages: [enginePackage], pinned: {} }
const gamedataManifest = { schemaVersion: 1, packages: [] }

/** Both manifest files answer 200, routed by URL - same helper `manifest-service.test.ts` uses. */
function serveGoodManifests(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockImplementation((url: unknown) =>
    Promise.resolve(jsonResponse(String(url).includes('engines/') ? enginesManifest : gamedataManifest)),
  )
}

/** The network is gone: every request rejects, as `fetch` does when offline. */
function serveOffline(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockImplementation(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')))
}

/** Collects `handle()` calls the way `MainModuleRegistry.invoke()` actually dispatches them. */
function collectHandlers(handlers: Map<string, ModuleHandler>): ModuleSetup['handle'] {
  return (type, schema, handler) => {
    handlers.set(type, (payload) => {
      const parsed = schema.safeParse(payload)
      if (!parsed.success) return fail('ipc.error.invalidPayload')
      return handler(parsed.data)
    })
  }
}

let dir: string
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-downloads-index-'))
  userDataBox.current = join(dir, 'userData')
  await mkdir(userDataBox.current, { recursive: true })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function setUpModule(): Promise<Map<string, ModuleHandler>> {
  const handlers = new Map<string, ModuleHandler>()
  await downloadsModule.setup({
    handle: collectHandlers(handlers),
    emit: vi.fn(),
    app: {} as ModuleSetup['app'],
    log: fakeLogger(),
  })
  return handlers
}

describe('downloadsModule', () => {
  it('registers manifest.get under the exact channel name', async () => {
    const handlers = await setUpModule()

    expect(handlers.has(DOWNLOADS_HANDLERS.manifestGet)).toBe(true)
    expect(DOWNLOADS_HANDLERS.manifestGet).toBe('manifest.get')
  })

  it('returns ok with a ManifestSnapshot on a successful fetch', async () => {
    serveGoodManifests(fetchMock)
    const handlers = await setUpModule()
    const handler = handlers.get(DOWNLOADS_HANDLERS.manifestGet)!

    const outcome = (await handler({})) as Outcome<ManifestSnapshot>

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.value.schemaVersion).toBe(1)
      expect(outcome.value.packages.map((pkg) => pkg.id)).toEqual(['q2pro-1.0.0'])
      expect(outcome.value.fromCache).toBe(false)
    }
  })

  it('returns the i18n key (never prose) when nothing is available', async () => {
    serveOffline(fetchMock)
    const handlers = await setUpModule()
    const handler = handlers.get(DOWNLOADS_HANDLERS.manifestGet)!

    const outcome = (await handler({})) as Outcome<ManifestSnapshot>

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.key).toBe('downloads.error.manifestUnavailable')
      // Proves this is a key, not a human-readable sentence: no spaces, matches the
      // dotted-key shape every other i18n error key in this codebase uses.
      expect(outcome.error.key).not.toMatch(/\s/)
    }
  })
})
