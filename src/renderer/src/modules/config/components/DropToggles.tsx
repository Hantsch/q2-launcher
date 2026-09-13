import { MessageSquare, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '../../../components/ui/Button'

/**
 * Story 055 D3: a drop entry's two options - "drop ammo too" and "announce to team" - as icon
 * toggle buttons, replacing the two text-labelled `Checkbox`es the Options cell used to show.
 *
 * Pressed state is never colour alone (`/design-tokens`): `IconButton`'s `primary` variant differs
 * from `ghost` in border (`border-flame-300` vs `border-transparent`) and fill (`bg-flame-500` vs
 * transparent) at once, not hue alone, and `aria-pressed` carries the state to assistive tech
 * regardless of how it is styled. `label` is the button's short accessible name (also its default
 * tooltip - `IconButton` sets `title={label}`); passing `title` explicitly here overrides that
 * default with the longer, state-aware tooltip text the story's AC asks for (an idle "why would I
 * use this" hint that is not just the name repeated, and the disabled ammo toggle's explanation).
 *
 * One consumer shape (`ControlsTab.tsx`'s catalogue-row and plain-alias Options-cell paths, story
 * decision: no new `components/ui` atom for this) - sized `size="sm"` (28px) to match every other
 * icon button already living in the same 200px Options track (`renderMoveButtons`,
 * `renderPlainActionRow`'s edit/rename/remove trio), not the 44px touch-target floor the
 * `/design-tokens` skill would otherwise want: CLAUDE.md's Deviations table has its own row for this
 * component's 28px toggles (Controls Options cell and the Aliases tab's action cluster alike), same
 * desktop, mouse-and-keyboard-only rationale as the table's other dense-row entries.
 */
export interface DropTogglesProps {
  /** Whether the ammo toggle can be operated at all (`drop-entries.ts#dropStateFor`'s
   * `canToggleAmmo`, or - for a catalogue row whose entry has no body yet - the row's own
   * `ammoCommand`). `false` disables the toggle rather than hiding it (AC 4: a hidden control
   * explains nothing).
   *
   * Renamed from `hasAmmo` in the story's review (finding 4): the old name was one character away
   * from `DropState.hasAmmo`, which means the opposite thing - whether an ammo command is *present*,
   * i.e. the toggle's pressed state - and the two were wired to signals that could contradict each
   * other on the fixture's `drop_shells`-shaped entries. */
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
          // Story 055 review, finding 3: `aria-disabled`, NOT the native `disabled` attribute. A
          // natively disabled `Button`/`IconButton` carries `disabled:pointer-events-none`, which
          // takes its `title` out of reach of the mouse, and a disabled button is out of the tab
          // order too - so AC 4's "disabled with an explaining tooltip" explained nothing to either
          // input device. `aria-disabled` keeps the button focusable and hoverable (tooltip and
          // focus ring intact), announces the state to assistive tech, and the click handler
          // no-ops instead; the dimming that used to come from `disabled:opacity-45` is restated
          // here for the aria variant.
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
