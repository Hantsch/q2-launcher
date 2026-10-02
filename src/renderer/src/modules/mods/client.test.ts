// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }

const { listMods } = await import('./client')

beforeEach(() => {
  invokeMock.mockReset()
})

describe('mods client', () => {
  it('a handler ok arrives as the function’s value', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: { mods: [] } })

    const result = await listMods('i1')

    expect(result).toEqual({ ok: true, value: { mods: [] } })
  })

  it('a handler fail arrives as the function’s fail', async () => {
    invokeMock.mockResolvedValue({ ok: false, error: { key: 'mods.error.noInstallation' } })

    const result = await listMods('i1')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.key).toBe('mods.error.noInstallation')
  })
})
