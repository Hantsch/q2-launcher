import { createSocket, type Socket } from 'node:dgram'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInfoQuery } from '@shared/servers/protocol'
import { SAMPLE_INFO_REPLY } from '@shared/servers/reply-fixtures'
import {
  queryServer,
  systemClock,
  type Clock,
  type QueryServerOptions,
  type ServerQueryResult,
  type ServerUdpHandlers,
  type ServerUdpImpl,
  type ServerUdpTarget,
} from './server-query'

/**
 * `queryServer` is a much smaller state machine than `resolveUdpMasterSource` - one datagram is the
 * whole reply, so there is no quiet period - but its failure modes still have to be proven against
 * fake timers rather than trusted by inspection: a retry that fires exactly on schedule and stops at
 * `retries + 1` sends (each on its own socket), a settle that is reached exactly once even when a
 * stray datagram arrives afterwards or while the first reply is still being processed, and every
 * settle path closing every socket the query opened instead of leaving one (and a timer) dangling.
 *
 * A `fakeClock` (not vitest's faked `Date`) drives the retry timers, the RTT measurement and the
 * deferred reply processing in lockstep, so "37 ms passed" is asserted against a number this file
 * controls end to end.
 *
 * Two tests at the bottom drive the real `node:dgram` default against a loopback responder on
 * `127.0.0.1`, mirroring `udp-master-source.test.ts`'s own such block. No test in this file
 * addresses a real game server (GB-A5).
 */

/** One socket the query opened through the seam. */
interface StubSocket {
  handlers: ServerUdpHandlers
  sent: Uint8Array[]
  closes: number
}

interface StubSeam {
  impl: ServerUdpImpl
  /** Targets the query asked to open, in order. */
  targets: ServerUdpTarget[]
  /** Every socket the query opened, in order - one per send. */
  sockets: StubSocket[]
  /** Datagrams the query sent across all its sockets, in order. */
  sent: Uint8Array[]
  opens: number
  /** `close()` calls across all sockets. */
  closes: number
  /**
   * Hands a datagram to the query the way a socket would - on the latest socket unless `socket`
   * (0-based) names another, with the transport's receive stamp when `receivedAt` is given.
   */
  deliver: (bytes: Uint8Array, at?: { socket?: number; receivedAt?: number; from?: string }) => void
  /** Reports a transport failure on the latest socket the way its 'error' event would. */
  fail: (error: Error) => void
  /** Lets a held open (`holdOpenAt`) complete. */
  release: () => void
}

interface StubBehaviour {
  openError?: Error
  /** 1-based open that rejects with `openError`; every open when omitted. */
  openErrorAt?: number
  sendError?: Error
  /** 1-based socket whose send throws `sendError`; every socket when omitted. */
  sendErrorAt?: number
  /** 1-based open that does not complete until `release()`. */
  holdOpenAt?: number
}

function stubSeam(behaviour: StubBehaviour = {}): StubSeam {
  let releaseHeld: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve
  })
  const hits = (at: number | undefined, n: number): boolean => at === undefined || at === n

  const seam: StubSeam = {
    targets: [],
    sockets: [],
    sent: [],
    opens: 0,
    closes: 0,
    impl: async (target, handlers) => {
      seam.opens += 1
      const n = seam.opens
      seam.targets.push(target)
      if (behaviour.holdOpenAt === n) await held
      if (behaviour.openError !== undefined && hits(behaviour.openErrorAt, n)) {
        throw behaviour.openError
      }
      const socket: StubSocket = { handlers, sent: [], closes: 0 }
      seam.sockets.push(socket)
      return {
        send: (datagram) => {
          if (behaviour.sendError !== undefined && hits(behaviour.sendErrorAt, n)) {
            throw behaviour.sendError
          }
          socket.sent.push(datagram)
          seam.sent.push(datagram)
        },
        close: () => {
          socket.closes += 1
          seam.closes += 1
        },
      }
    },
    deliver: (bytes, at = {}) => {
      const socket = seam.sockets[at.socket ?? seam.sockets.length - 1]
      socket?.handlers.onMessage(bytes, at.from ?? '127.0.0.1', at.receivedAt)
    },
    fail: (error) => seam.sockets.at(-1)?.handlers.onError(error),
    release: () => releaseHeld(),
  }

  return seam
}

