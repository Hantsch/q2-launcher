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

  it('a module\'s handlers are not reachable under another module\'s id', async () => {
    const registry = new MainModuleRegistry()
    const libraryHandler = vi.fn().mockResolvedValue({ from: 'library' })
    const libraryMod: MainModule = {
      id: 'library',
      setup: ({ handle }) => {
        handle('stats', z.object({}), libraryHandler)
      },
    }
    const homeMod: MainModule = {
      id: 'home',
      setup: () => {
        // deliberately registers nothing under 'stats' - proves the type
        // alone does not make 'library'/'stats' reachable as 'home'/'stats'
      },
    }

    await registry.register(libraryMod, fakeAppContext())
    await registry.register(homeMod, fakeAppContext())

    // Same handler `type` ('stats'), but requested under the *other*
    // module's id - the registry keys handlers by `${moduleId}/${type}`, so
    // this must miss even though 'library'/'stats' exists.
    const result = await registry.invoke({ moduleId: 'home', type: 'stats', payload: {} })

    expect(result).toEqual({
      ok: false,
      error: { key: 'modules.error.notImplemented', params: { moduleId: 'home', type: 'stats' } },
    })
    expect(libraryHandler).not.toHaveBeenCalled()
  })
})
