import { cn } from '../../lib/cn'
import { formatPercent } from '../../lib/format'

export interface ProgressBarProps {
  /** 0..1, or null when the total is unknown (renders indeterminate). */
  ratio: number | null
  /** Draws the green PLAYABLE tick at this ratio. */
  playableAtRatio?: number
  /** Runs the sheen animation; false for a paused or finished job. */
  active?: boolean
  className?: string
  label?: string
}

export function ProgressBar({
  ratio,
  playableAtRatio,
  active = true,
  className,
  label,
}: ProgressBarProps) {
  const indeterminate = ratio === null
  const clamped = indeterminate ? 0 : Math.min(1, Math.max(0, ratio))

  return (
    <div
      className={cn('progress-track', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': Math.round(clamped * 100) })}
      {...(indeterminate ? {} : { 'aria-valuetext': formatPercent(clamped) })}
    >
      <div
        className="progress-fill"
        data-active={active ? 'true' : 'false'}
        data-indeterminate={indeterminate ? 'true' : 'false'}
        style={indeterminate ? undefined : { width: `${clamped * 100}%` }}
      />
      {playableAtRatio !== undefined && playableAtRatio > 0 && playableAtRatio < 1 && (
        <div className="progress-marker" style={{ left: `${playableAtRatio * 100}%` }} />
      )}
    </div>
  )
}
