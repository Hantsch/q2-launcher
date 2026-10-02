import { describe, expect, it } from 'vitest'

import { MVD2_HEADER_MAX_BYTES, parseMvd2Header } from './mvd2-header'
import { buildMvd2 } from './mvd2-writer'

describe('parseMvd2Header', () => {
  it('an mvd2 reports map, level name, game dir and players from its inline configstrings', () => {
    // original layout: CS_NAME=0, CS_MODELS=32, CS_PLAYERSKINS=1312
    const bytes = buildMvd2({
      version: 2010,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: {
        0: 'The Edge',
        33: 'maps/q2dm1.bsp',
        [1312 + 1]: 'Alice\\female/athena',
        [1312 + 2]: 'Bob\\male/grunt',
      },
      terminate: true,
    })
    const result = parseMvd2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      ok: true,
      format: 'mvd2',
      protocol: 37,
      mvdVersion: 2010,
      layout: 'original',
      gameDir: 'baseq2',
      levelName: 'The Edge',
      map: 'q2dm1',
      pov: null,
      players: ['Alice', 'Bob'],
    })
    expect(result.largestBlockBytes).toBeGreaterThan(0)
    expect(result.bytesConsumed).toBe(6 + result.largestBlockBytes)
  })

  it('an empty game dir resolves to baseq2', () => {
    const bytes = buildMvd2({
      version: 2010,
      gameDir: '',
      clientNum: 0,
      configstrings: {},
      terminate: true,
    })
    const result = parseMvd2Header(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.gameDir).toBe('baseq2')
  })

  it('an extended-limits mvd2 reads the extended configstring layout', () => {
    // extended layout: CS_MODELS=62, CS_PLAYERSKINS=12862
    const extended = parseMvd2Header(
      buildMvd2({
        version: 2011,
        flags: 4,
        gameDir: 'baseq2',
        clientNum: 0,
        layout: 'extended',
        configstrings: {
          0: 'Extended Level',
          [62 + 1]: 'maps/q2dm8.bsp',
          [12862 + 1]: 'Slayer\\male/cyborg',
        },
        terminate: true,
      }),
    )
    expect(extended.ok).toBe(true)
    if (extended.ok) {
      expect(extended.layout).toBe('extended')
      expect(extended.levelName).toBe('Extended Level')
      expect(extended.map).toBe('q2dm8')
      expect(extended.players).toEqual(['Slayer'])
    }

    // The same facts, but filled ONLY at original-layout indices with the extended end marker: if
    // the parser used the original table for it, this would still parse "ok" (the original indices
    // happen to overlap with valid low extended indices) yet the level/map/player facts would come
    // back missing, proving the extended table was actually the one consulted above.
    const original = parseMvd2Header(
      buildMvd2({
        version: 2011,
        flags: 4,
        gameDir: 'baseq2',
        clientNum: 0,
        layout: 'extended',
        configstrings: { 33: 'maps/q2dm1.bsp', [1312 + 1]: 'Ranger\\male/ranger' },
        terminate: true,
      }),
    )
    expect(original.ok).toBe(true)
    if (original.ok) {
      expect(original.map).toBeNull()
      expect(original.players).toEqual([])
    }
  })

  it('flags come from the word from 2012 on and from the opcode bits before', () => {
    // version 2012: cmd's top bits claim extended (would be wrong pre-2012), but the flags word
    // says not-extended — the flags word must win.
    const bytes = buildMvd2({
      version: 2012,
      flags: 0,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: {},
      terminate: true,
    })
    // Force the opcode's top bits to look like flags=4 despite the writer using 2012's own flags
    // word (which the writer already sets correctly to 0) — mutate byte 6 (the cmd byte) directly.
    const mutated = new Uint8Array(bytes)
    mutated[6] = (mutated[6]! & 31) | (4 << 5)
    const result = parseMvd2Header(mutated)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.layout).toBe('original')
  })

  it('an mvd2 has no POV and never lists the MVD dummy as a player', () => {
    const bytes = buildMvd2({
      version: 2010,
      gameDir: 'baseq2',
      clientNum: 2,
      configstrings: {
        [1312 + 1]: 'Alice\\female/athena',
        [1312 + 2]: 'DummySpectator\\male/grunt',
      },
      terminate: true,
    })
    const result = parseMvd2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pov).toBeNull()
    expect(result.players).toEqual(['Alice'])
  })

  it('the mvd version is recorded and one outside 2009-2013 is unknown-version', () => {
    const low = parseMvd2Header(
      buildMvd2({
        version: 2008,
        gameDir: 'baseq2',
        clientNum: 0,
        configstrings: {},
        terminate: true,
      }),
    )
    expect(low.ok).toBe(false)
    if (!low.ok) {
      expect(low.reason).toBe('unknown-version')
      expect(low.version).toBe(2008)
    }

    const high = parseMvd2Header(
      buildMvd2({
        version: 2014,
        gameDir: 'baseq2',
        clientNum: 0,
        configstrings: {},
        terminate: true,
      }),
    )
    expect(high.ok).toBe(false)
    if (!high.ok) {
      expect(high.reason).toBe('unknown-version')
      expect(high.version).toBe(2014)
    }

    const okLow = parseMvd2Header(
      buildMvd2({
        version: 2009,
        gameDir: 'baseq2',
        clientNum: 0,
        configstrings: {},
        terminate: true,
      }),
    )
    expect(okLow.ok).toBe(true)
    if (okLow.ok) expect(okLow.mvdVersion).toBe(2009)

    const okHigh = parseMvd2Header(
      buildMvd2({
        version: 2013,
        gameDir: 'baseq2',
        clientNum: 0,
        configstrings: {},
        terminate: true,
      }),
    )
    expect(okHigh.ok).toBe(true)
    if (okHigh.ok) expect(okHigh.mvdVersion).toBe(2013)
  })

  it('protocol 34 in an mvd2 is unknown-protocol', () => {
    const result = parseMvd2Header(
      buildMvd2({
        version: 2010,
        protocol: 34,
        gameDir: 'baseq2',
        clientNum: 0,
        configstrings: {},
        terminate: true,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unknown-protocol')
      expect(result.protocol).toBe(34)
    }
  })

  it('parsing stops after the first block regardless of trailing frames', () => {
    const bytes = buildMvd2({
      version: 2010,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: { 0: 'Some Level', 33: 'maps/q2dm1.bsp' },
      trailingBlocks: 500,
      terminate: true,
    })
    const result = parseMvd2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytesConsumed).toBe(6 + result.largestBlockBytes)
    expect(result.bytesConsumed).toBeLessThanOrEqual(MVD2_HEADER_MAX_BYTES)
    expect(bytes.length).toBeGreaterThan(result.bytesConsumed) // trailing blocks were never read
  })

  it('empty, truncated, garbage and wrong-magic mvd2 input return a typed unparsable reason', () => {
    const empty = parseMvd2Header(new Uint8Array(0))
    expect(empty).toEqual({ ok: false, reason: 'empty' })

    const validDemo = buildMvd2({
      version: 2010,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: { 0: 'Some Level' },
      terminate: true,
    })
    const truncated = parseMvd2Header(validDemo.slice(0, validDemo.length - 3))
    expect(truncated.ok).toBe(false)
    if (!truncated.ok) expect(truncated.reason).toBe('truncated')

    const garbage = parseMvd2Header(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(garbage.ok).toBe(false)
    if (!garbage.ok) expect(garbage.reason).toBe('not-a-demo')

    const wrongMagic = parseMvd2Header(new Uint8Array([0x44, 0x4d, 0x32, 0x32, 1, 0, 0]))
    expect(wrongMagic.ok).toBe(false)
    if (!wrongMagic.ok) expect(wrongMagic.reason).toBe('not-a-demo')
  })

  it('mutated mvd2 demos never throw and always return a result', () => {
    function mulberry32(seed: number): () => number {
      let a = seed
      return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    const rand = mulberry32(0xc0ffee)
    const base = buildMvd2({
      version: 2013,
      flags: 4,
      layout: 'extended',
      gameDir: 'rogue',
      clientNum: 4,
      configstrings: {
        0: 'Fuzz Level',
        63: 'maps/fuzz.bsp',
        [12862 + 5]: 'Fuzzer\\male/fuzz',
      },
      trailingBlocks: 3,
      terminate: true,
    })

    const isValidReason = (reason: string): boolean =>
      [
        'empty',
        'truncated',
        'not-a-demo',
        'unknown-protocol',
        'header-too-large',
        'unknown-version',
      ].includes(reason)

    for (let i = 0; i < 2000; i++) {
      const mode = rand() < 0.5 ? 'truncate' : 'flip'
      const mutated = new Uint8Array(base)
      let candidate: Uint8Array
      if (mode === 'truncate') {
        const cut = Math.floor(rand() * (base.length + 1))
        candidate = mutated.slice(0, cut)
      } else {
        const flips = 1 + Math.floor(rand() * 4)
        for (let f = 0; f < flips; f++) {
          const idx = Math.floor(rand() * mutated.length)
          mutated[idx] = Math.floor(rand() * 256)
        }
        candidate = mutated
      }

      let result: ReturnType<typeof parseMvd2Header>
      try {
        result = parseMvd2Header(candidate)
      } catch (err) {
        throw new Error(`parseMvd2Header threw on iteration ${i}: ${String(err)}`)
      }

      expect(typeof result.ok).toBe('boolean')
      if (!result.ok) expect(isValidReason(result.reason)).toBe(true)
    }
  })

  it('a high-bit byte in a name survives byte-identically', () => {
    const bytes = buildMvd2({
      version: 2010,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: { [1312 + 1]: 'Fr\x93agger\\male/grunt' },
      terminate: true,
    })
    const result = parseMvd2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.players).toEqual(['Fr\x93agger'])
    expect(result.players[0]!.charCodeAt(2)).toBe(0x93)
  })
})
