// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }

const { startRepair } = await import('./client')

beforeEach(() => {
  invokeMock.mockReset()
})

describe('downloads client', () => {
  it('a handler ok arrives as the function’s value', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: { jobId: 'j1' } })

    const result = await startRepair({ installationId: 'i1', offers: [] } as never)

    expect(result).toEqual({ ok: true, value: { jobId: 'j1' } })
  })

  it('a handler fail arrives as the function’s fail', async () => {
    invokeMock.mockResolvedValue({ ok: false, error: { key: 'downloads.error.noInstallation' } })

    const result = await startRepair({ installationId: 'i1', offers: [] } as never)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.key).toBe('downloads.error.noInstallation')
  })
})
