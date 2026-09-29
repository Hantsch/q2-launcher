import { describe, expect, it } from 'vitest'
import { demoSeekCommand } from './demo-control'

describe('demoSeekCommand', () => {
  it('seek command per format: dm2 and mvd2 both send seek', () => {
    for (const format of ['dm2', 'mvd2'] as const) {
      expect(demoSeekCommand(format, { kind: 'relative', seconds: 10 })).toBe('seek +10')
      expect(demoSeekCommand(format, { kind: 'relative', seconds: -10 })).toBe('seek -10')
      expect(demoSeekCommand(format, { kind: 'relative', seconds: 9.6 })).toBe('seek +10')
      expect(demoSeekCommand(format, { kind: 'absolute', seconds: 30 })).toBe('seek 30')
      expect(demoSeekCommand(format, { kind: 'absolute', seconds: 29.6 })).toBe('seek 30')
      expect(demoSeekCommand(format, { kind: 'absolute', seconds: -5 })).toBe('seek 0')
      expect(demoSeekCommand(format, { kind: 'percent', percent: 50 })).toBe('seek 50%')
      expect(demoSeekCommand(format, { kind: 'percent', percent: 49.6 })).toBe('seek 50%')
      expect(demoSeekCommand(format, { kind: 'percent', percent: 150 })).toBe('seek 100%')
      expect(demoSeekCommand(format, { kind: 'percent', percent: -3 })).toBe('seek 0%')
    }
  })
})
