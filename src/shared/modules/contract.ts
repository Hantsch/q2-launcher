import type { ZodType } from 'zod'

/**
 * A module's typed contract: every `module:invoke` handler with its payload (`req`) and success
 * value (`res`), and every pushed event with its payload. Types only - the runtime half is the
 * schema map (`ContractSchemas`) main hands to `defineModule` (story 205).
 *
 * `req` is the schema's parsed output (`z.infer`), because that is what the registry hands the
 * handler after `safeParse`. `res` is the value inside the handler's `Outcome<R>`, never the
 * envelope itself.
 *
 * Declare a contract as a `type` alias (or with inline object literals): an `interface` used for
 * `handlers`/`events` has no implicit index signature and does not satisfy the `Record` bounds.
 */
export type ModuleContract = {
  handlers: Record<string, { req: unknown; res: unknown }>
  events: Record<string, unknown>
}

/**
 * One schema per handler, every key required - a handler without a schema is a compile error,
 * not a payload the registry would have to wave through.
 */
export type ContractSchemas<H extends ModuleContract> = {
  [K in keyof H['handlers']]: ZodType<H['handlers'][K]['req']>
}

export type HandlerReq<
  H extends ModuleContract,
  K extends keyof H['handlers'],
> = H['handlers'][K]['req']

export type HandlerRes<
  H extends ModuleContract,
  K extends keyof H['handlers'],
> = H['handlers'][K]['res']

export type EventPayload<H extends ModuleContract, E extends keyof H['events']> = H['events'][E]

/**
 * The payload argument a typed client takes for a handler: none when `req` is `void`/`undefined`,
 * exactly one otherwise. The tuple wrapping keeps a union such as `string | undefined` from
 * distributing into `[] | [payload: string]`, which would let a required payload be omitted.
 */
export type PayloadArgs<Req> = [Req] extends [void | undefined] ? [] : [payload: Req]
