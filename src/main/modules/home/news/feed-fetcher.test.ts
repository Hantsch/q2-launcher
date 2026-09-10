import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  NEWS_INDEX_DOCUMENT,
  fetchNewsDocuments,
  type ChangedNewsFetch,
  type FailedNewsFetch,
  type FetchNewsDocumentsOptions,
  type FetchNewsResult,
} from './feed-fetcher'

/**
 * Story 082 D5 - integration, on purpose, exactly like `src/main/modules/downloads/fetcher.test.ts`.
 *
 * A real `node:http` server on `127.0.0.1` answers real conditional GETs with real `ETag` /
 * `304` / `500` / `404` semantics, and the fetcher uses the **real global `fetch`** against it via
 * a `{ kind: 'loopback' }` source. Nothing here mocks `fetch` or fakes a `Response`: the whole point
 * of this deliverable is what happens on the wire when a validator matches, and a hand-rolled
 * response object would only prove that the implementation agrees with itself.
 *
 * The retry budget is counted by the *server* (`hits`), not by an internal counter, and the
 * "a 304 hands back no body" claim is checked by counting the bodies the server actually wrote
 * (`bodiesServed`).
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let origin: string
const routes = new Map<string, Handler>()
/** Requests per pathname - this is where "retried once" is observed. */
const hits = new Map<string, number>()
/** Responses that carried a body, i.e. were not a `304`. */
let bodiesServed = 0
const openResponses = new Set<ServerResponse>()

beforeEach(async () => {
  routes.clear()
  hits.clear()
  openResponses.clear()
  bodiesServed = 0

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
})

function route(pathname: string, handler: Handler): void {
  routes.set(pathname, handler)
}

/** A real conditional-GET endpoint: `304` when the client's validator matches, else `200`+body. */
function servesWithEtag(body: string, etag: string, contentType = 'text/markdown'): Handler {
  return (req, res) => {
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag })
      res.end()
      return
    }
    bodiesServed += 1
    res.writeHead(200, { etag, 'content-type': contentType })
    res.end(body)
  }
}

/** Always `200`, whatever the client's validator says - the "this document changed" case. */
function servesChanged(body: string, etag: string): Handler {
  return (_req, res) => {
    bodiesServed += 1
    res.writeHead(200, { etag, 'content-type': 'text/markdown' })
    res.end(body)
  }
}

function servesStatus(status: number): Handler {
  return (_req, res) => {
    res.writeHead(status)
    res.end(`status ${status}`)
  }
}

/** `failFor` requests answer `500`, the ones after that serve the body. */
function failsThenServes(failFor: number, body: string, etag: string): Handler {
  let seen = 0
  return (req, res) => {
    seen += 1
    if (seen <= failFor) {
      res.writeHead(500)
      res.end('nope')
      return
    }
    servesWithEtag(body, etag, 'application/json')(req, res)
  }
}

/** Accepts the request and never answers - no headers, ever. */
function neverAnswers(): Handler {
  return () => {
    /* deliberately empty: the response is destroyed in afterEach */
  }
}

/** Kills the socket before any headers - a network error, not an HTTP status. */
function dropsConnection(): Handler {
  return (_req, res) => {
    res.socket?.destroy()
  }
}

function indexBody(files: { id: string; file: string }[]): string {
  return JSON.stringify({ schemaVersion: 1, entries: files })
}

const INDEX_PATH = '/news/index.json'

function options(overrides: Partial<FetchNewsDocumentsOptions> = {}): FetchNewsDocumentsOptions {
  return {
    source: { kind: 'loopback', base: origin },
    // Scaled-down version of the shipped 5s budget; what is under test is which failures spend a
    // retry, not how long the clock is.
    timeoutMs: 300,
    ...overrides,
  }
}

function changed(result: FetchNewsResult): ChangedNewsFetch {
  if (result.kind !== 'changed') {
    throw new Error(`expected a changed feed, got ${result.kind}`)
  }
  return result
}

function failed(result: FetchNewsResult): FailedNewsFetch {
  if (result.kind !== 'failed') throw new Error(`expected a failure, got ${result.kind}`)
  return result
}

