import { describe, expect, it } from 'vitest'
import type { EffectiveSide } from '@shared/demos/effective-values'
import { formatDemoDate, sidesText } from './row-format'

describe('sidesText', () => {
  it('team names read A vs B', () => {
    const sides: EffectiveSide[] = [
      { team: 'Red', players: ['Alice', 'Bob'] },
      { team: 'Blue', players: ['Carl', 'Dana'] },
    ]
    expect(sidesText(sides)).toBe('Red vs Blue')
  })

  it('two unsided players read A vs B', () => {
    const sides: EffectiveSide[] = [{ players: ['Alice', 'Bob'] }]
    expect(sidesText(sides)).toBe('Alice vs Bob')
  })

  it('long player lists are capped with +n', () => {
    const sides: EffectiveSide[] = [{ players: ['Alice', 'Bob', 'Carl', 'Dana', 'Eve'] }]
    expect(sidesText(sides, (count) => `+${count}`)).toBe('Alice, Bob, Carl +2')
  })
})

describe('formatDemoDate', () => {
  it('a non-finite date formats to null', () => {
    expect(formatDemoDate(Number.NaN, 'en')).toBeNull()
    expect(formatDemoDate(Number.POSITIVE_INFINITY, 'en')).toBeNull()
    expect(formatDemoDate(null, 'en')).toBeNull()
    expect(formatDemoDate(undefined, 'en')).toBeNull()
  })
})
