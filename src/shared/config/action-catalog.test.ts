import { describe, expect, it } from 'vitest'
import {
  DROP_ACTIONS,
  DROPPABLES,
  MOVEMENT_ACTIONS,
  WEAPON_ACTIONS,
  WEAPON_EXTRA_ACTIONS,
} from './action-catalog'
import { ALIAS_LOOP_COUNT, CBUF_LINE_BYTES, MAX_ALIAS_NAME } from './engine-limits'

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

describe('engine-limits', () => {
  it('carries the citation-backed buffer/alias constants', () => {
    expect(CBUF_LINE_BYTES).toBe(1024)
    expect(MAX_ALIAS_NAME).toBe(32)
    expect(ALIAS_LOOP_COUNT).toBe(16)
  })
})
