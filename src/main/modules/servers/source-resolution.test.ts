import { describe, expect, it, vi } from 'vitest'
import type { MasterSource } from '@shared/modules/servers'
import { MASTER_REPLY_HEADER, masterSourceFailureKey } from '@shared/servers/master-records'
import type { FetchImpl } from '../downloads/fetcher'
import { resolveSources, type ResolveSourcesDeps } from './source-resolution'
import type { MasterUdpImpl } from './udp-master-source'

/**
 * Story 114 D4 (AC3): each source is resolved independently, so one source's failure - whether
 * returned or thrown - never costs the scan another source's addresses, and a disabled source is
 * never queried at all.
 */

function record(a: number, b: number, c: number, d: number, port: number): number[] {
  return [a, b, c, d, (port >> 8) & 0xff, port & 0xff]
}

/** A well-formed master reply datagram carrying one record, mirroring udp-master-source.test.ts. */
function reply(...records: number[][]): Uint8Array {
  return new Uint8Array([...MASTER_REPLY_HEADER, ...records.flat()])
}

/** A `MasterUdpImpl` that hands the collector one reply datagram (if given) and otherwise stays
 * silent, so `resolveUdpMasterSource` settles quickly on the short timings the tests inject. */
function udpStub(datagram: Uint8Array | null): MasterUdpImpl {
  return async (_target, handlers) => {
    if (datagram !== null) handlers.onMessage(datagram)
    return { send: () => {}, close: () => {} }
  }
}

const FAST_UDP_TIMING = { quietPeriodMs: 5, firstReplyTimeoutMs: 30 }

function baseDeps(overrides: Partial<ResolveSourcesDeps> = {}): ResolveSourcesDeps {
  return {
    fetchImpl: vi.fn(async () => {
      throw new Error('fetchImpl should not have been called in this test')
    }) as unknown as FetchImpl,
    udpImpl: vi.fn(async () => {
      throw new Error('udpImpl should not have been called in this test')
    }) as unknown as MasterUdpImpl,
    ...FAST_UDP_TIMING,
    ...overrides,
  }
}

const udpOkSource: MasterSource = {
  id: 'udp-ok',
  type: 'udp-master',
  address: '10.0.0.1:27900',
  enabled: true,
}

describe('resolveSources', () => {
  it('isolates a source that returns a failure result, keeping the other source addresses (AC3)', async () => {
    const httpFailSource: MasterSource = {
      id: 'http-fail',
      type: 'http-list',
      address: 'http://example.test/list?raw=1',
      enabled: true,
    }

    const fetchImpl: FetchImpl = async () =>
      ({ ok: false, status: 500 }) as unknown as Response

    const result = await resolveSources(
      [udpOkSource, httpFailSource],
      baseDeps({
        udpImpl: udpStub(reply(record(1, 2, 3, 4, 27910))),
        fetchImpl,
      }),
    )

    expect(result.addresses).toHaveLength(1)
    expect(result.addresses[0]?.normalized).toBe('1.2.3.4:27910')
    expect(result.failures).toEqual([
      { sourceId: 'http-fail', reasonKey: masterSourceFailureKey('http-status') },
    ])
  })

  it('isolates a source whose resolve call throws (unhandled rejection), keeping the other source addresses (AC3)', async () => {
    const httpThrowSource: MasterSource = {
      id: 'http-throw',
      type: 'http-list',
      address: 'http://example.test/throw?raw=1',
      enabled: true,
    }

    // A response that reports success but whose body read rejects - `resolveHttpListSource` only
    // wraps the `fetch` call itself in try/catch (see its file doc comment), so this is a genuine
    // unhandled rejection escaping that function, not a value it returns.
    const fetchImpl: FetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error('body read failed')
        },
        arrayBuffer: async () => {
          throw new Error('body read failed')
        },
      }) as unknown as Response

    const result = await resolveSources(
      [udpOkSource, httpThrowSource],
      baseDeps({
        udpImpl: udpStub(reply(record(5, 6, 7, 8, 27920))),
        fetchImpl,
      }),
    )

    expect(result.addresses).toHaveLength(1)
    expect(result.addresses[0]?.normalized).toBe('5.6.7.8:27920')
    expect(result.failures).toEqual([
      { sourceId: 'http-throw', reasonKey: masterSourceFailureKey('transport-error') },
    ])
  })

  it('skips a disabled source entirely: no resolve call and no failure entry', async () => {
    const disabledUdp: MasterSource = {
      id: 'disabled-udp',
      type: 'udp-master',
      address: '10.0.0.9:27900',
      enabled: false,
    }
    const disabledHttp: MasterSource = {
      id: 'disabled-http',
      type: 'http-list',
      address: 'http://example.test/list?raw=1',
      enabled: false,
    }

    const deps = baseDeps()
    const result = await resolveSources([disabledUdp, disabledHttp, udpOkSource], {
      ...deps,
      udpImpl: udpStub(reply(record(9, 9, 9, 9, 27930))),
    })

    expect(deps.fetchImpl).not.toHaveBeenCalled()
    expect(result.addresses).toHaveLength(1)
    expect(result.addresses[0]?.normalized).toBe('9.9.9.9:27930')
    expect(result.failures).toEqual([])
  })
})
