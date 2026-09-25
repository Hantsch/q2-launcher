import { describe, expect, it } from 'vitest'
import type { LaunchPhase, LaunchState } from '@shared/types'
import { isScanBlocked } from './scan-guard'

/**
 * Story 116 D2: `isScanBlocked` mirrors `LaunchService.isRunning()`'s predicate exactly (D-D) -
 * `'starting'`/`'running'` block, every other phase (including `'handed-off'`, which the launcher
 * has no reliable knowledge of) does not.
 */

function state(phase: LaunchPhase): LaunchState {
  return { phase, installationId: phase === 'idle' ? null : 'inst-1' }
}

describe('isScanBlocked', () => {
  const blocked: LaunchPhase[] = ['starting', 'running']
  const notBlocked: LaunchPhase[] = ['idle', 'handed-off', 'exited', 'failed']

  it.each(blocked)('blocks scans while the phase is %s', (phase) => {
    expect(isScanBlocked(state(phase))).toBe(true)
  })

  it.each(notBlocked)('does not block scans while the phase is %s', (phase) => {
    expect(isScanBlocked(state(phase))).toBe(false)
  })

  it('does not block on a handed-off session - the launcher has no reliable knowledge of it (D-D)', () => {
    expect(isScanBlocked(state('handed-off'))).toBe(false)
  })
})
