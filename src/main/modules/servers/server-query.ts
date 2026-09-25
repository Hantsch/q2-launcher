import type { ScanQueryResult } from '@shared/modules/servers'
import { parseInfoReply } from '@shared/servers/info-reply'
import { buildInfoQuery, buildStatusQuery } from '@shared/servers/protocol'
import { parseStatusReply } from '@shared/servers/status-reply'

/**
 * Story 114 D2: querying exactly *one* game server for its `info` or `status` reply over UDP.
 *
 * Mirrors `udp-master-source.ts`'s seam shape line for line - an injectable `ServerUdpImpl`, an
 * injectable `Clock`, `node:dgram` imported lazily inside the default implementation, and every
 * exit funnelled through one `settle()` so a datagram arriving after the promise has resolved is
 * dropped rather than risking a double-resolve. What is different, and why this file is smaller:
 *
 * - **One datagram is the whole reply.** There is no quiet period and no reassembly: the first
 *   datagram that parses (or fails to parse) *is* the answer, so there is exactly one state machine
 *   transition to get right, not two independent clocks.
 * - **Retries are sends, not a reason to wait longer.** `timeoutMs` arms a single retry timer per
 *   send; on expiry, a resend is issued (re-using the same pre-built datagram) if any retries remain,
 *   otherwise the query settles `no-reply`. A silent server therefore always produces exactly
 *   `retries + 1` sends before giving up.
 * - **RTT is measured from the *last* send, not the first.** Every (re)send overwrites the
 *   "last sent at" timestamp before arming its own timer, so a reply that only arrives after one or
 *   more retries reports the time since the send it is actually answering.
 * - **A reply that does not parse is `malformed`, not `no-reply`.** The server said *something* -
 *   claiming nothing answered would be a lie - but whatever it said was not a usable `info`/`status`
 *   reply, so this settles immediately rather than waiting out further retries.
 *
 * The `info` query needs a protocol version argument the reply body never echoes back and this
 * deliverable's options do not expose, so `INFO_QUERY_PROTOCOL_VERSION` fixes it to the classic
 * Quake II wire value (34, the same sample value `protocol.test.ts` builds its query fixtures with).
 */

/** Where to send the query datagram. Host is used verbatim; see `dgramServerUdp` on IPv4. */
export interface ServerUdpTarget {
  host: string
  port: number
}

/**
 * What the query wants to hear from the socket. Passed at open time rather than registered
 * afterwards, so there is no window in which a datagram could arrive before anyone is listening -
 * same reasoning as `MasterUdpHandlers`.
 */
export interface ServerUdpHandlers {
  onMessage: (data: Uint8Array) => void
  /** Transport-level failure (bind/send/socket error). May fire after `close()`; ignored then. */
  onError: (error: Error) => void
}

/** The socket, as narrowly as the query needs it: send one datagram (possibly more than once), close. */
export interface ServerUdpSocket {
  send: (datagram: Uint8Array) => void
  /** Must be safe to call more than once and must not throw on an already-closed socket. */
  close: () => void
}

/**
 * The one socket this module opens. Async so the default implementation can `await import()` its
 * transport (mirroring `MasterUdpImpl`/`FetchImpl`); a rejection is a `transport-error`, never an
 * escaping exception.
 */
export type ServerUdpImpl = (
  target: ServerUdpTarget,
  handlers: ServerUdpHandlers,
) => Promise<ServerUdpSocket>

/** Whatever the injected `setTimeout` hands back - `NodeJS.Timeout` for the real one. */
export type TimerHandle = ReturnType<typeof setTimeout>

/** The timer functions plus a clock reading, injectable so both the retry schedule and the
 * measured RTT are testable against fake timers rather than wall-clock time. */
export interface Clock {
  setTimeout: (callback: () => void, ms: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
  /** Milliseconds, monotonically non-decreasing from the caller's point of view. */
  now: () => number
}

/** Looks the globals up per call, so a test that installs fake timers is honoured even here. */
export const systemClock: Clock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => Date.now(),
}

/**
 * The real socket. `node:dgram` is imported lazily so that importing this module - and testing the
 * entire query state machine - needs no socket-capable runtime.
 *
 * `udp4` only, mirroring `dgramMasterUdp`: story 107's address vocabulary admits IPv4 literals and
 * hostnames, not IPv6 literals. A hostname that resolves to IPv6 only fails the send, which
 * surfaces as `transport-error` rather than as a hang.
 */
