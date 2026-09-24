import { createSocket, type Socket } from 'node:dgram'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MASTER_REPLY_HEADER } from '@shared/servers/master-records'
import {
  buildMasterQuery,
  resolveUdpMasterSource,
  type Clock,
  type MasterUdpHandlers,
  type MasterUdpImpl,
  type MasterUdpTarget,
  type ResolveUdpMasterSourceOptions,
  type UdpMasterSourceResult,
} from './udp-master-source'

/**
 * Story 109 D3. The stop rule is the risk in this file, not the bytes: a quiet period restarted on
 * the wrong event, a timer left armed after an abort or a socket left open all pass a naive test
 * and then either hang a scan or silently shorten the server list.
 *
 * So every timing case runs on fake timers against a stub seam - the injectable `MasterUdpImpl` -
 * and asserts both halves of "500 ms after the last datagram": that the collection has *not*
 * resolved one millisecond early, and that it has one millisecond later. `vi.getTimerCount()` is
 * checked after each resolution, because a dangling timer is exactly the defect that no result
 * assertion can see.
 *
 * One test at the bottom drives the real `node:dgram` default against a loopback responder on
 * `127.0.0.1` with real timers, mirroring `downloads/fetcher.test.ts`'s loopback HTTP server. No
 * test in this file addresses a real master (GB-A5).
 */

function record(a: number, b: number, c: number, d: number, port: number): number[] {
  return [a, b, c, d, (port >> 8) & 0xff, port & 0xff]
}

/** A well-formed master reply datagram carrying the given packed records. */
function reply(...records: number[][]): Uint8Array {
  return new Uint8Array([...MASTER_REPLY_HEADER, ...records.flat()])
}

interface StubSeam {
  impl: MasterUdpImpl
  /** Targets the collector asked to open, in order. */
  targets: MasterUdpTarget[]
  /** Datagrams the collector sent. */
  sent: Uint8Array[]
  opens: number
  closes: number
  /** Hands a datagram to the collector the way a socket would. */
  deliver: (bytes: Uint8Array) => void
  /** Reports a transport failure the way a socket's 'error' event would. */
  fail: (error: Error) => void
}

function stubSeam(behaviour: { openError?: Error; sendError?: Error } = {}): StubSeam {
  let handlers: MasterUdpHandlers | null = null

  const seam: StubSeam = {
    targets: [],
    sent: [],
    opens: 0,
    closes: 0,
    impl: async (target, given) => {
      seam.opens += 1
      seam.targets.push(target)
      handlers = given
      if (behaviour.openError !== undefined) throw behaviour.openError
      return {
        send: (datagram) => {
          if (behaviour.sendError !== undefined) throw behaviour.sendError
          seam.sent.push(datagram)
        },
        close: () => {
          seam.closes += 1
        },
      }
    },
    deliver: (bytes) => handlers?.onMessage(bytes),
    fail: (error) => handlers?.onError(error),
  }

  return seam
}

/** Observes a pending collection without awaiting it, so "not resolved yet" is assertable. */
function track(promise: Promise<UdpMasterSourceResult>): {
  settled: boolean
  result: UdpMasterSourceResult | null
} {
  const state: { settled: boolean; result: UdpMasterSourceResult | null } = {
    settled: false,
    result: null,
  }
  void promise.then((result) => {
    state.settled = true
    state.result = result
  })
  return state
}

function countingClock(): { clock: Clock; created: () => number; cleared: () => number } {
  let created = 0
  let cleared = 0
  return {
    clock: {
      setTimeout: (callback, ms) => {
        created += 1
        return setTimeout(callback, ms)
      },
      clearTimeout: (handle) => {
        cleared += 1
        clearTimeout(handle)
      },
    },
    created: () => created,
    cleared: () => cleared,
  }
}

const TARGET: MasterUdpTarget = { host: '127.0.0.1', port: 27900 }
const TIMINGS = { quietPeriodMs: 500, firstReplyTimeoutMs: 2000 }

function normalized(result: UdpMasterSourceResult | null): string[] {
  return result !== null && result.ok ? result.addresses.map((address) => address.normalized) : []
}

