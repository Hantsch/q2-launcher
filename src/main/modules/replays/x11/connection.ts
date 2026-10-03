import { createConnection } from 'node:net'
import type { Duplex } from 'node:stream'
import { fail, ok, type Outcome } from '@shared/types'
import { MIT_MAGIC_COOKIE, parseXauthority, pickCookie } from './xauth'
import { decodeSetupReply, encodeSetupRequest, readPacket } from './wire'

/** Where to connect: a unix socket path, or a TCP host and port. */
export type X11Target = { path: string } | { host: string; port: number }

export interface X11Connection {
  /** Root window of the first screen. */
  readonly root: number
  readonly resourceIdBase: number
  readonly resourceIdMask: number
  /**
   * Writes one encoded request. With `expectsReply` the outcome carries the whole reply packet (32
   * bytes plus extra data); without it the outcome is an empty buffer as soon as the bytes are
   * written, and any X error for that request is dropped.
   */
  request(bytes: Buffer, expectsReply: boolean): Promise<Outcome<Buffer>>
  close(): void
}

export interface ConnectX11Options {
  env: Readonly<Record<string, string | undefined>>
  /** Rejects when the file is missing or unreadable; that means "no authorization", not failure. */
  readFile: (path: string) => Promise<Buffer>
  /** This machine's host name, as .Xauthority records it for FamilyLocal entries. */
  hostname: string
  createSocket?: (target: X11Target) => Duplex
  timeoutMs?: number
}

const X11_UNIX_DIR = '/tmp/.X11-unix'
const X11_TCP_BASE_PORT = 6000

/** `:n[.s]` is a unix socket, `host:n[.s]` is TCP; the screen number never matters here. */
function parseDisplay(
  display: string | undefined,
): { target: X11Target; number: number; host: string | null } | null {
  const m = /^([^:]*):(\d+)(?:\.\d+)?$/.exec(display ?? '')
  if (!m) return null
  const number = Number(m[2])
  const host = m[1] === '' || m[1] === 'unix' ? null : m[1]
  const target: X11Target = host
    ? { host, port: X11_TCP_BASE_PORT + number }
    : { path: `${X11_UNIX_DIR}/X${number}` }
  return { target, number, host }
}

const defaultSocket = (target: X11Target): Duplex => createConnection(target)

async function loadCookie(
  opts: ConnectX11Options,
  display: number,
  host: string | null,
): Promise<Buffer | null> {
  const file = opts.env.XAUTHORITY || (opts.env.HOME ? `${opts.env.HOME}/.Xauthority` : undefined)
  if (!file) return null
  try {
    const entries = parseXauthority(await opts.readFile(file))
    return pickCookie(entries, { hostname: host ?? opts.hostname, display })
  } catch {
    return null
  }
}

interface Pending {
  resolve: (result: Outcome<Buffer>) => void
  timer: ReturnType<typeof setTimeout>
}

export async function connectX11(opts: ConnectX11Options): Promise<Outcome<X11Connection>> {
  const display = parseDisplay(opts.env.DISPLAY)
  if (!display) return fail('x11.noDisplay')
  const timeoutMs = opts.timeoutMs ?? 2000
  const cookie = await loadCookie(opts, display.number, display.host)
  const socket = (opts.createSocket ?? defaultSocket)(display.target)

  return new Promise<Outcome<X11Connection>>((resolveConnect) => {
    let inbox = Buffer.alloc(0)
    let sequence = 0
    let closed = false
    let settled = false
    let conn: X11Connection | null = null
    // Keyed by the 16-bit sequence number the server echoes; it wraps after 65536 requests.
    const pending = new Map<number, Pending>()

    const settleConnect = (result: Outcome<X11Connection>): void => {
      if (settled) return
      settled = true
      clearTimeout(setupTimer)
      resolveConnect(result)
    }
    const shutdown = (key: string): void => {
      if (closed) return
      closed = true
      socket.destroy()
      settleConnect(fail(key))
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.resolve(fail(key))
      }
      pending.clear()
    }
    const setupTimer = setTimeout(() => shutdown('x11.timeout'), timeoutMs)

    const handleSetup = (): boolean => {
      const setup = decodeSetupReply(inbox)
      if (!setup.ok) {
        if (setup.error === 'garbled') shutdown('x11.protocolError')
        return false
      }
      const reply = setup.value
      inbox = inbox.subarray(reply.byteLength)
      if (reply.status !== 'success') {
        settled = true
        clearTimeout(setupTimer)
        resolveConnect(fail('x11.refused', { reason: reply.reason }))
        closed = true
        socket.destroy()
        return false
      }
      conn = {
        root: reply.roots[0]?.root ?? 0,
        resourceIdBase: reply.resourceIdBase,
        resourceIdMask: reply.resourceIdMask,
        request(bytes, expectsReply) {
          if (closed) return Promise.resolve(fail('x11.closed'))
          sequence = (sequence + 1) & 0xffff
          const seq = sequence
          socket.write(bytes)
          if (!expectsReply) return Promise.resolve(ok(Buffer.alloc(0)))
          return new Promise((resolve) => {
            const timer = setTimeout(() => {
              pending.delete(seq)
              resolve(fail('x11.timeout'))
            }, timeoutMs)
            pending.set(seq, { resolve, timer })
          })
        },
        close: () => shutdown('x11.closed'),
      }
      settleConnect(ok(conn))
      return true
    }

    const settlePending = (seq: number, result: Outcome<Buffer>): void => {
      const p = pending.get(seq)
      if (!p) return
      pending.delete(seq)
      clearTimeout(p.timer)
      p.resolve(result)
    }

    const drain = (): void => {
      while (!closed && conn) {
        const packet = readPacket(inbox)
        if (!packet.ok) {
          if (packet.error === 'garbled') shutdown('x11.protocolError')
          return
        }
        const { kind, sequence: seq, length } = packet.value
        const bytes = Buffer.from(inbox.subarray(0, length))
        inbox = inbox.subarray(length)
        if (kind === 'reply') settlePending(seq, ok(bytes))
        else if (kind === 'error') settlePending(seq, fail('x11.requestFailed', { code: bytes[1] }))
      }
    }

    socket.on('data', (chunk: Buffer) => {
      if (closed) return
      inbox = Buffer.concat([inbox, chunk])
      if (!conn && !handleSetup()) return
      drain()
    })
    socket.on('error', () => shutdown('x11.connectionLost'))
    socket.on('close', () => shutdown('x11.connectionLost'))

    socket.write(
      cookie
        ? encodeSetupRequest(MIT_MAGIC_COOKIE, cookie)
        : encodeSetupRequest('', Buffer.alloc(0)),
    )
  })
}
