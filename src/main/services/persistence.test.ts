import { describe, expect, it } from 'vitest'
import { PersistenceRegistry } from './persistence'

describe('PersistenceRegistry', () => {
  it('settleAll settles every registered store and reports each failure', async () => {
    const registry = new PersistenceRegistry()
    registry.register('a', { settle: async () => ({ ok: true }) })
    registry.register('b', { settle: async () => ({ ok: false }) })

    expect(await registry.settleAll()).toEqual([
      { label: 'a', ok: true },
      { label: 'b', ok: false },
    ])
  })

  it('a rejecting store does not stop the others', async () => {
    const registry = new PersistenceRegistry()
    registry.register('bad', { settle: () => Promise.reject(new Error('boom')) })
    registry.register('good', { settle: async () => ({ ok: true }) })

    expect(await registry.settleAll()).toEqual([
      { label: 'bad', ok: false },
      { label: 'good', ok: true },
    ])
  })
})
