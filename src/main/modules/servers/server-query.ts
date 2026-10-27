import type { ScanQueryResult } from '@shared/modules/servers'
import { parseInfoReply } from '@shared/servers/info-reply'
import { buildInfoQuery, buildStatusQuery } from '@shared/servers/protocol'
import { parseStatusReply } from '@shared/servers/status-reply'

/**
 * Story 114: querying exactly *one* game server for its `info` or `status` reply over UDP.
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
 * - **Every send has its own socket, and a reply is timed against the send it answers.** A reply
 *   carries no sequence number, so a late answer to the first send arriving after a retry went out
 *   is indistinguishable from an answer to the retry - on a shared socket. One socket per send makes
 *   the socket the reply arrived on name its send: RTT is that socket's receive stamp minus that
 *   socket's own send stamp, never "now minus the latest send". Settling closes every socket the
 *   query opened (story 258).
 * - **The receive stamp is taken before any other work.** The socket listener reads the monotonic
 *   clock first; parsing and settling run deferred, so a burst of replies landing in one event-loop
 *   turn during a concurrent scan is stamped on arrival instead of queueing behind each other's
 *   parse. The first reply wins; a second one arriving before the first was processed is ignored,
 *   and an abort that lands in between still settles `no-reply` (story 258).
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
  /** `receivedAt` is the transport's `Clock.now()` reading taken on arrival; when a seam omits it,
   * the query reads its own clock instead. */
  onMessage: (data: Uint8Array, receivedAt?: number) => void
  /** Transport-level failure (bind/send/socket error). May fire after `close()`; ignored then. */
  onError: (error: Error) => void
}

/** The socket, as narrowly as the query needs it: send its one datagram, close. */
export interface ServerUdpSocket {
  send: (datagram: Uint8Array) => void
  /** Must be safe to call more than once and must not throw on an already-closed socket. */
  close: () => void
}

/**
 * Opens one socket - the query opens one per send. Async so the default implementation can
 * `await import()` its transport (mirroring `MasterUdpImpl`/`FetchImpl`); a rejection is a
 * `transport-error`, never an escaping exception.
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
  /** Runs `fn` after the current event-loop turn's pending I/O. Defaults to `setImmediate`. */
  defer?: (fn: () => void) => void
}

/** Looks the globals up per call, so a test that installs fake timers is honoured even here.
 * `performance.now()` rather than `Date.now()`: an RTT is a difference of two readings, which a
 * wall-clock adjustment (NTP step, manual change) would corrupt, and whole milliseconds are too
 * coarse for a LAN ping (story 258). */
export const systemClock: Clock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  now: () => performance.now(),
}

const deferToNextTurn = (fn: () => void): void => {
  setImmediate(fn)
}

/**
 * The real socket. `node:dgram` is imported lazily so that importing this module - and testing the
 * entire query state machine - needs no socket-capable runtime.
 *
 * `udp4` only, mirroring `dgramMasterUdp`: story 107's address vocabulary admits IPv4 literals and
 * hostnames, not IPv6 literals. A hostname that resolves to IPv6 only fails the send, which
 * surfaces as `transport-error` rather than as a hang.
 */
