import { networkInterfaces as osNetworkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import {
  SERVERS_LAN_ERROR_NO_INTERFACE_KEY,
  SERVERS_LAN_ERROR_SOCKET_REFUSED_KEY,
} from '@shared/modules/servers'
import { parseInfoReply, type InfoReplySuccess } from '@shared/servers/info-reply'
import { buildInfoQuery } from '@shared/servers/protocol'
import {
  INFO_QUERY_PROTOCOL_VERSION,
  systemClock,
  type Clock,
  type TimerHandle,
} from './server-query'

/**
 * Story 196 D1: LAN discovery. One `info` query is broadcast per usable IPv4 interface (directed
 * broadcast `address | ~netmask`, port 27910), re-sent `retries` times `timeoutMs` apart; the first
 * answer per `address:port` wins. Same injectable seams as `server-query.ts` (udp, clock), plus the
 * interface list, so the whole thing is testable without a network.
 *
 * Under the UI harness (`targetsOverride`) no interfaces are enumerated: unicast queries go to the
 * named loopback fixture servers from one loopback socket, with the same dedupe.
 */

export const LAN_DISCOVERY_PORT = 27910

export const LAN_ERROR_NO_INTERFACE = SERVERS_LAN_ERROR_NO_INTERFACE_KEY
export const LAN_ERROR_SOCKET_REFUSED = SERVERS_LAN_ERROR_SOCKET_REFUSED_KEY

export interface LanUdpHandlers {
  onMessage: (data: Uint8Array, from: { address: string; port: number }) => void
  /** Transport-level failure after open. May fire after `close()`; ignored then. */
  onError: (error: Error) => void
}

export interface LanUdpSocket {
  /** Rejects when the datagram could not be sent (broadcast refused, network unreachable...). */
  send: (datagram: Uint8Array, host: string, port: number) => Promise<void>
  /** Safe to call more than once; never throws. */
  close: () => void
}

/** Opens a socket bound to `bindAddress` with broadcast enabled. Rejects on bind/option failure. */
export type LanUdpImpl = (bindAddress: string, handlers: LanUdpHandlers) => Promise<LanUdpSocket>

export const dgramLanUdp: LanUdpImpl = async (bindAddress, handlers) => {
  const { createSocket } = await import('node:dgram')
  const socket = createSocket('udp4')
  let closed = false
  socket.on('message', (data, rinfo) =>
    handlers.onMessage(data, { address: rinfo.address, port: rinfo.port }),
  )
  // Kept attached past close(): an unhandled 'error' event on a dgram socket throws.
  socket.on('error', (error) => handlers.onError(error))
  const close = (): void => {
    if (closed) return
    closed = true
    try {
      socket.close()
    } catch {
      /* already closing or never bound */
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, bindAddress, () => {
        socket.removeListener('error', reject)
        resolve()
      })
    })
    socket.setBroadcast(true)
  } catch (error) {
    close()
    throw error
  }
  return {
    send: (datagram, host, port) =>
      new Promise<void>((resolve, reject) => {
        socket.send(datagram, port, host, (error) => (error == null ? resolve() : reject(error)))
      }),
    close,
  }
}

export interface LanReply {
  /** `ip:port` of the answering server. */
  address: string
  reply: InfoReplySuccess
  rttMs: number
}

export interface LanDiscoveryOptions {
  settings: { timeoutMs: number; retries: number }
  signal?: AbortSignal
  onReply: (reply: LanReply) => void
  deps?: {
    networkInterfaces?: () => Record<string, NetworkInterfaceInfo[] | undefined>
    udpImpl?: LanUdpImpl
    clock?: Clock
    /** Harness override: `host:port` unicast targets, or `'none'` for zero interfaces. */
    targetsOverride?: string[] | 'none'
  }
}

interface Plan {
  bindAddress: string
  destinations: { host: string; port: number }[]
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

function intToIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

/** Directed broadcast address of an interface, or null if it has no usable IPv4 address/mask. */
export function directedBroadcast(address: string, netmask: string): string | null {
  const a = ipv4ToInt(address)
  const m = ipv4ToInt(netmask)
  if (a === null || m === null) return null
  return intToIpv4((a | ~m) >>> 0)
}

function planFromInterfaces(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
): Plan[] {
  const plans: Plan[] = []
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      // `family` is the string 'IPv4' on current Node, the number 4 on Node 18.0-18.3.
      const family = info.family as string | number
      if (family !== 'IPv4' && family !== 4) continue
      if (info.internal) continue
      const broadcast = directedBroadcast(info.address, info.netmask)
      if (broadcast === null) continue
      plans.push({
        bindAddress: info.address,
        destinations: [{ host: broadcast, port: LAN_DISCOVERY_PORT }],
      })
    }
  }
  return plans
}

