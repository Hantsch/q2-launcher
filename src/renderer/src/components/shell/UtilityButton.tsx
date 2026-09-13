import { cn } from '../../lib/cn'
import { NavJobBadge } from './NavJobBadge'

export function UtilityButton({
  testId,
  label,
  active,
  onClick,
  badge,
  children,
}: {
  testId?: string
  label: string
  active: boolean
  onClick: () => void
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'no-drag relative grid size-11 place-items-center rounded-sm transition-colors duration-[--dur-fast]',
        active ? 'bg-hover text-flame-300' : 'text-ink-muted hover:bg-hover hover:text-ink',
      )}
    >
      {children}
      {!!badge && <NavJobBadge count={badge} testId={testId ? `${testId}-badge` : undefined} />}
    </button>
  )
}
