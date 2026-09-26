import { describe, expect, it } from 'vitest'
import { DMFLAG_BITS, decodeDmflags } from './dmflags'

describe('decodeDmflags', () => {
  it('decodes each vanilla bit to its rule', () => {
    DMFLAG_BITS.forEach((id, bit) => {
      const value = 1 << bit
      const decoded = decodeDmflags(String(value))
      expect(decoded).toEqual({ ok: true, value, rules: [id], unknownBits: [] })
    })
  })

  it('lists set bits above the vanilla table as unknown', () => {
    const decoded = decodeDmflags('16711680') // 0xFF0000, bits 16-23 set
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) throw new Error('unreachable')
    expect(decoded.rules).toEqual([])
    expect(decoded.unknownBits).toEqual([16, 17, 18, 19, 20, 21, 22, 23])
  })

  it('zero decodes to no rules', () => {
    expect(decodeDmflags('0')).toEqual({ ok: true, value: 0, rules: [], unknownBits: [] })
  })

  it('rejects a non-integer value without throwing', () => {
    for (const raw of ['abc', '-1', '1.5', '']) {
      expect(() => decodeDmflags(raw)).not.toThrow()
      expect(decodeDmflags(raw)).toEqual({ ok: false, raw })
    }
  })
})
