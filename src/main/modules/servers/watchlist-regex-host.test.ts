import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { WATCHLIST_REGEX_BUDGET_MS } from '@shared/modules/servers'
import { createRegexHost, createRegexWorker, type RegexHost } from './watchlist-regex-host'

// These tests run the REAL worker thread (no worker_threads mock): the point of D3 is proving that
// the serialised matcher runs off-thread and that terminate/respawn/FIFO hand-over actually works.

const PATHOLOGICAL = '(a+)+$'
const PATHOLOGICAL_NAME = 'a'.repeat(30) + '!'

const hosts: RegexHost[] = []
function host(options?: Parameters<typeof createRegexHost>[0]): RegexHost {
  const h = createRegexHost(options)
  hosts.push(h)
  return h
}

afterEach(() => {
  for (const h of hosts.splice(0)) h.dispose()
})

describe('createRegexHost (real worker)', () => {
  it('WATCHLIST_REGEX_BUDGET_MS is 100', () => {
    expect(WATCHLIST_REGEX_BUDGET_MS).toBe(100)
  })

  it('returns one case-insensitive hit per name for a benign pattern', async () => {
    const result = await host().match('e1', '^john', ['John', 'johnny', 'xjohn', 'Bob'])
    expect(result).toEqual({ ok: true, hits: [true, true, false, false] })
  })

  it('resolves a catastrophic-backtracking pattern too-slow within the budget plus slack', async () => {
    const budgetMs = 100
    const h = host({ budgetMs })
    const started = performance.now()
    const result = await h.match('slow', PATHOLOGICAL, [PATHOLOGICAL_NAME])
    const elapsed = performance.now() - started
    expect(result).toEqual({ ok: false, reason: 'too-slow' })
    expect(elapsed).toBeLessThan(budgetMs + 400)
  })

  it('runs a job queued behind a timed-out one on a fresh worker, in FIFO order', async () => {
    const h = host({ budgetMs: 100 })
    const order: string[] = []
    const slow = h.match('slow', PATHOLOGICAL, [PATHOLOGICAL_NAME]).then((r) => {
      order.push('slow')
      return r
    })
    const benign = h.match('benign', 'bob', ['xBOBx', 'alice']).then((r) => {
      order.push('benign')
      return r
    })
    const [slowResult, benignResult] = await Promise.all([slow, benign])
    expect(slowResult).toEqual({ ok: false, reason: 'too-slow' })
    expect(benignResult).toEqual({ ok: true, hits: [true, false] })
    expect(order).toEqual(['slow', 'benign'])
  })

  it('recovers after a worker crash: the crashed job fails, the next job respawns and succeeds', async () => {
    let spawned = 0
    const h = host({
      createWorker: () => {
        spawned += 1
        if (spawned === 1) {
          return new Worker(
            "require('node:worker_threads').parentPort.on('message', () => { throw new Error('boom') })",
            { eval: true },
          )
        }
        return createRegexWorker()
      },
    })
    const crashed = h.match('e1', '^a', ['abc'])
    const after = h.match('e2', '^a', ['abc', 'xyz'])
    expect(await crashed).toEqual({ ok: false, reason: 'worker-error' })
    expect(await after).toEqual({ ok: true, hits: [true, false] })
    expect(spawned).toBe(2)
  })

  it('reports an invalid pattern as worker-error and keeps the same worker usable', async () => {
    let spawned = 0
    const h = host({
      createWorker: () => {
        spawned += 1
        return createRegexWorker()
      },
    })
    expect(await h.match('bad', '(', ['x'])).toEqual({ ok: false, reason: 'worker-error' })
    expect(await h.match('good', 'x', ['x'])).toEqual({ ok: true, hits: [true] })
    expect(spawned).toBe(1)
  })

  it('does not spawn a worker until a job needs one, and not again after a timeout with an empty queue', async () => {
    let spawned = 0
    const h = host({
      budgetMs: 100,
      createWorker: () => {
        spawned += 1
        return createRegexWorker()
      },
    })
    expect(spawned).toBe(0)
    expect(await h.match('slow', PATHOLOGICAL, [PATHOLOGICAL_NAME])).toEqual({
      ok: false,
      reason: 'too-slow',
    })
    expect(spawned).toBe(1)
    expect(await h.match('next', 'a', ['a'])).toEqual({ ok: true, hits: [true] })
    expect(spawned).toBe(2)
  })

  it('dispose resolves the in-flight and queued jobs worker-error, and later calls too', async () => {
    const h = host({ budgetMs: 10_000 })
    const inFlight = h.match('slow', PATHOLOGICAL, [PATHOLOGICAL_NAME])
    const queued = h.match('queued', 'a', ['a'])
    h.dispose()
    expect(await inFlight).toEqual({ ok: false, reason: 'worker-error' })
    expect(await queued).toEqual({ ok: false, reason: 'worker-error' })
    expect(await h.match('late', 'a', ['a'])).toEqual({ ok: false, reason: 'worker-error' })
    h.dispose()
  })
})
