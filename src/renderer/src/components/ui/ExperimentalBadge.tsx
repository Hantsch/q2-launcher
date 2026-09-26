import { useTranslation } from 'react-i18next'
import { Badge } from './primitives'

/**
 * The "Experimental" marker `FeatureGate` renders alongside any feature it unlocks - story 129
 * D3. Unconditional wherever it appears (unlike `DemoBadge`, which derives its own visibility):
 * `FeatureGate` only mounts it when the gated feature is unlocked in the first place.
 */
export function ExperimentalBadge() {
  const { t } = useTranslation()
  return (
    <Badge tone="neutral" testId="experimental-badge">
      {t('experimental.badge')}
    </Badge>
  )
}
