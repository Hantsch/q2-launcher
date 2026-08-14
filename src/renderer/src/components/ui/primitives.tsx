import type { HTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

export function Panel({
  className,
  children,
  raised,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { raised?: boolean }) {
  return (
    <div className={cn(raised ? 'panel-raised' : 'panel', 'rounded-md', className)} {...rest}>
      {children}
    </div>
  )
}

/** The stencilled equipment label above every group of content. */
export function SectionLabel({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('stencil', className)} {...rest}>
      {children}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-line', className)} />
}

export function StatusDot({ className, pulse }: { className?: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2 shrink-0">
      <span className={cn('size-2 rounded-full', className)} />
      {pulse && (
        <span
          className={cn('absolute inset-0 animate-ping rounded-full opacity-60', className)}
          style={{ animationDuration: '1.6s' }}
        />
      )}
    </span>
  )
}

export type BadgeTone = 'neutral' | 'flame' | 'success' | 'warning' | 'danger' | 'strogg'

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-line-strong bg-hover text-ink-dim',
  flame: 'border-flame-700 bg-flame-900/50 text-flame-300',
  success: 'border-success/35 bg-success/8 text-success',
  warning: 'border-warning/35 bg-warning/8 text-warning',
  danger: 'border-danger/35 bg-danger/8 text-danger',
  strogg: 'border-strogg-700 bg-strogg-900/40 text-strogg-300',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5',
        'font-display text-[10px] font-medium tracking-[0.12em] uppercase',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-ink-muted', className)} />
}

/** Label/value row used in every detail panel. */
export function KeyValue({
  label,
  children,
  mono,
  title,
}: {
  label: string
  children: ReactNode
  mono?: boolean
  title?: string
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <span className="stencil shrink-0">{label}</span>
      <span
        className={cn('min-w-0 truncate text-right text-xs text-ink-dim', mono && 'numeric')}
        title={title}
        data-selectable
      >
        {children}
      </span>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  hint,
  actions,
  className,
}: {
  icon?: ReactNode
  title: string
  body?: string
  hint?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-8 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="grid size-14 place-items-center rounded-md border border-line bg-panel text-ink-muted">
          {icon}
        </div>
      )}
      <div className="max-w-md space-y-2">
        <h3 className="font-display text-lg tracking-wide text-ink uppercase">{title}</h3>
        {body && <p className="text-sm leading-relaxed text-ink-dim">{body}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      {hint && <p className="max-w-md text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

/** Placeholder block while something loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-sm bg-hover', className)} />
}
