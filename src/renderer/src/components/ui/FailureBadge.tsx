import { useTranslation } from 'react-i18next'
import type { Installation } from '@shared/types'
import { Badge } from './primitives'

/**
 * The "Failed" marker shown wherever an installation's identity is surfaced
 * (library card, rail hover card) - story 077 D4.
 *
 * Mirrors `DemoBadge`: takes the whole `Installation` so the derivation
 * (`installation.lastFailure` set) lives here rather than at each call site,
 * and renders nothing when there is no failure, so callers can use it
 * unconditionally. An installation with `lastFailure` is never playable
 * (`status` is `invalid`/`missing`, per D1/D2), but an `invalid`/`missing`
 * installation without a `lastFailure` is an ordinary broken folder and must
 * render neither this badge nor anything else new - the presence of
 * `lastFailure` is the only signal this component reads.
 */
export function FailureBadge({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  if (!installation.lastFailure) return null
  return (
    <Badge tone="danger" testId="failure-badge">
      {t('installation.failedBadge')}
    </Badge>
  )
}
