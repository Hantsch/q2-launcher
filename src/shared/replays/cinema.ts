import { JUMP_STEP_S, PAGE_STEP_S, SPEED_STEPS, type TimelineAction } from './timeline'

/**
 * Cinema-mode rules: which key does what while the overlay is up, and whether cinema can run.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */

/** Idle time after which the cinema overlay hides itself. */
export const CINEMA_IDLE_MS = 3000

export type CinemaKeyEvent = { key: string; code: string; shiftKey: boolean }

export type CinemaKeyAction = TimelineAction | { kind: 'leave' }

export type CinemaAvailability = { available: true } | { available: false; reason: { key: string } }

/** Next step slower (`-1`) or faster (`1`) than `current`, clamped at the ends of SPEED_STEPS. */
function stepSpeed(current: number, direction: -1 | 1): number {
  const steps = SPEED_STEPS as readonly number[]
  const candidates = direction > 0 ? steps.filter((s) => s > current) : steps.filter((s) => s < current)
  if (candidates.length === 0) return steps[direction > 0 ? steps.length - 1 : 0]
  return direction > 0 ? candidates[0] : candidates[candidates.length - 1]
}

export function cinemaKeyAction(event: CinemaKeyEvent, currentSpeed: number): CinemaKeyAction | null {
  const jump = event.shiftKey ? PAGE_STEP_S : JUMP_STEP_S
  switch (event.code) {
    case 'Space':
    case 'KeyK':
      return { kind: 'togglePause' }
    case 'ArrowLeft':
      return { kind: 'jump', deltaS: -jump as -10 | -60 }
    case 'ArrowRight':
      return { kind: 'jump', deltaS: jump as 10 | 60 }
    case 'Comma':
      return { kind: 'speed', value: stepSpeed(currentSpeed, -1) }
    case 'Period':
      return { kind: 'speed', value: stepSpeed(currentSpeed, 1) }
    case 'KeyF':
      return { kind: 'fullscreen' }
    case 'Escape':
      return { kind: 'leave' }
    default:
      return null
  }
}
