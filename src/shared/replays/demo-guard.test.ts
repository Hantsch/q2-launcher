import { describe, expect, it } from 'vitest'
import { createCbufSim } from '../../test-support/q2-cbuf-sim'
import { DEMO_ACTIONS } from '@shared/config/catalog/action-catalog'
import { ARMPOS_CVAR, BACK_TO_WINDOW_COMMAND, guardDemoCommand } from './demo-guard'

/** Define the action the way a cfg does (`alias <name> "<body>"`), then press its key. */
function pressAction(sim: ReturnType<typeof createCbufSim>, body: string): void {
  sim.press(`alias act "${body}"`)
  sim.press('act')
  sim.run()
}

describe('demo guard (story 172 D1)', () => {
  it('a guarded demo action is ignored at the armed position and runs once the position moved', () => {
    const body = guardDemoCommand('seek +10')

    const armed = createCbufSim({ cvars: { [ARMPOS_CVAR]: '0:12.3' }, demoPos: '0:12.3' })
    pressAction(armed, body)
    expect(armed.log).toEqual([])

    const moved = createCbufSim({ cvars: { [ARMPOS_CVAR]: '0:12.3' }, demoPos: '0:12.4' })
    pressAction(moved, body)
    expect(moved.log).toEqual(['seek +10'])

    // No control loop ran (armpos never set): a playing demo takes the action.
    const plain = createCbufSim({ demoPos: '0:12.3' })
    pressAction(plain, body)
    expect(plain.log).toEqual(['seek +10'])

    // No demo at all (empty position) and no armpos: nothing runs, nothing but engine text printed.
    const none = createCbufSim()
    pressAction(none, body)
    expect(none.log).toEqual([])
    expect(none.output).toEqual([])
  })

  it('presses queued behind a parked control loop are ignored at the armed position', () => {
    const sim = createCbufSim({ cvars: { [ARMPOS_CVAR]: '0:05' }, demoPos: '0:05' })
    sim.press(`alias act "${guardDemoCommand('pause')}"`)
    // The loop is mid-script (parked on `wait`) while the user presses the key twice.
    sim.press('wait')
    sim.press('act')
    sim.press('act')
    sim.run()
    sim.frame()
    expect(sim.log).toEqual([])
  })

  it('every guarded catalogue command is skipped at the armed position and runs after a move', () => {
    for (const action of DEMO_ACTIONS.filter((a) => a.id !== 'demoBackToWindow')) {
      const stuck = createCbufSim({
        cvars: { [ARMPOS_CVAR]: '1:00', timescale: '1' },
        demoPos: '1:00',
      })
      pressAction(stuck, action.command)
      expect(stuck.log, `${action.id} at the armed position`).toEqual([])
      expect(stuck.cvars.get('timescale'), action.id).toBe('1')

      const moved = createCbufSim({
        cvars: { [ARMPOS_CVAR]: '1:00', timescale: '1' },
        demoPos: '1:01',
      })
      pressAction(moved, action.command)
      expect(moved.log.length, `${action.id} after the position moved`).toBeGreaterThan(0)
    }
  })

  it('the back-to-window command execs the cfg', () => {
    const sim = createCbufSim()
    sim.press(BACK_TO_WINDOW_COMMAND)
    sim.run()
    expect(sim.output).toEqual(["Couldn't exec q2l_back.cfg"])
    sim.files.set('q2l_back.cfg', 'echo back')
    sim.press(BACK_TO_WINDOW_COMMAND)
    sim.run()
    expect(sim.output.at(-1)).toBe('back')
  })
})
