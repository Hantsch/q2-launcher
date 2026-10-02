import { describe, expect, it } from 'vitest'
import { fail, isOutcome, ok } from './common'

describe('isOutcome', () => {
  it('isOutcome accepts envelopes and rejects domain unions', () => {
    expect(isOutcome(ok(1))).toBe(true)
    expect(isOutcome(ok(undefined))).toBe(true)
    expect(isOutcome(fail('a.b'))).toBe(true)
    expect(isOutcome({ ok: false, error: { key: 'x', params: { a: 1 } } })).toBe(true)

    expect(isOutcome({ ok: true })).toBe(false)
    expect(isOutcome({ ok: true, list: [] })).toBe(false)
    expect(isOutcome({ ok: false })).toBe(false)
    expect(isOutcome({ ok: false, error: 'boom' })).toBe(false)
    expect(isOutcome({ ok: false, error: { key: 3 } })).toBe(false)
    expect(isOutcome(null)).toBe(false)
    expect(isOutcome(undefined)).toBe(false)
    expect(isOutcome('ok')).toBe(false)
    expect(isOutcome({ answer: 42 })).toBe(false)
  })
})