describe('fetchNewsDocuments', () => {
  it('a cold fetch retrieves the index and every document it references, with their ETags', async () => {
    const index = indexBody([
      { id: 'a', file: 'a.md' },
      { id: 'b', file: 'b.md' },
    ])
    route(INDEX_PATH, servesWithEtag(index, '"i1"', 'application/json'))
    route('/news/a.md', servesWithEtag('# A', '"ea1"'))
    route('/news/b.md', servesWithEtag('# B', '"eb1"'))

    const result = changed(await fetchNewsDocuments(options()))

    expect(result.index).toEqual(JSON.parse(index))
    expect(result.documents).toEqual({ 'a.md': '# A', 'b.md': '# B' })
    expect(result.etags).toEqual({
      [NEWS_INDEX_DOCUMENT]: '"i1"',
      'a.md': '"ea1"',
      'b.md': '"eb1"',
    })
    expect(result.indexStatus).toBe('fetched')
    expect(result.statuses).toEqual({ 'a.md': 'fetched', 'b.md': 'fetched' })
    expect(result.failures).toEqual([])
    // One request each, no retry, no second pass.
    expect([...hits.entries()].sort()).toEqual([
      ['/news/a.md', 1],
      ['/news/b.md', 1],
      [INDEX_PATH, 1],
    ])
  })

  it('a 304 from the index and every document is reported as unchanged, and no body is used', async () => {
    route(INDEX_PATH, servesWithEtag(indexBody([{ id: 'a', file: 'a.md' }]), '"i1"'))
    route('/news/a.md', servesWithEtag('# A', '"ea1"'))

    const etags = { [NEWS_INDEX_DOCUMENT]: '"i1"', 'a.md': '"ea1"' }
    const result = await fetchNewsDocuments(options({ etags }))

    expect(result.kind).toBe('unchanged')
    // The map the caller keeps using - unchanged, so the next cycle can 304 again.
    expect(result.kind === 'unchanged' && result.etags).toEqual(etags)
    // Nothing was transferred: not one response carried a body...
    expect(bodiesServed).toBe(0)
    // ...and nothing was asked twice - a "nothing changed" cycle costs exactly one request each.
    expect(hits.get(INDEX_PATH)).toBe(1)
    expect(hits.get('/news/a.md')).toBe(1)
  })

  it('a document that answers 304 while another changed is re-fetched, so the material is complete', async () => {
    // The index itself did not change either: its body has to come back all the same, or there is
    // no entry list to rebuild the feed from.
    route(
      INDEX_PATH,
      servesWithEtag(
        indexBody([
          { id: 'a', file: 'a.md' },
          { id: 'b', file: 'b.md' },
        ]),
        '"i1"',
        'application/json',
      ),
    )
    route('/news/a.md', servesChanged('# A, edited', '"ea2"'))
    route('/news/b.md', servesWithEtag('# B', '"eb1"'))

    const result = changed(
      await fetchNewsDocuments(
        options({
          etags: { [NEWS_INDEX_DOCUMENT]: '"i1"', 'a.md': '"ea1"', 'b.md': '"eb1"' },
        }),
      ),
    )

    // Complete: the changed document AND the unchanged one, whose text a 304 did not hand over.
    expect(result.documents).toEqual({ 'a.md': '# A, edited', 'b.md': '# B' })
    expect(result.index).toEqual(
      JSON.parse(
        indexBody([
          { id: 'a', file: 'a.md' },
          { id: 'b', file: 'b.md' },
        ]),
      ),
    )
    expect(result.indexStatus).toBe('refreshed')
    expect(result.statuses).toEqual({ 'a.md': 'fetched', 'b.md': 'refreshed' })
    expect(result.etags).toEqual({
      [NEWS_INDEX_DOCUMENT]: '"i1"',
      'a.md': '"ea2"',
      'b.md': '"eb1"',
    })
    // Twice each for the two that 304ed first (conditional, then unconditional), once for the
    // document that answered with a body straight away.
    expect(hits.get(INDEX_PATH)).toBe(2)
    expect(hits.get('/news/b.md')).toBe(2)
    expect(hits.get('/news/a.md')).toBe(1)
  })

  it('a document that fails loses its cached ETag, so the next refresh cannot 304 past it', async () => {
    route(
      INDEX_PATH,
      servesWithEtag(
        indexBody([
          { id: 'a', file: 'a.md' },
          { id: 'b', file: 'b.md' },
        ]),
        '"i1"',
        'application/json',
      ),
    )
    route('/news/a.md', servesChanged('# A, edited', '"ea2"'))
    route('/news/b.md', servesStatus(404))

    const result = changed(
      await fetchNewsDocuments(
        options({
          etags: { [NEWS_INDEX_DOCUMENT]: '"i1"', 'a.md': '"ea1"', 'b.md': '"eb1"' },
        }),
      ),
    )

    // The rest of the feed still arrives...
    expect(result.documents).toEqual({ 'a.md': '# A, edited' })
    expect(result.statuses['b.md']).toBe('failed')
    expect(result.failures).toEqual([{ file: 'b.md', reason: 'HTTP 404' }])
    // ...and b.md's stale validator is gone. Carrying it over would make the next refresh ask
    // conditionally, get a 304, call the feed unchanged and never deliver that entry again.
    expect(result.etags).not.toHaveProperty('b.md')
    expect(result.etags).toEqual({ [NEWS_INDEX_DOCUMENT]: '"i1"', 'a.md': '"ea2"' })
  })

  it('a request that times out is retried exactly once', async () => {
    route(INDEX_PATH, neverAnswers())

    const result = failed(await fetchNewsDocuments(options({ timeoutMs: 120 })))

    expect(result.reason).toContain('no response within 120ms')
    expect(hits.get(INDEX_PATH)).toBe(2)
  })

  it('a network error is retried exactly once', async () => {
    route(INDEX_PATH, dropsConnection())

    const result = failed(await fetchNewsDocuments(options()))

    expect(result.reason).toContain(NEWS_INDEX_DOCUMENT)
    expect(hits.get(INDEX_PATH)).toBe(2)
  })

  it('a 5xx response is retried exactly once and then gives up', async () => {
    route(INDEX_PATH, servesStatus(503))

    const result = failed(await fetchNewsDocuments(options()))

    expect(result.reason).toContain('HTTP 503')
    expect(hits.get(INDEX_PATH)).toBe(2)
    // The caller's ETag map comes back untouched: it still belongs to the feed the caller holds.
    expect(result.etags).toEqual({})
  })

  it('a 5xx followed by a 200 succeeds on the retry', async () => {
    route(INDEX_PATH, failsThenServes(1, indexBody([{ id: 'a', file: 'a.md' }]), '"i1"'))
    route('/news/a.md', servesWithEtag('# A', '"ea1"'))

    const result = changed(await fetchNewsDocuments(options()))

    expect(result.documents).toEqual({ 'a.md': '# A' })
    expect(hits.get(INDEX_PATH)).toBe(2)
  })

  it('a 4xx response is NOT retried', async () => {
    route(INDEX_PATH, servesStatus(404))

    const result = failed(await fetchNewsDocuments(options()))

    expect(result.reason).toContain('HTTP 404')
    // A missing document is a content mistake; a second identical request cannot fix it.
    expect(hits.get(INDEX_PATH)).toBe(1)
  })

  it('a skip source makes no request at all', async () => {
    route(INDEX_PATH, servesWithEtag('{}', '"i1"', 'application/json'))

    const result = await fetchNewsDocuments(options({ source: { kind: 'skip' } }))

    expect(result.kind).toBe('skipped')
    expect(hits.size).toBe(0)
  })

  it('an index entry whose file name is not a single safe path segment is never requested', async () => {
    route(
      INDEX_PATH,
      servesWithEtag(
        indexBody([
          { id: 'evil', file: '../../../etc/passwd' },
          { id: 'absolute', file: 'https://example.com/x.md' },
          { id: 'good', file: 'good.md' },
        ]),
        '"i1"',
        'application/json',
      ),
    )
    route('/news/good.md', servesWithEtag('# Good', '"eg1"'))

    const result = changed(await fetchNewsDocuments(options()))

    expect(result.documents).toEqual({ 'good.md': '# Good' })
    // Exactly two requests were made: the index and the one document that is a plain name.
    expect([...hits.keys()].sort()).toEqual([INDEX_PATH, '/news/good.md'].sort())
  })
})
