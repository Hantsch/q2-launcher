import { Badge } from '../ui/primitives'

const MAX_DISPLAY_COUNT = 99

/**
 * Corner badge for the number of active jobs (currently downloads) on a nav
 * button. Renders nothing at 0 - story 032 D2. Wiring this into a specific
 * button (aria-label, TitleBar placement) belongs to D3.
 */
export function NavJobBadge({ count, testId }: { count: number; testId?: string }) {
  if (count <= 0) return null

  const label = count > MAX_DISPLAY_COUNT ? `${MAX_DISPLAY_COUNT}+` : String(count)

  return (
    <Badge
      tone="flame"
      testId={testId}
      className="absolute -top-1 -right-1 min-w-[1.1rem] justify-center px-1 py-0 tabular-nums"
    >
      {label}
    </Badge>
  )
}
