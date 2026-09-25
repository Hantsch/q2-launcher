import { describe, expect, it } from 'vitest'
import { deriveEngine, deriveProtocol } from './server-engine'

describe('deriveProtocol/deriveEngine', () => {
  it("maps protocol 34/35/36 to its engine and anything else to unknown", () => {
    expect(deriveEngine(deriveProtocol({ protocol: '34' }))).toBe('vanilla')
    expect(deriveEngine(deriveProtocol({ protocol: '35' }))).toBe('r1q2')
    expect(deriveEngine(deriveProtocol({ protocol: '36' }))).toBe('q2pro')

    expect(deriveProtocol({ protocol: '37' })).toBe(37)
    expect(deriveEngine(deriveProtocol({ protocol: '37' }))).toBeUndefined()

    expect(deriveProtocol({ protocol: 'abc' })).toBeUndefined()
    expect(deriveEngine(deriveProtocol({ protocol: 'abc' }))).toBeUndefined()

    expect(deriveProtocol({ mapname: 'q2dm1' })).toBeUndefined()
    expect(deriveEngine(deriveProtocol({ mapname: 'q2dm1' }))).toBeUndefined()

    expect(deriveProtocol(null)).toBeUndefined()
    expect(deriveEngine(deriveProtocol(null))).toBeUndefined()
  })
})
