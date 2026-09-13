import { describe, expect, it } from 'vitest'
import {
  actionKeySlots,
  clearKeySlot,
  keySlotAt,
  keySlotCount,
  withKeySlot,
} from '@shared/config/action-slots'
import type { ActionKeySlot, ConfigAction } from '@shared/modules/config'

function action(keys?: readonly ActionKeySlot[]): ConfigAction {
  return { id: 'a1', categoryId: 'c1', name: 'Jump', kind: 'bind', commands: [], keys }
}

const fiveSlots: readonly ActionKeySlot[] = [
  { key: 'W' },
  { key: 'X', modifier: 'ALT' },
  { key: 'Y' },
  { key: 'Z', modifier: 'CTRL' },
  { key: 'Q', modifier: 'SHIFT' },
]

describe('actionKeySlots', () => {
  it('returns the keys array as-is when present', () => {
    expect(actionKeySlots(action(fiveSlots))).toEqual(fiveSlots)
  })

  it('returns [] for an action with no keys field', () => {
    expect(actionKeySlots(action())).toEqual([])
  })
})

describe('keySlotAt', () => {
  it('returns the slot at a valid index', () => {
    expect(keySlotAt(action(fiveSlots), 4)).toEqual({ key: 'Q', modifier: 'SHIFT' })
  })

  it('returns undefined past the end of keys', () => {
    expect(keySlotAt(action(fiveSlots), 5)).toBeUndefined()
  })

  it('returns undefined for an action with no keys at all', () => {
    expect(keySlotAt(action(), 0)).toBeUndefined()
  })
})

describe('keySlotCount', () => {
  it('counts every slot, including beyond the old two-slot cap', () => {
    expect(keySlotCount(action(fiveSlots))).toBe(5)
  })

  it('is 0 for an action with no keys field', () => {
    expect(keySlotCount(action())).toBe(0)
  })
})

describe('withKeySlot', () => {
  it('replaces an existing slot in place, leaving the rest untouched', () => {
    const result = withKeySlot(action(fiveSlots), 1, { key: 'X2' })

    expect(actionKeySlots(result)).toEqual([
      { key: 'W' },
      { key: 'X2' },
      { key: 'Y' },
      { key: 'Z', modifier: 'CTRL' },
      { key: 'Q', modifier: 'SHIFT' },
    ])
  })

  it('appends a new slot at the next free index', () => {
    const result = withKeySlot(action(fiveSlots), 5, { key: 'N' })

    expect(keySlotCount(result)).toBe(6)
    expect(keySlotAt(result, 5)).toEqual({ key: 'N' })
  })

  it('appends a first slot to an action with no keys at all', () => {
    const result = withKeySlot(action(), 0, { key: 'F1' })

    expect(actionKeySlots(result)).toEqual([{ key: 'F1' }])
  })

  it('pads with empty-key slots when index is beyond the next free one', () => {
    const result = withKeySlot(action(), 2, { key: 'G' })

    expect(actionKeySlots(result)).toEqual([{ key: '' }, { key: '' }, { key: 'G' }])
  })

  it('does not mutate the original action', () => {
    const original = action(fiveSlots)
    withKeySlot(original, 0, { key: 'CHANGED' })

    expect(actionKeySlots(original)).toEqual(fiveSlots)
  })

  it('rejects a negative index', () => {
    expect(() => withKeySlot(action(), -1, { key: 'A' })).toThrow(RangeError)
  })
})

describe('clearKeySlot', () => {
  it('removes a middle slot and shifts later slots down', () => {
    const result = clearKeySlot(action(fiveSlots), 1)

    expect(actionKeySlots(result)).toEqual([
      { key: 'W' },
      { key: 'Y' },
      { key: 'Z', modifier: 'CTRL' },
      { key: 'Q', modifier: 'SHIFT' },
    ])
  })

  it('shrinks the array when clearing the last slot', () => {
    const result = clearKeySlot(action(fiveSlots), 4)

    expect(keySlotCount(result)).toBe(4)
  })

  it('drops the keys field entirely when clearing the only slot', () => {
    const result = clearKeySlot(action([{ key: 'W' }]), 0)

    expect(result.keys).toBeUndefined()
    expect(actionKeySlots(result)).toEqual([])
  })

  it('is a no-op for an out-of-range index', () => {
    const original = action(fiveSlots)
    const result = clearKeySlot(original, 10)

    expect(result).toBe(original)
  })

  it('is a no-op for an action with no keys at all', () => {
    const original = action()
    const result = clearKeySlot(original, 0)

    expect(result).toBe(original)
  })

  it('does not mutate the original action', () => {
    const original = action(fiveSlots)
    clearKeySlot(original, 0)

    expect(actionKeySlots(original)).toEqual(fiveSlots)
  })
})
