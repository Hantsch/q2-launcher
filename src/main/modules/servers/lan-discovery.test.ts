import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SAMPLE_INFO_REPLY } from '@shared/servers/reply-fixtures'
import {
  discoverLanServers,
  LAN_ERROR_NO_INTERFACE,
  LAN_ERROR_SOCKET_REFUSED,
  type LanReply,
  type LanUdpHandlers,
  type LanUdpImpl,
} from './lan-discovery'
import type { Clock } from './server-query'

/** Story 196 D1 - fake interfaces + fake udp + a fake clock; no network is touched. */

function iface(
  address: string,
  netmask: string,
  extra: Partial<NetworkInterfaceInfo> = {},
): NetworkInterfaceInfo {
  return {
    address,
    netmask,
    family: 'IPv4',
    internal: false,
    mac: '',
    cidr: null,
    ...extra,
  } as NetworkInterfaceInfo
}

function fakeClock(): { clock: Clock; advance: (ms: number) => Promise<void> } {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; cb: () => void }>()
  const clock: Clock = {
    setTimeout: (cb, ms) => {
      const id = nextId++
      timers.set(id, { at: now + ms, cb })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (h) => void timers.delete(h as unknown as number),
    now: () => now,
  }
  const advance = async (ms: number): Promise<void> => {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (due === undefined) break
      timers.delete(due[0])
      now = due[1].at
      due[1].cb()
      await Promise.resolve()
    }
    now = target
    await Promise.resolve()
  }
  return { clock, advance }
}

interface FakeNet {
  impl: LanUdpImpl
  binds: string[]
  sends: { from: string; host: string; port: number }[]
  closed: string[]
  handlers: Map<string, LanUdpHandlers>
}

function fakeNet(opts: { bindFails?: string[]; sendFails?: string[] } = {}): FakeNet {
  const net: FakeNet = {
    binds: [],
    sends: [],
    closed: [],
    handlers: new Map(),
    impl: async () => {
      throw new Error('unset')
    },
  }
  net.impl = async (bindAddress, handlers) => {
    if (opts.bindFails?.includes(bindAddress)) throw new Error('bind refused')
    net.binds.push(bindAddress)
    net.handlers.set(bindAddress, handlers)
    return {
      send: async (_datagram, host, port) => {
        if (opts.sendFails?.includes(bindAddress)) throw new Error('send refused')
        net.sends.push({ from: bindAddress, host, port })
      },
      close: () => void net.closed.push(bindAddress),
    }
  }
  return net
}

