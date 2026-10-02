// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }

const { getRawFiles } = await import('./client')

beforeEach(() => {
  invokeMock.mockReset()
})

describe('config client', () => {
  it('a handler ok arrives as the function’s value', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: { canonical: null, installations: [] } })

    const result = await getRawFiles({ profileId: 'p1' } as never)

    expect(result).toEqual({ ok: true, value: { canonical: null, installations: [] } })
  })

  it('a handler fail arrives as the function’s fail', async () => {
    invokeMock.mockResolvedValue({ ok: false, error: { key: 'config.error.profileNotFound' } })

    const result = await getRawFiles({ profileId: 'p1' } as never)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.key).toBe('config.error.profileNotFound')
  })
})
