import type { StateSectionSpec, StateStore } from '../main/services/state'

/**
 * An in-memory stand-in for `StateStore` that only supports `section()`: for tests that need a
 * module's persisted state to exist without a state file. `initial` seeds values by section key.
 */
export function fakeSectionState(initial: Record<string, unknown> = {}): StateStore {
  const values = new Map<string, unknown>(Object.entries(initial))
  return {
    section: <T>(spec: StateSectionSpec<T>) => {
      if (!values.has(spec.key)) values.set(spec.key, spec.defaults())
      return {
        get: () => values.get(spec.key) as T,
        update: (fn: (live: T) => T) => {
          const next = fn(values.get(spec.key) as T)
          values.set(spec.key, next)
          return next
        },
      }
    },
  } as unknown as StateStore
}
