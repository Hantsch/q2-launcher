import type { ParsedServerAddress } from '@shared/servers/address'
import {
  assembleMasterAddresses,
  unpackMasterReply,
  type MasterSourceFailure,
} from '@shared/servers/master-records'
import { OOB_PREFIX, encodeLatin1 } from '@shared/servers/protocol'

/**
 * Story 109 D3: collecting a UDP master's `query` reply off a live socket and handing back the
 * address set it reported.
 *
 * The codec half (unpacking one datagram, unioning several) is pure and lives in
 * `@shared/servers/master-records`; everything here is the part that cannot be pure - a socket, a
 * send, and the decision of *when a reply that has no terminator is over*.
 *
 * Three pieces of machinery carry the whole risk of this file, because each of them fails
 * silently: a wrong rule does not crash, it returns a short server list or never returns at all.
 *
 * **1. Two independent clocks, guarding different things.** The *quiet period* (500 ms, story 109
 * Decisions (Sprint)) is the stop condition: the master answers over an unbounded number of
 * datagrams with no terminator, so the reply is "over" when 500 ms have passed since the last one.
 * It is therefore restarted by every reply datagram - cleared and set again, not merely started
 * once - and only ever started *by* a datagram, never before one. The *first-reply timeout*
 * (2000 ms) is not a cap on the reply and never shortens it: it answers the one question the quiet
 * period cannot even ask, namely "did this master say anything at all", and is cleared for good by
 * the first reply datagram. Getting these two backwards produces either a truncated server list
 * (a cap masquerading as a stop rule) or a scan that hangs forever (no first-reply guard).
 *
 * **2. Every exit runs through `settle()`.** Quiet period elapsed, first-reply timeout, transport
 * error, abort: all four clear both timers, drop the abort listener, close the socket and resolve
 * exactly once. A datagram that arrives after that - the socket close and the last in-flight
 * datagram race by construction - is dropped on the `settled` guard, so a late packet can never
 * mutate a result the caller already has. The seam is also closed when an abort lands while it was
 * still opening (the socket materialises after the resolution, and nobody else would ever close
 * it).
 *
 * **3. A bad datagram is not a bad source.** A datagram whose header is not `servers ` is not our
 * reply at all (a stray packet, a late reply to a previous query) and is ignored outright: no
 * addresses, and no effect on either clock. A datagram that *is* a master reply but whose body is
 * unusable (cut mid-record) still counts as "the master is talking" for both clocks, but
 * contributes no addresses - one garbage datagram must not lose the other two hundred servers,
 * mirroring the per-record rule in `master-records.ts`. Only when no datagram at all yielded
 * addresses is such a body defect reported as the source's failure reason.
 *
 * The socket sits behind an injectable seam (`MasterUdpImpl`) exactly like `FetchImpl` in
 * `src/main/modules/downloads/fetcher.ts`, and `node:dgram` is imported lazily inside the default
 * implementation for the same reason `electron` is there: importing this module must not require a
 * socket-capable environment, and the whole state machine above is unit-testable with no socket at
 * all. The clock is injectable for the same reason - the quiet-period rule is proven against fake
 * timers rather than by waiting out 500 ms of wall clock.
 */

/** Where to send the `query` datagram. Host is used verbatim; see `dgramMasterUdp` on IPv4. */
export interface MasterUdpTarget {
  host: string
  port: number
}

/**
 * What the collector wants to hear from the socket. Passed at open time rather than registered
 * afterwards, so there is no window in which a datagram could arrive before anyone is listening.
 *
 * `onMessage` deliberately carries no `rinfo`: nothing here filters on the sender (a master
 * reached by hostname may legitimately answer from another address of the same host), the payload
 * is validated structurally instead, and a field the collector does not read would only be one
 * more thing every test double has to synthesise.
 */
export interface MasterUdpHandlers {
  onMessage: (data: Uint8Array) => void
  /** Transport-level failure (bind/send/socket error). May fire after `close()`; ignored then. */
  onError: (error: Error) => void
}

/** The socket, as narrowly as the collector needs it: send one datagram, close. */
export interface MasterUdpSocket {
  send: (datagram: Uint8Array) => void
  /** Must be safe to call more than once and must not throw on an already-closed socket. */
  close: () => void
}

