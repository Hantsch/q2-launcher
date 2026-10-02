import type { AppContext } from '../main/context'
import { IDLE_LAUNCH_STATE } from '@shared/types'
import { createFeatureGate, type FeatureGate } from '../main/features/gate'
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

/** A feature gate with every feature unlocked: feature-gated handlers register as if unlocked. */
export const ALL_UNLOCKED_FEATURE_GATE: FeatureGate = {
  isFeatureUnlocked: () => true,
  unlockedFeatures: () => [],
}

/**
 * A value that answers any property read or call with another such value, and is never thenable.
 * Stands in for services a module's `setup()` merely captures; anything it truly needs to compute
 * from them is out of scope for a registration-only test.
 */
function deepStub(): unknown {
  const target = function () {} as unknown as object
  const proxy: unknown = new Proxy(target, {
    get: (_t, key) => (key === 'then' || typeof key === 'symbol' ? undefined : deepStub()),
    apply: () => deepStub(),
  })
  return proxy
}

/**
 * An `AppContext` every service of which is a `deepStub`, with all features unlocked - enough to
 * run any module's `setup()` and observe which handlers it registers.
 */
export function stubbedAppContext(overrides: Partial<AppContext> = {}): AppContext {
  const services = [
    'state',
    'icons',
    'detection',
    'jobs',
    'writeGuard',
    'dialog',
    'mainWindow',
    'cinemaWindow',
    'update',
    'unlock',
  ]
  const stubs = Object.fromEntries(services.map((name) => [name, deepStub()]))
  return fakeAppContext({
    ...(stubs as Partial<AppContext>),
    features: ALL_UNLOCKED_FEATURE_GATE,
    getMainWindow: () => null,
    ...overrides,
  })
}
