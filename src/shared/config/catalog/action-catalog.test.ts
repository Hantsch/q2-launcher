import { describe, expect, it } from 'vitest'
import {
  DEMO_ACTIONS,
  DROP_ACTIONS,
  DROPPABLES,
  MOVEMENT_ACTIONS,
  WEAPON_ACTIONS,
  WEAPON_EXTRA_ACTIONS,
} from './action-catalog'
import { ALIAS_LOOP_COUNT, CBUF_LINE_BYTES, MAX_ALIAS_NAME } from '../syntax/engine-limits'

function uniqueIds(items: { id: string }[]): boolean {
  const ids = items.map((i) => i.id)
  return new Set(ids).size === ids.length
}

describe('DROP_ACTIONS', () => {
  it('yields a weapon+ammo command pair for a droppable with ammo', () => {
    const rlauncher = DROP_ACTIONS.find((a) => a.id === 'rlauncher')
    expect(rlauncher?.commands).toEqual(['drop rocket launcher', 'drop rockets'])

    const shotgun = DROP_ACTIONS.find((a) => a.id === 'shotgun')
    expect(shotgun?.commands).toEqual(['drop shotgun', 'drop shells'])
  })

  it('yields a single-element commands array for a droppable without ammo', () => {
    const quad = DROP_ACTIONS.find((a) => a.id === 'quad')
    expect(quad?.commands).toEqual(['drop quad damage'])

    const tech = DROP_ACTIONS.find((a) => a.id === 'tech')
    expect(tech?.commands).toEqual(['drop tech'])
  })

  it('has one entry per droppable', () => {
    expect(DROP_ACTIONS).toHaveLength(DROPPABLES.length)
  })
})

describe('id uniqueness', () => {
  it('is unique within MOVEMENT_ACTIONS', () => {
    expect(uniqueIds(MOVEMENT_ACTIONS)).toBe(true)
  })

  it('is unique within WEAPON_ACTIONS', () => {
    expect(uniqueIds(WEAPON_ACTIONS)).toBe(true)
  })

  it('is unique within WEAPON_EXTRA_ACTIONS', () => {
    expect(uniqueIds(WEAPON_EXTRA_ACTIONS)).toBe(true)
  })

  it('is unique within DROPPABLES', () => {
    expect(uniqueIds(DROPPABLES)).toBe(true)
  })
})

describe('DEMO_ACTIONS', () => {
  it("each demo action's command text is pinned", () => {
    // Literal expectations: 10 and 60 are the timeline's JUMP_STEP_S / PAGE_STEP_S (story 165); if
    // those constants change, these strings must change on purpose.
    const commands = Object.fromEntries(DEMO_ACTIONS.map((a) => [a.id, a.command]))
    const G = 'if x$cl_demopos ne x$q2l_armpos then '
    expect(commands).toEqual({
      demoPause: `${G}pause`,
      demoJumpBack: `${G}seek -10`,
      demoJumpForward: `${G}seek +10`,
      demoJumpBackLong: `${G}seek -60`,
      demoJumpForwardLong: `${G}seek +60`,
      // Story 167 D2: SPEED_STEPS [0.25, 0.5, 1, 2, 4]; up checks descending, down ascending.
      demoSpeedUp:
        `${G}if $timescale == 2 then timescale 4; ${G}if $timescale == 1 then timescale 2; ` +
        `${G}if $timescale == 0.5 then timescale 1; ${G}if $timescale == 0.25 then timescale 0.5`,
      demoSpeedDown:
        `${G}if $timescale == 0.5 then timescale 0.25; ${G}if $timescale == 1 then timescale 0.5; ` +
        `${G}if $timescale == 2 then timescale 1; ${G}if $timescale == 4 then timescale 2`,
      // Story 172 D1: unguarded - `q2l_back.cfg` guards itself.
      demoBackToWindow: 'exec q2l_back.cfg',
    })
  })

  it('demo labels are config.actionCatalog keys with an ASCII label', () => {
    for (const a of DEMO_ACTIONS) {
      expect(a.category).toBe('demo')
      expect(a.labelKey).toBe(`config.actionCatalog.${a.id}.label`)
      expect(a.descriptionKey).toBe(`config.actionCatalog.${a.id}.description`)
      expect(a.label).toMatch(/^[\x20-\x7E]+$/)
    }
    expect(uniqueIds(DEMO_ACTIONS)).toBe(true)
  })
})

describe('engine-limits', () => {
  it('carries the citation-backed buffer/alias constants', () => {
    expect(CBUF_LINE_BYTES).toBe(1024)
    expect(MAX_ALIAS_NAME).toBe(32)
    expect(ALIAS_LOOP_COUNT).toBe(16)
  })
})
