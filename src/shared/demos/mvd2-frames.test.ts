import { describe, expect, it } from 'vitest'

import { createMvd2FrameCounter } from './mvd2-frames'
import { buildMvd2Stream, mvd2Msg } from './mvd2-frames-writer'
import type { Mvd2StreamMessage } from './mvd2-frames-writer'
import { DEMO_FRAME_MS } from './frame-count'
import type { FrameCountResult } from './frame-count'

const VERSIONS = [2009, 2010, 2011, 2012, 2013] as const

/** Counts `bytes`, pushed in chunks of `chunkSize` (whole file when omitted). */
function count(bytes: Uint8Array, chunkSize = bytes.length || 1): FrameCountResult {
  const counter = createMvd2FrameCounter()
  for (let i = 0; i < bytes.length; i += chunkSize) counter.push(bytes.subarray(i, i + chunkSize))
  return counter.finish()
}

/** Every message the counter sizes and skips. */
function everySizedMessage(): Mvd2StreamMessage[] {
  return [
    mvd2Msg.configstring(33, 'maps/q2dm1.bsp'),
    mvd2Msg.print('hello\n'),
    mvd2Msg.raw(1), // mvd_nop
    mvd2Msg.unicast(3, [1, 2, 3, 4, 5]),
    mvd2Msg.unicastR(4, []),
    mvd2Msg.multicast('all', [9, 9, 9]),
    mvd2Msg.multicast('all_r', []),
    mvd2Msg.multicast('phs', [1, 2, 3], 77),
    mvd2Msg.multicast('pvs', [1], 0xffff),
    mvd2Msg.multicast('phs_r', [1, 2, 3, 4, 5, 6, 7, 8]),
    mvd2Msg.multicast('pvs_r', [], 12),
    mvd2Msg.sound({ index: 4, sendchan: 9 }),
    mvd2Msg.sound({
      index: 300,
      index16: true,
      volume: 255,
      attenuation: 64,
      offset: 10,
      sendchan: (7 << 3) | 2,
    }),
    // A length that spills into the opcode's extra bits (> 255 bytes).
    mvd2Msg.unicast(1, new Array<number>(300).fill(7)),
    mvd2Msg.multicast('pvs', new Array<number>(500).fill(3), 1),
  ]
}

