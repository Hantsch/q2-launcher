import { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectX11, type X11Target } from './connection'

/** Hand-written spec bytes, little-endian (X11 Appendix B), not produced by the codec. */
function hex(...parts: string[]): Buffer {
  return Buffer.from(parts.join('').replace(/\s+/g, ''), 'hex')
}

// Success, no vendor, no formats, one screen without depths: 80 bytes, additional length 18 units.
const SETUP_SUCCESS = hex(
  '01 00 0b 00 00 00 12 00',
  '40 e2 01 00 00 00 20 01 ff ff 1f 00', // release, id base 0x01200000, id mask 0x001fffff
  '00 01 00 00 00 00 ff ff 01 00', // motion, vendor 0, max request, 1 screen, 0 formats
  '00 00 20 20 08 ff 00 00 00 00',
  '39 05 00 00', // root 0x539
  '20 00 00 00 ff ff ff 00 00 00 00 00 00 00 00 00',
  '80 07 38 04 08 02 25 01 01 00 01 00',
  '21 00 00 00 00 00 18 00', // root-visual, backing/save, root depth 24, 0 depths
)
// Failed: reason "no" (2 bytes, padded to 4), additional length 1.
const SETUP_REFUSED = hex('00 02 0b 00 00 00 01 00', '6e 6f 00 00')

const seqLE = (n: number): string =>
  (n & 0xff).toString(16).padStart(2, '0') + (n >> 8).toString(16).padStart(2, '0')
/** A 32-byte reply for `seq` whose bytes 8-9 carry `tag`. */
const reply = (seq: number, tag: number): Buffer =>
  hex('01 00', seqLE(seq), '00 00 00 00', tag.toString(16).padStart(2, '0'), '00', '00'.repeat(22))
const errorPacket = (seq: number, code: number): Buffer =>
  hex('00', code.toString(16).padStart(2, '0'), seqLE(seq), '00'.repeat(28))
const eventPacket = (seq: number): Buffer => hex('0c 00', seqLE(seq), '00'.repeat(28))