describe('resolveUdpMasterSource (stub seam, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Opens the collection and lets the seam finish opening + the query go out. */
  async function start(
    seam: StubSeam,
    options: ResolveUdpMasterSourceOptions = {},
  ): Promise<ReturnType<typeof track>> {
    const pending = track(
      resolveUdpMasterSource(TARGET, { udpImpl: seam.impl, ...TIMINGS, ...options }),
    )
    await vi.advanceTimersByTimeAsync(0)
    return pending
  }

  it('collection ends one quiet period after the last datagram', async () => {
    const seam = stubSeam()
    const pending = await start(seam)

    seam.deliver(reply(record(10, 0, 0, 1, 27910)))
    await vi.advanceTimersByTimeAsync(100)
    seam.deliver(reply(record(10, 0, 0, 2, 27911)))
    await vi.advanceTimersByTimeAsync(100)
    // Repeats a record from the first datagram: the assembled set must carry it once.
    seam.deliver(reply(record(10, 0, 0, 3, 27912), record(10, 0, 0, 1, 27910)))

    // 700 ms after the *first* datagram, 499 ms after the last one: still collecting. A quiet
    // period measured from the first datagram (or a hard cap) would already have resolved here.
    await vi.advanceTimersByTimeAsync(499)
    expect(pending.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(pending.settled).toBe(true)
    expect(normalized(pending.result)).toEqual([
      '10.0.0.1:27910',
      '10.0.0.2:27911',
      '10.0.0.3:27912',
    ])
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a datagram arriving after the quiet period has elapsed does not change the returned result', async () => {
    const seam = stubSeam()
    const pending = await start(seam)

    seam.deliver(reply(record(10, 0, 0, 1, 27910)))
    await vi.advanceTimersByTimeAsync(500)
    expect(pending.settled).toBe(true)
    const resolved = pending.result

    // The socket close and a datagram already in flight race by construction.
    seam.deliver(reply(record(10, 0, 0, 2, 27911)))
    await vi.advanceTimersByTimeAsync(1000)

    expect(pending.result).toBe(resolved)
    expect(normalized(pending.result)).toEqual(['10.0.0.1:27910'])
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('no datagram at all fails with no-reply after the first-reply timeout instead of hanging', async () => {
    const seam = stubSeam()
    const pending = await start(seam)

    await vi.advanceTimersByTimeAsync(1999)
    expect(pending.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(pending.result).toEqual({ ok: false, reason: 'no-reply' })
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a seam that throws yields transport-error', async () => {
    const failedOpen = stubSeam({ openError: new Error('EACCES') })
    const opening = await start(failedOpen)
    expect(opening.result).toEqual({ ok: false, reason: 'transport-error' })
    // Nothing was handed back to close, and nothing is left ticking.
    expect(failedOpen.closes).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    const failedSend = stubSeam({ sendError: new Error('ENETUNREACH') })
    const sending = await start(failedSend)
    expect(sending.result).toEqual({ ok: false, reason: 'transport-error' })
    expect(failedSend.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a socket error before any reply is transport-error, after a reply keeps what arrived', async () => {
    const early = stubSeam()
    const beforeReply = await start(early)
    early.fail(new Error('socket died'))
    await vi.advanceTimersByTimeAsync(0)
    expect(beforeReply.result).toEqual({ ok: false, reason: 'transport-error' })
    expect(early.closes).toBe(1)

    const late = stubSeam()
    const afterReply = await start(late)
    late.deliver(reply(record(10, 0, 0, 1, 27910)))
    late.fail(new Error('socket died'))
    await vi.advanceTimersByTimeAsync(0)
    expect(normalized(afterReply.result)).toEqual(['10.0.0.1:27910'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an aborted signal closes the socket and resolves without throwing', async () => {
    const seam = stubSeam()
    const controller = new AbortController()
    const pending = await start(seam, { signal: controller.signal })

    seam.deliver(reply(record(10, 0, 0, 1, 27910)))
    await vi.advanceTimersByTimeAsync(100)
    expect(pending.settled).toBe(false)

    controller.abort()
    await vi.advanceTimersByTimeAsync(0)

    expect(pending.settled).toBe(true)
    expect(normalized(pending.result)).toEqual(['10.0.0.1:27910'])
    expect(seam.closes).toBe(1)
    // The quiet-period timer must be gone with it - an abort that only resolves leaves a timer
    // holding the event loop open and a socket holding a port.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a signal already aborted opens no socket at all', async () => {
    const seam = stubSeam()
    const pending = await start(seam, { signal: AbortSignal.abort() })

    expect(pending.result).toEqual({ ok: false, reason: 'no-reply' })
    expect(seam.opens).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a datagram that is not a master reply is ignored and never counts as the first reply', async () => {
    const seam = stubSeam()
    const pending = await start(seam)

    seam.deliver(new Uint8Array([0x01, 0x02, 0x03]))
    seam.deliver(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x70, 0x72, 0x69, 0x6e, 0x74]))
    await vi.advanceTimersByTimeAsync(2000)

    // Neither datagram refreshed a clock, so the first-reply guard still fires on schedule.
    expect(pending.result).toEqual({ ok: false, reason: 'no-reply' })
    expect(seam.closes).toBe(1)
  })

  it('a garbage datagram between two good ones does not sink the collection', async () => {
    const seam = stubSeam()
    const pending = await start(seam)

    seam.deliver(reply(record(10, 0, 0, 1, 27910)))
    await vi.advanceTimersByTimeAsync(100)
    seam.deliver(new Uint8Array([...MASTER_REPLY_HEADER, 10, 0, 0, 9])) // cut mid-record
    await vi.advanceTimersByTimeAsync(100)
    seam.deliver(reply(record(10, 0, 0, 2, 27911)))
    await vi.advanceTimersByTimeAsync(500)

    expect(normalized(pending.result)).toEqual(['10.0.0.1:27910', '10.0.0.2:27911'])
  })

  it('a reply whose body is unusable and nothing else reports that body defect', async () => {
    const seam = stubSeam()
    const pending = await start(seam)

    seam.deliver(new Uint8Array([...MASTER_REPLY_HEADER, 10, 0, 0, 9]))
    await vi.advanceTimersByTimeAsync(500)

    // It answered, so `no-reply` would be a lie; it answered nothing usable, so `ok` would be too.
    expect(pending.result).toEqual({ ok: false, reason: 'truncated' })
  })

  it('the UDP transport is driven entirely through its injectable seam', async () => {
    const seam = stubSeam()
    const { clock, created, cleared } = countingClock()

    const pending = await start(seam, { clock })
    seam.deliver(reply(record(10, 0, 0, 1, 27910)))
    await vi.advanceTimersByTimeAsync(500)

    // Every byte on the wire, and the only wire there is, came from the stub.
    expect(seam.opens).toBe(1)
    expect(seam.targets).toEqual([TARGET])
    expect(seam.sent).toHaveLength(1)
    expect(Array.from(seam.sent[0] as Uint8Array)).toEqual(Array.from(buildMasterQuery()))
    expect(Array.from(buildMasterQuery())).toEqual([
      0xff, 0xff, 0xff, 0xff, 0x71, 0x75, 0x65, 0x72, 0x79, 0x00,
    ])
    expect(seam.closes).toBe(1)
    expect(normalized(pending.result)).toEqual(['10.0.0.1:27910'])
    // Both timers came from the injected clock (first-reply + quiet period), and the first-reply
    // one was cleared by the datagram rather than left to fire.
    expect(created()).toBe(2)
    expect(cleared()).toBe(1)
  })
})

describe('resolveUdpMasterSource (real node:dgram default, loopback responder)', () => {
  let responder: Socket
  let port: number
  let received: Uint8Array[]

  beforeEach(async () => {
    received = []
    responder = createSocket('udp4')
    responder.on('message', (message, rinfo) => {
      received.push(Uint8Array.from(message))
      // Two datagrams with an overlapping record, the way a real master splits its reply.
      responder.send(reply(record(10, 0, 0, 1, 27910)), rinfo.port, rinfo.address)
      responder.send(
        reply(record(10, 0, 0, 2, 27911), record(10, 0, 0, 1, 27910)),
        rinfo.port,
        rinfo.address,
      )
    })
    await new Promise<void>((resolve) => responder.bind(0, '127.0.0.1', resolve))
    port = responder.address().port
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => responder.close(() => resolve()))
  })

  it('collects a loopback responder through the real socket and gets the same address set', async () => {
    const result = await resolveUdpMasterSource(
      { host: '127.0.0.1', port },
      { quietPeriodMs: 150, firstReplyTimeoutMs: 2000 },
    )

    expect(received).toHaveLength(1)
    expect(Array.from(received[0] as Uint8Array)).toEqual(Array.from(buildMasterQuery()))
    expect(normalized(result)).toEqual(['10.0.0.1:27910', '10.0.0.2:27911'])
  })
})
