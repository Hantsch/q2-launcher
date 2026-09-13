import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { ROUTE_SETTINGS, useLauncher } from '../../store/useLauncher'
import { UpdateAction } from './UpdateAction'

/**
 * Story 098 D3: the update popover's content, opened from `UpdateButton`. Reads the mirrored
 * `update` slice directly from the store (same convention as `ActionBar`'s `JobReadout`) rather
 * than taking it as a prop, so a real `useLauncher.setState` is enough to drive every phase in
 * tests.
 *
 * Story 099 D4: the phase-based primary action itself now lives in `UpdateAction.tsx` (R7),
 * shared verbatim with About's pending-update block so both surfaces drive the exact same
 * download/cancel/restart logic. See that file for the per-phase behaviour (Decisions).
 *
 * "What changed" links into Settings -> About ([[099]]'s surface, `data-testid="settings-about"`
 * added there) rather than rendering notes here - 099 owns notes rendering.
 */
export function UpdatePopover({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const update = useLauncher((state) => state.update)
  const dismissUpdate = useLauncher((state) => state.dismissUpdate)
  const setRoute = useLauncher((state) => state.setRoute)

  function goToAbout(): void {
    setRoute(ROUTE_SETTINGS)
    onClose()
    // Settings is a long scrolling view (SettingsView.tsx) and `settings-about` (099's anchor) sits
    // at the bottom of it, after every module-contributed section - without this, the user lands at
    // the top with the release notes off-screen. The route change above only takes effect on the
    // next render commit, which lands after this handler returns, so the anchor is not in the DOM
    // yet; two rAFs (one for the commit, one for the browser's next paint) is the smallest wait that
    // reliably sees it before scrolling, mirroring the `scrollIntoView` calls already used elsewhere
    // in the renderer (e.g. ControlsTab.tsx).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.querySelector('[data-testid="settings-about"]')?.scrollIntoView({ block: 'start' })
      })
    })
  }

  const version = update.update?.version

  return (
    <div className="space-y-3" data-testid="update-popover">
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink" data-testid="update-popover-version">
          {version ? t('appUpdate.version', { version }) : t('appUpdate.popover.label')}
        </p>
        <Button
          variant="link"
          size="sm"
          onClick={goToAbout}
          data-testid="update-popover-whatchanged"
        >
          {t('appUpdate.whatChanged')}
        </Button>
      </div>

      <UpdateAction />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => void dismissUpdate()}
        data-testid="update-popover-dismiss"
      >
        {t('appUpdate.action.dismiss')}
      </Button>
    </div>
  )
}
