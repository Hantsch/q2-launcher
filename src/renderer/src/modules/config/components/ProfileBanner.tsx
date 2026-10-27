import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

/** Full class names per tone: Tailwind only emits classes it can read literally from the source. */
const TONE = {
  warning: {
    box: 'border-warning/35 bg-warning/8',
    icon: 'text-warning',
    title: 'text-warning',
  },
  danger: {
    box: 'border-danger/35 bg-danger/8',
    icon: 'text-danger',
    title: 'text-danger',
  },
} as const

/**
 * The persistent notice strip of the profile view: a toned icon and title, an optional explanation,
 * an optional muted hint line and an optional row of actions. One layout for every profile notice so
 * they never drift apart.
 */
export function ProfileBanner({
  tone,
  title,
  body,
  hint,
  children,
  testId,
}: {
  tone: keyof typeof TONE
  title: string
  body?: string
  hint?: string
  children?: ReactNode
  testId?: string
}) {
  const classes = TONE[tone]
  return (
    <div data-testid={testId} className={`space-y-3 rounded-sm border p-3 ${classes.box}`}>
      <div className="flex items-start gap-2">
        <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${classes.icon}`} />
        <div className="space-y-1">
          <p className={`text-sm font-medium ${classes.title}`}>{title}</p>
          {body !== undefined && <p className="text-xs leading-relaxed text-ink-dim">{body}</p>}
          {hint !== undefined && <p className="text-xs text-ink-muted">{hint}</p>}
        </div>
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  )
}