describe('createMvd2FrameCounter', () => {
  it('frames behind configstring/print/unicast/multicast prefixes count once', () => {
    const prefix = everySizedMessage()
    const blocks = [
      [...prefix, mvd2Msg.frame()],
      ...prefix.map((m) => [m, mvd2Msg.frame()]),
      [mvd2Msg.frame()],
    ]
    const result = count(
      buildMvd2Stream({ headerConfigstrings: { 0: 'The Edge' }, blocks, terminate: true }),
    )
    expect(result).toEqual({
      ok: true,
      frames: blocks.length,
      durationMs: blocks.length * DEMO_FRAME_MS,
      complete: true,
    })
  })

  it('print-only and gamestate blocks count zero', () => {
    const blocks: Mvd2StreamMessage[][] = [
      [mvd2Msg.print('nothing happens\n')],
      [mvd2Msg.frame()],
      [mvd2Msg.configstring(10, 'x')],
      [mvd2Msg.frame()],
      [mvd2Msg.serverdata(37, 2010), mvd2Msg.configstring(33, 'maps/q2dm2.bsp')], // mid-file gamestate
      // Note: an empty block ([]) is deliberately not exercised here — in `.mvd2` framing a
      // zero-length block IS the terminator, so it cannot also stand for a frame-less block.
      [mvd2Msg.print('a\n'), mvd2Msg.print('b\n')],
      [mvd2Msg.frame()],
      [mvd2Msg.frame()],
    ]
    const result = count(buildMvd2Stream({ blocks, terminate: true }))
    expect(result).toEqual({ ok: true, frames: 4, durationMs: 400, complete: true })
    // A block count (header block + the 8 above) would say 9.
    expect(blocks.length + 1).not.toBe(4)
  })

  it('versions 2009-2013 are accepted, 2008 is not-a-demo', () => {
    for (const version of VERSIONS) {
      const result = count(
        buildMvd2Stream({ version, blocks: [[mvd2Msg.frame()]], terminate: true }),
      )
      expect(result, `version ${version}`).toEqual({
        ok: true,
        frames: 1,
        durationMs: 100,
        complete: true,
      })
    }
    expect(
      count(buildMvd2Stream({ version: 2008, blocks: [[mvd2Msg.frame()]], terminate: true })),
    ).toMatchObject({
      ok: false,
      reason: 'not-a-demo',
    })
  })

  it('rejects a bad protocol and foreign data as not-a-demo', () => {
    expect(
      count(buildMvd2Stream({ protocol: 36, blocks: [[mvd2Msg.frame()]], terminate: true })),
    ).toMatchObject({
      ok: false,
      reason: 'not-a-demo',
    })
    const notMvd2 = new Uint8Array([0x4d, 0x56, 0x44, 0x33, 10, 0, 4, 0, 0, 0, 37, 0])
    expect(count(notMvd2)).toEqual({ ok: false, reason: 'not-a-demo', at: 0 })
    expect(count(new Uint8Array(0))).toEqual({ ok: false, reason: 'not-a-demo' })
    // Just the magic and the terminator: no serverdata was ever seen.
    const magicOnly = new Uint8Array([0x4d, 0x56, 0x44, 0x32, 0, 0])
    expect(count(magicOnly)).toEqual({ ok: false, reason: 'not-a-demo' })
  })

  describe('undecodable input', () => {
    const cases: [string, Mvd2StreamMessage][] = [
      ['an opcode past the known table', mvd2Msg.raw(19)],
      ['mvd_bad', mvd2Msg.raw(0)],
      ['mvd_disconnect', mvd2Msg.raw(2)],
      ['mvd_reconnect', mvd2Msg.raw(3)],
      ['mvd_frame_nodelta (never written by any real recorder)', mvd2Msg.raw(7)],
      ['mvd_stufftext', mvd2Msg.raw(18)],
      ['an unterminated print', mvd2Msg.raw(17, [2, 0x41, 0x42])],
      ['an unterminated configstring', mvd2Msg.raw(5, [1, 0, 0x41, 0x42])],
      ['a unicast cut inside its clientNum', mvd2Msg.raw(8, [3])],
      ['a unicast whose payload runs past the block', mvd2Msg.raw(8, [5, 1, 1, 2])],
      ['a multicast_phs cut inside its leaf', mvd2Msg.raw(11, [2, 0xff])],
      ['a sound cut inside its sendchan', mvd2Msg.raw(16, [0, 4, 1])],
      ['a mid-file serverdata with an unknown protocol', mvd2Msg.serverdata(36)],
    ]
    for (const [name, message] of cases) {
      it(`${name} is undecodable at its block`, () => {
        const good = buildMvd2Stream({ blocks: [[mvd2Msg.frame()]] })
        const bytes = buildMvd2Stream({
          blocks: [[mvd2Msg.frame()], [message], [mvd2Msg.frame()]],
          terminate: true,
        })
        expect(count(bytes)).toEqual({ ok: false, reason: 'undecodable', at: good.length })
      })
    }

    it('is sticky: after failing, the counter reports failed and ignores later pushes', () => {
      const bad = buildMvd2Stream({ blocks: [[mvd2Msg.frame()], [mvd2Msg.raw(19)]] })
      const counter = createMvd2FrameCounter()
      counter.push(bad)
      expect(counter.failed).toBe(true)
      counter.push(buildMvd2Stream({ blocks: [[mvd2Msg.frame()]], terminate: true }))
      expect(counter.finish()).toMatchObject({ ok: false, reason: 'undecodable' })
    })
  })

  it('a cut tail keeps the counted frames with complete: false', () => {
    const blocks = [[mvd2Msg.frame()], [mvd2Msg.frame()], [mvd2Msg.print('x\n'), mvd2Msg.frame()]]
    const full = buildMvd2Stream({ blocks, terminate: true })
    expect(count(full)).toEqual({ ok: true, frames: 3, durationMs: 300, complete: true })
    expect(count(full.subarray(0, full.length - 2))).toEqual({
      ok: true,
      frames: 3,
      durationMs: 300,
      complete: false,
    })
    expect(count(full.subarray(0, full.length - 5))).toEqual({
      ok: true,
      frames: 2,
      durationMs: 200,
      complete: false,
    })
    // Cut inside the terminator itself.
    expect(count(full.subarray(0, full.length - 1))).toEqual({
      ok: true,
      frames: 3,
      durationMs: 300,
      complete: false,
    })
    // Bytes after the terminator are ignored.
    const trailing = buildMvd2Stream({
      blocks,
      terminate: true,
      trailing: [1, 2, 3, 99, 99, 99, 99, 99],
    })
    expect(count(trailing)).toEqual({ ok: true, frames: 3, durationMs: 300, complete: true })
  })

  it('zero frames is no-frames', () => {
    const blocks = [[mvd2Msg.print('nothing happens\n')], [mvd2Msg.configstring(1, 'x')]]
    expect(
      count(buildMvd2Stream({ headerConfigstrings: { 0: 'x' }, blocks, terminate: true })),
    ).toEqual({
      ok: false,
      reason: 'no-frames',
    })
    expect(count(buildMvd2Stream({ blocks: [] }))).toEqual({ ok: false, reason: 'no-frames' })
  })

  it('gives the same result for 1-byte, 7-byte and 64 KiB pushes', () => {
    const big = Array.from({ length: 400 }, (_, i) =>
      i % 5 === 0
        ? [mvd2Msg.print(`line ${i}\n`)]
        : [
            mvd2Msg.sound({ index: i, index16: true, sendchan: i }),
            mvd2Msg.multicast('pvs', new Array<number>(20).fill(i % 256), i),
            mvd2Msg.frame(),
          ],
    )
    const streams = [
      buildMvd2Stream({ blocks: big, terminate: true }),
      buildMvd2Stream({ blocks: big }),
      buildMvd2Stream({ blocks: [...big, [mvd2Msg.raw(19)], ...big] }),
      buildMvd2Stream({ blocks: big, terminate: true }).subarray(0, 5_000),
    ]
    for (const bytes of streams) {
      const whole = count(bytes)
      for (const size of [1, 7, 65_536]) expect(count(bytes, size), `chunk ${size}`).toEqual(whole)
    }
  })

  it('1000 seeded mutations of a valid stream never throw', () => {
    let seed = 0x24681
    const random = (): number => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const int = (n: number): number => Math.floor(random() * n)
    const base = VERSIONS.map((version) =>
      buildMvd2Stream({
        version,
        headerConfigstrings: { 0: 'x', 33: 'maps/q2dm1.bsp' },
        blocks: everySizedMessage().map((m) => [m, mvd2Msg.frame()]),
        terminate: true,
      }),
    )
    for (let n = 0; n < 1000; n++) {
      const source = base[n % base.length]!
      let bytes = source.slice()
      const kind = int(4)
      if (kind === 0) for (let k = 1 + int(8); k > 0; k--) bytes[int(bytes.length)] = int(256)
      else if (kind === 1) bytes = bytes.slice(0, int(bytes.length))
      else if (kind === 2) {
        const at = int(bytes.length)
        const insert = Array.from({ length: 1 + int(16) }, () => int(256))
        bytes = new Uint8Array([...bytes.subarray(0, at), ...insert, ...bytes.subarray(at)])
      } else {
        const at = int(Math.max(1, bytes.length - 2))
        new DataView(bytes.buffer).setUint16(at, int(2) === 0 ? 0 : 0xffff, true)
      }
      const counter = createMvd2FrameCounter()
      let result: FrameCountResult | undefined
      expect(() => {
        for (let i = 0; i < bytes.length;) {
          const size = 1 + int(512)
          counter.push(bytes.subarray(i, i + size))
          i += size
        }
        result = counter.finish()
      }).not.toThrow()
      if (result?.ok) {
        expect(result.frames).toBeGreaterThan(0)
        expect(result.frames).toBeLessThanOrEqual(Math.floor(bytes.length / 3))
        expect(result.durationMs).toBe(result.frames * DEMO_FRAME_MS)
      }
    }
  })

  it('counts a 32 MiB stream pushed in 64 KiB chunks within 1000 ms', () => {
    const blocks: Mvd2StreamMessage[][] = []
    let size = 0
    let frames = 0
    while (size < 32 * 1024 * 1024) {
      const i = blocks.length
      if (i % 50 === 0) {
        blocks.push([mvd2Msg.print(`chat line ${i}\n`)])
      } else {
        blocks.push([
          mvd2Msg.sound({ index: 3, sendchan: 4 }),
          mvd2Msg.multicast('pvs', new Array<number>(1200).fill(1), 7),
          mvd2Msg.frame(),
        ])
        frames++
      }
      size += 1_150 // under-estimates every block, so the stream ends up at least 32 MiB
    }
    const bytes = buildMvd2Stream({ blocks, terminate: true })
    expect(bytes.length).toBeGreaterThanOrEqual(32 * 1024 * 1024)

    const started = performance.now()
    const counter = createMvd2FrameCounter()
    for (let i = 0; i < bytes.length; i += 65_536) counter.push(bytes.subarray(i, i + 65_536))
    const result = counter.finish()
    const elapsed = performance.now() - started

    expect(result).toEqual({ ok: true, frames, durationMs: frames * DEMO_FRAME_MS, complete: true })
    expect(elapsed).toBeLessThanOrEqual(1000)
  })
})