/**
 * The one socket this module opens. Async so the default implementation can `await import()` its
 * transport (mirroring `FetchImpl`, which is async for the same reason); a rejection is a
 * `transport-error`, never an escaping exception.
 */
export type MasterUdpImpl = (
  target: MasterUdpTarget,
  handlers: MasterUdpHandlers,
) => Promise<MasterUdpSocket>

/** Whatever the injected `setTimeout` hands back - `NodeJS.Timeout` for the real one. */
export type TimerHandle = ReturnType<typeof setTimeout>

/** The two timer functions the collector needs, injectable so the stop rule is testable. */
export interface Clock {
  setTimeout: (callback: () => void, ms: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
}

/** Looks the globals up per call, so a test that installs fake timers is honoured even here. */
export const systemClock: Clock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
}

/** The decided stop condition: silence this long after the last reply datagram ends collection. */
export const DEFAULT_QUIET_PERIOD_MS = 500

/** How long the master has to say anything at all before it counts as `no-reply`. */
export const DEFAULT_FIRST_REPLY_TIMEOUT_MS = 2_000

/**
 * The master `query` datagram: `OOB_PREFIX` + `"query"` + a terminating NUL byte, per concept
 * 6.5 (`\xFF\xFF\xFF\xFFquery\0`). The NUL is part of the documented wire format and is sent
 * deliberately - a master that ignores a query without it would answer nothing at all, which this
 * collector could only ever report as `no-reply`.
 */
export function buildMasterQuery(): Uint8Array {
  const command = encodeLatin1('query')
  // One byte longer than prefix + command: the trailing NUL is the zero the fresh buffer already
  // holds, written this way rather than as an escape so no control byte sits in this source file.
  const datagram = new Uint8Array(OOB_PREFIX.length + command.length + 1)
  datagram.set(OOB_PREFIX, 0)
  datagram.set(command, OOB_PREFIX.length)
  return datagram
}

/**
 * The real socket. `node:dgram` is imported lazily so that importing this module - and testing the
 * entire collector - needs no socket-capable runtime.
 *
 * `udp4` only: story 107's address vocabulary admits IPv4 literals and hostnames, not IPv6
 * literals. A hostname that resolves to IPv6 only fails the send, which surfaces as
 * `transport-error` rather than as a hang.
 */
export const dgramMasterUdp: MasterUdpImpl = async (target, handlers) => {
  const { createSocket } = await import('node:dgram')
  const socket = createSocket('udp4')
  let closed = false

  socket.on('message', (data) => handlers.onMessage(data))
  // Kept attached past close(): an unhandled 'error' event on a dgram socket throws, and a send
  // still in flight when we close can emit one. The collector ignores errors after it settled.
  socket.on('error', (error) => handlers.onError(error))

  return {
    send: (datagram) => {
      socket.send(datagram, target.port, target.host, (error) => {
        if (error != null && !closed) handlers.onError(error)
      })
    },
    close: () => {
      if (closed) return
      closed = true
      try {
        socket.close()
      } catch {
        /* already closing or never bound - nothing left to release */
      }
    },
  }
}

export interface ResolveUdpMasterSourceOptions {
  /** Defaults to `dgramMasterUdp`. */
  udpImpl?: MasterUdpImpl
  /** Defaults to `systemClock`. */
  clock?: Clock
  quietPeriodMs?: number
  firstReplyTimeoutMs?: number
  /** Caller-owned cancellation: closes the socket and resolves with whatever arrived so far. */
  signal?: AbortSignal
}

export type UdpMasterSourceResult =
  { ok: true; addresses: ParsedServerAddress[] } | { ok: false; reason: MasterSourceFailure }

/**
 * Sends one `query` to `target` and collects the reply datagrams until the quiet period elapses,
 * returning the assembled, deduplicated address set. Never throws and never hangs: every path ends
 * in exactly one resolution with the socket closed and both timers cleared. See the file doc
 * comment for the stop rule and for what a malformed datagram does (and does not) do.
 */
