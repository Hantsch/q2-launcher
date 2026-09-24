import { describe, expect, it } from 'vitest'

import { parseHttpListBinary, parseHttpListText } from './http-list'

/** Packs one `host:port` IPv4 address into the 6-byte record shape both the UDP master reply and
 * the `?raw=2` HTTP list share: 4 octets + 2-byte big-endian port. Test-local — the shared reader
 * itself lives in `./master-records` (D1) and is not reimplemented here. */
function packRecord(a: number, b: number, c: number, d: number, port: number): number[] {
  return [a, b, c, d, port >> 8, port & 0xff]
}

function packRecords(records: number[][]): Uint8Array {
  return new Uint8Array(records.flat())
}

describe('parseHttpListText', () => {
  it('parses the raw=1 text list into addresses', () => {
    const text = [
      '10.0.0.1:27910',
      '10.0.0.2:27911\r',
      '',
      '# a comment line',
      'quake.example.com:27912',
      '',
    ].join('\n')

    const result = parseHttpListText(text)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.addresses.map((a) => a.normalized)).toEqual([
      '10.0.0.1:27910',
      '10.0.0.2:27911',
      'quake.example.com:27912',
    ])
    expect(result.skipped).toEqual([])
  })

  it('an empty text body is empty-body', () => {
    expect(parseHttpListText('')).toEqual({ ok: false, reason: 'empty-body' })
    expect(parseHttpListText('\n\n   \n')).toEqual({ ok: false, reason: 'empty-body' })
    expect(parseHttpListText('# only a comment\n')).toEqual({ ok: false, reason: 'empty-body' })
  })

  it('a rejected line is skipped with its reason and the list still parses', () => {
    const text = ['10.0.0.1:27910', 'not-an-address', '256.0.0.1:27910', '10.0.0.2:27911'].join(
      '\n',
    )

    const result = parseHttpListText(text)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.addresses.map((a) => a.normalized)).toEqual(['10.0.0.1:27910', '10.0.0.2:27911'])
    expect(result.skipped).toEqual([
      { value: 'not-an-address', reason: 'missing-port' },
      { value: '256.0.0.1:27910', reason: 'ipv4-octet-out-of-range' },
    ])
  })
})

describe('parseHttpListBinary', () => {
  it('parses the raw=2 binary list into the same addresses as the equivalent UDP payload', () => {
    const bytes = packRecords([
      packRecord(10, 0, 0, 1, 27910),
      packRecord(10, 0, 0, 2, 27911),
      packRecord(192, 168, 1, 1, 27912),
    ])

    const result = parseHttpListBinary(bytes)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.addresses.map((a) => a.normalized)).toEqual([
      '10.0.0.1:27910',
      '10.0.0.2:27911',
      '192.168.1.1:27912',
    ])
    expect(result.skipped).toEqual([])
  })

  it('an empty binary body is empty-body', () => {
    expect(parseHttpListBinary(new Uint8Array())).toEqual({ ok: false, reason: 'empty-body' })
  })

  it('a binary body whose length is not a multiple of 6 is truncated', () => {
    const bytes = packRecords([packRecord(10, 0, 0, 1, 27910)]).slice(0, 5)

    expect(parseHttpListBinary(bytes)).toEqual({ ok: false, reason: 'truncated' })
  })
})
