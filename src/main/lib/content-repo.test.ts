import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  CachedContentDocument,
  ContentRepoHttpError,
  contentRepoUrl,
  fetchContentJson,
} from './content-repo'
import type { Logger } from './logger'

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  const status = init?.status ?? (init?.ok === false ? 500 : 200)
  return new Response(JSON.stringify(body), { status })
}

describe('content-repo', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // AC1: the manifest is fetched from engines/ and gamedata/ on main of the content repository.
  it('requests the engines manifest from the exact content-repo URL on main', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ engines: [] }))

    await fetchContentJson('engines/manifest.json')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/engines/manifest.json',
    )
  })

  it('requests the gamedata manifest from the exact content-repo URL on main', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ gamedata: [] }))

    await fetchContentJson('gamedata/manifest.json')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/gamedata/manifest.json',
    )
  })

  it('contentRepoUrl() builds the same URLs directly, including a leading-slash path', () => {
    expect(contentRepoUrl('engines/manifest.json')).toBe(
      'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/engines/manifest.json',
    )
    expect(contentRepoUrl('/gamedata/manifest.json')).toBe(
      'https://raw.githubusercontent.com/Hantsch/q2_community_content/main/gamedata/manifest.json',
    )
  })

  it('passes an AbortSignal to fetch, derived from the default 10s timeout', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    await fetchContentJson('engines/manifest.json')

    const options = fetchMock.mock.calls[0][1] as { signal?: unknown }
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('honours a custom timeoutMs by asking AbortSignal.timeout for it', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    await fetchContentJson('engines/manifest.json', { timeoutMs: 5_000 })

    expect(timeoutSpy).toHaveBeenCalledWith(5_000)
    timeoutSpy.mockRestore()
  })

  it('throws an inspectable error carrying the status on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 404 }))

    await expect(fetchContentJson('engines/manifest.json')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('the thrown error is a ContentRepoHttpError instance for 500s too', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, { ok: false, status: 500 }))

    const error = await fetchContentJson('gamedata/manifest.json').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ContentRepoHttpError)
    expect((error as ContentRepoHttpError).status).toBe(500)
  })

  it('a request that never answers fails with the timeout reason instead of hanging', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        }),
    )

    await expect(fetchContentJson('engines/manifest.json', { timeoutMs: 20 })).rejects.toThrow(
      /no response within 20ms/,
    )
  })
})

describe('CachedContentDocument', () => {
  let dir: string
  const log = (): Logger =>
    ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger
  const make = (fetchBody: () => Promise<{ items: string[] }>, logger = log()) =>
    new CachedContentDocument<{ items: string[] }>({
      filePath: join(dir, 'doc.json'),
      freshnessMs: 60_000,
      cacheVersion: 2,
      label: 'doc',
      log: logger,
      schema: z.object({ items: z.array(z.string()) }),
      fetch: fetchBody,
    })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cached-doc-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('a cache read off disk is never fresh', async () => {
    await writeFile(
      join(dir, 'doc.json'),
      JSON.stringify({ cacheVersion: 2, fetchedAt: new Date().toISOString(), items: ['old'] }),
    )
    const fetchBody = vi.fn().mockResolvedValue({ items: ['new'] })
    const result = await make(fetchBody).get()
    expect(fetchBody).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ status: 'ok', fromCache: false, data: { items: ['new'] } })
  })

  it('serves the disk copy only when the live fetch failed', async () => {
    await writeFile(
      join(dir, 'doc.json'),
      JSON.stringify({ cacheVersion: 2, fetchedAt: new Date().toISOString(), items: ['old'] }),
    )
    const result = await make(() => Promise.reject(new Error('offline'))).get()
    expect(result).toMatchObject({
      status: 'ok',
      fromCache: true,
      fallbackReason: 'offline',
      data: { items: ['old'] },
    })
  })

  it('a cacheVersion mismatch discards the cache', async () => {
    await writeFile(
      join(dir, 'doc.json'),
      JSON.stringify({ cacheVersion: 1, fetchedAt: new Date().toISOString(), items: ['old'] }),
    )
    const logger = log()
    const result = await make(() => Promise.reject(new Error('offline')), logger).get()
    expect(result).toEqual({ status: 'unavailable', reason: 'offline' })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('cache discarded'))
  })
})
