import { describe, expect, it } from 'vitest'
import { fail, isOutcome, ok, refuse } from './common'

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

describe('refusals', () => {
  it('refuse() builds a Refusal and omits absent params', () => {
    const bare = refuse('a.b.c')
    expect(bare).toEqual({ ok: false, reasonKey: 'a.b.c' })
    expect('params' in bare).toBe(false)
    expect(refuse('a.b.c', { n: 2 })).toEqual({ ok: false, reasonKey: 'a.b.c', params: { n: 2 } })
    expect(isOutcome(bare)).toBe(false)
  })
})
