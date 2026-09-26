import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowDownCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { formatRelativeTime } from '../../lib/format'
import { useLauncher } from '../../store/useLauncher'
import { Button } from '../ui/Button'

/**
 * Story 099 D5: "last checked <relative>" plus a "check now" action. Rendered by
 * `AppVersionCard.tsx` directly under the running version at the top of Settings, so the version
 * and its update state are the first thing the view shows.
 *
 * Reads `update` from the store the same way `UpdateAction.tsx` does, and calls the new
 * `checkForUpdates` store action (097's `update:check` channel, wired in D5) on click. In-flight
 * tracking mirrors `UpdateAction.tsx`'s `restarting` local state rather than the store's
 * `update.status === 'checking'` - the button must disable the instant it is clicked, not once a
 * round trip through main has updated the mirrored state. A check main started on its own
 * (`status === 'checking'`) disables it too.
 *
 * The outcome line only ever reflects a *completed* check (`upToDate` / `available` / `error`) -
 * `idle` (nothing yet) and `checking` (in flight; its own "checking" line says so) render no
 * outcome, so there is never a stale outcome sitting under a fresh check. Each outcome pairs its
 * tone with an icon and text, never colour alone.
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
  const busy = checking || update.status === 'checking'

  async function handleCheckNow(): Promise<void> {
    setChecking(true)
    await checkForUpdates()
    setChecking(false)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        {busy && (
          <p
            className="flex items-center gap-1.5 text-sm text-ink-dim"
            data-testid="about-update-checking"
          >
            <RefreshCw className="size-4 shrink-0 animate-spin" aria-hidden />
            {t('settings.about.checking')}
          </p>
        )}

        {!busy && update.status === 'upToDate' && (
          <p
            className="flex items-center gap-1.5 text-sm text-ink"
            data-testid="about-update-outcome"
          >
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            {t('settings.about.checkUpToDate')}
          </p>
        )}

        {!busy && update.status === 'available' && update.update && (
          <p
            className="flex items-center gap-1.5 text-sm text-ink"
            data-testid="about-update-outcome"
          >
            <ArrowDownCircle className="size-4 shrink-0 text-flame-300" aria-hidden />
            {t('settings.about.checkAvailable', { version: update.update.version })}
          </p>
        )}

        {!busy && update.status === 'error' && update.error && (
          <p
            className="flex items-center gap-1.5 text-sm text-danger"
            data-testid="about-update-outcome"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {t(update.error.key, update.error.params ?? {})}
          </p>
        )}

        <p className="text-xs text-ink-muted" data-testid="about-update-last-checked">
          {relative
            ? t('settings.about.lastChecked', { time: relative })
            : t('settings.about.neverChecked')}
        </p>
      </div>

      <Button
        variant="neutral"
        size="sm"
        disabled={busy}
        icon={<RefreshCw className="size-3.5" aria-hidden />}
        onClick={() => void handleCheckNow()}
        data-testid="about-update-check-now"
      >
        {t('settings.about.checkNow')}
      </Button>
    </div>
  )
}
