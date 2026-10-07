import { MessageSquare, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../../../components/ui/Button'

/**
 * A drop entry's two options - "drop ammo too" and "announce to team" - as icon toggle buttons.
 *
 * Pressed state is never colour alone (`/design-tokens`): `IconButton`'s `primary` variant differs
 * from `ghost` in border and fill at once, and `aria-pressed` carries the state to assistive tech.
 * `label` is the short accessible name; `title` overrides the default tooltip with the longer,
 * state-aware text (an idle hint, and the disabled ammo toggle's explanation).
 *
 * Sized `size="sm"` (28px) to match the other icon buttons in the 200px Options track, below the
 * 44px touch-target floor; CLAUDE.md's Deviations table has a row for it.
 */
export interface DropTogglesProps {
  /** Whether the ammo toggle can be operated at all (`drop-entries.ts#dropStateFor`'s
   * `canToggleAmmo`, or - for a catalogue row whose entry has no body yet - the row's own
   * `ammoCommand`). `false` disables the toggle rather than hiding it (a hidden control
   * explains nothing).
   *
   * Not `hasAmmo`: `DropState.hasAmmo` means the opposite (an ammo command is *present*, the
   * toggle's pressed state) and the two could contradict each other. */
  ammoEnabled: boolean
  /** Current ammo-toggle state (`dropStateFor(action).hasAmmo`). */
  ammoOn: boolean
  /** Current message-toggle state - a stored message, or a row the user just revealed
   * (`revealedMessageRows`), same expression the inline message sub-row's own visibility uses. */
  messageOn: boolean
  onToggleAmmo: (on: boolean) => void
  onToggleMessage: (on: boolean) => void
  /** Test-only, additive selectors for the live-smoke flow (mirrors the removed checkboxes'
   * `data-testid`s) - `undefined` renders no attribute at all. */
  ammoTestId?: string
  messageTestId?: string
}

export function DropToggles({
  ammoEnabled,
  ammoOn,
  messageOn,
  onToggleAmmo,
  onToggleMessage,
  ammoTestId,
  messageTestId,
}: DropTogglesProps) {
  const { t } = useTranslation()

  const ammoTooltip = ammoEnabled
    ? t('config.controls.dropBind.ammo.tooltip')
    : t('config.controls.dropBind.ammo.tooltipDisabled')

  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="contents" data-testid={ammoTestId}>
        <IconButton
          label={t('config.controls.dropBind.ammo.label')}
          title={ammoTooltip}
          size="sm"
          variant={ammoOn ? 'primary' : 'ghost'}
          aria-pressed={ammoOn}
          // `aria-disabled`, not `disabled`: a natively disabled button loses pointer events (its
          // `title` becomes unreachable) and leaves the tab order, so the explaining tooltip would
          // reach no input device. The click handler no-ops and the dimming is restated below.
          aria-disabled={!ammoEnabled || undefined}
          className={ammoEnabled ? undefined : 'cursor-not-allowed opacity-45'}
          onClick={() => {
            if (!ammoEnabled) return
            onToggleAmmo(!ammoOn)
          }}
        >
          <Package className="size-3.5" aria-hidden="true" />
        </IconButton>
      </span>
      <span className="contents" data-testid={messageTestId}>
        <IconButton
          label={t('config.controls.dropBind.message.label')}
          title={t('config.controls.dropBind.message.tooltip')}
          size="sm"
          variant={messageOn ? 'primary' : 'ghost'}
          aria-pressed={messageOn}
          onClick={() => onToggleMessage(!messageOn)}
        >
          <MessageSquare className="size-3.5" aria-hidden="true" />
        </IconButton>
      </span>
    </span>
  )
}
