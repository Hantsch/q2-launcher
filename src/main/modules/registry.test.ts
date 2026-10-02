import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { fakeAppContext } from '../../test-support/app-context'
import { createFeatureGate } from '../features/gate'
import { fail, ok, type Outcome } from '@shared/types'
import { MainModuleRegistry } from './registry'
import type { MainModule } from './types'

/**
 * Story 036 D8: `MainModuleRegistry.invoke()` validates against the schema a
 * module registered its handler with, once, before the handler is entered -
 * a bad payload becomes a failed `Outcome` (matching the shell's
 * `handleOutcome`) rather than a call into the handler at all, and a good
 * payload reaches the handler and comes back wrapped in `ok(...)`.
 */

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
    const result = await registry.invoke({
      moduleId: 'library',
      type: 'stats',
      payload: { x: 123 },
    })

    expect(result).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('reaches the handler with a valid payload and answers with its outcome', async () => {
    const registry = new MainModuleRegistry()
    const handler = vi.fn().mockResolvedValue(ok({ answer: 42 }))
    const module: MainModule = {
      id: 'library',
      setup: ({ handle }) => {
        handle('stats', z.object({ x: z.string() }), handler)
      },
    }

    await registry.register(module, fakeAppContext())
    const result = await registry.invoke({
      moduleId: 'library',
      type: 'stats',
      payload: { x: 'hello' },
    })

    expect(handler).toHaveBeenCalledWith({ x: 'hello' })
    expect(result).toEqual({ ok: true, value: { answer: 42 } })
  })

  it("handlerTypes lists a module's registered types only", async () => {
    const registry = new MainModuleRegistry()
    const schema = z.undefined()
    await registry.register(
      {
        id: 'library',
        setup: ({ handle }) => {
          handle('stats', schema, () => ok(1))
          handle('a.first', schema, () => ok(1))
        },
      },
      fakeAppContext(),
    )
    await registry.register(
      { id: 'home', setup: ({ handle }) => handle('other', schema, () => ok(1)) },
      fakeAppContext(),
    )

    expect(registry.handlerTypes('library')).toEqual(['a.first', 'stats'])
    expect(registry.handlerTypes('home')).toEqual(['other'])
    expect(registry.handlerTypes('mods')).toEqual([])
  })

  it("a module's handlers are not reachable under another module's id", async () => {
    const registry = new MainModuleRegistry()
    const libraryHandler = vi.fn().mockResolvedValue(ok({ from: 'library' }))
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

/**
 * Story 130 D1: a handler registered with `{ feature }` exists only when that feature is
 * unlocked; while it is locked, `invoke()` answers exactly as for a type that was never
 * registered, and gating one handler leaves its ungated siblings alone.
 */
describe('MainModuleRegistry feature gating', () => {
  function gatedModule(watch: () => Outcome<unknown>, stats: () => Outcome<unknown>): MainModule {
    return {
      id: 'library',
      setup: ({ handle }) => {
        handle('watch', z.object({}), watch, { feature: 'test-only-feature' })
        handle('stats', z.object({}), stats)
      },
    }
  }

  it('a locked gated handler answers exactly like a type that was never registered', async () => {
    const registry = new MainModuleRegistry(createFeatureGate([]))
    const watch = vi.fn().mockResolvedValue(ok({ watching: true }))
    await registry.register(gatedModule(watch, vi.fn()), fakeAppContext())

    // The same request against a registry where 'watch' was never declared at all.
    const neverDeclared = new MainModuleRegistry(createFeatureGate([]))
    await neverDeclared.register(
      { id: 'library', setup: ({ handle }) => handle('stats', z.object({}), vi.fn()) },
      fakeAppContext(),
    )

    const locked = await registry.invoke({ moduleId: 'library', type: 'watch', payload: {} })
    const unknown = await neverDeclared.invoke({ moduleId: 'library', type: 'watch', payload: {} })

    expect(locked).toEqual(unknown)
    expect(locked).toEqual({
      ok: false,
      error: {
        key: 'modules.error.notImplemented',
        params: { moduleId: 'library', type: 'watch' },
      },
    })
    expect(watch).not.toHaveBeenCalled()
  })

  it('an unlocked gated handler is registered and reached', async () => {
    const registry = new MainModuleRegistry(createFeatureGate(['test-only-feature']))
    const watch = vi.fn().mockResolvedValue(ok({ watching: true }))
    await registry.register(gatedModule(watch, vi.fn()), fakeAppContext())

    const result = await registry.invoke({ moduleId: 'library', type: 'watch', payload: {} })

    expect(result).toEqual({ ok: true, value: { watching: true } })
    expect(watch).toHaveBeenCalledWith({})
  })

  it('a registry built without a gate fails closed', async () => {
    const registry = new MainModuleRegistry()
    const watch = vi.fn()
    await registry.register(gatedModule(watch, vi.fn()), fakeAppContext())

    const result = await registry.invoke({ moduleId: 'library', type: 'watch', payload: {} })

    expect(result).toEqual({
      ok: false,
      error: {
        key: 'modules.error.notImplemented',
        params: { moduleId: 'library', type: 'watch' },
      },
    })
    expect(watch).not.toHaveBeenCalled()
  })

  it.each([
    ['locked', createFeatureGate([])],
    ['unlocked', createFeatureGate(['test-only-feature'])],
  ])('an ungated sibling of a gated handler works while the feature is %s', async (_, gate) => {
    const registry = new MainModuleRegistry(gate)
    const stats = vi.fn().mockResolvedValue(ok({ answer: 42 }))
    await registry.register(gatedModule(vi.fn(), stats), fakeAppContext())

    const result = await registry.invoke({ moduleId: 'library', type: 'stats', payload: {} })

    expect(result).toEqual({ ok: true, value: { answer: 42 } })
    expect(stats).toHaveBeenCalledWith({})
    expect(registry.registered()).toEqual(['library'])
  })
})

describe('MainModuleRegistry outcome pass-through', () => {
  async function invokeWith(handler: () => unknown) {
    const registry = new MainModuleRegistry()
    await registry.register(
      {
        id: 'library',
        setup: ({ handle }) => {
          handle('stats', z.object({}), handler as () => Outcome<unknown>)
        },
      },
      fakeAppContext(),
    )
    return registry.invoke({ moduleId: 'library', type: 'stats', payload: {} })
  }
  const handlerFailed = {
    ok: false,
    error: { key: 'modules.error.handlerFailed', params: { moduleId: 'library', type: 'stats' } },
  }

  it("a handler's ok outcome arrives as one envelope", async () => {
    expect(await invokeWith(() => ok({ answer: 42 }))).toEqual({ ok: true, value: { answer: 42 } })
  })

  it("a handler's fail outcome passes through unchanged", async () => {
    expect(await invokeWith(() => fail('library.error.x', { n: 1 }))).toEqual({
      ok: false,
      error: { key: 'library.error.x', params: { n: 1 } },
    })
  })

  it('a handler that returns a non-Outcome is answered with handlerFailed', async () => {
    expect(await invokeWith(() => ({ answer: 42 }))).toEqual(handlerFailed)
    expect(await invokeWith(() => ({ ok: true, list: [] }))).toEqual(handlerFailed)
  })

  it('a handler that throws is answered with handlerFailed', async () => {
    expect(
      await invokeWith(() => {
        throw new Error('boom')
      }),
    ).toEqual(handlerFailed)
  })

  it('a plain-value handler is a compile error', () => {
    const module: MainModule = {
      id: 'library',
      setup: ({ handle }) => {
        // @ts-expect-error handlers must return an Outcome, not a bare value
        handle('stats', z.object({}), () => ({ answer: 42 }))
      },
    }
    expect(module.id).toBe('library')
  })
})

describe('MainModuleRegistry disposal', () => {
  it('disposers run in reverse registration order', async () => {
    const registry = new MainModuleRegistry()
    const order: string[] = []
    await registry.register(
      {
        id: 'library',
        setup: ({ onDispose }) => {
          onDispose(() => void order.push('library-a'))
          onDispose(async () => {
            await Promise.resolve()
            order.push('library-b')
          })
        },
      },
      fakeAppContext(),
    )
    await registry.register(
      { id: 'servers', setup: ({ onDispose }) => onDispose(() => void order.push('servers')) },
      fakeAppContext(),
    )

    await registry.disposeAll()
    await registry.disposeAll()

    expect(order).toEqual(['servers', 'library-b', 'library-a'])
  })

  it('a throwing disposer does not stop the others', async () => {
    const registry = new MainModuleRegistry()
    const ran: string[] = []
    await registry.register(
      {
        id: 'library',
        setup: ({ onDispose }) => {
          onDispose(() => void ran.push('first'))
          onDispose(() => {
            throw new Error('boom')
          })
          onDispose(() => Promise.reject(new Error('rejected')))
          onDispose(() => void ran.push('last'))
        },
      },
      fakeAppContext(),
    )

    await expect(registry.disposeAll()).resolves.toBeUndefined()

    expect(ran).toEqual(['last', 'first'])
  })

  it('disposers registered before setup() throws still run', async () => {
    const registry = new MainModuleRegistry()
    const disposer = vi.fn()
    await registry.register(
      {
        id: 'library',
        setup: ({ onDispose }) => {
          onDispose(disposer)
          throw new Error('setup failed')
        },
      },
      fakeAppContext(),
    )

    await registry.disposeAll()

    expect(disposer).toHaveBeenCalledTimes(1)
  })
})
