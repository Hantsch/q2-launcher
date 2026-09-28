import { useTranslation } from 'react-i18next'
import type { ValueSource } from '@shared/demos/effective-values'

/**
 * Story 148 D2: renders where an effective value came from as visible text (never icon-only), so
 * a user can tell "set by you" from "guessed" without a tooltip. `null` (no source resolved) is a
 * legitimate case - it renders nothing.
 */
export function ValueSourceLabel({ source }: { source: ValueSource | null }) {
  const { t } = useTranslation()
  if (source === null) return null
  return (
    <span data-testid="value-source" data-source={source} className="text-ink-muted">
      {t(`replays.source.${source}`)}
    </span>
  )
}