export const dgramServerUdp = async (
  target: ServerUdpTarget,
  handlers: ServerUdpHandlers,
  clock: Clock = systemClock,
): Promise<ServerUdpSocket> => {
  const { createSocket } = await import('node:dgram')
  const socket = createSocket('udp4')
  let closed = false

  socket.on('message', (data) => {
    // Stamped before anything else runs in this listener - see the file doc comment.
    const receivedAt = clock.now()
    handlers.onMessage(data, receivedAt)
  })
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
export const INFO_QUERY_PROTOCOL_VERSION = 34

export interface QueryServerOptions {
  kind: 'info' | 'status'
  /** How long to wait for a reply to one send before retrying (or giving up). */
  timeoutMs: number
  /** How many *additional* sends to issue after the first before giving up as `no-reply`. */
  retries: number
  /** Defaults to `systemClock`. */
  clock?: Clock
  /** Defaults to `dgramServerUdp`, stamping with `clock`. */
  udpImpl?: ServerUdpImpl
  /** Caller-owned cancellation: closes every socket and settles as `no-reply`. */
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
 * every path ends in exactly one resolution with every socket it opened closed. See the file doc
 * comment for the retry/RTT rules and for what a reply that fails to parse resolves as.
 */
export async function queryServer(
  target: ServerUdpTarget,
  options: QueryServerOptions,
): Promise<ServerQueryResult> {
  const { kind, timeoutMs, retries } = options
  const clock = options.clock ?? systemClock
  const udpImpl: ServerUdpImpl =
    options.udpImpl ?? ((to, handlers) => dgramServerUdp(to, handlers, clock))
  const defer = clock.defer ?? deferToNextTurn
  const signal = options.signal

  const datagram =
    kind === 'info' ? buildInfoQuery(INFO_QUERY_PROTOCOL_VERSION) : buildStatusQuery()

  let settled = false
  /** Set the moment the first reply arrives: from then on nothing is sent and no other reply or
   * transport error may decide the result - only its deferred processing or an abort. */
  let replyInHand = false
  const openSockets = new Set<ServerUdpSocket>()
  let retryTimer: TimerHandle | null = null
  /** Counts sends still owed, including the first: starts at `retries + 1`. */
  let sendsRemaining = retries + 1

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

  const closeAllSockets = (): void => {
    for (const socket of openSockets) {
      try {
        socket.close()
      } catch {
        /* a seam that cannot close is not a reason to lose a result we already have */
      }
    }
    openSockets.clear()
  }

  const settle = (result: ServerQueryResult): void => {
    if (settled) return
    settled = true
    clearRetryTimer()
    signal?.removeEventListener('abort', onAbort)
    closeAllSockets()
    resolveResult(result)
  }

  // A reply in hand but not yet processed has not decided anything, so an abort still wins and
  // `no-reply` is the only resolution left to give it - the same convention
  // `resolveUdpMasterSource` uses for an already-aborted signal.
  const onAbort = (): void => settle({ ok: false, reason: 'no-reply' })

  const processReply = (data: Uint8Array, rttMs: number): void => {
    if (settled) return

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

  const onReply = (data: Uint8Array, receivedAt: number, sentAt: number): void => {
    if (settled || replyInHand) return
    replyInHand = true
    clearRetryTimer()
    const rttMs = receivedAt - sentAt
    defer(() => processReply(data, rttMs))
  }

  const onError = (_error: Error): void => {
    if (settled || replyInHand) return
    settle({ ok: false, reason: 'transport-error' })
  }

  /** Opens a fresh socket and sends on it once. Never rejects: every failure settles instead, so
   * the floating call from a timer callback cannot become an unhandled rejection. */
  const openAndSend = async (): Promise<void> => {
    sendsRemaining -= 1
    /** `null` until this socket's send goes out: a datagram before that answers nothing of ours. */
    let sentAt: number | null = null
    let socket: ServerUdpSocket
    try {
      socket = await udpImpl(target, {
        onMessage: (data, receivedAt) => {
          const stamp = receivedAt ?? clock.now()
          if (sentAt === null) return
          onReply(data, stamp, sentAt)
        },
        onError,
      })
    } catch {
      settle({ ok: false, reason: 'transport-error' })
      return
    }
    openSockets.add(socket)
    // The query may have settled (abort, error) or got its reply while this socket was opening:
    // it exists only now, so the close `settle()` ran could not reach it.
    if (settled) {
      closeAllSockets()
      return
    }
    if (replyInHand) return
    try {
      sentAt = clock.now()
      socket.send(datagram)
    } catch {
      // The real `dgramServerUdp` never throws here (send errors arrive async via `onError`), but a
      // seam that does throw synchronously is still a transport-error, not an unhandled exception
      // escaping a timer callback.
      settle({ ok: false, reason: 'transport-error' })
      return
    }
    retryTimer = clock.setTimeout(onTimeout, timeoutMs)
  }

  function onTimeout(): void {
    retryTimer = null
    if (settled || replyInHand) return
    if (sendsRemaining > 0) {
      void openAndSend()
      return
    }
    settle({ ok: false, reason: 'no-reply' })
  }

  // An already-cancelled query opens nothing at all.
  if (signal?.aborted === true) return { ok: false, reason: 'no-reply' }
  signal?.addEventListener('abort', onAbort, { once: true })

  await openAndSend()
  return pending
}
