import { describe, expect, it } from 'vitest'
import {
  MASTER_REPLY_HEADER,
  assembleMasterAddresses,
  masterSourceFailureKey,
  readPackedRecords,
  unpackMasterReply,
  type MasterSourceFailure,
} from './master-records'
import type { ParsedServerAddress } from './address'
// A static import, not a runtime `fs.readFile`: `src/shared` may never import `node:*`
// (docs/ARCHITECTURE.md), even in a test, since this file type-checks under `tsconfig.web.json`
// too (which carries no node types at all). See `src/shared/servers/address.test.ts` for the same
// pattern.
import en from '../../renderer/src/i18n/locales/en.json'

function record(a: number, b: number, c: number, d: number, port: number): number[] {
  return [a, b, c, d, (port >> 8) & 0xff, port & 0xff]
}

function payloadWithRecords(...records: number[][]): Uint8Array {
  return new Uint8Array([...MASTER_REPLY_HEADER, ...records.flat()])
}

describe('unpackMasterReply', () => {
  it('unpacks a master reply into packed IPv4 and big-endian port records', () => {
    const bytes = payloadWithRecords(
      record(10, 0, 0, 1, 27910),
      record(192, 168, 1, 42, 27911),
      record(1, 2, 3, 4, 0x1234),
    )

    const result = unpackMasterReply(bytes)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skipped).toEqual([])
    expect(result.addresses.map((a) => a.normalized)).toEqual([
      '10.0.0.1:27910',
      '192.168.1.42:27911',
      '1.2.3.4:4660',
    ])
    expect(result.addresses[2]?.port).toBe(0x1234)
  })

  it('a record with port 0 lands in skipped, not in addresses', () => {
    const bytes = payloadWithRecords(record(10, 0, 0, 1, 27910), record(10, 0, 0, 2, 0))

    const result = unpackMasterReply(bytes)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.addresses.map((a) => a.normalized)).toEqual(['10.0.0.1:27910'])
    expect(result.skipped).toEqual([{ value: '10.0.0.2:0', reason: 'zero-port' }])
  })

  describe('a malformed or truncated payload is an explicit failure, never a partial address', () => {
    it('shorter than the header is too-short', () => {
      const bytes = MASTER_REPLY_HEADER.slice(0, MASTER_REPLY_HEADER.length - 1)
      const result = unpackMasterReply(bytes)
      expect(result).toEqual({ ok: false, reason: 'too-short' })
    })

    it('wrong header is bad-header', () => {
      const bytes = new Uint8Array(MASTER_REPLY_HEADER.length + RECORD_LENGTH_FOR_TEST)
      bytes.set([0xff, 0xff, 0xff, 0xff, 0x71, 0x75, 0x65, 0x72], 0) // "\xFF\xFF\xFF\xFFquer" wrong text
      const result = unpackMasterReply(bytes)
      expect(result).toEqual({ ok: false, reason: 'bad-header' })
    })

    it('empty body is empty-body', () => {
      const bytes = new Uint8Array([...MASTER_REPLY_HEADER])
      const result = unpackMasterReply(bytes)
      expect(result).toEqual({ ok: false, reason: 'empty-body' })
    })

    it('cut mid-record is truncated', () => {
      const bytes = new Uint8Array([...MASTER_REPLY_HEADER, ...record(10, 0, 0, 1, 27910), 1, 2, 3])
      const result = unpackMasterReply(bytes)
      expect(result).toEqual({ ok: false, reason: 'truncated' })
    })

    it('none of these produce a partial address list', () => {
      const shortest = unpackMasterReply(MASTER_REPLY_HEADER.slice(0, 2))
      expect(shortest).not.toHaveProperty('addresses')
    })
  })
})

const RECORD_LENGTH_FOR_TEST = 6

describe('readPackedRecords', () => {
  it('returns truncated when the remainder is not a multiple of 6 bytes', () => {
    const bytes = new Uint8Array([...record(10, 0, 0, 1, 1), 1, 2, 3])
    const result = readPackedRecords(bytes, 0)
    expect(result).toEqual({ ok: false, reason: 'truncated' })
  })

  it('reads zero records from an empty remainder', () => {
    const bytes = new Uint8Array(0)
    const result = readPackedRecords(bytes, 0)
    expect(result).toEqual({ ok: true, addresses: [], skipped: [] })
  })
})

describe('assembleMasterAddresses', () => {
  it('assembles several datagrams into one address set without duplicates', () => {
    const first = unpackMasterReply(
      payloadWithRecords(record(10, 0, 0, 1, 27910), record(10, 0, 0, 2, 27910)),
    )
    const second = unpackMasterReply(
      payloadWithRecords(record(10, 0, 0, 2, 27910), record(10, 0, 0, 3, 27910)),
    )

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const combined = assembleMasterAddresses([first.addresses, second.addresses])

    expect(combined.map((a) => a.normalized)).toEqual([
      '10.0.0.1:27910',
      '10.0.0.2:27910',
      '10.0.0.3:27910',
    ])
  })

  it('keeps first-seen order and dedupes across more than two payloads', () => {
    const a: ParsedServerAddress[] = [
      { host: '10.0.0.1', port: 1, kind: 'ipv4', normalized: '10.0.0.1:1' },
    ]
    const b: ParsedServerAddress[] = [
      { host: '10.0.0.2', port: 2, kind: 'ipv4', normalized: '10.0.0.2:2' },
      { host: '10.0.0.1', port: 1, kind: 'ipv4', normalized: '10.0.0.1:1' },
    ]
    const c: ParsedServerAddress[] = [
      { host: '10.0.0.3', port: 3, kind: 'ipv4', normalized: '10.0.0.3:3' },
    ]

    const combined = assembleMasterAddresses([a, b, c])

    expect(combined.map((x) => x.normalized)).toEqual([
      '10.0.0.1:1',
      '10.0.0.2:2',
      '10.0.0.3:3',
    ])
  })
})

describe('masterSourceFailureKey', () => {
  const ALL_REASONS: MasterSourceFailure[] = [
    'too-short',
    'bad-header',
    'truncated',
    'empty-body',
    'no-reply',
    'transport-error',
    'http-status',
  ]

  function stringAt(path: string): string | undefined {
    const value: unknown = path
      .split('.')
      .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' && key in acc ? (acc as Record<string, unknown>)[key] : undefined), en)
    return typeof value === 'string' ? value : undefined
  }

  it.each(ALL_REASONS)('%s resolves to servers.source.error.%s, present in en.json', (reason) => {
    const key = masterSourceFailureKey(reason)
    expect(key).toBe(`servers.source.error.${reason}`)

    const message = stringAt(key)
    expect(typeof message).toBe('string')
    expect(message?.length).toBeGreaterThan(0)
  })
})

// Structural rule, checked statically rather than at runtime: master-records.ts imports only from
// './address' (a sibling pure shared module). It must never import from 'node:*', 'electron', or
// the IPC layer — this file type-checks under both tsconfig.node.json and tsconfig.web.json (the
// latter carries no Node types at all), which would fail to compile if that rule were broken.
