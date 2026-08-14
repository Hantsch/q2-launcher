import type { CheckSeverity, InstallationStatus } from '@shared/types'

export interface StatusTone {
  /** Text colour class. */
  text: string
  /** Background for a dot or pill. */
  dot: string
  /** Subtle background wash for a row or badge. */
  wash: string
  border: string
  labelKey: string
}

/**
 * One mapping from installation health to colour, used by the rail, the action
 * bar and the library so a "needs attention" install looks identical everywhere.
 */
export const STATUS_TONES: Record<InstallationStatus, StatusTone> = {
  ok: {
    text: 'text-success',
    dot: 'bg-success',
    wash: 'bg-success/8',
    border: 'border-success/35',
    labelKey: 'installation.status.ok',
  },
  warning: {
    text: 'text-warning',
    dot: 'bg-warning',
    wash: 'bg-warning/8',
    border: 'border-warning/35',
    labelKey: 'installation.status.warning',
  },
  invalid: {
    text: 'text-danger',
    dot: 'bg-danger',
    wash: 'bg-danger/8',
    border: 'border-danger/35',
    labelKey: 'installation.status.invalid',
  },
  missing: {
    text: 'text-danger',
    dot: 'bg-danger',
    wash: 'bg-danger/8',
    border: 'border-danger/35',
    labelKey: 'installation.status.missing',
  },
  unknown: {
    text: 'text-ink-muted',
    dot: 'bg-ink-muted',
    wash: 'bg-hover',
    border: 'border-line',
    labelKey: 'installation.status.unknown',
  },
}

export function statusTone(status: InstallationStatus): StatusTone {
  return STATUS_TONES[status]
}

export const SEVERITY_TONES: Record<CheckSeverity, { text: string; icon: string }> = {
  ok: { text: 'text-success', icon: 'CircleCheck' },
  warn: { text: 'text-warning', icon: 'TriangleAlert' },
  error: { text: 'text-danger', icon: 'CircleX' },
}

/** True when the installation can be started right now. */
export function isPlayable(status: InstallationStatus): boolean {
  return status === 'ok' || status === 'warning'
}
