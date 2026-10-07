import type { FeatureName } from '@shared/features'
import type {
  ContractSchemas,
  EventPayload,
  HandlerReq,
  HandlerRes,
  ModuleContract,
} from '@shared/modules/contract'
import type { ModuleId, Outcome } from '@shared/types'
import type { ModuleSetup } from './types'

/** `true` when `T` is a union of two or more members. */
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never

/**
 * Accepts exactly one key. A union key (`type as 'a' | 'b'`) would type the handler against both
 * entries at once - a payload of either shape, and a result of either `res` - while the registry
 * stores it under only one of them.
 */
type SingleKey<K> = true extends IsUnion<K> ? never : K

/**
 * Rejects a contract whose handler keys are plain `string` - an omitted type argument or the bare
 * `ModuleContract` - since every key, schema and result would then type-check.
 */
type ExplicitContract<H extends ModuleContract> = string extends keyof H['handlers']
  ? { 'defineModule needs its contract as a type argument: defineModule<Contract>(...)': never }
  : unknown

export interface BoundModule<H extends ModuleContract> {
  handle: <K extends keyof H['handlers'] & string>(
    type: SingleKey<K>,
    handler: (
      payload: HandlerReq<H, K>,
    ) => Outcome<HandlerRes<H, K>> | Promise<Outcome<HandlerRes<H, K>>>,
    options?: { feature?: FeatureName },
  ) => void
  emit: <E extends keyof H['events'] & string>(
    type: SingleKey<E>,
    payload: EventPayload<H, E>,
  ) => void
}

export interface DefinedModule<H extends ModuleContract> {
  id: ModuleId
  schemas: ContractSchemas<H>
  bind: (setup: ModuleSetup) => BoundModule<H>
}

/**
 * Ties a module's contract to its schema map, so `handle` takes a handler's schema from the map
 * by its type and the handler is checked against the contract's `req`/`res` (story 205).
 *
 * `bind` returns plain closures, so `const { handle, emit } = defineModule<C>(id, schemas).bind(setup)`
 * works. It adds no behaviour: validation, feature gating and Outcome checking stay in the
 * registry behind `setup.handle`.
 */
export function defineModule<H extends ModuleContract>(
  id: ModuleId,
  schemas: ContractSchemas<H> & ExplicitContract<H>,
): DefinedModule<H> {
  return {
    id,
    schemas,
    bind: (setup) => ({
      handle: (type, handler, options) => {
        setup.handle(type, schemas[type], handler, options)
      },
      emit: (type, payload) => {
        setup.emit(type, payload)
      },
    }),
  }
}