const ETH = { eth0: [iface('192.168.1.10', '255.255.255.0')] }
const SETTINGS = { timeoutMs: 100, retries: 2 }

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('discoverLanServers', () => {
  it('a server answering twice or on two interfaces is reported once', async () => {
    const net = fakeNet()
    const { clock, advance } = fakeClock()
    const replies: LanReply[] = []
    const run = discoverLanServers({
      settings: SETTINGS,
      onReply: (r) => replies.push(r),
      deps: {
        networkInterfaces: () => ({
          a: [iface('192.168.1.10', '255.255.255.0')],
          b: [iface('10.0.0.5', '255.0.0.0')],
        }),
        udpImpl: net.impl,
        clock,
      },
    })
    await settle()
    const from = { address: '192.168.1.77', port: 27910 }
    net.handlers.get('192.168.1.10')!.onMessage(SAMPLE_INFO_REPLY, from)
    net.handlers.get('192.168.1.10')!.onMessage(SAMPLE_INFO_REPLY, from)
    net.handlers.get('10.0.0.5')!.onMessage(SAMPLE_INFO_REPLY, from)
    net.handlers
      .get('10.0.0.5')!
      .onMessage(SAMPLE_INFO_REPLY, { address: '192.168.1.77', port: 27911 })
    await advance(300)
    await run
    expect(replies.map((r) => r.address)).toEqual(['192.168.1.77:27910', '192.168.1.77:27911'])
  })

  it('no usable interface reports noInterface', async () => {
    const net = fakeNet()
    const result = await discoverLanServers({
      settings: SETTINGS,
      onReply: () => undefined,
      deps: {
        networkInterfaces: () => ({
          lo: [iface('127.0.0.1', '255.0.0.0', { internal: true })],
          v6: [{ ...iface('fe80::1', 'ffff:ffff:ffff:ffff::'), family: 'IPv6' } as NetworkInterfaceInfo],
        }),
        udpImpl: net.impl,
      },
    })
    expect(result).toEqual({ failureKey: LAN_ERROR_NO_INTERFACE })
    expect(net.binds).toEqual([])
    const none = await discoverLanServers({
      settings: SETTINGS,
      onReply: () => undefined,
      deps: { targetsOverride: 'none', udpImpl: net.impl },
    })
    expect(none).toEqual({ failureKey: LAN_ERROR_NO_INTERFACE })
  })

  it('every socket refused reports socketRefused', async () => {
    const bindFail = fakeNet({ bindFails: ['192.168.1.10'] })
    const a = await discoverLanServers({
      settings: SETTINGS,
      onReply: () => undefined,
      deps: { networkInterfaces: () => ETH, udpImpl: bindFail.impl },
    })
    expect(a).toEqual({ failureKey: LAN_ERROR_SOCKET_REFUSED })

    const sendFail = fakeNet({ sendFails: ['192.168.1.10'] })
    const { clock, advance } = fakeClock()
    const run = discoverLanServers({
      settings: SETTINGS,
      onReply: () => undefined,
      deps: { networkInterfaces: () => ETH, udpImpl: sendFail.impl, clock },
    })
    await settle()
    await advance(300)
    expect(await run).toEqual({ failureKey: LAN_ERROR_SOCKET_REFUSED })
    expect(sendFail.closed).toEqual(['192.168.1.10'])
  })

  it('broadcasts to each interface directed broadcast address on port 27910, retries+1 times', async () => {
    const net = fakeNet()
    const { clock, advance } = fakeClock()
    const run = discoverLanServers({
      settings: SETTINGS,
      onReply: () => undefined,
      deps: {
        networkInterfaces: () => ({
          a: [iface('192.168.1.10', '255.255.255.0')],
          b: [iface('10.1.2.3', '255.255.0.0')],
        }),
        udpImpl: net.impl,
        clock,
      },
    })
    await settle()
    await advance(100)
    await advance(100)
    expect(net.sends.filter((s) => s.from === '192.168.1.10')).toEqual(
      Array(3).fill({ from: '192.168.1.10', host: '192.168.1.255', port: 27910 }),
    )
    expect(net.sends.filter((s) => s.from === '10.1.2.3').map((s) => s.host)).toEqual(
      Array(3).fill('10.1.255.255'),
    )
    expect(net.closed).toEqual([])
    await advance(100)
    expect(await run).toEqual({ failureKey: null })
    expect([...net.closed].sort()).toEqual(['10.1.2.3', '192.168.1.10'])
  })

  it('one failing interface does not stop the others and the run still succeeds', async () => {
    const net = fakeNet({ bindFails: ['10.0.0.5'] })
    const { clock, advance } = fakeClock()
    const run = discoverLanServers({
      settings: { timeoutMs: 50, retries: 0 },
      onReply: () => undefined,
      deps: {
        networkInterfaces: () => ({
          a: [iface('192.168.1.10', '255.255.255.0')],
          b: [iface('10.0.0.5', '255.0.0.0')],
        }),
        udpImpl: net.impl,
        clock,
      },
    })
    await settle()
    await advance(50)
    expect(await run).toEqual({ failureKey: null })
    expect(net.sends).toHaveLength(1)
  })

  it('abort closes every socket and resolves early', async () => {
    const net = fakeNet()
    const { clock } = fakeClock()
    const controller = new AbortController()
    const run = discoverLanServers({
      settings: SETTINGS,
      signal: controller.signal,
      onReply: () => undefined,
      deps: { networkInterfaces: () => ETH, udpImpl: net.impl, clock },
    })
    await settle()
    controller.abort()
    expect(await run).toEqual({ failureKey: null })
    expect(net.closed).toEqual(['192.168.1.10'])
  })

  it('a target override sends unicast from one loopback socket and dedupes', async () => {
    const net = fakeNet()
    const { clock, advance } = fakeClock()
    const replies: LanReply[] = []
    const run = discoverLanServers({
      settings: { timeoutMs: 50, retries: 0 },
      onReply: (r) => replies.push(r),
      deps: { targetsOverride: ['127.0.0.1:40001', '127.0.0.1:40002'], udpImpl: net.impl, clock },
    })
    await settle()
    expect(net.binds).toEqual(['127.0.0.1'])
    expect(net.sends.map((s) => `${s.host}:${s.port}`)).toEqual([
      '127.0.0.1:40001',
      '127.0.0.1:40002',
    ])
    const h = net.handlers.get('127.0.0.1')!
    h.onMessage(SAMPLE_INFO_REPLY, { address: '127.0.0.1', port: 40001 })
    h.onMessage(SAMPLE_INFO_REPLY, { address: '127.0.0.1', port: 40001 })
    await advance(50)
    await run
    expect(replies.map((r) => r.address)).toEqual(['127.0.0.1:40001'])
  })
})