export async function resolveUdpMasterSource(
  target: MasterUdpTarget,
  options: ResolveUdpMasterSourceOptions = {},
): Promise<UdpMasterSourceResult> {
  const udpImpl = options.udpImpl ?? dgramMasterUdp
  const clock = options.clock ?? systemClock
  const quietPeriodMs = options.quietPeriodMs ?? DEFAULT_QUIET_PERIOD_MS
  const firstReplyTimeoutMs = options.firstReplyTimeoutMs ?? DEFAULT_FIRST_REPLY_TIMEOUT_MS
  const signal = options.signal

  let settled = false
  let socket: MasterUdpSocket | null = null
  let socketClosed = false
  let quietTimer: TimerHandle | null = null
  let firstReplyTimer: TimerHandle | null = null
  let replyReceived = false

  /** One entry per reply datagram that unpacked; unioned and deduped only at the end. */
  const payloads: ParsedServerAddress[][] = []
  /** Why the last unusable reply body was rejected - reported only if nothing else yielded data. */
  let lastPayloadFailure: MasterSourceFailure | null = null

  let resolveResult!: (result: UdpMasterSourceResult) => void
  const collected = new Promise<UdpMasterSourceResult>((resolve) => {
    resolveResult = resolve
  })

  const clearTimers = (): void => {
    if (quietTimer !== null) {
      clock.clearTimeout(quietTimer)
      quietTimer = null
    }
    if (firstReplyTimer !== null) {
      clock.clearTimeout(firstReplyTimer)
      firstReplyTimer = null
    }
  }

  const closeSocket = (): void => {
    if (socket === null || socketClosed) return
    socketClosed = true
    try {
      socket.close()
    } catch {
      /* a seam that cannot close is not a reason to lose the addresses we collected */
    }
  }

  const settle = (result: UdpMasterSourceResult): void => {
    if (settled) return
    settled = true
    clearTimers()
    signal?.removeEventListener('abort', onAbort)
    closeSocket()
    resolveResult(result)
  }

  /**
   * End of collection: the addresses if any datagram carried some, otherwise the reason the last
   * reply body was rejected, otherwise "nothing answered".
   */
  const finishCollection = (): void => {
    if (payloads.length > 0) {
      settle({ ok: true, addresses: assembleMasterAddresses(payloads) })
      return
    }
    settle({ ok: false, reason: lastPayloadFailure ?? 'no-reply' })
  }

  const onAbort = (): void => finishCollection()

  const onMessage = (data: Uint8Array): void => {
    if (settled) return

    const unpacked = unpackMasterReply(data)
    // Not a `servers ` reply: a stray packet or a late answer to someone else's query. It is not
    // evidence that this master is talking, so it touches neither clock.
    if (!unpacked.ok && (unpacked.reason === 'too-short' || unpacked.reason === 'bad-header')) {
      return
    }

    // A reply datagram - the master is answering. The first-reply guard has done its job for good,
    // and the quiet period restarts from *this* datagram.
    replyReceived = true
    if (firstReplyTimer !== null) {
      clock.clearTimeout(firstReplyTimer)
      firstReplyTimer = null
    }
    if (quietTimer !== null) clock.clearTimeout(quietTimer)
    quietTimer = clock.setTimeout(() => {
      quietTimer = null
      finishCollection()
    }, quietPeriodMs)

    if (unpacked.ok) payloads.push(unpacked.addresses)
    else lastPayloadFailure = unpacked.reason
  }

  const onError = (_error: Error): void => {
    if (settled) return
    // A socket that dies after the master already answered: keep what it said rather than throwing
    // away a good list over a failing close.
    if (payloads.length > 0) {
      finishCollection()
      return
    }
    settle({ ok: false, reason: 'transport-error' })
  }

  // An already-cancelled scan opens nothing at all.
  if (signal?.aborted === true) return { ok: false, reason: 'no-reply' }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const opened = await udpImpl(target, { onMessage, onError })
    socket = opened
    // The abort (or a seam error) may have landed while the seam was still opening: the socket
    // exists only now, and `settle()` has already run its close.
    if (settled) {
      closeSocket()
      return collected
    }
    opened.send(buildMasterQuery())
  } catch {
    settle({ ok: false, reason: 'transport-error' })
    return collected
  }

  // Armed after the send, and only if nothing has answered yet - a seam that delivers a datagram
  // synchronously from `send()` would otherwise get a first-reply timer that nothing clears, and
  // that timer would later cut a perfectly good collection short with `no-reply`.
  if (!settled && !replyReceived) {
    firstReplyTimer = clock.setTimeout(() => {
      firstReplyTimer = null
      settle({ ok: false, reason: 'no-reply' })
    }, firstReplyTimeoutMs)
  }

  return collected
}
