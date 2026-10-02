import type { AppContext } from '../main/context'
import { IDLE_LAUNCH_STATE } from '@shared/types'
import { createFeatureGate } from '../main/features/gate'
import { PersistenceRegistry } from '../main/services/persistence'

/**
 * A stand-in `AppContext` carrying only the seams module `setup()` reads unconditionally:
 * `broadcast.emit`, an idle silent `launch`, a locked feature gate (the registry's own
 * fail-closed default) and an empty installation list. `state` is deliberately absent - tests
 * that need one pass a real `StateStore` (or stub) as an override.
 */
export function fakeAppContext(overrides: Partial<AppContext> = {}): AppContext {
  return {
    broadcast: { emit: () => {} },
    launch: { getState: () => IDLE_LAUNCH_STATE, onStateChange: () => () => {} },
    features: createFeatureGate([]),
    installations: { list: () => [] },
    persistence: new PersistenceRegistry(),
    ...overrides,
  } as unknown as AppContext
}
