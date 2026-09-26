import { describe, expect, it } from 'vitest'
import type { ScanTarget } from '@shared/modules/servers'
import {
  runScan,
  type QueryServerFn,
  type ScanProgress,
  type ScanServerResult,
} from './scan-runner'
import type { ServerQueryResult } from './server-query'

/**
 * Story 114 D5. What can go wrong here passes every final-result assertion: an `await` on a whole
 * stage (rows arrive, just late), a pool that silently serializes, a target asked twice, an abort
 * that leaves slots waiting. So every test drives a fake `queryServer` whose replies are deferred
 * promises resolved by hand, and asserts *when* things happen relative to each other - not just
 * what the scan ended up with. `flush()` lets every pending continuation run before asserting.
 */

type Kind = 'info' | 'status'

interface FakeCall {
  address: string
  kind: Kind
  signal: AbortSignal | undefined
  settled: boolean
  resolve: (result: ServerQueryResult) => void
  reject: (error: Error) => void
}

interface FakeQuery {
  fn: QueryServerFn
  calls: FakeCall[]
  readonly inFlight: number
  readonly maxInFlight: number
  pending: (kind?: Kind) => FakeCall[]
  resolve: (address: string, kind: Kind, result: ServerQueryResult) => void
}

/**
 * `auto` answers every query itself on the next macrotask; without it, each query stays pending
 * until the test resolves it. `honourAbort` mirrors the real `queryServer` (settle `no-reply` on
 * abort); without it the fake ignores the signal entirely, like a query slow to notice.
 */