class FakeServer {
  written: Buffer[] = []
  target: X11Target | null = null
  readonly socket = new Duplex({
    read() {},
    write: (chunk: Buffer, _enc, cb) => {
      this.written.push(chunk)
      cb()
    },
  })
  createSocket = (target: X11Target): Duplex => {
    this.target = target
    return this.socket
  }
  send(...chunks: Buffer[]): void {
    for (const c of chunks) this.socket.push(c)
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

async function connected(server = new FakeServer(), timeoutMs?: number) {
  const pendingConn = connectX11({
    env: { DISPLAY: ':0' },
    readFile: () => Promise.reject(new Error('ENOENT')),
    hostname: 'box',
    createSocket: server.createSocket,
    timeoutMs,
  })
  await tick()
  server.send(SETUP_SUCCESS)
  const result = await pendingConn
  if (!result.ok) throw new Error('handshake failed')
  return { server, conn: result.value }
}

afterEach(() => vi.useRealTimers())

describe('X11 display resolution', () => {
  const connect = (env: Record<string, string>, server: FakeServer) =>
    connectX11({
      env,
      readFile: () => Promise.reject(new Error('ENOENT')),
      hostname: 'box',
      createSocket: server.createSocket,
    })

  it('a missing DISPLAY fails with x11.noDisplay', async () => {
    const result = await connect({}, new FakeServer())
    expect(result).toEqual({ ok: false, error: { key: 'x11.noDisplay' } })
  })

  it('a malformed DISPLAY fails with x11.noDisplay', async () => {
    const result = await connect({ DISPLAY: 'nonsense' }, new FakeServer())
    expect(result).toEqual({ ok: false, error: { key: 'x11.noDisplay' } })
  })

  it(':n.s connects to the unix socket of display n', async () => {
    const server = new FakeServer()
    void connect({ DISPLAY: ':1.0' }, server)
    await tick()
    expect(server.target).toEqual({ path: '/tmp/.X11-unix/X1' })
  })

  it('host:n connects over TCP to 6000+n', async () => {
    const server = new FakeServer()
    void connect({ DISPLAY: 'gamebox:2' }, server)
    await tick()
    expect(server.target).toEqual({ host: 'gamebox', port: 6002 })
  })
})

describe('X11 handshake', () => {
  it('sends the cookie from XAUTHORITY and exposes the setup reply', async () => {
    const cookie = Buffer.alloc(16, 0xab)
    const record = Buffer.concat([
      hex('0100 0003'),
      Buffer.from('box'),
      hex('0001'),
      Buffer.from('0'),
      hex('0012'),
      Buffer.from('MIT-MAGIC-COOKIE-1'),
      hex('0010'),
      cookie,
    ])
    const server = new FakeServer()
    const pendingConn = connectX11({
      env: { DISPLAY: ':0', XAUTHORITY: '/home/u/xa' },
      readFile: async (p) => {
        expect(p).toBe('/home/u/xa')
        return record
      },
      hostname: 'box',
      createSocket: server.createSocket,
    })
    await tick()
    server.send(SETUP_SUCCESS)
    const result = await pendingConn
    expect(server.written[0].subarray(-16)).toEqual(cookie)
    expect(
      result.ok && [result.value.root, result.value.resourceIdBase, result.value.resourceIdMask],
    ).toEqual([0x539, 0x01200000, 0x001fffff])
  })

  it('sends no authorization when the Xauthority file is missing', async () => {
    const { server } = await connected()
    expect(server.written[0]).toEqual(hex('6c 00 0b 00 00 00 00 00 00 00 00 00'))
  })

  it('reports a refused setup with the server reason', async () => {
    const server = new FakeServer()
    const pendingConn = connectX11({
      env: { DISPLAY: ':0' },
      readFile: () => Promise.reject(new Error('ENOENT')),
      hostname: 'box',
      createSocket: server.createSocket,
    })
    await tick()
    server.send(SETUP_REFUSED)
    expect(await pendingConn).toEqual({
      ok: false,
      error: { key: 'x11.refused', params: { reason: 'no' } },
    })
  })

  it('fails when the server never answers the setup', async () => {
    vi.useFakeTimers()
    const server = new FakeServer()
    const pendingConn = connectX11({
      env: { DISPLAY: ':0' },
      readFile: () => Promise.reject(new Error('ENOENT')),
      hostname: 'box',
      createSocket: server.createSocket,
      timeoutMs: 500,
    })
    await vi.advanceTimersByTimeAsync(600)
    expect(await pendingConn).toEqual({ ok: false, error: { key: 'x11.timeout' } })
  })
})

describe('X11 requests', () => {
  it('matches replies to requests by sequence number, out of order and past events', async () => {
    const { server, conn } = await connected()
    const first = conn.request(Buffer.from('a'), true)
    const second = conn.request(Buffer.from('b'), true)
    server.send(eventPacket(1), reply(2, 0x22), reply(1, 0x11))
    const [a, b] = await Promise.all([first, second])
    expect(a.ok && a.value[8]).toBe(0x11)
    expect(b.ok && b.value[8]).toBe(0x22)
  })

  it('routes an X error to the request that caused it', async () => {
    const { server, conn } = await connected()
    const first = conn.request(Buffer.from('a'), true)
    const second = conn.request(Buffer.from('b'), true)
    server.send(errorPacket(1, 3), reply(2, 7))
    expect(await first).toEqual({
      ok: false,
      error: { key: 'x11.requestFailed', params: { code: 3 } },
    })
    expect((await second).ok).toBe(true)
  })

  it('resolves a request without a reply once written and drops its later error', async () => {
    const { server, conn } = await connected()
    const fire = await conn.request(Buffer.from('a'), false)
    expect(fire).toEqual({ ok: true, value: Buffer.alloc(0) })
    const next = conn.request(Buffer.from('b'), true)
    server.send(errorPacket(1, 8), reply(2, 5))
    expect((await next).ok).toBe(true)
  })

  it('reassembles a reply split across chunks and several packets in one chunk', async () => {
    const { server, conn } = await connected()
    const first = conn.request(Buffer.from('a'), true)
    const second = conn.request(Buffer.from('b'), true)
    const r1 = reply(1, 0x11)
    server.send(r1.subarray(0, 10))
    await tick()
    server.send(Buffer.concat([r1.subarray(10), reply(2, 0x22)]))
    const [a, b] = await Promise.all([first, second])
    expect([a.ok && a.value[8], b.ok && b.value[8]]).toEqual([0x11, 0x22])
  })

  it('keeps matching replies after the 16-bit sequence number wraps', async () => {
    const { server, conn } = await connected()
    for (let i = 1; i <= 65535; i++) await conn.request(Buffer.from('x'), false)
    const wrapped = conn.request(Buffer.from('y'), true) // sequence 65536 -> 0
    server.send(reply(0, 0x42))
    const result = await wrapped
    expect(result.ok && result.value[8]).toBe(0x42)
    const after = conn.request(Buffer.from('z'), true)
    server.send(reply(1, 0x43))
    const next = await after
    expect(next.ok && next.value[8]).toBe(0x43)
  })

  it('fails a request that gets no reply within the timeout', async () => {
    const { conn } = await connected(new FakeServer(), 300)
    vi.useFakeTimers()
    const slow = conn.request(Buffer.from('a'), true)
    await vi.advanceTimersByTimeAsync(400)
    expect(await slow).toEqual({ ok: false, error: { key: 'x11.timeout' } })
  })

  it('fails every pending request when the socket closes', async () => {
    const { server, conn } = await connected()
    const first = conn.request(Buffer.from('a'), true)
    const second = conn.request(Buffer.from('b'), true)
    server.socket.destroy()
    expect(await first).toEqual({ ok: false, error: { key: 'x11.connectionLost' } })
    expect((await second).ok).toBe(false)
    expect((await conn.request(Buffer.from('c'), true)).ok).toBe(false)
  })

  it('fails pending requests when closed by the caller', async () => {
    const { conn } = await connected()
    const pendingReq = conn.request(Buffer.from('a'), true)
    conn.close()
    expect(await pendingReq).toEqual({ ok: false, error: { key: 'x11.closed' } })
  })
})
