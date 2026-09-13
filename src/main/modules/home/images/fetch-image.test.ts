import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION_PX,
  fetchImage,
  type DecodeImage,
  type FetchImageOptions,
} from './fetch-image'
import { newsImageFileName } from './paths'

/**
 * Story 084 D2 - integration, on purpose, exactly like `downloads/fetcher.test.ts` and
 * `news/feed-fetcher.test.ts`: a real `node:http` server on `127.0.0.1` answers real requests, and
 * `fetchImage()` talks to it through the real global `fetch` via the injected `fetchImpl`. Only
 * `decodeImage` is faked - that is the one seam the module was built with specifically so tests
 * never need real image bytes or an Electron runtime.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let dir: string
let cacheDir: string
let server: Server
let origin: string
const routes = new Map<string, Handler>()
const hits = new Map<string, number>()
const openResponses = new Set<ServerResponse>()

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-fetch-image-'))
  cacheDir = join(dir, 'news-images')
  await mkdir(cacheDir, { recursive: true })
  routes.clear()
  hits.clear()
  openResponses.clear()

  server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    hits.set(pathname, (hits.get(pathname) ?? 0) + 1)
    openResponses.add(res)
    res.on('close', () => openResponses.delete(res))
    const handler = routes.get(pathname)
    if (handler === undefined) {
      res.statusCode = 404
      res.end('no such route')
      return
    }
    handler(req, res)
  })
  server.keepAliveTimeout = 50
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  for (const res of openResponses) res.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(dir, { recursive: true, force: true })
})

const PATH = '/slide.png'

function route(pathname: string, handler: Handler): string {
  routes.set(pathname, handler)
  return `${origin}${pathname}`
}

function serves(body: Buffer, contentType = 'image/png'): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-length': String(body.byteLength), 'content-type': contentType })
    res.end(body)
  }
}

/** No `content-length` (chunked): the streamed-byte cap is the only thing that can catch this. */
function servesChunked(body: Buffer, contentType = 'image/png'): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': contentType })
    res.end(body)
  }
}

function servesStatus(status: number): Handler {
  return (_req, res) => {
    res.writeHead(status)
    res.end(`status ${status}`)
  }
}

/** Never responds - triggers the caller's own timeout. */
function hangs(): Handler {
  return (_req, res) => {
    openResponses.add(res)
  }
}

function fileName(sourceUrl = `${origin}${PATH}`, ext = 'png'): string {
  return newsImageFileName(sourceUrl, ext)
}

async function cacheEntries(): Promise<string[]> {
  return (await readdir(cacheDir)).sort()
}

const validDecode: DecodeImage = () => ({ ok: true, width: 64, height: 64 })
const oversizedDecode: DecodeImage = () => ({ ok: true, width: 4001, height: 64 })
const undecodableDecode: DecodeImage = () => ({ ok: false })

function opts(overrides: Partial<FetchImageOptions> = {}): FetchImageOptions {
  return {
    sourceUrl: `${origin}${PATH}`,
    cacheDir,
    fetchImpl: fetch,
    decodeImage: validDecode,
    timeoutMs: 200,
    retries: 1,
    ...overrides,
  }
}

describe('fetchImage', () => {
  it('rejects a body over the cap when content-length is absent and the stream itself is huge', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1024, 0x42)
    route(PATH, servesChunked(big))

    const result = await fetchImage(opts())

    expect(result.kind).toBe('rejected')
    expect(await cacheEntries()).toEqual([])
  })

  it('rejects a body over the cap when content-length honestly declares it', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1024, 0x42)
    route(PATH, serves(big))

    const result = await fetchImage(opts())

    expect(result.kind).toBe('rejected')
    if (result.kind === 'rejected') expect(result.reason).toContain('content-length')
    expect(await cacheEntries()).toEqual([])
  })

  it('rejects a non-image content-type', async () => {
    route(PATH, serves(Buffer.from('not an image'), 'text/html'))

    const result = await fetchImage(opts())

    expect(result.kind).toBe('rejected')
    expect(await cacheEntries()).toEqual([])
  })

  it('rejects a body decodeImage reports as undecodable', async () => {
    route(PATH, serves(Buffer.alloc(16, 0x01)))

    const result = await fetchImage(opts({ decodeImage: undecodableDecode }))

    expect(result.kind).toBe('rejected')
    expect(await cacheEntries()).toEqual([])
  })

  it('rejects an image decodeImage reports as over 4000px', async () => {
    route(PATH, serves(Buffer.alloc(16, 0x01)))

    const result = await fetchImage(opts({ decodeImage: oversizedDecode }))

    expect(result.kind).toBe('rejected')
    if (result.kind === 'rejected') expect(result.reason).toContain(String(MAX_IMAGE_DIMENSION_PX))
    expect(await cacheEntries()).toEqual([])
  })

  it('a 404 is gone and deletes a pre-existing cached copy', async () => {
    const existing = fileName()
    await writeFile(join(cacheDir, existing), Buffer.from('old bytes'))
    route(PATH, servesStatus(404))

    const result = await fetchImage(opts())

    expect(result.kind).toBe('gone')
    expect(await cacheEntries()).toEqual([])
  })

  it('a 410 is gone and deletes a pre-existing cached copy', async () => {
    const existing = fileName()
    await writeFile(join(cacheDir, existing), Buffer.from('old bytes'))
    route(PATH, servesStatus(410))

    const result = await fetchImage(opts())

    expect(result.kind).toBe('gone')
    expect(await cacheEntries()).toEqual([])
  })

  it('a timeout is unavailable and leaves a pre-existing cached copy untouched', async () => {
    const existing = fileName()
    await writeFile(join(cacheDir, existing), Buffer.from('old bytes'))
    route(PATH, hangs())

    const result = await fetchImage(opts({ timeoutMs: 30, retries: 1 }))

    expect(result.kind).toBe('unavailable')
    expect(await cacheEntries()).toEqual([existing])
  })

  it('a thrown network error is unavailable and leaves a pre-existing cached copy untouched', async () => {
    const existing = fileName()
    await writeFile(join(cacheDir, existing), Buffer.from('old bytes'))
    const throwingFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    const result = await fetchImage(opts({ fetchImpl: throwingFetch, retries: 1 }))

    expect(result.kind).toBe('unavailable')
    expect(throwingFetch).toHaveBeenCalledTimes(2) // initial + 1 retry
    expect(await cacheEntries()).toEqual([existing])
  })

  it('a 5xx is unavailable (after one retry) and leaves a pre-existing cached copy untouched', async () => {
    const existing = fileName()
    await writeFile(join(cacheDir, existing), Buffer.from('old bytes'))
    route(PATH, servesStatus(503))

    const result = await fetchImage(opts({ retries: 1 }))

    expect(result.kind).toBe('unavailable')
    expect(hits.get(PATH)).toBe(2) // initial + 1 retry
    expect(await cacheEntries()).toEqual([existing])
  })

  it('a good small PNG lands cached under its content-addressed name', async () => {
    const png = Buffer.alloc(1024, 0x89)
    route(PATH, serves(png))

    const result = await fetchImage(opts())

    expect(result.kind).toBe('cached')
    const expected = fileName()
    if (result.kind === 'cached') {
      expect(result.fileName).toBe(expected)
      expect(result.path).toBe(join(cacheDir, expected))
    }
    expect(await cacheEntries()).toEqual([expected])
  })
})
