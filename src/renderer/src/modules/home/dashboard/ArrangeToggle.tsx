import { useTranslation } from 'react-i18next'
import { Check, LayoutGrid } from 'lucide-react'
import { IconButton } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'

/**
 * The dashboard's arrange-mode toggle (story 086 D4, User decision: the arrange control sits with
 * the content it edits, not the titlebar utility row).
 *
 * User feedback: the header row this replaces - an all-caps "DASHBOARD" title beside a labelled
 * "Arrange dashboard" button - only cost vertical space. What is left is one icon, absolutely
 * positioned into the top-left of the arrange bar's already-reserved slot (`Dashboard.tsx`'s
 * `pt-14`), so it adds no layout height of its own in either mode and never moves between them.
 * `.dashboard-arrange-bar`'s left inset (dashboard.css) is sized to clear it, which is what lets
 * the same single element sit in empty space outside arrange mode and inside the bar within it -
 * one position, one `data-testid`, nothing to keep in sync.
 *
 * At rest it is invisible and fades in while the pointer is anywhere over the dashboard
 * (`group-hover/dashboard` - the container in `Dashboard.tsx` carries `group/dashboard`) or while
 * it holds keyboard focus. Arrange mode keeps it visible unconditionally: the control you need in
 * order to *leave* a mode must not have to be rediscovered by hovering.
 *
 * The opacity lives on the wrapper, not on the button, because `IconButton`'s own
 * `disabled:opacity-45` would otherwise out-specify `opacity-0` and leave the disabled (narrow
 * window) toggle permanently half-visible - `cn` is plain `clsx`, it does not resolve conflicts.
 *
 * With no visible text left, `label` carries the whole meaning (`IconButton` puts it on both
 * `aria-label` and a native `title`), and the disabled hint takes its place when arrange mode is
 * unavailable - same string that used to be the button's `title` attribute.
 */
export function ArrangeToggle({
  arrangeMode,
  onToggle,
  disabled,
}: {
  arrangeMode: boolean
  onToggle: () => void
  disabled: boolean
}) {
  const { t } = useTranslation()

  const label = disabled
    ? t('home.dashboard.arrange.disabledHint')
    : t(arrangeMode ? 'home.dashboard.arrange.on' : 'home.dashboard.arrange.off')

  return (
    <span
      className={cn(
        'absolute top-3 left-3 z-30 inline-flex',
        'transition-opacity duration-[--dur-fast] ease-[--ease-out-quart]',
        arrangeMode
          ? 'opacity-100'
          : 'opacity-0 group-hover/dashboard:opacity-100 focus-within:opacity-100',
      )}
    >
      <IconButton
        label={label}
        size="sm"
        variant={arrangeMode ? 'primary' : 'neutral'}
        disabled={disabled}
        data-testid="dashboard-arrange-toggle"
        onClick={onToggle}
      >
        {arrangeMode ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <LayoutGrid className="size-3.5" aria-hidden="true" />
        )}
      </IconButton>
    </span>
  )
}
