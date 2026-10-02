import { describe, expect, it, vi } from 'vitest'
import { fetchWithPolicy, type FetchImpl } from './http'

const base = { timeoutMs: 50, retries: 2, maxBytes: 1024 }

/** Never answers, but honours the signal like a real fetch. */
const hang: FetchImpl = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  })

function streamOf(...chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

describe('fetchWithPolicy', () => {
  it("a response slower than timeoutMs ends as timeout with the 'no response within' reason", async () => {
    const fetchImpl = vi.fn(hang)
    const outcome = await fetchWithPolicy('http://x/', { ...base, retries: 0, fetchImpl })
    expect(outcome).toMatchObject({ ok: false, kind: 'timeout', reason: 'no response within 50ms' })
  })

  it('an external abort ends the fetch as aborted and is never retried', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(hang)
    const pending = fetchWithPolicy('http://x/', { ...base, timeoutMs: 5000, fetchImpl, signal: controller.signal })
    controller.abort()
    const outcome = await pending
    expect(outcome).toMatchObject({ ok: false, kind: 'aborted' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a 503 then a 200 succeeds on the retry and calls onRetry once', async () => {
    const fetchImpl = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('hello', { status: 200 }))
    const onRetry = vi.fn()
    const outcome = await fetchWithPolicy('http://x/', { ...base, fetchImpl, onRetry })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(new TextDecoder().decode(outcome.body)).toBe('hello')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('a body over maxBytes is too-large, by declared content-length and by streamed bytes', async () => {
    const declared = vi.fn<FetchImpl>(async () =>
      new Response('x', { status: 200, headers: { 'content-length': '5000' } }),
    )
    const byDeclared = await fetchWithPolicy('http://x/', { ...base, fetchImpl: declared })
    expect(byDeclared).toMatchObject({ ok: false, kind: 'too-large' })
    expect(declared).toHaveBeenCalledTimes(1)

    const streamed = vi.fn<FetchImpl>(async () =>
      streamOf(new Uint8Array(600), new Uint8Array(600)),
    )
    const byStream = await fetchWithPolicy('http://x/', { ...base, fetchImpl: streamed })
    expect(byStream).toMatchObject({ ok: false, kind: 'too-large', reason: 'body exceeds 1024 bytes' })
    expect(streamed).toHaveBeenCalledTimes(1)
  })

  it('a 404 is http-status and not retried; a network rejection is network with its cause', async () => {
    const notFound = vi.fn<FetchImpl>(async () => new Response('', { status: 404 }))
    const a = await fetchWithPolicy('http://x/', { ...base, fetchImpl: notFound })
    expect(a).toMatchObject({ ok: false, kind: 'http-status', status: 404, reason: 'HTTP 404' })
    expect(notFound).toHaveBeenCalledTimes(1)

    const refused = vi.fn<FetchImpl>(async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })
    })
    const b = await fetchWithPolicy('http://x/', { ...base, retries: 0, fetchImpl: refused })
    expect(b).toMatchObject({ ok: false, kind: 'network' })
    if (!b.ok) expect(b.reason).toContain('ECONNREFUSED')
  })
})