function fakeQuery(
  behaviour: { auto?: (address: string, kind: Kind) => ServerQueryResult | 'reject'; honourAbort?: boolean } = {},
): FakeQuery {
  const calls: FakeCall[] = []
  let inFlight = 0
  let maxInFlight = 0

  const fn: QueryServerFn = (target, options) =>
    new Promise<ServerQueryResult>((resolve, reject) => {
      const address = `${target.host}:${target.port}`
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const call: FakeCall = {
        address,
        kind: options.kind,
        signal: options.signal,
        settled: false,
        resolve: (result) => {
          if (call.settled) return
          call.settled = true
          inFlight -= 1
          resolve(result)
        },
        reject: (error) => {
          if (call.settled) return
          call.settled = true
          inFlight -= 1
          reject(error)
        },
      }
      calls.push(call)
      if (behaviour.honourAbort === true) {
        options.signal?.addEventListener('abort', () => call.resolve({ ok: false, reason: 'no-reply' }), {
          once: true,
        })
      }
      const auto = behaviour.auto
      if (auto !== undefined) {
        setImmediate(() => {
          const answer = auto(address, options.kind)
          if (answer === 'reject') call.reject(new Error('seam blew up'))
          else call.resolve(answer)
        })
      }
    })

  return {
    fn,
    calls,
    get inFlight() {
      return inFlight
    },
    get maxInFlight() {
      return maxInFlight
    },
    pending: (kind) => calls.filter((call) => !call.settled && (kind === undefined || call.kind === kind)),
    resolve: (address, kind, result) => {
      const call = calls.find((c) => c.address === address && c.kind === kind && !c.settled)
      if (call === undefined) throw new Error(`no pending ${kind} query for ${address}`)
      call.resolve(result)
    },
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function info(clients?: number): ServerQueryResult {
  return {
    ok: true,
    kind: 'info',
    reply: clients === undefined ? { ok: true, serverinfo: {} } : { ok: true, serverinfo: {}, clients },
    rttMs: 12,
  }
}

function status(): ServerQueryResult {
  return { ok: true, kind: 'status', reply: { ok: true, serverinfo: {}, players: [] }, rttMs: 15 }
}

const NO_REPLY: ServerQueryResult = { ok: false, reason: 'no-reply' }

function addr(n: number): string {
  return `10.0.0.${n}:27910`
}

function targets(...ns: number[]): ScanTarget[] {
  return ns.map((n) => ({ address: addr(n), origins: ['source'] }))
}

const SETTINGS = { concurrency: 8, timeoutMs: 2000, retries: 1 }

function recorder(): { rows: ScanServerResult[]; progress: ScanProgress[] } {
  return { rows: [], progress: [] }
}

function countsPerAddress(calls: FakeCall[], kind: Kind): Map<string, number> {
  const counts = new Map<string, number>()
  for (const call of calls.filter((c) => c.kind === kind)) counts.set(call.address, (counts.get(call.address) ?? 0) + 1)
  return counts
}

describe('runScan', () => {
  it('stage 1 streams a row before the sweep has finished', async () => {
    const fake = fakeQuery()
    const seen = recorder()
    const done = runScan({
      targets: targets(1, 2, 3, 4),
      settings: SETTINGS,
      deps: { queryServer: fake.fn },
      onServer: (row) => seen.rows.push(row),
      onProgress: (p) => seen.progress.push(p),
    })
    await flush()

    // All four are asked at once (cap 8) - the pool did not serialize them.
    expect(fake.pending('info').map((c) => c.address)).toEqual([addr(1), addr(2), addr(3), addr(4)])

    fake.resolve(addr(3), 'info', info(0))
    await flush()

    // The row for 3 is out while 1, 2 and 4 are still pending.
    expect(seen.rows).toEqual([{ stage: 'stage1', target: targets(3)[0], result: info(0) }])
    expect(fake.pending('info')).toHaveLength(3)
    expect(seen.progress.at(-1)).toEqual({
      phase: 'stage1',
      stage1Done: 1,
      stage1Total: 4,
      stage2Done: 0,
      stage2Total: 0,
    })

    fake.resolve(addr(1), 'info', info(0))
    await flush()
    expect(seen.rows.map((r) => r.target.address)).toEqual([addr(3), addr(1)])

    fake.resolve(addr(4), 'info', info(0))
    fake.resolve(addr(2), 'info', info(0))
    const result = await done
    expect(seen.rows.map((r) => r.target.address)).toEqual([addr(3), addr(1), addr(4), addr(2)])
    expect(result).toEqual({
      phase: 'stage2',
      stage1Done: 4,
      stage1Total: 4,
      stage2Done: 0,
      stage2Total: 0,
      aborted: false,
    })
  })

  it('stage 2 queries the servers worth checking and the selected one, and nothing twice', async () => {
    // 1: populated, 2: empty (and selected), 3: silent, 4: info without a player count (unknown
    // occupancy, worth checking anyway), 5: populated. Target 1 also arrives twice, from two origins.
    const stage1: Record<string, ServerQueryResult> = {
      [addr(1)]: info(3),
      [addr(2)]: info(0),
      [addr(3)]: NO_REPLY,
      [addr(4)]: info(),
      [addr(5)]: info(1),
    }
    const fake = fakeQuery({ auto: (address, kind) => (kind === 'info' ? (stage1[address] ?? NO_REPLY) : status()) })
    const seen = recorder()

    const result = await runScan({
      targets: [...targets(1, 2, 3, 4, 5), { address: addr(1), origins: ['favourite'] }],
      settings: { ...SETTINGS, concurrency: 2 },
      selectedAddress: addr(2),
      deps: { queryServer: fake.fn },
      onServer: (row) => seen.rows.push(row),
      onProgress: (p) => seen.progress.push(p),
    })

    const infoCounts = countsPerAddress(fake.calls, 'info')
    const statusCounts = countsPerAddress(fake.calls, 'status')
    expect([...infoCounts.keys()].sort()).toEqual([addr(1), addr(2), addr(3), addr(4), addr(5)])
    expect([...infoCounts.values()].every((n) => n === 1)).toBe(true)
    expect([...statusCounts.keys()].sort()).toEqual([addr(1), addr(2), addr(4), addr(5)])
    expect([...statusCounts.values()].every((n) => n === 1)).toBe(true)

    // Selected goes first; no status query is issued before every info query has landed.
    const firstStatus = fake.calls.findIndex((c) => c.kind === 'status')
    expect(fake.calls[firstStatus]?.address).toBe(addr(2))
    expect(fake.calls.slice(firstStatus).every((c) => c.kind === 'status')).toBe(true)

    // The merged target keeps both origins in both stages.
    const rowsFor1 = seen.rows.filter((r) => r.target.address === addr(1))
    expect(rowsFor1.map((r) => [r.stage, r.target.origins])).toEqual([
      ['stage1', ['source', 'favourite']],
      ['stage2', ['source', 'favourite']],
    ])

    expect(seen.rows.filter((r) => r.stage === 'stage2')).toHaveLength(4)
    expect(result).toEqual({
      phase: 'stage2',
      stage1Done: 5,
      stage1Total: 5,
      stage2Done: 4,
      stage2Total: 4,
      aborted: false,
    })
  })

  it('stage 2 is exactly the non-empty set without a selection, and asks a selection outside the address set too', async () => {
    const auto = (address: string, kind: Kind): ServerQueryResult =>
      kind === 'status' ? status() : address === addr(1) ? info(2) : info(0)

    const plain = fakeQuery({ auto })
    await runScan({ targets: targets(1, 2), settings: SETTINGS, deps: { queryServer: plain.fn }, onServer: () => {} })
    expect(plain.calls.filter((c) => c.kind === 'status').map((c) => c.address)).toEqual([addr(1)])

    const outside = fakeQuery({ auto })
    const rows: ScanServerResult[] = []
    await runScan({
      targets: targets(1, 2),
      settings: SETTINGS,
      selectedAddress: '10.0.0.9:27910',
      deps: { queryServer: outside.fn },
      onServer: (row) => rows.push(row),
    })
    expect(outside.calls.filter((c) => c.kind === 'info').map((c) => c.address)).toEqual([addr(1), addr(2)])
    expect(outside.calls.filter((c) => c.kind === 'status').map((c) => c.address)).toEqual([addr(9), addr(1)])
    expect(rows.find((r) => r.stage === 'stage2' && r.target.address === addr(9))?.target.origins).toEqual([])
  })

  it('a failing server does not stop the sweep', async () => {
    const stage1: Record<string, ServerQueryResult | 'reject'> = {
      [addr(1)]: { ok: false, reason: 'transport-error' },
      [addr(2)]: NO_REPLY,
      [addr(3)]: 'reject',
      [addr(4)]: info(4),
    }
    const fake = fakeQuery({ auto: (address, kind) => (kind === 'info' ? (stage1[address] ?? NO_REPLY) : status()) })
    const rows: ScanServerResult[] = []

    const result = await runScan({
      targets: targets(1, 2, 3, 4),
      settings: { ...SETTINGS, concurrency: 1 },
      deps: { queryServer: fake.fn },
      onServer: (row) => rows.push(row),
    })

    expect(rows.filter((r) => r.stage === 'stage1').map((r) => [r.target.address, r.result])).toEqual([
      [addr(1), { ok: false, reason: 'transport-error' }],
      [addr(2), NO_REPLY],
      [addr(3), { ok: false, reason: 'transport-error' }],
      [addr(4), info(4)],
    ])
    expect(rows.filter((r) => r.stage === 'stage2').map((r) => r.target.address)).toEqual([addr(4)])
    expect(result.aborted).toBe(false)
  })

  it('an abort in stage 1 stops both stages and settles without waiting for in-flight queries', async () => {
    // The fake ignores the signal and never answers: runScan must still settle.
    const fake = fakeQuery()
    const controller = new AbortController()
    const rows: ScanServerResult[] = []
    const done = runScan({
      targets: targets(1, 2, 3, 4, 5),
      settings: { ...SETTINGS, concurrency: 2 },
      selectedAddress: addr(1),
      signal: controller.signal,
      deps: { queryServer: fake.fn },
      onServer: (row) => rows.push(row),
    })
    await flush()
    fake.resolve(addr(1), 'info', info(5))
    await flush()
    expect(fake.calls.map((c) => c.address)).toEqual([addr(1), addr(2), addr(3)])

    controller.abort()
    const result = await done

    expect(result).toMatchObject({ aborted: true, phase: 'stage1', stage1Done: 1, stage2Total: 0 })
    // The abort reached every in-flight query, so the real queryServer would close its sockets.
    expect(fake.pending().map((c) => c.signal?.aborted)).toEqual([true, true])

    // Late replies are dropped and nothing new starts - not the rest of stage 1, not stage 2.
    fake.resolve(addr(2), 'info', info(3))
    fake.resolve(addr(3), 'info', info(3))
    await flush()
    expect(fake.calls).toHaveLength(3)
    expect(rows.map((r) => r.target.address)).toEqual([addr(1)])
  })

  it('an abort in stage 2 stops it, and an already-aborted signal starts nothing', async () => {
    const fake = fakeQuery({ honourAbort: true })
    const controller = new AbortController()
    const rows: ScanServerResult[] = []
    const done = runScan({
      targets: targets(1, 2, 3, 4),
      settings: { ...SETTINGS, concurrency: 2 },
      signal: controller.signal,
      deps: { queryServer: fake.fn },
      onServer: (row) => rows.push(row),
    })
    for (const n of [1, 2, 3, 4]) {
      await flush()
      fake.resolve(addr(n), 'info', info(1))
    }
    await flush()
    expect(fake.pending('status').map((c) => c.address)).toEqual([addr(1), addr(2)])

    controller.abort()
    const result = await done
    await flush()

    expect(result).toMatchObject({ aborted: true, phase: 'stage2', stage2Done: 0, stage2Total: 4 })
    expect(fake.calls.filter((c) => c.kind === 'status')).toHaveLength(2)
    // The honoured aborts resolved as no-reply, but those are not a server's silence: no rows.
    expect(rows.filter((r) => r.stage === 'stage2')).toEqual([])

    const idle = fakeQuery()
    const onServer: (row: ScanServerResult) => void = () => {
      throw new Error('must not be called')
    }
    const already = await runScan({
      targets: targets(1),
      settings: SETTINGS,
      signal: AbortSignal.abort(),
      deps: { queryServer: idle.fn },
      onServer,
    })
    expect(already.aborted).toBe(true)
    expect(idle.calls).toEqual([])
  })

  it('never has more than `concurrency` queries in flight, in either stage', async () => {
    const fake = fakeQuery()
    const done = runScan({
      targets: targets(1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
      settings: { ...SETTINGS, concurrency: 3 },
      deps: { queryServer: fake.fn },
      onServer: () => {},
    })

    for (let remaining = 10; remaining > 0; remaining -= 1) {
      await flush()
      expect(fake.inFlight).toBe(Math.min(3, remaining))
      const next = fake.pending('info')[0] as FakeCall
      // Every even server is populated, so stage 2 gets five targets.
      next.resolve(info(Number(next.address.split('.')[3]?.split(':')[0]) % 2 === 0 ? 2 : 0))
    }
    for (let remaining = 5; remaining > 0; remaining -= 1) {
      await flush()
      expect(fake.pending('status')).toHaveLength(Math.min(3, remaining))
      ;(fake.pending('status')[0] as FakeCall).resolve(status())
    }

    const result = await done
    expect(fake.maxInFlight).toBe(3)
    expect(result).toMatchObject({ stage1Done: 10, stage2Done: 5, stage2Total: 5, aborted: false })
  })

  it('a throwing onServer stops the sweep and is rethrown once every slot has stopped', async () => {
    const fake = fakeQuery({ honourAbort: true })
    const failure = new Error('listener broke')
    const done = runScan({
      targets: targets(1, 2, 3),
      settings: { ...SETTINGS, concurrency: 2 },
      deps: { queryServer: fake.fn },
      onServer: () => {
        throw failure
      },
    })
    await flush()
    fake.resolve(addr(1), 'info', info(2))

    await expect(done).rejects.toBe(failure)
    expect(fake.calls.map((c) => c.address)).toEqual([addr(1), addr(2)])
    expect(fake.calls[1]?.signal?.aborted).toBe(true)
  })
})
