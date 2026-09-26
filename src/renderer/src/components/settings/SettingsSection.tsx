import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Panel } from '../ui/primitives'

export interface SettingsSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** DOM id the Settings side nav scrolls to. */
  id: string
  title: string
  description?: string
  children: ReactNode
}

/**
 * One Settings section: a panel with a real heading (h2, so it reads as a section title rather
 * than as another stencilled field label) and an optional one-line description.
 */
export function SettingsSection({
  id,
  title,
  description,
  className,
  children,
  ...rest
}: SettingsSectionProps) {
  return (
    <Panel id={id} className={cn('scroll-mt-6 space-y-4 p-5', className)} {...rest}>
      <header className="space-y-0.5">
        <h2 className="font-display text-base tracking-[0.06em] text-ink uppercase">{title}</h2>
        {description && <p className="text-xs text-ink-muted">{description}</p>}
      </header>
      {children}
    </Panel>
  )
}
