import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PackageSource } from '@shared/modules/downloads'
import { pathExists } from '../../lib/fs-utils'
import { downloadPackage } from './fetcher'
import type { DownloadPackageOptions, DownloadPackageResult, DownloadProgress } from './fetcher'
import { PART_SUFFIX } from './paths'

/**
 * Story 071 D2, AC3/AC4 - integration, on purpose.
 *
 * Real bytes over a real socket (a `node:http` server on `127.0.0.1`), real files in an `mkdtemp`
 * directory, real SHA256 digests: the criteria are checked the way an attacker's mirror would be
 * caught in production, not by asserting that the implementation agrees with itself. Nothing here
 * mocks a response, and nothing asserts on an internal digest that was not read back off disk.
 *
 * `fetchImpl` is the injection seam the fetcher was built with. The test double is the *real*
 * global `fetch` pointed at the local server rather than a stub, which is what lets the timeout,
 * retry and mirror machinery be exercised against genuine socket behaviour (a dropped connection,
 * a response that goes quiet) without an Electron runtime for `net.fetch`.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let dir: string
let server: Server
let origin: string
/** Route table, per test: pathname -> handler. */
const routes = new Map<string, Handler>()
/** How many requests each pathname received - the retry budget is counted here, not internally. */
const hits = new Map<string, number>()
const openResponses = new Set<ServerResponse>()

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-fetcher-'))
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
  // Short keep-alive so the server can be torn down between tests without waiting for undici's
  // pooled sockets to go idle on their own.
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

const FILE_NAME = 'package.zip'

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function route(pathname: string, handler: Handler): string {
  routes.set(pathname, handler)
  return `${origin}${pathname}`
}

/** Serves `body` in one go with a truthful `content-length`. */
function serves(body: Buffer): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-length': String(body.byteLength) })
    res.end(body)
  }
}

/**
 * Serves `body` in `chunkSize` pieces `gapMs` apart, chunked (no `content-length`) - a slow but
 * healthy transfer.
 */
function trickles(body: Buffer, chunkSize: number, gapMs: number): Handler {
  return (_req, res) => {
    res.writeHead(200)
    let offset = 0
    const push = (): void => {
      if (res.destroyed) return
      if (offset >= body.byteLength) {
        res.end()
        return
      }
      res.write(body.subarray(offset, offset + chunkSize))
      offset += chunkSize
      setTimeout(push, gapMs)
    }
    setTimeout(push, gapMs)
  }
}

/** Sends headers and a few bytes, then goes quiet forever without closing - a stalled response. */
function stallsAfter(body: Buffer, prefixBytes: number): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-length': String(body.byteLength) })
    res.write(body.subarray(0, prefixBytes))
  }
}

/** Sends headers and a few bytes, then kills the socket - a dropped connection mid-body. */
function dropsAfter(body: Buffer, prefixBytes: number): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-length': String(body.byteLength) })
    res.write(body.subarray(0, prefixBytes), () => res.socket?.destroy())
  }
}

/** Accepts the request and never answers at all - no headers, ever. */
function neverAnswers(): Handler {
  return () => {
    /* deliberately empty: the response object is destroyed in afterEach */
  }
}

function pkg(overrides: Partial<PackageSource> & { url: string }): PackageSource {
  return {
    fileName: FILE_NAME,
    mirrors: [],
    sizeBytes: 0,
    sha256: 'a'.repeat(64),
    ...overrides,
  }
}

function options(overrides: Partial<DownloadPackageOptions> = {}): DownloadPackageOptions {
  return {
    userDataPath: dir,
    // The real client, pointed at the local server.
    fetchImpl: (url, init) => fetch(url, init),
    // Scaled-down versions of the shipped 30s budgets; the semantics under test are which clock
    // runs, not how long it is.
    headersTimeoutMs: 400,
    stallTimeoutMs: 250,
    retryDelayMs: 0,
    ...overrides,
  }
}

function finalPath(fileName: string = FILE_NAME): string {
  return join(dir, 'cache', 'downloads', fileName)
}

function partPath(fileName: string = FILE_NAME): string {
  return `${finalPath(fileName)}${PART_SUFFIX}`
}

function verified(result: DownloadPackageResult): Extract<DownloadPackageResult, { ok: true }> {
  if (!result.ok)
    throw new Error(`expected a verified download, got ${result.key}: ${result.reason}`)
  return result
}

function failed(result: DownloadPackageResult): Extract<DownloadPackageResult, { ok: false }> {
  if (result.ok) throw new Error(`expected a failure, got a verified file at ${result.path}`)
  return result
}