/** Observes a pending query without awaiting it, so "not settled yet" is assertable. */
function track(promise: Promise<ServerQueryResult>): {
  settled: boolean
  result: ServerQueryResult | null
} {
  const state: { settled: boolean; result: ServerQueryResult | null } = {
    settled: false,
    result: null,
  }
  void promise.then((result) => {
    state.settled = true
    state.result = result
  })
  return state
}

/**
 * A `Clock` whose `now()` is a virtual counter this file advances itself, in lockstep with the fake
 * timers. Deferred reply processing is queued, not run: `advance` moves the clock first, then runs
 * what was deferred, then the timers due - so a test can prove the RTT does not depend on how long
 * the deferred processing waited.
 */
function fakeClock(): { clock: Clock; advance: (ms: number) => Promise<void> } {
  let virtualNow = 0
  const deferred: (() => void)[] = []
  return {
    clock: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle),
      now: () => virtualNow,
      defer: (fn) => {
        deferred.push(fn)
      },
    },
    advance: async (ms: number) => {
      virtualNow += ms
      for (const fn of deferred.splice(0)) fn()
      await vi.advanceTimersByTimeAsync(ms)
    },
  }
}

const TARGET: ServerUdpTarget = { host: '127.0.0.1', port: 27910 }
const TIMINGS = { timeoutMs: 500, retries: 2 }
const MALFORMED_INFO = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x69, 0x6e, 0x66, 0x6f, 0x0a])