export const dgramServerUdp: ServerUdpImpl = async (target, handlers) => {
  const { createSocket } = await import('node:dgram')
  const socket = createSocket('udp4')
  let closed = false

  socket.on('message', (data) => handlers.onMessage(data))
  // Kept attached past close(): an unhandled 'error' event on a dgram socket throws, and a send
  // still in flight when we close can emit one. The query ignores errors after it settled.
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

/** The classic Quake II protocol version the `info` query's argument claims - see the file doc
 * comment for why this is a fixed constant rather than an option. */
const INFO_QUERY_PROTOCOL_VERSION = 34

export interface QueryServerOptions {
  kind: 'info' | 'status'
  /** How long to wait for a reply to one send before retrying (or giving up). */
  timeoutMs: number
  /** How many *additional* sends to issue after the first before giving up as `no-reply`. */
  retries: number
  /** Defaults to `systemClock`. */
  clock?: Clock
  /** Defaults to `dgramServerUdp`. */
  udpImpl?: ServerUdpImpl
  /** Caller-owned cancellation: closes the socket and settles as `no-reply`. */
  signal?: AbortSignal
}

export type ServerQueryFailureReason = 'no-reply' | 'transport-error' | 'malformed'

/** Review fix (story 114): alias of the shared `ScanQueryResult` (`@shared/modules/servers`) so
 * the renderer can import the real type for the `scan.server` push instead of re-declaring a copy
 * of it by hand - every existing import of `ServerQueryResult` in this main-only tree keeps
 * working unchanged. */
export type ServerQueryResult = ScanQueryResult

/**
 * Sends an `info` or `status` query to `target` and resolves with the parsed reply (and its
 * measured RTT), retrying on timeout up to `retries` extra times. Never throws and never hangs:
 * every path ends in exactly one resolution with the socket closed. See the file doc comment for
 * the retry/RTT rules and for what a reply that fails to parse resolves as.
 */
export async function queryServer(
  target: ServerUdpTarget,
  options: QueryServerOptions,
): Promise<ServerQueryResult> {
  const { kind, timeoutMs, retries } = options
  const udpImpl = options.udpImpl ?? dgramServerUdp
  const clock = options.clock ?? systemClock
  const signal = options.signal

  const datagram = kind === 'info' ? buildInfoQuery(INFO_QUERY_PROTOCOL_VERSION) : buildStatusQuery()

  let settled = false
  let socket: ServerUdpSocket | null = null
  let socketClosed = false
  let retryTimer: TimerHandle | null = null
  /** Counts sends still owed, including the first: starts at `retries + 1`. */
  let sendsRemaining = retries + 1
  let lastSendAt = 0

  let resolveResult!: (result: ServerQueryResult) => void
  const pending = new Promise<ServerQueryResult>((resolve) => {
    resolveResult = resolve
  })

  const clearRetryTimer = (): void => {
    if (retryTimer !== null) {
      clock.clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  const closeSocket = (): void => {
    if (socket === null || socketClosed) return
    socketClosed = true
    try {
      socket.close()
    } catch {
      /* a seam that cannot close is not a reason to lose a result we already have */
    }
  }

  const settle = (result: ServerQueryResult): void => {
    if (settled) return
    settled = true
    clearRetryTimer()
    signal?.removeEventListener('abort', onAbort)
    closeSocket()
    resolveResult(result)
  }

  // An abort can only ever land before a reply parsed (a parsed reply already settled
  // synchronously), so `no-reply` is the only resolution left to give it - the same convention
  // `resolveUdpMasterSource` uses for an already-aborted signal.
  const onAbort = (): void => settle({ ok: false, reason: 'no-reply' })

  const sendQuery = (): void => {
    if (socket === null) return
    lastSendAt = clock.now()
    sendsRemaining -= 1
    try {
      socket.send(datagram)
    } catch {
      // The real `dgramServerUdp` never throws here (send errors arrive async via `onError`), but
      // a retry's send is not covered by the caller-level try/catch around the initial open+send,
      // so a seam that does throw synchronously is still a transport-error, not an unhandled
      // exception escaping a timer callback.
      settle({ ok: false, reason: 'transport-error' })
      return
    }
    retryTimer = clock.setTimeout(onTimeout, timeoutMs)
  }

  function onTimeout(): void {
    retryTimer = null
    if (settled) return
    if (sendsRemaining > 0) {
      sendQuery()
      return
    }
    settle({ ok: false, reason: 'no-reply' })
  }

  const onMessage = (data: Uint8Array): void => {
    if (settled) return
    const rttMs = clock.now() - lastSendAt

    if (kind === 'info') {
      const parsed = parseInfoReply(data)
      if (!parsed.ok) {
        settle({ ok: false, reason: 'malformed' })
        return
      }
      settle({ ok: true, kind: 'info', reply: parsed, rttMs })
      return
    }

    const parsed = parseStatusReply(data)
    if (!parsed.ok) {
      settle({ ok: false, reason: 'malformed' })
      return
    }
    settle({ ok: true, kind: 'status', reply: parsed, rttMs })
  }

  const onError = (_error: Error): void => {
    if (settled) return
    settle({ ok: false, reason: 'transport-error' })
  }

  // An already-cancelled query opens nothing at all.
  if (signal?.aborted === true) return { ok: false, reason: 'no-reply' }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const opened = await udpImpl(target, { onMessage, onError })
    socket = opened
    // The abort (or a seam error) may have landed while the seam was still opening: the socket
    // exists only now, and `settle()` has already run its close.
    if (settled) {
      closeSocket()
      return pending
    }
    sendQuery()
  } catch {
    settle({ ok: false, reason: 'transport-error' })
    return pending
  }

  return pending
}
