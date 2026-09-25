import { createSocket, type Socket } from 'node:dgram'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInfoQuery } from '@shared/servers/protocol'
import { SAMPLE_INFO_REPLY } from '@shared/servers/reply-fixtures'
import {
  queryServer,
  type Clock,
  type QueryServerOptions,
  type ServerQueryResult,
  type ServerUdpHandlers,
  type ServerUdpImpl,
  type ServerUdpTarget,
} from './server-query'

/**
 * Story 114 D2. `queryServer` is a much smaller state machine than `resolveUdpMasterSource` - one
 * datagram is the whole reply, so there is no quiet period - but the same three failure modes
 * still have to be proven against fake timers rather than trusted by inspection: a retry that fires
 * exactly on schedule and stops at `retries + 1` sends, a settle that is reached exactly once even
 * when a stray datagram arrives afterwards, and an abort that closes the socket instead of leaving
 * it (and a timer) dangling.
 *
 * A `fakeClock` (not vitest's faked `Date`) drives both the retry timers and the RTT measurement in
 * lockstep, so "37 ms passed" is asserted against a number this file controls end to end rather than
 * against however vitest happens to fake `Date.now()`.
 *
 * One test at the bottom drives the real `node:dgram` default against a loopback responder on
 * `127.0.0.1`, mirroring `udp-master-source.test.ts`'s own such block. No test in this file
 * addresses a real game server (GB-A5).
 */

interface StubSeam {
  impl: ServerUdpImpl
  /** Targets the query asked to open, in order. */
  targets: ServerUdpTarget[]
  /** Datagrams the query sent, in order - one per send/resend. */
  sent: Uint8Array[]
  opens: number
  closes: number
  /** Hands a datagram to the query the way a socket would. */
  deliver: (bytes: Uint8Array) => void
  /** Reports a transport failure the way a socket's 'error' event would. */
  fail: (error: Error) => void
}

function stubSeam(behaviour: { openError?: Error; sendError?: Error } = {}): StubSeam {
  let handlers: ServerUdpHandlers | null = null

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
 * timers, rather than relying on vitest's own `Date` faking - so an RTT assertion checks exactly the
 * number of milliseconds this test told the clock to advance by.
 */
function fakeClock(): { clock: Clock; advance: (ms: number) => Promise<void> } {
  let virtualNow = 0
  return {
    clock: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle),
      now: () => virtualNow,
    },
    advance: async (ms: number) => {
      virtualNow += ms
      await vi.advanceTimersByTimeAsync(ms)
    },
  }
}

const TARGET: ServerUdpTarget = { host: '127.0.0.1', port: 27910 }
const TIMINGS = { timeoutMs: 500, retries: 2 }

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
    }
    expect(seam.sent).toHaveLength(1)
    expect(seam.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('RTT is measured from the last send that got an answer, not the first', async () => {
    const seam = stubSeam()
    const { clock, advance } = fakeClock()
    const pending = await start(seam, clock)

    // First send times out with no reply at all - a retry goes out.
    await advance(500)
    expect(seam.sent).toHaveLength(2)

    // The retry gets an answer 42 ms later: RTT must be measured from *this* send, not the first.
    await advance(42)
    seam.deliver(SAMPLE_INFO_REPLY)
    await advance(0)

    expect(pending.result?.ok).toBe(true)
    if (pending.result?.ok === true) {
      expect(pending.result.rttMs).toBe(42)
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
    // retries: 2 -> exactly 3 sends total, never a fourth.
    expect(seam.sent).toHaveLength(3)
    expect(seam.closes).toBe(1)
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
    seam.deliver(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x69, 0x6e, 0x66, 0x6f, 0x0a]))
    await advance(1000)

    expect(pending.result).toBe(resolved)
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
    seam.deliver(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x69, 0x6e, 0x66, 0x6f, 0x0a]))
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
    }
  })
})
