import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveExtractorPath } from '../lib/archive/7za-path'
import { stagePackage, type StageExtractFn } from './package-staging'

const PAYLOAD = Buffer.from('package bytes for the stager test\n')
const SHA = createHash('sha256').update(PAYLOAD).digest('hex')

let userData: string
let server: Server
let baseUrl: string
const hits: string[] = []

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'q2l-stage-'))
  hits.length = 0
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/good.bin') {
      res.writeHead(200, { 'content-length': PAYLOAD.length })
      res.end(PAYLOAD)
    } else if (req.url === '/wrong-hash.bin') {
      const wrong = Buffer.alloc(PAYLOAD.length, 1)
      res.writeHead(200, { 'content-length': wrong.length })
      res.end(wrong)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(userData, { recursive: true, force: true })
})

const resolveExtractor = (): { path: string; exists: boolean } => ({
  path: 'fake-7za',
  exists: true,
})

const baseInput = (overrides: { url: string; mirrors?: string[]; sizeBytes?: number }) => ({
  source: {
    fileName: 'pkg.bin',
    url: overrides.url,
    mirrors: overrides.mirrors ?? [],
    sizeBytes: overrides.sizeBytes ?? PAYLOAD.length,
    sha256: SHA,
  },
  jobId: 'job1',
  index: 0,
  userDataPath: userData,
  signal: new AbortController().signal,
  resolveExtractor,
})

