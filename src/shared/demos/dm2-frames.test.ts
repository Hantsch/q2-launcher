import { describe, expect, it } from 'vitest'

import { createDm2FrameCounter } from './dm2-frames'
import { buildDm2Stream, dm2Msg, TE, TE_FIELDS } from './dm2-frames-writer'
import type { Dm2StreamMessage, TeName } from './dm2-frames-writer'
import { DEMO_FRAME_MS } from './frame-count'
import type { FrameCountResult } from './frame-count'

const PROTOCOLS = [34, 3434, 3435, 3436] as const

/** Counts `bytes`, pushed in chunks of `chunkSize` (whole file when omitted). */
function count(bytes: Uint8Array, chunkSize = bytes.length || 1): FrameCountResult {
  const counter = createDm2FrameCounter()
  for (let i = 0; i < bytes.length; i += chunkSize) counter.push(bytes.subarray(i, i + chunkSize))
  return counter.finish()
}

function str(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0)).concat(0)
}

/** Every message the counter sizes and skips, in the encoding of `protocol`. */
function everySizedMessage(): Dm2StreamMessage[] {
  const tempEntities = (Object.keys(TE_FIELDS) as TeName[]).flatMap((name) =>
    name === 'STEAM'
      ? [
          dm2Msg.tempEntity(TE.STEAM, { steamEntity: -1 }),
          dm2Msg.tempEntity(TE.STEAM, { steamEntity: 3, coord: 20_000 }),
        ]
      : [dm2Msg.tempEntity(TE[name]), dm2Msg.tempEntity(TE[name], { coord: -20_000 })],
  )
  return [
    dm2Msg.configstring(33, 'maps/q2dm1.bsp'),
    dm2Msg.print('hello\n'),
    dm2Msg.raw(11, str('precache\n')), // stufftext
    dm2Msg.raw(15, str('centered')), // centerprint
    dm2Msg.raw(4, str('xv 32 yv 8 string "hi"')), // layout
    dm2Msg.raw(5, new Array<number>(512).fill(1)), // inventory: 256 x int16
    dm2Msg.raw(6), // nop
    dm2Msg.raw(7), // disconnect
    dm2Msg.raw(8), // reconnect
    dm2Msg.raw(1, [5, 0, 1]), // muzzleflash
    dm2Msg.raw(2, [5, 0, 1]), // muzzleflash2
    dm2Msg.sound({ index: 4 }),
    dm2Msg.sound({
      index: 300,
      index16: true,
      volume: 255,
      attenuation: 64,
      offset: 10,
      entity: 7,
      pos: [100, -20_000, 20_000],
    }),
    dm2Msg.raw(16, [4, 0, 50, 1, 2, 3, 4]), // download: 4 bytes
    dm2Msg.raw(16, [0xff, 0xff, 100]), // download: size -1, no data
    dm2Msg.raw(16, [0, 0, 100]), // download: size 0
    ...tempEntities,
  ]
}

