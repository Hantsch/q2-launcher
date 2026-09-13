import { useTranslation } from 'react-i18next'
import { ArrowUpCircle } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { useLauncher } from '../../store/useLauncher'
import { UtilityButton } from './UtilityButton'
import { UpdatePopover } from './UpdatePopover'

/**
 * Story 098 D3: the titlebar's update control. Placed left of `utilityModules.map(...)` in
 * `TitleBar.tsx` (Decisions: "the first secondary module").
 *
 * AC1: rendered only while 097's state names a known release (`update.update !== null`) - not
 * gated on `phase`, so a background recheck of an already-known release (which reports
 * `phase: 'checking'`, `resolveUpdatePhase`'s own precedence) never makes the control flicker
 * away. Reuses D2's `UtilityButton` directly, wrapped in the new `Popover` primitive for the rich
 * content a `Menu` cannot carry.
 */
export function UpdateButton() {
  const { t } = useTranslation()
  const update = useLauncher((state) => state.update)

  if (update.update === null) return null

  // AC5: the dot marks "you have not looked at this yet" - it disappears the moment the user acts
  // (the phase moves past `available`, into `downloading`/`downloaded`) or dismisses, and for no
  // other reason.
  const attention = !update.dismissed && update.phase === 'available'

  return (
    <Popover
      label={t('appUpdate.popover.label')}
      content={({ close }) => <UpdatePopover onClose={close} />}
    >
      {({ open, toggle }) => (
        <span className="relative inline-flex">
          <UtilityButton
            testId="nav-update"
            label={t(attention ? 'appUpdate.action.labelAvailable' : 'appUpdate.action.label')}
            active={open}
            onClick={toggle}
          >
            <ArrowUpCircle className="size-5" />
          </UtilityButton>
          {/* Decorative only - the accessible name above already changes with `attention`
              (design-tokens: "never colour alone"). */}
          {attention && (
            <span
              aria-hidden
              data-testid="nav-update-attention"
              className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full bg-flame-500 ring-1 ring-void"
            />
          )}
        </span>
      )}
    </Popover>
  )
}