function planFromTargets(targets: string[]): Plan[] {
  const destinations = targets.flatMap((target) => {
    const i = target.lastIndexOf(':')
    const port = Number(target.slice(i + 1))
    return i > 0 && Number.isInteger(port) ? [{ host: target.slice(0, i), port }] : []
  })
  return destinations.length === 0 ? [] : [{ bindAddress: '127.0.0.1', destinations }]
}

/**
 * Resolves after `(retries + 1) x timeoutMs` (or on abort) with every socket closed. `failureKey`
 * is an i18n key: no usable interface, or every send refused; `null` if any broadcast went out.
 */
export async function discoverLanServers(
  options: LanDiscoveryOptions,
): Promise<{ failureKey: string | null }> {
  const { settings, signal, onReply } = options
  const deps = options.deps ?? {}
  const clock = deps.clock ?? systemClock
  const udpImpl = deps.udpImpl ?? dgramLanUdp

  let plans: Plan[]
  if (deps.targetsOverride !== undefined) {
    plans = deps.targetsOverride === 'none' ? [] : planFromTargets(deps.targetsOverride)
  } else {
    plans = planFromInterfaces((deps.networkInterfaces ?? osNetworkInterfaces)())
  }
  if (plans.length === 0) return { failureKey: LAN_ERROR_NO_INTERFACE }
  if (signal?.aborted === true) return { failureKey: null }

  const datagram = buildInfoQuery(INFO_QUERY_PROTOCOL_VERSION)
  const seen = new Set<string>()
  let anySent = false
  let lastSendAt = 0
  let finished = false

  const onMessage = (data: Uint8Array, from: { address: string; port: number }): void => {
    if (finished) return
    const key = `${from.address}:${from.port}`
    if (seen.has(key)) return
    const parsed = parseInfoReply(data)
    if (!parsed.ok) return
    seen.add(key)
    onReply({ address: key, reply: parsed, rttMs: clock.now() - lastSendAt })
  }

  // One failing interface must not stop the others: each open settles on its own.
  const opened = (
    await Promise.all(
      plans.map(async (plan) => {
        try {
          return {
            socket: await udpImpl(plan.bindAddress, { onMessage, onError: () => undefined }),
            plan,
          }
        } catch {
          return null
        }
      }),
    )
  ).filter((o): o is { socket: LanUdpSocket; plan: Plan } => o !== null)

  const closeAll = (): void => {
    for (const { socket } of opened) {
      try {
        socket.close()
      } catch {
        /* nothing left to release */
      }
    }
  }

  if (opened.length === 0) return { failureKey: LAN_ERROR_SOCKET_REFUSED }
  if ((signal as AbortSignal | undefined)?.aborted === true) {
    closeAll()
    return { failureKey: null }
  }

  const sendRound = (): void => {
    lastSendAt = clock.now()
    for (const { socket, plan } of opened) {
      for (const d of plan.destinations) {
        try {
          socket.send(datagram, d.host, d.port).then(
            () => {
              anySent = true
            },
            () => undefined,
          )
        } catch {
          /* a seam that throws synchronously counts as a refused send */
        }
      }
    }
  }

  let sendsRemaining = settings.retries + 1
  let timer: TimerHandle | null = null
  await new Promise<void>((resolve) => {
    const done = (): void => {
      if (finished) return
      finished = true
      if (timer !== null) clock.clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      closeAll()
      resolve()
    }
    const tick = (): void => {
      timer = null
      if (finished) return
      if (sendsRemaining > 0) {
        sendsRemaining -= 1
        sendRound()
        timer = clock.setTimeout(tick, settings.timeoutMs)
        return
      }
      done()
    }
    signal?.addEventListener('abort', done, { once: true })
    tick()
  })

  return { failureKey: anySent ? null : LAN_ERROR_SOCKET_REFUSED }
}
