import { useTranslation } from 'react-i18next'
import type { Installation } from '@shared/types'
import { isDemoData } from '../../lib/demo-data'
import { Badge } from './primitives'

/**
 * The "Demo" marker shown wherever an installation's identity is surfaced
 * (library card, action bar, rail hover card) - story 074 D7.
 *
 * Takes the whole `Installation` (unlike `EngineBadge`'s plain `engineKind`)
 * because the derivation itself (`isDemoData`) lives here rather than at each
 * call site, so there is one fewer place a call site can compute it wrong.
 * Renders nothing when the installation is not demo data, so callers can use
 * it unconditionally.
 */
export function DemoBadge({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  if (!isDemoData(installation.checks)) return null
  return (
    <Badge tone="warning" testId="demo-badge">
      {t('installation.demoBadge')}
    </Badge>
  )
}