describe('createDm2FrameCounter', () => {
  it('frames preceded by every sized reliable message count once', () => {
    for (const protocol of PROTOCOLS) {
      const prefix = everySizedMessage()
      const blocks = [
        [...prefix, dm2Msg.frame(1)],
        ...prefix.map((m, i) => [m, dm2Msg.frame(i + 2)]),
        [dm2Msg.frame(9999)],
      ]
      const result = count(
        buildDm2Stream({
          protocol,
          headerConfigstrings: { 0: 'The Edge' },
          blocks,
          terminate: true,
        }),
      )
      expect(result, `protocol ${protocol}`).toEqual({
        ok: true,
        frames: blocks.length,
        durationMs: blocks.length * DEMO_FRAME_MS,
        complete: true,
      })
    }
  })

  it('frame-less blocks count zero so the count is not a block estimate', () => {
    const blocks: Dm2StreamMessage[][] = [
      [dm2Msg.baseline()],
      [dm2Msg.raw(11, str('precache\n'))],
      [dm2Msg.frame(1)],
      [dm2Msg.print('print only\n')],
      [dm2Msg.frame(2)],
      [dm2Msg.serverdata(34), dm2Msg.configstring(33, 'maps/q2dm2.bsp')], // mid-demo map change
      [dm2Msg.configstring(34, 'models/x.md2'), dm2Msg.baseline()],
      [],
      [dm2Msg.print('a\n'), dm2Msg.print('b\n')],
      [dm2Msg.frame(1)],
      [dm2Msg.frame(2)],
    ]
    const result = count(buildDm2Stream({ protocol: 34, blocks, terminate: true }))
    expect(result).toEqual({ ok: true, frames: 4, durationMs: 400, complete: true })
    // A block count (header block + the 11 above) would say 12.
    expect(blocks.length + 1).not.toBe(4)
  })

  describe('protocol deviations', () => {
    // Hand-assembled message bytes, followed by a frame whose serverframe (256) starts with a 0
    // byte: reading one byte too many or too few lands on opcode 0 and fails loudly.
    function withFrame(protocol: number, raw: Dm2StreamMessage): FrameCountResult {
      return count(
        buildDm2Stream({ protocol, blocks: [[raw, dm2Msg.frame(256)]], terminate: true }),
      )
    }
    const ONE_FRAME = { ok: true, frames: 1, durationMs: 100, complete: true }

    it('protocol 34 ignores SND_INDEX16 and reads a byte index; 3434+ read a 16-bit index', () => {
      expect(withFrame(34, dm2Msg.raw(9, [0x20, 5]))).toEqual(ONE_FRAME)
      for (const protocol of [3434, 3435, 3436]) {
        expect(withFrame(protocol, dm2Msg.raw(9, [0x20, 0x2c, 0x01]))).toEqual(ONE_FRAME)
        expect(withFrame(protocol, dm2Msg.raw(9, [0x00, 5]))).toEqual(ONE_FRAME)
      }
    })

    it('protocols 34 and 3434 read fixed int16 coordinates; 3435 and 3436 read extended 2-or-3-byte ones', () => {
      // TE_ROCKET_EXPLOSION: one position.
      for (const protocol of [34, 3434]) {
        expect(withFrame(protocol, dm2Msg.raw(3, [7, 1, 0, 3, 0, 5, 0]))).toEqual(ONE_FRAME)
      }
      for (const protocol of [3435, 3436]) {
        // Low bit clear: 2 bytes per axis. Low bit set: 3 bytes per axis.
        expect(withFrame(protocol, dm2Msg.raw(3, [7, 2, 0, 4, 0, 6, 0]))).toEqual(ONE_FRAME)
        expect(withFrame(protocol, dm2Msg.raw(3, [7, 1, 0, 9, 3, 0, 9, 0x41, 0x9c, 0]))).toEqual(
          ONE_FRAME,
        )
        // Sound position under the same rule: flags SND_POS, index, x (3 bytes), y, z (2 bytes).
        expect(withFrame(protocol, dm2Msg.raw(9, [0x04, 5, 1, 0, 1, 2, 0, 4, 0]))).toEqual(
          ONE_FRAME,
        )
      }
      // The same extended bytes misalign on a fixed-coordinate protocol.
      expect(withFrame(34, dm2Msg.raw(3, [7, 1, 0, 9, 3, 0, 9, 0x41, 0x9c, 0]))).toMatchObject({
        ok: false,
      })
    })

    it('TE_STEAM carries its trailing int32 only when its entity is not -1', () => {
      for (const protocol of [34, 3434]) {
        const noWait = [40, 0xff, 0xff, 8, 0, 0, 0, 0, 0, 0, 5, 7, 1, 0]
        expect(withFrame(protocol, dm2Msg.raw(3, noWait))).toEqual(ONE_FRAME)
        const withWait = [40, 3, 0, 8, 0, 0, 0, 0, 0, 0, 5, 7, 1, 0, 0xdc, 0x05, 0, 0]
        expect(withFrame(protocol, dm2Msg.raw(3, withWait))).toEqual(ONE_FRAME)
      }
    })

    it('every protocol counts a stream exercising its deviations end to end', () => {
      for (const protocol of PROTOCOLS) {
        const blocks = [
          [
            dm2Msg.sound({ index: 700, index16: true, entity: 1, pos: [30_000, 1, -30_000] }),
            dm2Msg.frame(1),
          ],
          [
            dm2Msg.tempEntity(TE.RAILTRAIL, { coord: 25_000 }),
            dm2Msg.tempEntity(TE.LIGHTNING, { coord: -25_000 }),
            dm2Msg.frame(2),
          ],
          [dm2Msg.tempEntity(TE.STEAM, { steamEntity: 12, coord: 17_000 }), dm2Msg.frame(3)],
        ]
        expect(
          count(buildDm2Stream({ protocol, blocks, terminate: true })),
          `protocol ${protocol}`,
        ).toEqual({
          ok: true,
          frames: 3,
          durationMs: 300,
          complete: true,
        })
      }
    })
  })

  describe('undecodable input', () => {
    const cases: [string, Dm2StreamMessage][] = [
      ['svc_playerinfo outside a frame', dm2Msg.raw(17, [0, 0])],
      ['an opcode past the known table', dm2Msg.raw(99)],
      ['svc_bad', dm2Msg.raw(0)],
      ['TE_FLAME (no reader in any client)', dm2Msg.tempEntity(TE.FLAME)],
      ['an unknown temp-entity type', dm2Msg.raw(3, [200, 0, 0, 0, 0, 0, 0])],
      ['an unterminated print', dm2Msg.raw(10, [2, 0x41, 0x42])],
      ['an inventory past the block end', dm2Msg.raw(5, [1, 2, 3])],
      ['a download larger than the block', dm2Msg.raw(16, [0x40, 0, 50, 1, 2])],
      ['a download with a negative size other than -1', dm2Msg.raw(16, [0xfe, 0xff, 50])],
      ['a sound cut inside its entity field', dm2Msg.raw(9, [0x08, 5, 1])],
      ['a mid-demo serverdata with an unknown protocol', dm2Msg.serverdata(35)],
    ]
    for (const [name, message] of cases) {
      it(`${name} is undecodable at its block`, () => {
        const good = buildDm2Stream({ protocol: 34, blocks: [[dm2Msg.frame(1)]] })
        const bytes = buildDm2Stream({
          protocol: 34,
          blocks: [[dm2Msg.frame(1)], [message], [dm2Msg.frame(2)]],
          terminate: true,
        })
        expect(count(bytes)).toEqual({ ok: false, reason: 'undecodable', at: good.length })
      })
    }

    it('is sticky: after failing, the counter reports failed and ignores later pushes', () => {
      const bad = buildDm2Stream({ protocol: 34, blocks: [[dm2Msg.frame(1)], [dm2Msg.raw(99)]] })
      const counter = createDm2FrameCounter()
      counter.push(bad)
      expect(counter.failed).toBe(true)
      counter.push(buildDm2Stream({ protocol: 34, blocks: [[dm2Msg.frame(1)]], terminate: true }))
      expect(counter.finish()).toMatchObject({ ok: false, reason: 'undecodable' })
    })

    it('rejects foreign data as not-a-demo', () => {
      const firstNotServerdata = new Uint8Array([3, 0, 0, 0, 10, 2, 0, 0xff, 0xff, 0xff, 0xff])
      expect(count(firstNotServerdata)).toEqual({ ok: false, reason: 'not-a-demo', at: 0 })
      expect(
        count(buildDm2Stream({ protocol: 35, blocks: [[dm2Msg.frame(1)]], terminate: true })),
      ).toMatchObject({
        ok: false,
        reason: 'not-a-demo',
      })
      const valid = buildDm2Stream({ protocol: 34, blocks: [[dm2Msg.frame(1)]] })
      for (const badLength of [-2, 1_048_577]) {
        const bytes = new Uint8Array(valid.length + 8)
        bytes.set(valid)
        new DataView(bytes.buffer).setInt32(valid.length, badLength, true)
        expect(count(bytes)).toEqual({ ok: false, reason: 'not-a-demo', at: valid.length })
      }
      expect(count(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toEqual({
        ok: false,
        reason: 'not-a-demo',
      })
      expect(count(new Uint8Array(0))).toEqual({ ok: false, reason: 'not-a-demo' })
    })
  })

  it('a cut tail keeps the counted frames with complete: false', () => {
    const blocks = [[dm2Msg.frame(1)], [dm2Msg.frame(2)], [dm2Msg.print('x\n'), dm2Msg.frame(3)]]
    const full = buildDm2Stream({ protocol: 34, blocks, terminate: true })
    expect(count(full)).toEqual({ ok: true, frames: 3, durationMs: 300, complete: true })
    expect(count(full.subarray(0, full.length - 4))).toEqual({
      ok: true,
      frames: 3,
      durationMs: 300,
      complete: false,
    })
    expect(count(full.subarray(0, full.length - 10))).toEqual({
      ok: true,
      frames: 2,
      durationMs: 200,
      complete: false,
    })
    // Cut inside the terminator itself.
    expect(count(full.subarray(0, full.length - 2))).toEqual({
      ok: true,
      frames: 3,
      durationMs: 300,
      complete: false,
    })
    // Bytes after the terminator are ignored.
    const trailing = buildDm2Stream({
      protocol: 34,
      blocks,
      terminate: true,
      trailing: [1, 2, 3, 99, 99, 99, 99, 99],
    })
    expect(count(trailing)).toEqual({ ok: true, frames: 3, durationMs: 300, complete: true })
  })

  it('zero frames is no-frames', () => {
    const blocks = [[dm2Msg.baseline()], [dm2Msg.print('nothing happens\n')]]
    expect(
      count(
        buildDm2Stream({
          protocol: 3436,
          headerConfigstrings: { 0: 'x' },
          blocks,
          terminate: true,
        }),
      ),
    ).toEqual({
      ok: false,
      reason: 'no-frames',
    })
    expect(count(buildDm2Stream({ protocol: 34, blocks: [] }))).toEqual({
      ok: false,
      reason: 'no-frames',
    })
  })

  it('gives the same result for 1-byte, 7-byte and 64 KiB pushes', () => {
    const big = Array.from({ length: 400 }, (_, i) =>
      i % 5 === 0
        ? [dm2Msg.print(`line ${i}\n`)]
        : [dm2Msg.sound({ index: i, index16: true, pos: [i * 100, 0, 0] }), dm2Msg.frame(i, 300)],
    )
    const streams = [
      buildDm2Stream({ protocol: 3435, blocks: big, terminate: true }),
      buildDm2Stream({ protocol: 34, blocks: big }),
      buildDm2Stream({ protocol: 3434, blocks: [...big, [dm2Msg.raw(99)], ...big] }),
      buildDm2Stream({ protocol: 3436, blocks: big, terminate: true }).subarray(0, 50_000),
    ]
    for (const bytes of streams) {
      const whole = count(bytes)
      for (const size of [1, 7, 65_536]) expect(count(bytes, size), `chunk ${size}`).toEqual(whole)
    }
  })

  it('1000 seeded mutations of a valid stream never throw', () => {
    let seed = 0x13837
    const random = (): number => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const int = (n: number): number => Math.floor(random() * n)
    const base = PROTOCOLS.map((protocol) =>
      buildDm2Stream({
        protocol,
        headerConfigstrings: { 0: 'x', 33: 'maps/q2dm1.bsp' },
        blocks: everySizedMessage().map((m, i) => [m, dm2Msg.frame(i)]),
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
        const at = int(bytes.length - 4)
        new DataView(bytes.buffer).setInt32(at, int(2) === 0 ? -1 - int(5) : int(0x7fffffff), true)
      }
      const counter = createDm2FrameCounter()
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
        expect(result.frames).toBeLessThanOrEqual(Math.floor(bytes.length / 5))
        expect(result.durationMs).toBe(result.frames * DEMO_FRAME_MS)
      }
    }
  })

  it('counts a 32 MiB stream pushed in 64 KiB chunks within 1000 ms', () => {
    const blocks: Dm2StreamMessage[][] = []
    let size = 0
    let frames = 0
    while (size < 32 * 1024 * 1024) {
      const i = blocks.length
      if (i % 50 === 0) {
        blocks.push([dm2Msg.print(`chat line ${i}\n`)])
      } else {
        blocks.push([
          dm2Msg.sound({ index: 3, entity: 4 }),
          dm2Msg.tempEntity(TE.GUNSHOT, { coord: 900 }),
          dm2Msg.frame(i, 1_300),
        ])
        frames++
      }
      size += 1_250 // under-estimates every block, so the stream ends up at least 32 MiB
    }
    const bytes = buildDm2Stream({ protocol: 34, blocks, terminate: true })
    expect(bytes.length).toBeGreaterThanOrEqual(32 * 1024 * 1024)

    const started = performance.now()
    const counter = createDm2FrameCounter()
    for (let i = 0; i < bytes.length; i += 65_536) counter.push(bytes.subarray(i, i + 65_536))
    const result = counter.finish()
    const elapsed = performance.now() - started

    expect(result).toEqual({ ok: true, frames, durationMs: frames * DEMO_FRAME_MS, complete: true })
    expect(elapsed).toBeLessThanOrEqual(1000)
  })
})
