import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import type { ZodType } from 'zod'
import { fakeAppContext } from '../../test-support/app-context'
import { ok, type Outcome } from '@shared/types'
import type { ModuleContract } from '@shared/modules/contract'
import { scopedLogger } from '../lib/logger'
import { defineModule } from './define-module'
import { MainModuleRegistry } from './registry'
import type { MainModule, ModuleSetup } from './types'

const greetSchema = z.object({ name: z.string() })
const countSchema = z.void()

type TestContract = {
  handlers: {
    greet: { req: z.infer<typeof greetSchema>; res: string }
    count: { req: void; res: number }
  }
  events: {
    greeted: { name: string }
  }
}

const schemas = { greet: greetSchema, count: countSchema }

/** A `ModuleSetup` that only records what is registered and emitted. */
function recordingSetup() {
  const handled: Array<{ type: string; schema: ZodType<unknown> }> = []
  const emitted: Array<{ type: string; payload: unknown }> = []
  const setup: ModuleSetup = {
    handle: (type, schema) => {
      handled.push({ type, schema: schema as ZodType<unknown> })
    },
    emit: (type, payload) => {
      emitted.push({ type, payload })
    },
    app: fakeAppContext(),
    log: scopedLogger('test'),
    onDispose: () => {},
  }
  return { setup, handled, emitted }
}

describe('defineModule', () => {
  it('defineModule registers each handler with its contract schema', () => {
    const { setup, handled } = recordingSetup()
    const { handle } = defineModule<TestContract>('home', schemas).bind(setup)

    handle('greet', ({ name }) => ok(`hello ${name}`))
    handle('count', () => ok(1))

    expect(handled).toHaveLength(2)
    expect(handled[0].type).toBe('greet')
    expect(handled[0].schema).toBe(greetSchema)
    expect(handled[1].type).toBe('count')
    expect(handled[1].schema).toBe(countSchema)
  })

  it("defineModule's emit forwards the event to the module's setup", () => {
    const { setup, emitted } = recordingSetup()
    const { emit } = defineModule<TestContract>('home', schemas).bind(setup)

    emit('greeted', { name: 'ranger' })

    expect(emitted).toEqual([{ type: 'greeted', payload: { name: 'ranger' } }])
  })

  it('a bad payload never reaches a defineModule handler', async () => {
    const registry = new MainModuleRegistry()
    const greet = vi.fn((payload: { name: string }) => ok(`hello ${payload.name}`))
    const module: MainModule = {
      id: 'home',
      setup: (setup) => {
        const { handle } = defineModule<TestContract>('home', schemas).bind(setup)
        handle('greet', greet)
      },
    }

    await registry.register(module, fakeAppContext())
    const rejected = await registry.invoke({
      moduleId: 'home',
      type: 'greet',
      payload: { name: 7 },
    })
    const accepted = await registry.invoke({
      moduleId: 'home',
      type: 'greet',
      payload: { name: 'ranger' },
    })

    expect(rejected).toEqual({ ok: false, error: { key: 'ipc.error.invalidPayload' } })
    expect(greet).toHaveBeenCalledTimes(1)
    expect(accepted).toEqual({ ok: true, value: 'hello ranger' })
  })

  it('a missing schema or a wrong result type does not compile', () => {
    // Each `@ts-expect-error` is the assertion: `npm run typecheck` fails as soon as the line
    // below it compiles. The calls also run, against a recording setup, so they stay live code.
    const { setup, handled, emitted } = recordingSetup()
    const numericGreet = z.object({ name: z.number() })

    // @ts-expect-error a schema map missing a handler's key
    defineModule<TestContract>('home', { greet: greetSchema })

    // @ts-expect-error a schema whose parsed output is not the contract's req
    defineModule<TestContract>('home', { greet: numericGreet, count: countSchema })

    // @ts-expect-error without a contract type argument every key would type-check
    defineModule('home', { greet: greetSchema })

    // @ts-expect-error the bare ModuleContract is just as open
    defineModule<ModuleContract>('home', { greet: greetSchema })

    const { handle, emit } = defineModule<TestContract>('home', schemas).bind(setup)

    // @ts-expect-error a handler returning Outcome<number> where res is string
    handle('greet', () => ok(42))

    // @ts-expect-error a handler returning Outcome<unknown> where res is string
    handle('greet', (): Outcome<unknown> => ok('hello'))

    // @ts-expect-error a handler reading a payload shape the schema does not produce
    handle('greet', (payload: { name: number }) => ok(String(payload.name)))

    // @ts-expect-error an unknown handler type
    handle('nope', () => ok('x'))

    // @ts-expect-error a union type would type one handler against both entries
    handle('greet' as 'greet' | 'count', () => ok('x'))

    // @ts-expect-error an emit with a wrong payload
    emit('greeted', { name: 7 })

    // @ts-expect-error an unknown event type
    emit('vanished', { name: 'ranger' })

    expect(handled.map((entry) => entry.type)).toEqual(['greet', 'greet', 'greet', 'nope', 'greet'])
    expect(emitted.map((entry) => entry.type)).toEqual(['greeted', 'vanished'])
  })
})