describe('stagePackage', () => {
  it('a size or SHA256 mismatch never extracts', async () => {
    const extract = vi.fn()
    const sizeMismatch = await stagePackage({
      ...baseInput({ url: `${baseUrl}/good.bin`, sizeBytes: PAYLOAD.length + 1 }),
      extract: extract as unknown as StageExtractFn,
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    const hashMismatch = await stagePackage({
      ...baseInput({ url: `${baseUrl}/wrong-hash.bin` }),
      extract: extract as unknown as StageExtractFn,
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    expect(sizeMismatch.ok).toBe(false)
    expect(hashMismatch.ok).toBe(false)
    expect(extract).not.toHaveBeenCalled()
  })

  it('a failing url falls back to the mirror', async () => {
    const seen: string[] = []
    const extract: StageExtractFn = (input) => {
      seen.push(input.archive.path)
      return { result: Promise.resolve({ ok: true, value: undefined }), kill: () => {} }
    }
    const result = await stagePackage({
      ...baseInput({ url: `${baseUrl}/missing.bin`, mirrors: [`${baseUrl}/good.bin`] }),
      extract,
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    expect(result.ok).toBe(true)
    expect(hits).toEqual(['/missing.bin', '/good.bin'])
    expect(seen).toHaveLength(1)
    expect(await readFile(seen[0]!)).toEqual(PAYLOAD)
    if (result.ok) expect(result.extractDir).toContain('job1-0')
  })

  it('a failed extraction reports stage extract with the download url', async () => {
    const extract: StageExtractFn = () => ({
      result: Promise.resolve({ ok: false, error: { key: 'downloads.error.extractionFailed' } }),
      kill: () => {},
    })
    const result = await stagePackage({
      ...baseInput({ url: `${baseUrl}/good.bin` }),
      extract,
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    expect(result).toMatchObject({
      ok: false,
      stage: 'extract',
      key: 'downloads.error.extractionFailed',
      url: `${baseUrl}/good.bin`,
    })
  })

  it('a failed extraction keeps the extractor key and the archive size', async () => {
    const extract: StageExtractFn = () => ({
      result: Promise.resolve({ ok: false, error: { key: 'extractor.unlisted' } }),
      kill: () => {},
    })
    const result = await stagePackage({
      ...baseInput({ url: `${baseUrl}/good.bin` }),
      extract,
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    expect(result).toMatchObject({
      ok: false,
      stage: 'extract',
      key: 'downloads.error.extractionFailed',
      extractorKey: 'extractor.unlisted',
      sizeBytes: PAYLOAD.length,
    })
  })

  it('a staging directory that cannot be created reports stage prepare with the archive url and size', async () => {
    const blocker = join(userData, 'blocker')
    await writeFile(blocker, 'not a directory')
    const extract = vi.fn()
    const result = await stagePackage({
      ...baseInput({ url: `${baseUrl}/good.bin` }),
      extractDir: join(blocker, 'extract'),
      extract: extract as unknown as StageExtractFn,
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    expect(result).toMatchObject({
      ok: false,
      cancelled: false,
      stage: 'prepare',
      key: 'downloads.error.diskWrite',
      url: `${baseUrl}/good.bin`,
      sizeBytes: PAYLOAD.length,
    })
    expect(extract).not.toHaveBeenCalled()
  })

  it('a signal aborted before the download is cancelled without fetching or extracting', async () => {
    const controller = new AbortController()
    controller.abort()
    const extract = vi.fn()
    const result = await stagePackage({
      ...baseInput({ url: `${baseUrl}/good.bin` }),
      signal: controller.signal,
      extract: extract as unknown as StageExtractFn,
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    expect(result).toMatchObject({ ok: false, cancelled: true })
    expect(hits).toEqual([])
    expect(extract).not.toHaveBeenCalled()
  })

  it('a signal aborted once the download finished is cancelled without extracting', async () => {
    const controller = new AbortController()
    const extract = vi.fn()
    const result = await stagePackage({
      ...baseInput({ url: `${baseUrl}/good.bin` }),
      signal: controller.signal,
      extract: extract as unknown as StageExtractFn,
      options: {
        fetchImpl: async (url, init) => {
          const response = await fetch(url, init)
          const bytes = Buffer.from(await response.arrayBuffer())
          controller.abort()
          return new Response(bytes, {
            status: 200,
            headers: { 'content-length': `${bytes.length}` },
          })
        },
      },
    })
    expect(result).toMatchObject({ ok: false, cancelled: true })
    expect(extract).not.toHaveBeenCalled()
  })

  it('the extractor handle reaches onExtractor before the extraction result settles', async () => {
    const order: string[] = []
    let release!: () => void
    const pending = new Promise<{ ok: true; value: undefined }>((resolve) => {
      release = () => resolve({ ok: true, value: undefined })
    })
    const handle = { result: pending, kill: () => {} }
    const extract: StageExtractFn = () => {
      order.push('extract')
      return handle
    }
    const staged = stagePackage({
      ...baseInput({ url: `${baseUrl}/good.bin` }),
      extract,
      onExtractor: (received) => {
        order.push(received === handle ? 'onExtractor' : 'onExtractor:other')
        // The result is still pending here: the callback must not wait on it.
        order.push('result-pending')
        setTimeout(release, 0)
      },
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    const result = await staged
    expect(order).toEqual(['extract', 'onExtractor', 'result-pending'])
    expect(result.ok).toBe(true)
  })

  it('a .tar.gz is extracted in two passes', async () => {
    const passes: string[] = []
    const extract: StageExtractFn = (input) => {
      passes.push(input.archive.path)
      const first = passes.length === 1
      // The fake 7za: the first pass drops the inner .tar, the second its content.
      const done = (async () => {
        await mkdir(input.extractDir, { recursive: true })
        await writeFile(join(input.extractDir, first ? 'inner.tar' : 'file.txt'), 'x')
        return { ok: true as const, value: undefined }
      })()
      return { result: done, kill: () => {} }
    }
    const result = await stagePackage({
      ...baseInput({ url: `${baseUrl}/good.bin` }),
      extract,
      options: { fetchImpl: (url, init) => fetch(url, init) },
    })
    expect(result.ok).toBe(true)
    expect(passes).toHaveLength(2)
    expect(passes[1]!.endsWith('inner.tar')).toBe(true)
    if (result.ok) expect(await readdir(result.extractDir)).toEqual(['file.txt'])
  })
})

describe('stagePackage with the vendored 7-Zip', () => {
  const real = resolveExtractorPath({ isPackaged: false })

  it.skipIf(!real.exists)('unpacks a real .tar.gz down to its files', async () => {
    const work = await mkdtemp(join(tmpdir(), 'q2l-stage-real-'))
    try {
      await writeFile(join(work, 'hello.txt'), 'hello tar\n')
      execFileSync(real.path, ['a', '-ttar', '-y', 'inner.tar', 'hello.txt'], { cwd: work })
      execFileSync(real.path, ['a', '-tgzip', '-y', 'pkg.tar.gz', 'inner.tar'], { cwd: work })
      const bytes = await readFile(join(work, 'pkg.tar.gz'))
      const gz = createServer((_req, res) => {
        res.writeHead(200, { 'content-length': bytes.length })
        res.end(bytes)
      })
      await new Promise<void>((resolve) => gz.listen(0, '127.0.0.1', resolve))
      try {
        const url = `http://127.0.0.1:${(gz.address() as AddressInfo).port}/pkg.tar.gz`
        const result = await stagePackage({
          source: {
            fileName: 'pkg.tar.gz',
            url,
            mirrors: [],
            sizeBytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
          jobId: 'real1',
          index: 2,
          userDataPath: userData,
          signal: new AbortController().signal,
          resolveExtractor: () => real,
          options: { fetchImpl: (u, init) => fetch(u, init) },
        })
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.extractDir).toContain('real1-2')
        expect(await readdir(result.extractDir)).toEqual(['hello.txt'])
        expect(existsSync(join(result.extractDir, 'inner.tar'))).toBe(false)
      } finally {
        await new Promise<void>((resolve) => gz.close(() => resolve()))
      }
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })
})
