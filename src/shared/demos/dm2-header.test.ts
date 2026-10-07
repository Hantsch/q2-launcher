import { describe, expect, it } from 'vitest'

import { DM2_HEADER_MAX_BYTES, parseDm2Header } from './dm2-header'
import { buildDm2 } from './dm2-writer'

describe('parseDm2Header', () => {
  it('a protocol-34 demo reports its map from CS_MODELS+1', () => {
    const bytes = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: { 33: 'maps/q2dm1.bsp' },
      terminate: true,
    })
    const result = parseDm2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.map).toBe('q2dm1')
  })

  it('the level name comes from CS_NAME', () => {
    const bytes = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: { 0: 'The Edge' },
      terminate: true,
    })
    const result = parseDm2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.levelName).toBe('The Edge')
  })

  it('the game dir comes from serverdata and an empty one is baseq2', () => {
    const withDir = parseDm2Header(
      buildDm2({
        protocol: 34,
        gameDir: 'xatrix',
        playernum: 0,
        configstrings: {},
        terminate: true,
      }),
    )
    expect(withDir.ok).toBe(true)
    if (withDir.ok) expect(withDir.gameDir).toBe('xatrix')

    const withoutDir = parseDm2Header(
      buildDm2({ protocol: 34, gameDir: '', playernum: 0, configstrings: {}, terminate: true }),
    )
    expect(withoutDir.ok).toBe(true)
    if (withoutDir.ok) expect(withoutDir.gameDir).toBe('baseq2')
  })

  it('the POV is the playernum skin slot up to the first backslash', () => {
    // original layout: CS_PLAYERSKINS = 1312
    const bytes = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 2,
      configstrings: { [1312 + 2]: 'Ranger\\male/ranger' },
      terminate: true,
    })
    const result = parseDm2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pov).toBe('Ranger')
  })

  it('every non-empty player skin slot yields a player name', () => {
    const bytes = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: {
        [1312 + 0]: 'Alice\\female/athena',
        [1312 + 3]: 'Bob\\male/grunt',
        [1312 + 1]: '', // explicitly empty, should be skipped
      },
      terminate: true,
    })
    const result = parseDm2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.players).toEqual(['Alice', 'Bob'])
  })

  it('a 3434-3436 demo yields the same facts through the extended layout and reports its protocol', () => {
    // extended layout: CS_MODELS = 62, CS_PLAYERSKINS = 12862
    for (const protocol of [3434, 3435, 3436] as const) {
      const bytes = buildDm2({
        protocol,
        gameDir: 'baseq2',
        playernum: 1,
        configstrings: {
          0: 'Extended Level',
          [62 + 1]: 'maps/q2dm8.bsp',
          [12862 + 1]: 'Slayer\\male/cyborg',
        },
        terminate: true,
      })
      const result = parseDm2Header(bytes)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.protocol).toBe(protocol)
      expect(result.layout).toBe('extended')
      expect(result.levelName).toBe('Extended Level')
      expect(result.map).toBe('q2dm8')
      expect(result.pov).toBe('Slayer')
    }

    // A protocol-34 demo filling ONLY original-layout indices: if the parser used the wrong
    // (extended) table for it, CS_MODELS+1 (33) would not land on the model configstring and
    // map/pov/players would come back null/empty instead of resolving.
    const original = parseDm2Header(
      buildDm2({
        protocol: 34,
        gameDir: 'baseq2',
        playernum: 0,
        configstrings: { 33: 'maps/q2dm1.bsp', 1312: 'Ranger\\male/ranger' },
        terminate: true,
      }),
    )
    expect(original.ok).toBe(true)
    if (original.ok) {
      expect(original.layout).toBe('original')
      expect(original.map).toBe('q2dm1')
      expect(original.pov).toBe('Ranger')
    }
  })

  it('parsing stops after the header regardless of trailing frames', () => {
    // Header messages and the trailing "done" message (opcode 14) each get their own block
    // (forced via a small maxBlockPayload), and are NOT terminated — instead a large chunk of
    // unparsed/unparseable bytes follows, standing in for "the rest of a much longer recording".
    // If the parser only stops at the block containing the done message (as it must), it never
    // has to look at — let alone successfully parse — anything past that block.
    const header = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: { 0: 'Some Level', 33: 'maps/q2dm1.bsp' },
      trailingFrameBytes: 10,
      maxBlockPayload: 200,
    })
    const restOfFile = new Uint8Array(50_000).fill(0xaa) // garbage: not a valid block/message stream
    const bytes = new Uint8Array(header.length + restOfFile.length)
    bytes.set(header, 0)
    bytes.set(restOfFile, header.length)

    const result = parseDm2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // bytesConsumed must land exactly at the end of the header's own blocks: nothing about the
    // 50,000 trailing garbage bytes should have been read.
    expect(result.bytesConsumed).toBe(header.length)
    expect(bytes.length - result.bytesConsumed).toBe(50_000)
  })

  it('empty, truncated, garbage and unknown-protocol input return a typed unparsable reason', () => {
    const empty = parseDm2Header(new Uint8Array(0))
    expect(empty).toEqual({ ok: false, reason: 'empty' })

    const validDemo = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: { 0: 'Some Level', 33: 'maps/q2dm1.bsp' },
      terminate: true,
    })
    const truncated = parseDm2Header(validDemo.slice(0, validDemo.length - 3))
    expect(truncated.ok).toBe(false)
    if (!truncated.ok) expect(truncated.reason).toBe('truncated')

    // Small block (length 5) whose first message's opcode isn't svc_serverdata (12).
    const garbage = parseDm2Header(new Uint8Array([5, 0, 0, 0, 99, 1, 2, 3, 4]))
    expect(garbage.ok).toBe(false)
    if (!garbage.ok) expect(garbage.reason).toBe('not-a-demo')

    // Bad negative block length (not the -1 terminator).
    const badLength = new Uint8Array([0xfe, 0xff, 0xff, 0xff])
    const badLengthResult = parseDm2Header(badLength)
    expect(badLengthResult.ok).toBe(false)
    if (!badLengthResult.ok) expect(badLengthResult.reason).toBe('not-a-demo')

    const unknownProtocol = parseDm2Header(
      buildDm2({
        protocol: 9999 as never,
        gameDir: 'baseq2',
        playernum: 0,
        configstrings: {},
        terminate: true,
      }),
    )
    expect(unknownProtocol.ok).toBe(false)
    if (!unknownProtocol.ok) {
      expect(unknownProtocol.reason).toBe('unknown-protocol')
      expect(unknownProtocol.protocol).toBe(9999)
    }
  })

  it('mutated demos never throw and always return a result', () => {
    // mulberry32 — deterministic seeded PRNG, no external dependency.
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
    const base = buildDm2({
      protocol: 3434,
      gameDir: 'rogue',
      playernum: 4,
      configstrings: {
        0: 'Fuzz Level',
        63: 'maps/fuzz.bsp',
        [12862 + 4]: 'Fuzzer\\male/fuzz',
      },
      trailingFrameBytes: 200,
      terminate: true,
    })

    const isValidReason = (reason: string): boolean =>
      ['empty', 'truncated', 'not-a-demo', 'unknown-protocol', 'header-too-large'].includes(reason)

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

      let result: ReturnType<typeof parseDm2Header>
      try {
        result = parseDm2Header(candidate)
      } catch (err) {
        throw new Error(`parseDm2Header threw on iteration ${i}: ${String(err)}`)
      }

      expect(typeof result.ok).toBe('boolean')
      if (result.ok) {
        expect(typeof result.protocol).toBe('number')
        expect(typeof result.layout).toBe('string')
        expect(typeof result.gameDir).toBe('string')
        expect(typeof result.levelName).toBe('string')
        expect(Array.isArray(result.players)).toBe(true)
        expect(typeof result.largestBlockBytes).toBe('number')
        expect(typeof result.bytesConsumed).toBe('number')
      } else {
        expect(isValidReason(result.reason)).toBe(true)
      }
    }
  })

  it('a high-bit byte in a name survives byte-identically', () => {
    const bytes = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: { 0: 'Le\x93vel' },
      terminate: true,
    })
    const result = parseDm2Header(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.levelName).toBe('Le\x93vel')
    expect(result.levelName.charCodeAt(2)).toBe(0x93)
  })

  it('reports header-too-large instead of truncated for a huge unterminated header', () => {
    const configstrings: Record<number, string> = { 0: 'Huge Level' }
    // Pad with many configstrings so the accumulated block payload exceeds DM2_HEADER_MAX_BYTES
    // before the header ever resolves (no terminator, no trailing frame).
    const filler = 'x'.repeat(1000)
    for (let i = 1; i < 1200; i++) configstrings[i] = filler
    const bytes = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings,
    })
    expect(bytes.length).toBeGreaterThanOrEqual(DM2_HEADER_MAX_BYTES)
    // Truncate mid-stream so the header cannot resolve.
    const truncated = bytes.slice(0, bytes.length - 10)
    const result = parseDm2Header(truncated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('header-too-large')
  })
})
