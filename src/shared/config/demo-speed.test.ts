import { describe, expect, it } from 'vitest'
import { CBUF_LINE_BYTES } from '@shared/config/engine-limits'
import { SPEED_STEPS } from '@shared/replays/timeline'
import { DEMO_ACTIONS } from './action-catalog'
import { buildDemoRows } from './catalog-rows'
import { speedDownCommand, speedDownCommands, speedUpCommand, speedUpCommands } from './demo-speed'

/**
 * A tiny model of how Q2PRO runs a bound body (see `demo-speed.ts`'s doc comment for the source):
 * the command buffer splits it at `;`, each piece has `$timescale` expanded *when it runs* (not
 * when the body was defined), and `if a == b then <cmd>` compares numerically and runs `<cmd>`
 * before the next piece. Expanding the whole body once up front would hide a cascading order, so
 * this deliberately does not.
 */
function press(body: string, timescale: string): string {
  let current = timescale
  for (const piece of body.split(';')) {
    const expanded = piece.trim().replace(/\$timescale\b/g, current)
    const m = /^if (\S+) == (\S+) then (.+)$/.exec(expanded)
    if (!m) throw new Error(`unexpected command piece: ${piece}`)
    const [, a, b, branch] = m
    if (Number(a) !== Number(b)) continue
    const set = /^timescale (\S+)$/.exec(branch!)
    if (!set) throw new Error(`unexpected branch: ${branch}`)
    current = set[1]!
  }
  return current
}

describe('demo speed commands (story 167 D2)', () => {
  it('speed up and speed down move exactly one timeline step per press', () => {
    const up = speedUpCommand()
    const down = speedDownCommand()
    const steps = SPEED_STEPS.map(String)

    for (let i = 0; i < steps.length; i++) {
      // One step per press, clamped at the fastest / slowest step.
      expect(press(up, steps[i]!), `up from ${steps[i]}`).toBe(steps[Math.min(i + 1, steps.length - 1)])
      expect(press(down, steps[i]!), `down from ${steps[i]}`).toBe(steps[Math.max(i - 1, 0)])
    }

    // Walk the whole ladder both ways, one press at a time, and past both ends.
    let value = steps[0]!
    const walkedUp = [value]
    for (let n = 0; n < steps.length; n++) walkedUp.push((value = press(up, value)))
    expect(walkedUp).toEqual([...steps, steps.at(-1)])
    const walkedDown = [value]
    for (let n = 0; n < steps.length; n++) walkedDown.push((value = press(down, value)))
    expect(walkedDown).toEqual([...[...steps].reverse(), steps[0]])

    // Numeric `==`: a differently formatted cvar string still matches its step.
    expect(press(up, '0.250')).toBe('0.5')
    // A value off the ladder matches nothing - no jump to an arbitrary step.
    expect(press(up, '3')).toBe('3')
  })

  it('the check order is what prevents a cascade within one press', () => {
    // Guard against the silent failure: reversing the chain would run every step in one press.
    const ascendingUp = speedUpCommand().split('; ').reverse().join('; ')
    expect(press(ascendingUp, '0.25')).toBe('4')
  })

  it('the catalogue row carries the same checks, in the same order, as separate commands', () => {
    const rows = Object.fromEntries(buildDemoRows().map((row) => [row.catalogId, row.commands]))
    for (const action of DEMO_ACTIONS.filter((a) => a.id.startsWith('demoSpeed'))) {
      const commands = rows[`demo:${action.id}`]
      expect(commands, action.id).toEqual(action.id === 'demoSpeedUp' ? speedUpCommands() : speedDownCommands())
      expect(commands!.join('; ')).toBe(action.command)
    }
  })

  it('bodies are quote-free, single-line and well under the engine line limit', () => {
    for (const body of [speedUpCommand(), speedDownCommand()]) {
      expect(body).not.toMatch(/["\r\n]/)
      // `alias <name> "<body>"` plus a comment still has to fit one buffer line.
      expect(body.length).toBeLessThan(CBUF_LINE_BYTES / 2)
    }
  })
})
