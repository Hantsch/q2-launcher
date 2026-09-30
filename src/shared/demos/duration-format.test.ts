import { describe, expect, it } from 'vitest'
import { formatDemoDuration } from './duration-format'

describe('formatDemoDuration', () => {
  it('formats sub-hour durations as m:ss with unpadded minutes', () => {
    expect(formatDemoDuration(41000)).toEqual({ kind: 'known', text: '0:41' })
    expect(formatDemoDuration(620100)).toEqual({ kind: 'known', text: '10:20' })
    expect(formatDemoDuration(59 * 60 * 1000 + 59 * 1000)).toEqual({
      kind: 'known',
      text: '59:59'
    })
    expect(formatDemoDuration(3599400)).toEqual({ kind: 'known', text: '59:59' })
  })

  it('rolls over into h:mm:ss at the 3600s boundary', () => {
    expect(formatDemoDuration(3599600)).toEqual({ kind: 'known', text: '1:00:00' })
    expect(formatDemoDuration(3600000)).toEqual({ kind: 'known', text: '1:00:00' })
  })

  it('formats hour-scale durations as h:mm:ss', () => {
    expect(formatDemoDuration(3725000)).toEqual({ kind: 'known', text: '1:02:05' })
    expect(formatDemoDuration((12 * 3600 + 1) * 1000)).toEqual({ kind: 'known', text: '12:00:01' })
  })

  it('rounds up to at least one second for a tiny positive duration', () => {
    expect(formatDemoDuration(1)).toEqual({ kind: 'known', text: '0:01' })
  })

  it('no input ever yields 0:00', () => {
    const invalidInputs: Array<number | null | undefined> = [
      null,
      undefined,
      NaN,
      Infinity,
      -Infinity,
      0,
      -5
    ]

    for (const input of invalidInputs) {
      const result = formatDemoDuration(input)
      expect(result).toEqual({ kind: 'unknown' })
      if (result.kind === 'known') {
        expect((result as { text: string }).text).not.toBe('0:00')
      }
    }

    for (let ms = 0; ms <= 10000; ms += 137) {
      const result = formatDemoDuration(ms)
      if (result.kind === 'known') {
        expect(result.text).not.toBe('0:00')
      }
    }
  })
})
