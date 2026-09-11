import type { HomeLayout, TilePlacement } from '@shared/modules/home'
import { describe, expect, it } from 'vitest'
import { collides, firstFreeSpot, move, place, resize, stack } from './layout'

/** Story 086 D2 acceptance tests (AC1, AC5, AC6, AC13). */

function tile(moduleId: TilePlacement['moduleId'], x: number, y: number, w: number, h: number): TilePlacement {
  return { moduleId, x, y, w, h }
}

function layoutOf(...tiles: TilePlacement[]): HomeLayout {
  return { tiles }
}

describe('collides', () => {
  it('is true when two rects actually overlap', () => {
    expect(collides(tile('playtime', 0, 0, 4, 4), tile('configProfiles', 2, 2, 4, 4))).toBe(true)
  })

  it('is false when rects only touch edges', () => {
    expect(collides(tile('playtime', 0, 0, 4, 4), tile('configProfiles', 4, 0, 4, 4))).toBe(false)
    expect(collides(tile('playtime', 0, 0, 4, 4), tile('configProfiles', 0, 4, 4, 4))).toBe(false)
  })

  it('is false when rects are fully separated', () => {
    expect(collides(tile('playtime', 0, 0, 2, 2), tile('configProfiles', 6, 6, 2, 2))).toBe(false)
  })
})

describe('place', () => {
  it('appends a new tile and never mutates the input layout', () => {
    const input = layoutOf(tile('playtime', 0, 0, 4, 4))
    const result = place(input, 'configProfiles', { x: 4, y: 0, w: 4, h: 4 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.layout.tiles).toHaveLength(2)
    expect(result.layout).not.toBe(input)
    expect(input.tiles).toHaveLength(1)
  })

  it('AC5: refuses a rect that collides with an existing tile, reason non-empty, input untouched', () => {
    const input = layoutOf(tile('playtime', 0, 0, 4, 4))
    const result = place(input, 'configProfiles', { x: 2, y: 2, w: 4, h: 4 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.layout).toBe(input)
  })

  it('AC5: refuses a rect that leaves the 12-column grid', () => {
    const input = layoutOf()
    const result = place(input, 'playtime', { x: 10, y: 0, w: 4, h: 4 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.layout).toBe(input)
  })

  it('AC5: refuses a rect below the module minimum size (2x2)', () => {
    const input = layoutOf()
    const result = place(input, 'playtime', { x: 0, y: 0, w: 1, h: 2 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.layout).toBe(input)
  })

  it('refuses placing a module id that is already on the grid', () => {
    const input = layoutOf(tile('playtime', 0, 0, 4, 4))
    const result = place(input, 'playtime', { x: 8, y: 0, w: 4, h: 4 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.layout).toBe(input)
  })
})

describe('move', () => {
  it('relocates a tile to a new x/y, keeping its w/h', () => {
    const input = layoutOf(tile('playtime', 0, 0, 4, 4), tile('configProfiles', 4, 0, 4, 4))
    const result = move(input, 'playtime', { x: 0, y: 4 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.layout.tiles.find((t) => t.moduleId === 'playtime')).toEqual({
      moduleId: 'playtime',
      x: 0,
      y: 4,
      w: 4,
      h: 4,
    })
  })

  it('AC1: a valid move never compacts the other tile - it keeps its exact x/y/w/h', () => {
    const other = tile('configProfiles', 4, 0, 4, 4)
    const input = layoutOf(tile('playtime', 0, 0, 4, 4), other)
    const result = move(input, 'playtime', { x: 0, y: 8 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.layout.tiles.find((t) => t.moduleId === 'configProfiles')).toEqual(other)
  })

  it('AC5/AC1: refuses a move that would overlap another tile; nothing moves, reason non-empty', () => {
    const other = tile('configProfiles', 4, 0, 4, 4)
    const input = layoutOf(tile('playtime', 0, 0, 4, 4), other)
    const result = move(input, 'playtime', { x: 2, y: 0 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.layout).toBe(input)
    // the untouched tile really is untouched - no gap was ever closed
    expect(result.layout.tiles.find((t) => t.moduleId === 'configProfiles')).toEqual(other)
  })

  it('AC5: refuses a move that would leave the grid', () => {
    const input = layoutOf(tile('playtime', 0, 0, 4, 4))
    const result = move(input, 'playtime', { x: 10, y: 0 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.layout).toBe(input)
  })

  it('refuses moving a module id that is not placed', () => {
    const input = layoutOf(tile('playtime', 0, 0, 4, 4))
    const result = move(input, 'configProfiles', { x: 8, y: 0 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.layout).toBe(input)
  })
})

describe('resize', () => {
  it('changes w/h, keeping x/y', () => {
    const input = layoutOf(tile('playtime', 0, 0, 4, 4))
    const result = resize(input, 'playtime', { w: 6, h: 6 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.layout.tiles[0]).toEqual({ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 6 })
  })

  it('AC5: refuses a resize that would overlap another tile; the other tile is untouched', () => {
    const other = tile('configProfiles', 6, 0, 4, 4)
    const input = layoutOf(tile('playtime', 0, 0, 4, 4), other)
    const result = resize(input, 'playtime', { w: 8, h: 4 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.layout).toBe(input)
    expect(result.layout.tiles.find((t) => t.moduleId === 'configProfiles')).toEqual(other)
  })

  it('AC5: refuses a resize that would leave the grid', () => {
    const input = layoutOf(tile('playtime', 8, 0, 4, 4))
    const result = resize(input, 'playtime', { w: 6, h: 4 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.layout).toBe(input)
  })

  it('AC5: refuses shrinking below the module minimum size (2x2)', () => {
    const input = layoutOf(tile('playtime', 0, 0, 4, 4))
    const result = resize(input, 'playtime', { w: 1, h: 4 })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(result.layout).toBe(input)
  })
})

describe('stack', () => {
  it('orders tiles row-major: top-to-bottom, then left-to-right', () => {
    const bottomRight = tile('configProfiles', 6, 4, 4, 4)
    const topLeft = tile('playtime', 0, 0, 4, 4)
    const input = layoutOf(bottomRight, topLeft)

    expect(stack(input)).toEqual([topLeft, bottomRight])
  })

  it('does not mutate the input layout or its tiles', () => {
    const input = layoutOf(tile('configProfiles', 6, 4, 4, 4), tile('playtime', 0, 0, 4, 4))
    const before = [...input.tiles]

    stack(input)

    expect(input.tiles).toEqual(before)
  })
})

describe('firstFreeSpot', () => {
  it('AC6: scans row-major and returns an earlier hole, not a later, larger free area', () => {
    // Row y=0..2: playtime occupies x 0..4, configProfiles occupies x 8..12 - a 4-wide hole at
    // x=4. Row y=2 onward is entirely free (a much larger area) but sorts later in row-major
    // order, so a correct scan must prefer the earlier, smaller hole.
    const input = layoutOf(tile('playtime', 0, 0, 4, 2), tile('configProfiles', 8, 0, 4, 2))

    expect(firstFreeSpot(input, 2, 2)).toEqual({ x: 4, y: 0 })
  })

  it('returns null when the requested size cannot fit on the grid at all', () => {
    expect(firstFreeSpot(layoutOf(), 13, 2)).toBeNull()
  })
})
