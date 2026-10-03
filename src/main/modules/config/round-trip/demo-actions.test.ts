import { describe, expect, it } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { STANDARD_TEMPLATE } from '@shared/modules/config'
import { DEMO_ACTIONS } from '@shared/config/catalog/action-catalog'
import { bindValueFor } from '@shared/config/aliases/action-mirror'
import { adoptRawBinds } from '@shared/config/profile/bind-adoption'
import { readAutorecord } from '@shared/config/catalog/autorecord'
import { buildDemoRows } from '@shared/config/catalog/catalog-rows'
import { renderProfileFile } from '@shared/config/render/render'
import { buildFixtureProfile } from '@shared/config/fixtures/profiles'
import { reimport, normalize, slotsOf, reimportProfile, installRoundTripRoot } from './helpers'

installRoundTripRoot()

describe('a bound demo speed action', () => {
  const speedIds = ['demoSpeedUp', 'demoSpeedDown'] as const

  function speedAction(id: (typeof speedIds)[number], key: string): ConfigAction {
    const row = buildDemoRows().find((candidate) => candidate.catalogId.endsWith(`:${id}`))!
    // Shaped exactly like `bind-adoption.ts#materialise` / the Controls grid would bind it.
    return {
      id: `entry-${id}`,
      categoryId: 'demo',
      // The catalogue label, as the Controls grid names a row (guarded command texts would slug alike).
      name: row.name!,
      kind: 'bind',
      catalogId: row.catalogId,
      commands: row.commands.map((text) => ({ kind: 'raw', text })),
      keys: [{ key }],
    }
  }

  function speedProfile(): ConfigProfile {
    const up = speedAction('demoSpeedUp', 'KP_PLUS')
    const down = speedAction('demoSpeedDown', 'KP_MINUS')
    return {
      id: 'speed-profile',
      name: 'Speed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars: {},
      // What the action mirror writes for each slot: the key calls the generated alias.
      binds: { KP_PLUS: bindValueFor(up), KP_MINUS: bindValueFor(down) },
      assignments: [],
      categories: STANDARD_TEMPLATE.categories
        .filter((category) => category.id === 'demo')
        .map((c) => ({ ...c })),
      actions: [up, down],
    }
  }

  it('a bound speed action survives write and read-back', async () => {
    const profile = speedProfile()
    const { profile2, text1 } = await reimportProfile(profile)

    for (const original of profile.actions!) {
      const back = profile2.actions!.filter((action) => action.catalogId === original.catalogId)
      expect(back, `exactly one entry for ${original.catalogId}`).toHaveLength(1)
      // Same row, same `if` checks in the same (engine execution) order.
      expect(back[0]!.commands).toEqual(original.commands)
      expect(slotsOf(back[0]!)).toEqual(slotsOf(original))
    }
    // The whole chain is written as one quoted alias body, `$timescale` verbatim inside it.
    for (const { id, command } of DEMO_ACTIONS.filter((action) => action.commands)) {
      expect(text1, id).toContain(`"${command}"`)
    }
    // A second pass is a fixed point, so nothing drifts on the next save either.
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })

  it('a hand-typed bind to the speed chain is adopted as the same catalogue row', async () => {
    const command = DEMO_ACTIONS.find((action) => action.id === 'demoSpeedUp')!.command
    const result = await reimport(`bind KP_PLUS "${command}"\n`)
    expect(result.binds.KP_PLUS).toBe(command)

    let next = 0
    const adopted = adoptRawBinds({ binds: result.binds, actions: [] }, () => `adopted-${next++}`)
    expect(adopted.adopted).toBe(1)
    expect(adopted.actions).toHaveLength(1)
    const expected = speedAction('demoSpeedUp', 'KP_PLUS')
    expect(adopted.actions[0]!.catalogId).toBe(expected.catalogId)
    expect(adopted.actions[0]!.commands).toEqual(expected.commands)
  })
})

describe('a guarded demo bind', () => {
  it('a guarded demo bind survives write and read-back quoted', async () => {
    const row = buildDemoRows().find((candidate) =>
      candidate.catalogId.endsWith(':demoJumpForward'),
    )!
    const action: ConfigAction = {
      id: 'entry-demoJumpForward',
      categoryId: 'demo',
      name: row.name!,
      kind: 'bind',
      catalogId: row.catalogId,
      commands: row.commands.map((text) => ({ kind: 'raw', text })),
      keys: [{ key: 'KP_RIGHTARROW' }],
    }
    const profile: ConfigProfile = {
      id: 'guard-profile',
      name: 'Guard',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      cvars: {},
      binds: { KP_RIGHTARROW: bindValueFor(action) },
      assignments: [],
      categories: STANDARD_TEMPLATE.categories
        .filter((category) => category.id === 'demo')
        .map((c) => ({ ...c })),
      actions: [action],
    }
    const { profile2, text1 } = await reimportProfile(profile)

    // The `$` bodies are quoted, so the engine stores them literally and expands them per press.
    const line = text1.split(/\r?\n/).find((l) => l.includes('cl_demopos'))
    expect(line).toMatch(/^alias \S+ "if x\$cl_demopos ne x\$q2l_armpos then seek \+10"/)

    const back = profile2.actions!.filter((entry) => entry.catalogId === action.catalogId)
    expect(back).toHaveLength(1)
    expect(back[0]!.commands).toEqual(action.commands)
    expect(slotsOf(back[0]!)).toEqual(slotsOf(action))
    expect(normalize(renderProfileFile(profile2))).toBe(normalize(text1))
  })
})

describe('the Q2PRO autorecord recipe', () => {
  it('a pasted q2pro autorecord recipe survives parse and render', async () => {
    const recipe = 'record ${cl_mapname}_${com_date}_${com_time}'
    const pasted = [
      `set cl_beginmapcmd "${recipe}"`,
      'set com_date_format %Y-%m-%d',
      'set com_time_format %H-%M-%S',
      '',
    ].join('\n')
    const result = await reimport(pasted)
    expect(result.cvars['cl_beginmapcmd']).toBe(recipe)
    expect(readAutorecord(result.cvars, 'q2pro')).toMatchObject({ kind: 'available', on: true })

    const profile = buildFixtureProfile({
      name: 'Story 168: pasted autorecord recipe',
      actions: [],
      cvars: result.cvars,
    })
    const text1 = renderProfileFile(profile)
    expect(text1).toContain(`"${recipe}"`)
    expect(text1).toContain('%H-%M-%S')

    const { profile2 } = await reimportProfile(profile)
    expect(readAutorecord(profile2.cvars, 'q2pro')).toMatchObject({ on: true })
    expect(profile2.cvars['cl_beginmapcmd']).toBe(recipe)
    const text2 = renderProfileFile(profile2)
    expect(text2).toContain(`"${recipe}"`)
    expect(normalize(text2)).toBe(normalize(text1))
  })
})
