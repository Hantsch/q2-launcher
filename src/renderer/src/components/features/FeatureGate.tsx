import { Fragment, type ReactNode } from 'react'
import type { FeatureName } from '@shared/features'
import { ExperimentalBadge } from '../ui/ExperimentalBadge'
import { useLauncher } from '../../store/useLauncher'

/** Story 130: whether `name` is unlocked, per main's boot-time gate - never renderer-decided. */
export function useFeatureUnlocked(name: FeatureName): boolean {
  return useLauncher((state) => state.unlockedFeatures.includes(name))
}

/**
 * Renders `children` only when `feature` is unlocked; otherwise renders nothing at all - no
 * placeholder, no disabled state, no tooltip hinting the feature exists (concept §13.6: "nobody
 * asks for something they don't see").
 *
 * Story 129 adds the "experimental" marking inside this component's unlocked branch - nothing
 * else about a gated feature's rendering changes when that lands.
 */
export function FeatureGate({
  feature,
  children,
}: {
  feature: FeatureName
  children: ReactNode
}): ReactNode {
  const unlocked = useFeatureUnlocked(feature)
  if (!unlocked) return null
  return (
    <Fragment>
      <ExperimentalBadge />
      {children}
    </Fragment>
  )
}
