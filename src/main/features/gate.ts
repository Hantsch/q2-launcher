import type { FeatureName } from '@shared/features'

/**
 * Story 130: the read-only answer to "is this gated feature unlocked in this process?".
 *
 * A gate is a frozen snapshot: it is resolved once at boot and never changes afterwards, so a
 * code redeemed mid-session takes effect only at the next start.
 */
export interface FeatureGate {
  isFeatureUnlocked(name: FeatureName): boolean
  unlockedFeatures(): FeatureName[]
}

/**
 * Builds a gate over exactly `names`. The names are copied into a private set at construction
 * time, so mutating the caller's collection afterwards cannot change what the gate answers.
 */
export function createFeatureGate(names: Iterable<FeatureName>): FeatureGate {
  const unlocked = new Set<FeatureName>(names)
  return {
    isFeatureUnlocked: (name) => unlocked.has(name),
    unlockedFeatures: () => [...unlocked],
  }
}

/** The fail-closed default: a gate that unlocks nothing. */
export const LOCKED_FEATURE_GATE: FeatureGate = createFeatureGate([])

/**
 * Resolves the process's gate from story 128's already-initialized `UnlockService`.
 *
 * Deliberately thin: `UnlockService.init()` has already re-verified every stored code and dropped
 * expired or rejected ones, so this neither re-verifies nor reads stored state itself - doing
 * either would be a second verification path that could drift from 128's. The parameter is typed
 * to the one method used, not the whole service.
 */
export function resolveFeatureGate(unlock: {
  unlockedFeatures(): ReadonlySet<string>
}): FeatureGate {
  return createFeatureGate(unlock.unlockedFeatures())
}
