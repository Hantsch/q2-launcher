import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '../../lib/format'
import { useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'

/**
 * Story 099 D5: "last checked <relative>" plus a "check now" action, sitting below the
 * this-version/pending-update blocks `AboutPanel.tsx` already renders (D2-D4).
 *
 * Reads `update` from the store the same way `UpdateAction.tsx` does, and calls the new
 * `checkForUpdates` store action (097's `update:check` channel, wired in D5) on click. In-flight
 * tracking mirrors `UpdateAction.tsx`'s `restarting` local state rather than the store's
 * `update.status === 'checking'` - the button must disable the instant it is clicked, not once a
 * round trip through main has updated the mirrored state.
 *
 * The outcome line only ever reflects a *completed* check (`upToDate` / `available` / `error`) -
 * `idle` (nothing yet) and `checking` (in flight; the disabled button already says so) render
 * nothing, so there is never a stale outcome sitting under a fresh check.
 *
 * The `error` case mirrors `UpdateAction.tsx`'s check-failure line exactly (`text-danger` + the
 * resolved i18n text, not a bare colour swatch) - same `update.error` shape, same `t()` call.
 */
export function UpdateCheckRow() {
  const { t } = useTranslation()
  const update = useLauncher((state) => state.update)
  const checkForUpdates = useLauncher((state) => state.checkForUpdates)
  const [checking, setChecking] = useState(false)

  const relative = formatRelativeTime(update.lastCheckedAt ?? undefined)

  async function handleCheckNow(): Promise<void> {
    setChecking(true)
    await checkForUpdates()
    setChecking(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted" data-testid="about-update-last-checked">
          {relative ? t('settings.about.lastChecked', { time: relative }) : t('settings.about.neverChecked')}
        </p>
        <Button
          variant="neutral"
          size="sm"
          disabled={checking}
          onClick={() => void handleCheckNow()}
          data-testid="about-update-check-now"
        >
          {t('settings.about.checkNow')}
        </Button>
      </div>

      {update.status === 'upToDate' && (
        <p className="text-xs text-ink-muted" data-testid="about-update-outcome">
          {t('settings.about.checkUpToDate')}
        </p>
      )}

      {update.status === 'available' && update.update && (
        <p className="text-xs text-ink" data-testid="about-update-outcome">
          {t('settings.about.checkAvailable', { version: update.update.version })}
        </p>
      )}

      {update.status === 'error' && update.error && (
        <p className="text-xs text-danger" data-testid="about-update-outcome">
          {t(update.error.key, update.error.params ?? {})}
        </p>
      )}
    </div>
  )
}
