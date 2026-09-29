import { describe, expect, it } from 'vitest'
import type { EngineKind } from '@shared/types/engine'
import { DEMO_ACTIONS } from '@shared/config/action-catalog'
import { demoActionUnavailableReason } from './demo-action-availability'

const SEEK = 'config.controls.demo.seekNeedsQ2pro'
const SPEED = 'config.controls.demo.speedNeedsQ2pro'

const EXPECTED_WITHOUT_Q2PRO: Record<string, string | undefined> = {
  demoPause: undefined,
  demoJumpBack: SEEK,
  demoJumpForward: SEEK,
  demoJumpBackLong: SEEK,
  demoJumpForwardLong: SEEK,
  demoSpeedUp: SPEED,
  demoSpeedDown: SPEED,
}

describe('demoActionUnavailableReason', () => {
  it('seek and speed rows are unavailable only when no assigned engine is Q2PRO', () => {
    expect(Object.keys(EXPECTED_WITHOUT_Q2PRO).sort()).toEqual(DEMO_ACTIONS.map((a) => a.id).sort())
    const available: EngineKind[][] = [[], ['q2pro'], ['r1q2', 'q2pro']]
    const unavailable: EngineKind[][] = [['r1q2'], ['r1q2', 'vanilla'], ['unknown']]
    for (const [id, reason] of Object.entries(EXPECTED_WITHOUT_Q2PRO)) {
      const catalogId = `demo:${id}`
      for (const engines of available) {
        expect(demoActionUnavailableReason(catalogId, engines), `${id} ${engines}`).toBeUndefined()
      }
      for (const engines of unavailable) {
        expect(demoActionUnavailableReason(catalogId, engines), `${id} ${engines}`).toBe(reason)
      }
    }
  })

  it('never gates a non-demo row', () => {
    expect(demoActionUnavailableReason('movement:forward', ['r1q2'])).toBeUndefined()
  })
})
