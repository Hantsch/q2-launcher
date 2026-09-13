import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNLOADS_HANDLERS, type BootstrapEngineOption } from '@shared/modules/downloads'
import type { Logger } from '../../lib/logger'
import { JobsService } from '../../services/jobs'
import type { ModuleHandler, ModuleSetup } from '../types'
import { fail } from '@shared/types'
import { downloadsModule } from './index'

/**
 * Story 074 D1 (AC1), extended by 080 D2: `bootstrapEngineOptions` must offer only engines that
 * are BOTH pinned by the manifest AND named in `BOOTSTRAP_SUPPORTED_ENGINES` (now Q2PRO and R1Q2).
 * A tautological test would just re-assert that constant; instead this fixture pins TWO engines in
 * the manifest - Q2PRO (in the list) and YQUAKE2 (a real engine `@shared/types/engine` knows how
 * to classify, but NOT in `BOOTSTRAP_SUPPORTED_ENGINES`) - and proves the handler drops the second
 * one even though it is a perfectly valid, pinned engine the launcher recognises. That is the one
 * behaviour that could silently regress if the filter were ever loosened to "pinned" alone. A
 * second test below proves the complementary AC1 behaviour: R1Q2 itself is now offered once
 * pinned, carrying its own identity/version/size.
 *
 * Mocking follows `index.test.ts`'s own convention exactly: `electron.app.getPath('userData')` is
 * stubbed to a per-test temp folder, `fetch` is a stubbed global routed by URL, and `handle()` is
 * collected the same way `MainModuleRegistry.invoke()` actually dispatches - schema.safeParse, then
 * call.
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

function enginePackage(engine: string, id: string): unknown {
  return {
    kind: 'engine',
    engine,
    id,
    version: '1.0.0',
    sizeBytes: 4096,
    sha256: 'a'.repeat(64),
    url: `https://example.com/${id}.zip`,
    mirrors: [],
    contents: [{ from: `${engine}.exe`, to: 'root' }],
  }
}

/** Pins Q2PRO (bootstrap-supported) and YQUAKE2 (launcher-supported, but not bootstrap-supported). */
const enginesManifest = {
  schemaVersion: 1,
  packages: [enginePackage('q2pro', 'q2pro-1.0.0'), enginePackage('yquake2', 'yquake2-1.0.0')],
  pinned: { q2pro: 'q2pro-1.0.0', yquake2: 'yquake2-1.0.0' },
}
/** Pins both bootstrap-supported engines, for the "R1Q2 is offered" test below. */
const bothEnginesManifest = {
  schemaVersion: 1,
  packages: [enginePackage('q2pro', 'q2pro-1.0.0'), enginePackage('r1q2', 'r1q2-1.0.0')],
  pinned: { q2pro: 'q2pro-1.0.0', r1q2: 'r1q2-1.0.0' },
}
const gamedataManifest = { schemaVersion: 1, packages: [] }

function serveGoodManifests(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockImplementation((url: unknown) =>
    Promise.resolve(
      jsonResponse(String(url).includes('engines/') ? enginesManifest : gamedataManifest),
    ),
  )
}

function serveBothEnginesManifest(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockImplementation((url: unknown) =>
    Promise.resolve(
      jsonResponse(String(url).includes('engines/') ? bothEnginesManifest : gamedataManifest),
    ),
  )
}

function serveOffline(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockImplementation(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')))
}

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
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-bootstrap-engine-options-'))
  userDataBox.current = join(dir, 'userData')
  await mkdir(userDataBox.current, { recursive: true })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await downloadsModule.dispose?.()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function setUpModule(): Promise<Map<string, ModuleHandler>> {
  const handlers = new Map<string, ModuleHandler>()
  await downloadsModule.setup({
    handle: collectHandlers(handlers),
    emit: vi.fn(),
    app: { jobs: new JobsService(() => {}) } as unknown as ModuleSetup['app'],
    log: fakeLogger(),
  })
  return handlers
}

describe('downloadsModule bootstrapEngineOptions', () => {
  it('registers the handler under the exact channel name', async () => {
    const handlers = await setUpModule()

    expect(handlers.has(DOWNLOADS_HANDLERS.bootstrapEngineOptions)).toBe(true)
    expect(DOWNLOADS_HANDLERS.bootstrapEngineOptions).toBe('bootstrap.engineOptions')
  })

  it('offers only Q2PRO, even though YQUAKE2 is also pinned and launcher-supported', async () => {
    serveGoodManifests(fetchMock)
    const handlers = await setUpModule()
    const handler = handlers.get(DOWNLOADS_HANDLERS.bootstrapEngineOptions)!

    const options = (await handler(undefined)) as BootstrapEngineOption[]

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      engine: 'q2pro',
      packageId: 'q2pro-1.0.0',
      version: '1.0.0',
      sizeBytes: 4096,
    })
    expect(options.some((option) => option.engine === 'yquake2')).toBe(false)
  })

  it('offers R1Q2 too once it is pinned, with its own identity, version and size', async () => {
    serveBothEnginesManifest(fetchMock)
    const handlers = await setUpModule()
    const handler = handlers.get(DOWNLOADS_HANDLERS.bootstrapEngineOptions)!

    const options = (await handler(undefined)) as BootstrapEngineOption[]

    expect(options).toHaveLength(2)
    expect(options).toContainEqual({
      engine: 'q2pro',
      packageId: 'q2pro-1.0.0',
      version: '1.0.0',
      sizeBytes: 4096,
    })
    expect(options).toContainEqual({
      engine: 'r1q2',
      packageId: 'r1q2-1.0.0',
      version: '1.0.0',
      sizeBytes: 4096,
    })
  })

  it('answers an empty list, not a failure, when the manifest is unavailable', async () => {
    serveOffline(fetchMock)
    const handlers = await setUpModule()
    const handler = handlers.get(DOWNLOADS_HANDLERS.bootstrapEngineOptions)!

    const options = (await handler(undefined)) as BootstrapEngineOption[]

    expect(options).toEqual([])
  })
})
