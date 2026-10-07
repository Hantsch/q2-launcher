import { describe, expect, it, vi } from 'vitest'
import { mockClient } from './mock-client'

const fakeClient = {
  load: async () => 'real-load',
  save: async () => 'real-save',
  LIMIT: 7,
}

describe('mockClient', () => {
  it('mockClient stubs every export and applies overrides', async () => {
    const override = vi.fn(async () => 'mocked-save')
    const mocked = await mockClient(async () => fakeClient, { save: override })

    expect(vi.isMockFunction(mocked.load)).toBe(true)
    expect(await mocked.load()).toBeUndefined()
    expect(mocked.save).toBe(override)
    expect(mocked.LIMIT).toBe(7)

    // An override key that is not an export of the module is a type error.
    // @ts-expect-error renamed or removed exports must fail typecheck
    await mockClient(async () => fakeClient, { renamed: vi.fn() })
  })
})

describe('mockClient bridge stub', () => {
  it('mockClient loads a client module that needs the preload bridge', async () => {
    const needsBridge = async () => {
      const w = (globalThis as { window?: { q2?: unknown } }).window
      if (!w?.q2) throw new Error('The preload bridge is not available.')
      return { call: () => 'real' }
    }
    const before = (globalThis as { window?: { q2?: unknown } }).window?.q2
    const mocked = await mockClient(needsBridge)

    expect(vi.isMockFunction(mocked.call)).toBe(true)
    expect((globalThis as { window?: { q2?: unknown } }).window?.q2).toBe(before)
  })
})