describe('queryServer (stub seam, fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Opens the query and lets the seam finish opening + the first send go out. */
  async function start(
    seam: StubSeam,
    clock: Clock,
    options: Partial<QueryServerOptions> = {},
  ): Promise<ReturnType<typeof track>> {
    const pending = track(
      queryServer(TARGET, { kind: 'info', udpImpl: seam.impl, clock, ...TIMINGS, ...options }),
    )
    await vi.advanceTimersByTimeAsync(0)
    return pending
  }

  it('a reply is parsed and the result carries a measured rttMs', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    await advance(37)
    seam.deliver(SAMPLE_INFO_REPLY)
    await advance(0)

    expect(pending.settled).toBe(true)
    const result = pending.result
    expect(result?.ok).toBe(true)
    if (result?.ok === true && result.kind === 'info') {
      expect(result.reply.hostname).toBe('Test Server')
      expect(result.rttMs).toBe(37)
      expect(result.fromAddress).toBe('127.0.0.1')
    }
    expect(seam.sent).toHaveLength(1)
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('RTT is measured from the last send that got an answer, not the first', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    // First send times out with no reply at all - a retry goes out on a second socket.
    await advance(500)
    expect(seam.sent).toHaveLength(2)
    expect(seam.sockets).toHaveLength(2)

    // The retry gets an answer 42 ms later: RTT must be measured from *this* send, not the first.
    await advance(42)
    seam.deliver(SAMPLE_INFO_REPLY, { socket: 1 })
    await advance(0)

    expect(pending.result?.ok).toBe(true)
    if (pending.result?.ok === true) {
      expect(pending.result.rttMs).toBe(42)
    }
  })

  it('a late reply to the first send is timed against the first send, not the retry', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    await advance(500)
    expect(seam.sockets).toHaveLength(2)
    expect(seam.sockets[1]?.sent).toHaveLength(1)

    // The first send's answer only lands 30 ms after the retry went out - on the first socket.
    await advance(30)
    seam.deliver(SAMPLE_INFO_REPLY, { socket: 0 })
    await advance(0)

    expect(pending.result?.ok).toBe(true)
    if (pending.result?.ok === true) {
      expect(pending.result.rttMs).toBe(530)
    }
  })

  it('the receive stamp is taken at arrival, not when the reply is processed', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    await advance(37)
    seam.deliver(SAMPLE_INFO_REPLY, { receivedAt: 37 })
    expect(pending.settled).toBe(false)

    // The deferred processing only runs after the clock moved on by 300 ms.
    await advance(300)

    expect(pending.result?.ok).toBe(true)
    if (pending.result?.ok === true) {
      expect(pending.result.rttMs).toBe(37)
    }
    expect(seam.sent).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('every socket of a query is closed when it settles', async () => {
    const settleBy: ((seam: StubSeam, controller: AbortController) => void)[] = [
      (seam) => seam.deliver(SAMPLE_INFO_REPLY, { socket: 0 }),
      (seam) => seam.deliver(MALFORMED_INFO, { socket: 1 }),
      (_seam, controller) => controller.abort(),
      (seam) => seam.fail(new Error('ECONNREFUSED')),
    ]

    for (const trigger of settleBy) {
      const seam = stubSeam()
      const { clock, advance } = fakeClock()
      const controller = new AbortController()
      const pending = await start(seam, clock, { signal: controller.signal })
      await advance(500)
      await advance(500)
      expect(seam.sockets).toHaveLength(3)

      trigger(seam, controller)
      await advance(0)

      expect(pending.settled).toBe(true)
      expect(seam.sockets.map((socket) => socket.closes)).toEqual([1, 1, 1])
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it('a silent server yields no-reply after exactly retries + 1 sends', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    expect(seam.sent).toHaveLength(1)
    expect(pending.settled).toBe(false)

    await advance(500)
    expect(seam.sent).toHaveLength(2)
    expect(pending.settled).toBe(false)

    await advance(500)
    expect(seam.sent).toHaveLength(3)
    expect(pending.settled).toBe(false)

    await advance(500)
    expect(pending.settled).toBe(true)
    expect(pending.result).toEqual({ ok: false, reason: 'no-reply' })
    // retries: 2 -> exactly 3 sends total, one per socket, never a fourth.
    expect(seam.sent).toHaveLength(3)
    expect(seam.sockets.map((socket) => socket.sent.length)).toEqual([1, 1, 1])
    expect(seam.sockets.map((socket) => socket.closes)).toEqual([1, 1, 1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a datagram arriving after settle is dropped and does not change the result', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock, { retries: 0 })

    seam.deliver(SAMPLE_INFO_REPLY)
    await advance(0)
    expect(pending.settled).toBe(true)
    const resolved = pending.result

    // The socket close and a datagram already in flight race by construction.
    seam.deliver(MALFORMED_INFO)
    await advance(1000)

    expect(pending.result).toBe(resolved)
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a second reply arriving before the first is processed is ignored', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    await advance(500)
    await advance(20)
    // Both sockets answer in the same turn; the first arrival decides, the malformed one is dropped.
    seam.deliver(SAMPLE_INFO_REPLY, { socket: 0 })
    seam.deliver(MALFORMED_INFO, { socket: 1 })
    await advance(0)

    expect(pending.result?.ok).toBe(true)
    if (pending.result?.ok === true) {
      expect(pending.result.rttMs).toBe(520)
    }
    expect(seam.sockets.map((socket) => socket.closes)).toEqual([1, 1])
    // A reply in hand stops the retry schedule even before it is processed.
    expect(seam.sent).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an abort before a received reply is processed still settles no-reply', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const controller = new AbortController()
    const pending = await start(seam, clock, { signal: controller.signal })

    await advance(10)
    seam.deliver(SAMPLE_INFO_REPLY)
    controller.abort()
    await advance(0)

    expect(pending.result).toEqual({ ok: false, reason: 'no-reply' })
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an abort closes the socket and settles the promise', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const controller = new AbortController()
    const pending = await start(seam, clock, { signal: controller.signal })

    await advance(100)
    expect(pending.settled).toBe(false)

    controller.abort()
    await advance(0)

    expect(pending.settled).toBe(true)
    expect(pending.result).toEqual({ ok: false, reason: 'no-reply' })
    expect(seam.closes).toBe(1)
    // The retry timer must be gone with it - an abort that only resolves leaves a timer holding
    // the event loop open and a socket holding a port.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a retry socket that finishes opening after an abort is closed without sending', async () => {
    const seam = stubSeam({ holdOpenAt: 2 })
    const { clock, advance } = fakeClock()
    const controller = new AbortController()
    const pending = await start(seam, clock, { signal: controller.signal })

    await advance(500)
    expect(seam.opens).toBe(2)

    controller.abort()
    await advance(0)
    expect(pending.result).toEqual({ ok: false, reason: 'no-reply' })

    seam.release()
    await advance(0)

    expect(seam.sockets).toHaveLength(2)
    expect(seam.sockets[1]?.sent).toHaveLength(0)
    expect(seam.sockets.map((socket) => socket.closes)).toEqual([1, 1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a signal already aborted opens no socket at all', async () => {
    const seam = stubSeam()
    const { clock } = fakeClock()
    const pending = await start(seam, clock, { signal: AbortSignal.abort() })

    expect(pending.result).toEqual({ ok: false, reason: 'no-reply' })
    expect(seam.opens).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a reply that fails to parse settles as malformed, not no-reply', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    // Well-formed envelope, empty body: `parseInfoReply` rejects this as malformed-infostring.
    seam.deliver(MALFORMED_INFO)
    await advance(0)

    expect(pending.result).toEqual({ ok: false, reason: 'malformed' })
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a seam that throws on open yields transport-error', async () => {
    const seam = stubSeam({ openError: new Error('EACCES') })
    const { clock } = fakeClock()
    const pending = await start(seam, clock)

    expect(pending.result).toEqual({ ok: false, reason: 'transport-error' })
    expect(seam.closes).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a seam that throws on send yields transport-error', async () => {
    const seam = stubSeam({ sendError: new Error('ENETUNREACH') })
    const { clock } = fakeClock()
    const pending = await start(seam, clock)

    expect(pending.result).toEqual({ ok: false, reason: 'transport-error' })
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a retry whose socket fails to open yields transport-error and closes the first socket', async () => {
    const seam = stubSeam({ openError: new Error('EMFILE'), openErrorAt: 2 })
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    await advance(500)

    expect(pending.result).toEqual({ ok: false, reason: 'transport-error' })
    expect(seam.opens).toBe(2)
    expect(seam.sockets.map((socket) => socket.closes)).toEqual([1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a retry whose send throws yields transport-error and closes both sockets', async () => {
    const seam = stubSeam({ sendError: new Error('ENETUNREACH'), sendErrorAt: 2 })
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    await advance(500)

    expect(pending.result).toEqual({ ok: false, reason: 'transport-error' })
    expect(seam.sockets.map((socket) => socket.closes)).toEqual([1, 1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the UDP transport is driven entirely through its injectable seam', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()

    const pending = await start(seam, clock, { kind: 'status' })
    seam.deliver(SAMPLE_INFO_REPLY) // wrong command token for `status` -> malformed
    await advance(0)

    expect(seam.opens).toBe(1)
    expect(seam.targets).toEqual([TARGET])
    expect(seam.sent).toHaveLength(1)
    expect(pending.result).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('systemClock', () => {
  it('systemClock is monotonic and sub-millisecond', () => {
    const spy = vi.spyOn(performance, 'now').mockReturnValue(1234.567)
    try {
      expect(systemClock.now()).toBe(1234.567)
    } finally {
      spy.mockRestore()
    }

    let previous = systemClock.now()
    for (let i = 0; i < 1000; i += 1) {
      const next = systemClock.now()
      expect(next).toBeGreaterThanOrEqual(previous)
      previous = next
    }
  })
})

describe('queryServer (real node:dgram default, loopback responder)', () => {
  let responder: Socket
  let port: number
  let received: Uint8Array[]

  beforeEach(async () => {
    received = []
    responder = createSocket('udp4')
    responder.on('message', (message, rinfo) => {
      received.push(Uint8Array.from(message))
      responder.send(SAMPLE_INFO_REPLY, rinfo.port, rinfo.address)
    })
    await new Promise<void>((resolve) => responder.bind(0, '127.0.0.1', resolve))
    port = responder.address().port
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => responder.close(() => resolve()))
  })

  it('queries a loopback responder through the real socket and gets a parsed reply', async () => {
    const result = await queryServer(
      { host: '127.0.0.1', port },
      { kind: 'info', timeoutMs: 2000, retries: 1 },
    )

    expect(received).toHaveLength(1)
    // The classic Quake II protocol version (34) is the fixed argument `server-query.ts` sends.
    expect(Array.from(received[0] as Uint8Array)).toEqual(Array.from(buildInfoQuery(34)))

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'info') {
      expect(result.reply.hostname).toBe('Test Server')
      expect(result.rttMs).toBeGreaterThanOrEqual(0)
      expect(result.fromAddress).toBe('127.0.0.1')
    }
  })

  it("the real socket stamps a reply's arrival with the query's own clock", async () => {
    // Every reading is 10 ms after the last: the send stamp is the first, the arrival the second.
    let ticks = 0
    const countingClock: Clock = {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle),
      now: () => (ticks += 10),
    }

    const result = await queryServer(
      { host: '127.0.0.1', port },
      { kind: 'info', timeoutMs: 2000, retries: 0, clock: countingClock },
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rttMs).toBe(10)
  })
})
