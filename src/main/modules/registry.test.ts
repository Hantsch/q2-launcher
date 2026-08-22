import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../context'
import { MainModuleRegistry } from './registry'
import type { MainModule } from './types'

/**
 * Story 036 D8: `MainModuleRegistry.invoke()` validates against the schema a
 * module registered its handler with, once, before the handler is entered -
 * a bad payload becomes a failed `Outcome` (matching the shell's
 * `handleOutcome`) rather than a call into the handler at all, and a good
 * payload reaches the handler and comes back wrapped in `ok(...)`.
 */

function fakeAppContext(): AppContext {
  return {} as unknown as AppContext
}

describe('MainModuleRegistry', () => {
  it('rejects an invalid payload without ever calling the handler', async () => {
    const registry = new MainModuleRegistry()
    const handler = vi.fn()
    const module: MainModule = {
      id: 'library',
      setup: ({ handle }) => {
        handle('stats', z.object({ x: z.string() }), handler)
      },
    }

    await registry.register(module, fakeAppContext())
    const result = await registry.invoke({ moduleId: 'library', type: 'stats', payload: { x: 123 } })

    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('reaches the handler with a valid payload and wraps its return value in ok()', async () => {
    const registry = new MainModuleRegistry()
    const handler = vi.fn().mockResolvedValue({ answer: 42 })
    const module: MainModule = {
      id: 'library',
      setup: ({ handle }) => {
        handle('stats', z.object({ x: z.string() }), handler)
      },
    }

    await registry.register(module, fakeAppContext())
    const result = await registry.invoke({ moduleId: 'library', type: 'stats', payload: { x: 'hello' } })

    expect(handler).toHaveBeenCalledWith({ x: 'hello' })
    expect(result).toEqual({ ok: true, value: { answer: 42 } })
  })
})
