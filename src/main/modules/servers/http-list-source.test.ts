import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveHttpListSource } from './http-list-source'

/**
 * Story 109 D4 - mirrors `src/main/modules/downloads/fetcher.test.ts`'s loopback setup: a real
 * `node:http` server on `127.0.0.1`, and the real global `fetch` injected as the `FetchImpl`, so
 * the seam is proven against genuine socket/HTTP behaviour without an Electron runtime and without
 * ever reaching q2servers.com (GB-A5, GB-A6).
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let origin: string
const routes = new Map<string, Handler>()

beforeEach(async () => {
  routes.clear()
  server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    const handler = routes.get(pathname)
    if (handler === undefined) {
      res.statusCode = 404
      res.end('no such route')
      return
    }
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function route(pathname: string, handler: Handler): string {
  routes.set(pathname, handler)
  return `${origin}${pathname}`
}

function servesText(body: string): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(body)
  }
}

function servesBinary(body: Buffer): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(body)
  }
}

function servesStatus(status: number, body = ''): Handler {
  return (_req, res) => {
    res.writeHead(status)
    res.end(body)
  }
}

/** Packs `a.b.c.d:port` addresses into the bare 6-byte-record shape `?raw=2` expects. */
function packRecords(addresses: { ip: [number, number, number, number]; port: number }[]): Buffer {
  const buffer = Buffer.alloc(addresses.length * 6)
  addresses.forEach((address, index) => {
    const offset = index * 6
    buffer[offset] = address.ip[0]
    buffer[offset + 1] = address.ip[1]
    buffer[offset + 2] = address.ip[2]
    buffer[offset + 3] = address.ip[3]
    buffer.writeUInt16BE(address.port, offset + 4)
  })
  return buffer
}

const fetchImpl = (url: string, init: { signal: AbortSignal }): Promise<Response> => fetch(url, init)

describe('resolveHttpListSource', () => {
  it('the HTTP list is fetched through the injected FetchImpl against a loopback server: raw=1 resolves to its addresses', async () => {
    const url = route('/raw1', servesText('192.168.0.1:27910\n192.168.0.2:27911\n'))

    const result = await resolveHttpListSource(url, { raw: 1, fetchImpl })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.addresses.map((a) => a.normalized).sort()).toEqual(
      ['192.168.0.1:27910', '192.168.0.2:27911'].sort(),
    )
    expect(result.skipped).toEqual([])
  })

  it('a raw=2 body resolves to the same address set as the equivalent raw=1 text', async () => {
    const records = [
      { ip: [192, 168, 0, 1] as [number, number, number, number], port: 27910 },
      { ip: [192, 168, 0, 2] as [number, number, number, number], port: 27911 },
    ]
    const textUrl = route(
      '/raw1-equiv',
      servesText(records.map((r) => `${r.ip.join('.')}:${r.port}`).join('\n')),
    )
    const binaryUrl = route('/raw2', servesBinary(packRecords(records)))

    const textResult = await resolveHttpListSource(textUrl, { raw: 1, fetchImpl })
    const binaryResult = await resolveHttpListSource(binaryUrl, { raw: 2, fetchImpl })

    expect(textResult.ok).toBe(true)
    expect(binaryResult.ok).toBe(true)
    if (!textResult.ok || !binaryResult.ok) throw new Error('expected ok')
    expect(binaryResult.addresses.map((a) => a.normalized).sort()).toEqual(
      textResult.addresses.map((a) => a.normalized).sort(),
    )
  })

  it('a non-2xx response yields http-status carrying the code and no addresses', async () => {
    const url500 = route('/fail-500', servesStatus(500, 'server error'))
    const url404 = route('/fail-404', servesStatus(404, 'not found'))

    const result500 = await resolveHttpListSource(url500, { raw: 1, fetchImpl })
    const result404 = await resolveHttpListSource(url404, { raw: 1, fetchImpl })

    expect(result500).toEqual({ ok: false, reason: 'http-status', status: 500 })
    expect(result404).toEqual({ ok: false, reason: 'http-status', status: 404 })
    expect('addresses' in result500).toBe(false)
    expect('addresses' in result404).toBe(false)
  })

  it("a body the codec rejects yields the codec's own reason", async () => {
    const emptyTextUrl = route('/empty-text', servesText(''))
    const emptyBinaryUrl = route('/empty-binary', servesBinary(Buffer.alloc(0)))
    const truncatedBinaryUrl = route('/truncated-binary', servesBinary(Buffer.alloc(4)))

    const emptyTextResult = await resolveHttpListSource(emptyTextUrl, { raw: 1, fetchImpl })
    const emptyBinaryResult = await resolveHttpListSource(emptyBinaryUrl, { raw: 2, fetchImpl })
    const truncatedResult = await resolveHttpListSource(truncatedBinaryUrl, { raw: 2, fetchImpl })

    expect(emptyTextResult).toEqual({ ok: false, reason: 'empty-body' })
    expect(emptyBinaryResult).toEqual({ ok: false, reason: 'empty-body' })
    expect(truncatedResult).toEqual({ ok: false, reason: 'truncated' })
  })

  it('a fetchImpl rejection is reported as transport-error', async () => {
    const throwingFetch = (): Promise<Response> => Promise.reject(new Error('connection refused'))

    const result = await resolveHttpListSource('http://127.0.0.1:1/unreachable', {
      raw: 1,
      fetchImpl: throwingFetch,
    })

    expect(result).toEqual({ ok: false, reason: 'transport-error' })
  })

  it('never requests q2servers.com - every route in this file is bound to 127.0.0.1', () => {
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
})
