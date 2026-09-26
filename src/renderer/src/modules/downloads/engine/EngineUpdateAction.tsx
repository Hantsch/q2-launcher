import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { isJobActive, type Installation } from '@shared/types'
import type { EngineUpdateStatus } from '@shared/modules/downloads'
import { useLauncher } from '../../../store/useLauncher'
import { IconButton } from '../../../components/ui/Button'
import { getEngineUpdateStatus } from '../client'

/**
 * How long after the renderer module first loads the very first automatic
 * `engineUpdateStatus` check waits before firing, so it never competes with the window's own
 * first paint - same rationale and magnitude as `scheduleStartupCheck()`'s own startup delay
 * (`src/main/index.ts`, story 097 D5: "fire-and-forget, after a short delay so it never competes
 * with the window's own first paint"). Only the first automatic check (module load, i.e. app
 * boot) is held back; switching installations or a job finishing while the app is already up
 * answers immediately, same as before - those are real state changes a user is actively looking
 * at, not a startup race.
 */
const STARTUP_CHECK_DELAY_MS = 3_000
const moduleLoadedAtMs = Date.now()
let firstAutomaticCheckDone = false

/**
 * Story 092 D7: the ActionBar's engine-update trigger, mirroring `RetailUpgradeDialog`'s own
 * trigger button (story 090 D4, inline in `ActionBar.tsx`'s utility cluster). Unlike that button -
 * which only needs to know "is this installation demo data" from the `Installation` it already has
 * - this one needs main's own verdict (AC1: "without downloading or changing anything on its own"),
 * so it fetches `EngineUpdateStatus` itself on mount and on every installation switch, the same
 * fetch-on-mount convention `RetailUpgradeDialog` uses for its own source list - plus once more
 * whenever this installation's jobs finish, so the indicator stops claiming an update the moment
 * the update job that removed it is done (and starts claiming one again after a rollback).
 *
 * Always rendered for the current installation - there is no "this engine has no update feature"
 * guard here, because there is nothing engine-specific to gate on: `engineUpdateStatus` answers a
 * renderable status for every engine kind (Decisions: "an installation with no recorded engine
 * version counts as differs"; D3's own test: "engine with no manifest pin => no update and no
 * throw"). A vanished installation (main answers `undefined`) or a fetch failure both fall back to
 * "no status yet", which never renders the indicator and still opens a dialog that can retry.
 */
export function EngineUpdateAction({ installation }: { installation: Installation }) {
  const { t } = useTranslation()
  const openDialog = useLauncher((state) => state.openDialog)
  const [status, setStatus] = useState<EngineUpdateStatus | undefined>(undefined)
  /**
   * How many jobs this installation currently has running. Not rendered - it is the refetch
   * trigger: the dialog's update and rollback both end by finishing their job, and this count
   * dropping is the one signal the ActionBar gets that main's verdict may have changed. Without it
   * the indicator dot would keep claiming an update until the user switched installations and back.
   * A count rather than a job id, so this component needs to know nothing about job kinds; another
   * of this installation's jobs ending costs one extra read of a status that never changed.
   */
  const activeJobs = useLauncher(
    (state) =>
      state.jobs.filter((job) => job.installationId === installation.id && isJobActive(job)).length,
  )

  useEffect(() => {
    let cancelled = false
    const run = (): void => {
      firstAutomaticCheckDone = true
      void getEngineUpdateStatus(installation.id).then((result) => {
        if (cancelled) return
        setStatus(result.ok ? result.value : undefined)
      })
    }

    if (firstAutomaticCheckDone) {
      run()
      return () => {
        cancelled = true
      }
    }

    // The very first automatic check the whole app makes: held back to the startup grace
    // window so it cannot race a short-lived window right after boot (see
    // `STARTUP_CHECK_DELAY_MS` above).
    const remainingDelayMs = Math.max(0, STARTUP_CHECK_DELAY_MS - (Date.now() - moduleLoadedAtMs))
    const timer = window.setTimeout(run, remainingDelayMs)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [installation.id, activeJobs])

  // The status carries the installation it is about, so a stale answer for the *previous*
  // installation can never light this dot up - which is what lets the fetch above refresh in place
  // (no `setStatus(undefined)` flicker on every refetch) rather than resetting first.
  const updateAvailable = status?.installationId === installation.id && status.updateAvailable

  return (
    <span className="relative inline-flex" data-testid="engine-update-action">
      <IconButton
        label={t(
          updateAvailable ? 'engineUpdate.action.labelAvailable' : 'engineUpdate.action.label',
        )}
        size="sm"
        onClick={() =>
          openDialog({
            kind: 'module',
            moduleId: 'downloads',
            view: 'engine-update',
            installationId: installation.id,
          })
        }
      >
        <RefreshCw className="size-3.5" />
      </IconButton>
      {/* Decorative only - the accessible name above already changes with `updateAvailable`
          (design-tokens: "never colour alone"), so this dot needs no label of its own. */}
      {updateAvailable && (
        <span
          aria-hidden
          data-testid="engine-update-available-indicator"
          className="pointer-events-none absolute -top-0.5 -right-0.5 size-2 rounded-full bg-flame-500 ring-1 ring-void"
        />
      )}
    </span>
  )
}
