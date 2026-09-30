import { describe, expect, it } from 'vitest'

import { parseDemoHeader } from './demo-header'
import { buildDm2 } from './dm2-writer'
import { buildMvd2 } from './mvd2-writer'

describe('parseDemoHeader', () => {
  it('the format is chosen by the MVD2 magic, not by the caller', () => {
    const mvd2Bytes = buildMvd2({
      version: 2010,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: { 0: 'Some Level', 33: 'maps/q2dm1.bsp' },
      terminate: true,
    })
    const mvd2Result = parseDemoHeader(mvd2Bytes)
    expect(mvd2Result.ok).toBe(true)
    if (mvd2Result.ok) {
      expect(mvd2Result.format).toBe('mvd2')
      expect(mvd2Result.map).toBe('q2dm1')
    }

    const dm2Bytes = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: { 0: 'Some Level', 33: 'maps/q2dm1.bsp' },
      terminate: true,
    })
    const dm2Result = parseDemoHeader(dm2Bytes)
    expect(dm2Result.ok).toBe(true)
    if (dm2Result.ok) {
      expect(dm2Result.format).toBe('dm2')
      expect(dm2Result.map).toBe('q2dm1')
    }
  })

  it('an unparsable input still resolves through the same typed reasons', () => {
    const empty = parseDemoHeader(new Uint8Array(0))
    expect(empty).toEqual({ ok: false, reason: 'empty' })

    const wrongMagicButNotDm2Either = parseDemoHeader(new Uint8Array([1, 2, 3, 4, 5]))
    expect(wrongMagicButNotDm2Either.ok).toBe(false)
  })
})
