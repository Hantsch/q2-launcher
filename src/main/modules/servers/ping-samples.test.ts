import { describe, expect, it } from 'vitest'
import { PING_SAMPLES_EXTRA, PING_SAMPLES_FIRST, medianPing, samplesFarApart } from './ping-samples'

describe('medianPing', () => {
  it('takes the middle of an odd count regardless of order', () => {
    expect(medianPing([90, 20, 40])).toBe(40)
  })

  it('averages the two middle values of an even count', () => {
    expect(medianPing([10, 20, 30, 50])).toBe(25)
  })

  it('rounds to whole milliseconds', () => {
    expect(medianPing([10, 21])).toBe(16)
    expect(medianPing([10, 20, 31, 41])).toBe(26)
  })

  it('does not reorder the caller array', () => {
    const samples = [30, 10, 20]
    medianPing(samples)
    expect(samples).toEqual([30, 10, 20])
  })
})

describe('samplesFarApart', () => {
  it('flags a wide spread on a near server', () => {
    expect(samplesFarApart([20, 70, 400])).toBe(true)
  })

  it('ignores a few ms of jitter', () => {
    expect(samplesFarApart([20, 24, 31])).toBe(false)
  })

  it('needs the relative bound too: 50 ms on a 330 ms server is not far apart', () => {
    expect(samplesFarApart([300, 330, 350])).toBe(false)
  })

  it('is false for fewer than two samples', () => {
    expect(samplesFarApart([40])).toBe(false)
    expect(samplesFarApart([])).toBe(false)
  })
})

describe('sample counts', () => {
  it('takes three samples first and three more on disagreement', () => {
    expect(PING_SAMPLES_FIRST).toBe(3)
    expect(PING_SAMPLES_EXTRA).toBe(3)
  })
})