describe('downloadPackage', () => {
  it('a file is handed on only after size and SHA256 match the package', async () => {
    const good = randomBytes(64 * 1024)
    const url = route('/good.zip', serves(good))
    const progress: DownloadProgress[] = []

    const result = verified(
      await downloadPackage(
        pkg({ url, sizeBytes: good.byteLength, sha256: sha256(good) }),
        options({ onProgress: (p) => progress.push(p) }),
      ),
    )

    // Handed on: the path exists, holds exactly the served bytes, and no longer carries `.part`.
    expect(result.path).toBe(finalPath())
    expect(result.sizeBytes).toBe(good.byteLength)
    expect(result.sha256).toBe(sha256(good))
    expect(await readFile(result.path)).toEqual(good)
    expect(await pathExists(partPath())).toBe(false)
    expect(progress.at(-1)).toEqual({
      url,
      receivedBytes: good.byteLength,
      totalBytes: good.byteLength,
    })

    // ...and *only* after: the same file served with one byte flipped (identical length, so only
    // the digest can tell) is never handed on, and nothing is left at its final path. It is
    // fetched under its own file name so that the file promoted above cannot be what is observed.
    const tampered = Buffer.from(good)
    tampered[1234] = tampered[1234] ^ 0xff
    const tamperedUrl = route('/tampered.zip', serves(tampered))

    const refused = failed(
      await downloadPackage(
        pkg({
          url: tamperedUrl,
          fileName: 'tampered.zip',
          sizeBytes: good.byteLength,
          sha256: sha256(good),
        }),
        options(),
      ),
    )

    expect(refused.key).toBe('downloads.error.allMirrorsFailed')
    expect(refused.attempts[0]).toMatchObject({ outcome: 'verification-failed', requests: 1 })
    expect(await pathExists(finalPath('tampered.zip'))).toBe(false)
    expect(await pathExists(partPath('tampered.zip'))).toBe(false)
  })

  it('a hash mismatch deletes the file and falls through to the next mirror', async () => {
    const good = randomBytes(32 * 1024)
    // Same length, different bytes: nothing but the SHA256 can catch this mirror out.
    const wrong = randomBytes(32 * 1024)
    const badUrl = route('/mirror-a.zip', serves(wrong))
    const mirrorUrl = route('/mirror-b.zip', serves(good))

    const result = verified(
      await downloadPackage(
        pkg({
          url: badUrl,
          mirrors: [mirrorUrl],
          sizeBytes: good.byteLength,
          sha256: sha256(good),
        }),
        options(),
      ),
    )

    expect(result.url).toBe(mirrorUrl)
    expect(await readFile(result.path)).toEqual(good)
    // Deleted: the in-flight name is gone, and the bad bytes never reached the final path.
    expect(await pathExists(partPath())).toBe(false)
    // A verification failure is not a transport failure: the bad mirror is asked exactly once.
    expect(hits.get('/mirror-a.zip')).toBe(1)
    expect(hits.get('/mirror-b.zip')).toBe(1)
    expect(result.attempts).toEqual([
      { url: badUrl, requests: 1, outcome: 'verification-failed', reason: expect.any(String) },
      { url: mirrorUrl, requests: 1, outcome: 'verified' },
    ])
  })

  it('when every mirror fails the job fails with downloads.error.allMirrorsFailed', async () => {
    const good = randomBytes(8 * 1024)
    const declared = { sizeBytes: good.byteLength, sha256: sha256(good) }
    // One of each way a mirror can be wrong: wrong bytes, wrong length, and gone entirely.
    const first = route('/one.zip', serves(randomBytes(good.byteLength)))
    const second = route('/two.zip', serves(randomBytes(good.byteLength - 1)))
    const third = `${origin}/missing.zip`

    const result = failed(
      await downloadPackage(pkg({ url: first, mirrors: [second, third], ...declared }), options()),
    )

    expect(result.key).toBe('downloads.error.allMirrorsFailed')
    expect(result.cancelled).toBe(false)
    expect(result.attempts.map((a) => a.url)).toEqual([first, second, third])
    // Nothing verified, nothing left behind - not even the last mirror's rejected bytes.
    expect(await pathExists(finalPath())).toBe(false)
    expect(await pathExists(partPath())).toBe(false)
    // A 404 is not worth asking again either.
    expect(hits.get('/missing.zip')).toBe(1)
  })

  it('a slow but progressing transfer is not cut off: the budget is a stall timeout, not wall clock', async () => {
    const good = randomBytes(4000)
    // 10 chunks, 60ms apart: ~600ms of transfer against a 250ms budget. A wall-clock timeout
    // would kill this; a stall timeout must not, because bytes never stop arriving.
    const url = route('/slow.zip', trickles(good, 400, 60))

    const started = Date.now()
    const result = verified(
      await downloadPackage(
        pkg({ url, sizeBytes: good.byteLength, sha256: sha256(good) }),
        options({ stallTimeoutMs: 250 }),
      ),
    )
    const elapsed = Date.now() - started

    expect(elapsed).toBeGreaterThan(250)
    expect(await readFile(result.path)).toEqual(good)
    expect(hits.get('/slow.zip')).toBe(1)
  })

  it('a response that stops sending bytes fails on the stall timeout and leaves no file', async () => {
    const good = randomBytes(4000)
    const url = route('/stalls.zip', stallsAfter(good, 500))

    const result = failed(
      await downloadPackage(
        pkg({ url, sizeBytes: good.byteLength, sha256: sha256(good) }),
        // No retries here: the retry budget has its own test, this one is about the clock.
        options({ stallTimeoutMs: 150, transportRetries: 0 }),
      ),
    )

    expect(result.key).toBe('downloads.error.allMirrorsFailed')
    expect(result.attempts[0]).toMatchObject({ outcome: 'transport-failed', requests: 1 })
    expect(result.attempts[0].reason).toContain('no bytes received')
    expect(await pathExists(partPath())).toBe(false)
    expect(await pathExists(finalPath())).toBe(false)
  })

  it('a server that never answers fails on the headers timeout', async () => {
    const url = route('/silent.zip', neverAnswers())

    const result = failed(
      await downloadPackage(
        pkg({ url, sizeBytes: 1024, sha256: 'a'.repeat(64) }),
        options({ headersTimeoutMs: 150, transportRetries: 0 }),
      ),
    )

    expect(result.attempts[0]).toMatchObject({ outcome: 'transport-failed', requests: 1 })
    expect(result.attempts[0].reason).toContain('no response headers')
    expect(await pathExists(partPath())).toBe(false)
  })

  it('a transport error is retried three times against the same URL before the next mirror', async () => {
    const good = randomBytes(16 * 1024)
    // Every request to this URL dies mid-body, so the retry budget is spent in full.
    const flakyUrl = route('/flaky.zip', dropsAfter(good, 2048))
    const mirrorUrl = route('/steady.zip', serves(good))

    const result = verified(
      await downloadPackage(
        pkg({
          url: flakyUrl,
          mirrors: [mirrorUrl],
          sizeBytes: good.byteLength,
          sha256: sha256(good),
        }),
        options({ transportRetries: 3 }),
      ),
    )

    // 1 initial request + exactly 3 retries, then - and only then - the next mirror.
    expect(hits.get('/flaky.zip')).toBe(4)
    expect(result.attempts[0]).toMatchObject({
      url: flakyUrl,
      requests: 4,
      outcome: 'transport-failed',
    })
    expect(result.url).toBe(mirrorUrl)
    expect(await readFile(result.path)).toEqual(good)
    expect(await pathExists(partPath())).toBe(false)
  })

  it('a mirror serving more bytes than declared is cut off and refused', async () => {
    const good = randomBytes(2000)
    // Chunked, so no `content-length` gives the overrun away in advance: the stream itself has to
    // be stopped once it exceeds what the package declared.
    const url = route('/greedy.zip', trickles(randomBytes(20_000), 1000, 5))

    const result = failed(
      await downloadPackage(
        pkg({ url, sizeBytes: good.byteLength, sha256: sha256(good) }),
        options(),
      ),
    )

    expect(result.attempts[0]).toMatchObject({ outcome: 'verification-failed', requests: 1 })
    // Cut off *because* of the overrun, not merely rejected by the digest at the end.
    expect(result.attempts[0].reason).toContain('more than the declared')
    expect(await pathExists(partPath())).toBe(false)
    expect(await pathExists(finalPath())).toBe(false)
  })

  it('a cancelled download stops and leaves no partial file', async () => {
    const good = randomBytes(4000)
    const url = route('/cancel.zip', trickles(good, 200, 40))
    const controller = new AbortController()

    const result = failed(
      await downloadPackage(
        pkg({ url, sizeBytes: good.byteLength, sha256: sha256(good) }),
        options({
          signal: controller.signal,
          onProgress: () => controller.abort(),
        }),
      ),
    )

    expect(result.cancelled).toBe(true)
    expect(result.attempts[0]).toMatchObject({ outcome: 'cancelled' })
    expect(await pathExists(partPath())).toBe(false)
    expect(await pathExists(finalPath())).toBe(false)
  })

  it('refuses a package whose file name is not a single safe path segment, without a request', async () => {
    const url = route('/traversal.zip', serves(randomBytes(16)))

    const result = failed(
      await downloadPackage(
        pkg({ url, fileName: '../escaped.zip', sizeBytes: 16, sha256: 'a'.repeat(64) }),
        options(),
      ),
    )

    expect(result.key).toBe('downloads.error.diskWrite')
    expect(result.attempts).toEqual([])
    expect(hits.size).toBe(0)
    expect(await pathExists(join(dir, 'escaped.zip'))).toBe(false)
  })
})
