import { open, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDm2 } from '../../shared/demos/dm2-writer'
import { buildMvd2 } from '../../shared/demos/mvd2-writer'
import { buildDm2Stream, dm2Msg } from '../../shared/demos/dm2-frames-writer'
import { DM2_HEADER_MAX_BYTES } from '../../shared/demos/dm2-header'
import { readDm2Header, readDemoHeader, readDemoFullPass } from './demo-bytes'

// Tracks bytes actually emitted by the gunzip decompressor - i.e. real decompressed output,
// not `result.bytes.length` - so the "bounded work" test below cannot be satisfied by an
// implementation that decompresses the whole file and slices the result afterwards.
const zlibTracker = vi.hoisted(() => ({ bytes: 0 }))
vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:zlib')>()
  return {
    ...actual,
    createGunzip: (...args: Parameters<typeof actual.createGunzip>) => {
      const stream = actual.createGunzip(...args)
      stream.on('data', (chunk: Buffer) => {
        zlibTracker.bytes += chunk.length
      })
      return stream
    },
  }
})

const OPENTDM_FIXTURE_PATH = join(
  __dirname,
  '../../../docs/fixtures/demos/shad-maq_PFDE3_q2rdm2_20260922-161521.dm2',
)
const FIXTURE_PATH = join(__dirname, '../../../docs/fixtures/demos/test.dm2')

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-demo-bytes-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('readDm2Header', () => {
  it('the real test.dm2 reports its map, level, game dir, POV and players', async () => {
    const result = await readDm2Header(FIXTURE_PATH)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.protocol).toBe(34)
    expect(result.map).toBe('q2rdm2')
    expect(result.gameDir).toBe('opentdm')
    expect(result.levelName).toBe('The Chastity Belt Duel  -  by JaLisK0')
    expect(result.pov).toBe('sd.kgm/sauDove')
    expect(result.players).toEqual(['WallFly[BZZZ]', 'sd.kgm/sauDove'])
    expect(result.bytesConsumed).toBe(6505)
  })

  it('a gzipped demo yields exactly the facts of the uncompressed one', async () => {
    const raw = await readFile(FIXTURE_PATH)
    const gzPath = join(dir, 'test.dm2.gz')
    await writeFile(gzPath, gzipSync(raw))

    const original = await readDm2Header(FIXTURE_PATH)
    const gzipped = await readDm2Header(gzPath)

    expect(gzipped).toEqual(original)
  })

  it('a 32 MiB demo is read only up to the header bound, plain and gzipped', async () => {
    const targetSize = 32 * 1024 * 1024
    // `trailingFrameBytes` puts a non-configstring message right after the header inside the
    // same block, so `parseDm2Header` stops there - the raw padding appended below (to reach the
    // 32 MiB file size) sits *after* the block the parser ever looks at.
    const header = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings: { 0: 'q2dm1', 32: 'maps/q2dm1.bsp', 1312: 'player/skin' },
      trailingFrameBytes: 64,
    })

    const padding = new Uint8Array(Math.max(0, targetSize - header.length))
    for (let i = 0; i < padding.length; i++) padding[i] = i & 0xff

    const combined = new Uint8Array(header.length + padding.length)
    combined.set(header, 0)
    combined.set(padding, header.length)

    const plainPath = join(dir, 'big.dm2')
    await writeFile(plainPath, combined)

    // Wrap FileHandle.read to observe actual bytes requested/read off disk, independent of
    // whatever the function under test decides to return.
    let plainBytesRead = 0
    const probeHandle = await open(plainPath, 'r')
    const handleProto = Object.getPrototypeOf(probeHandle)
    await probeHandle.close()
    const originalReadFn = handleProto.read
    handleProto.read = async function patchedRead(this: unknown, ...args: unknown[]) {
      const result = await originalReadFn.apply(this, args)
      plainBytesRead += result.bytesRead
      return result
    }

    try {
      const plainResult = await readDm2Header(plainPath)
      expect(plainResult.ok).toBe(true)
      expect(plainBytesRead).toBeLessThanOrEqual(DM2_HEADER_MAX_BYTES)
    } finally {
      handleProto.read = originalReadFn
    }

    // Gzipped version: track decompressed bytes collected via the wrapped `node:zlib` gunzip
    // (see `zlibTracker`/`vi.mock` above) - this observes real decompressed output regardless of
    // what the function under test returns.
    const gzPath = join(dir, 'big.dm2.gz')
    await writeFile(gzPath, gzipSync(Buffer.from(combined)))

    zlibTracker.bytes = 0
    const gzResult = await readDm2Header(gzPath)
    expect(gzResult.ok).toBe(true)
    expect(zlibTracker.bytes).toBeLessThanOrEqual(DM2_HEADER_MAX_BYTES + 128 * 1024)
  })

  it('a missing path is unreadable', async () => {
    const result = await readDm2Header(join(dir, 'does-not-exist.dm2'))
    expect(result).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('a cut gzip is truncated', async () => {
    // Many distinct, poorly-compressible configstrings so the gzip stream is large enough that
    // chopping it in half still leaves the decoder having emitted real (if incomplete) output -
    // a demo this tiny compresses so well that a naive cut can decompress to nothing at all.
    const configstrings: Record<number, string> = { 0: 'q2dm1', 32: 'maps/q2dm1.bsp' }
    for (let i = 0; i < 400; i++) {
      configstrings[100 + i] = `configstring-value-${i}-${Math.random().toString(36).slice(2)}`
    }
    const demo = buildDm2({
      protocol: 34,
      gameDir: 'baseq2',
      playernum: 0,
      configstrings,
      terminate: true,
    })
    const gz = gzipSync(Buffer.from(demo))
    const cut = gz.subarray(0, Math.floor(gz.length / 2))

    const cutPath = join(dir, 'cut.dm2.gz')
    await writeFile(cutPath, cut)

    const result = await readDm2Header(cutPath)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('truncated')
  })
})

const MVD2_FIXTURE_PATH = join(
  __dirname,
  '../../../docs/fixtures/demos/PFAU_20221127-053327_q2dm1.mvd2',
)

const EXPECTED_MVD2_FACTS = {
  ok: true,
  format: 'mvd2',
  protocol: 37,
  mvdVersion: 2010,
  layout: 'original',
  gameDir: 'opentdm',
  levelName: 'The Edge',
  map: 'q2dm1',
  pov: null,
  players: ['lamb shanker', 'lamb shanker'],
  largestBlockBytes: 7123,
  bytesConsumed: 7129,
}

describe('readDemoHeader', () => {
  it('the real PFAU q2dm1 mvd2 reports its map, level, game dir and players', async () => {
    const result = await readDemoHeader(MVD2_FIXTURE_PATH)
    expect(result).toEqual(EXPECTED_MVD2_FACTS)
  })

  it('a gzipped mvd2 yields exactly the facts of the uncompressed one', async () => {
    const raw = await readFile(MVD2_FIXTURE_PATH)
    const gzPath = join(dir, 'mvd2.mvd2.gz')
    await writeFile(gzPath, gzipSync(raw))

    const gzipped = await readDemoHeader(gzPath)
    expect(gzipped).toEqual(EXPECTED_MVD2_FACTS)
  })

  it('a mis-named demo is parsed as what its bytes are', async () => {
    const mvd2Bytes = await readFile(MVD2_FIXTURE_PATH)
    const dm2NamedPath = join(dir, 'x.dm2')
    await writeFile(dm2NamedPath, mvd2Bytes)
    const mvd2Result = await readDemoHeader(dm2NamedPath)
    expect(mvd2Result).toEqual(EXPECTED_MVD2_FACTS)

    const dm2Bytes = await readFile(join(__dirname, '../../../docs/fixtures/demos/test.dm2'))
    const mvd2NamedPath = join(dir, 'x.mvd2')
    await writeFile(mvd2NamedPath, dm2Bytes)
    const dm2Result = await readDemoHeader(mvd2NamedPath)
    expect(dm2Result.ok).toBe(true)
    if (!dm2Result.ok) return
    expect(dm2Result).toMatchObject({
      ok: true,
      format: 'dm2',
      protocol: 34,
      map: 'q2rdm2',
      gameDir: 'opentdm',
      levelName: 'The Chastity Belt Duel  -  by JaLisK0',
      pov: 'sd.kgm/sauDove',
      players: ['WallFly[BZZZ]', 'sd.kgm/sauDove'],
    })
  })

  it('a 32 MiB mvd2 is read only up to the header bound, plain and gzipped', async () => {
    const targetSize = 32 * 1024 * 1024
    const header = buildMvd2({
      version: 2010,
      gameDir: 'baseq2',
      clientNum: 0,
      configstrings: { 0: 'q2dm1', 33: 'maps/q2dm1.bsp' },
      terminate: true,
    })

    const padding = new Uint8Array(Math.max(0, targetSize - header.length))
    for (let i = 0; i < padding.length; i++) padding[i] = i & 0xff

    const combined = new Uint8Array(header.length + padding.length)
    combined.set(header, 0)
    combined.set(padding, header.length)

    const plainPath = join(dir, 'big.mvd2')
    await writeFile(plainPath, combined)

    // Wrap FileHandle.read to observe actual bytes requested/read off disk, independent of
    // whatever the function under test decides to return.
    let plainBytesRead = 0
    const probeHandle = await open(plainPath, 'r')
    const handleProto = Object.getPrototypeOf(probeHandle)
    await probeHandle.close()
    const originalReadFn = handleProto.read
    handleProto.read = async function patchedRead(this: unknown, ...args: unknown[]) {
      const result = await originalReadFn.apply(this, args)
      plainBytesRead += result.bytesRead
      return result
    }

    try {
      const plainResult = await readDemoHeader(plainPath)
      expect(plainResult.ok).toBe(true)
      expect(plainBytesRead).toBeLessThanOrEqual(DM2_HEADER_MAX_BYTES)
    } finally {
      handleProto.read = originalReadFn
    }

    // Gzipped version: track decompressed bytes collected via the wrapped `node:zlib` gunzip
    // (see `zlibTracker`/`vi.mock` above) - this observes real decompressed output regardless of
    // what the function under test returns.
    const gzPath = join(dir, 'big.mvd2.gz')
    await writeFile(gzPath, gzipSync(Buffer.from(combined)))

    zlibTracker.bytes = 0
    const gzResult = await readDemoHeader(gzPath)
    expect(gzResult.ok).toBe(true)
    expect(zlibTracker.bytes).toBeLessThanOrEqual(DM2_HEADER_MAX_BYTES + 128 * 1024)
  })

  it('a cut gzipped mvd2 is truncated', async () => {
    const raw = await readFile(MVD2_FIXTURE_PATH)
    const gz = gzipSync(raw)
    // The mvd2 header (block 1) resolves from only the first ~7 KiB of decompressed output, which
    // this fixture's highly-compressible text reaches very early in the compressed stream - cutting
    // at 50% (as the .dm2 truncation test does) would still leave a complete, decodable header.
    // Cut well before that instead, so decompression stops partway through block 1 itself.
    const cut = gz.subarray(0, Math.floor(gz.length * 0.01))

    const cutPath = join(dir, 'cut.mvd2.gz')
    await writeFile(cutPath, cut)

    const result = await readDemoHeader(cutPath)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('truncated')
  })
})

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/** A single `.mvd2` block (`[uint16 LE length][payload]`) holding `frameCount` bare `mvd_frame`
 * (op `6`) bytes — one message per byte, no body, which is all `createMvd2FrameCounter` reads. */
function buildMvd2FrameBlock(frameCount: number): Uint8Array {
  const payload = new Uint8Array(frameCount).fill(6)
  const out = new Uint8Array(2 + payload.length)
  out[0] = payload.length & 0xff
  out[1] = (payload.length >>> 8) & 0xff
  out.set(payload, 2)
  return out
}

const MVD2_TERMINATOR = new Uint8Array([0, 0])

describe('a demo is read in one full pass', () => {
  it('every demo the header parsers accept gets a duration (AC1)', async () => {
    for (const protocol of [34, 3434, 3435, 3436] as const) {
      const stream = buildDm2Stream({
        protocol,
        blocks: [[dm2Msg.frame(1)], [dm2Msg.frame(2)], [dm2Msg.frame(3)]],
        terminate: true,
      })
      const path = join(dir, `synthetic-${protocol}.dm2`)
      await writeFile(path, stream)

      const header = await readDemoHeader(path)
      expect(header.ok, `protocol ${protocol} header`).toBe(true)

      const duration = (await readDemoFullPass(path)).duration
      expect(duration.ok, `protocol ${protocol} duration`).toBe(true)
      if (duration.ok) expect(duration.frames).toBeGreaterThan(0)
    }

    for (const version of [2009, 2013] as const) {
      const headerBytes = buildMvd2({
        version,
        gameDir: 'baseq2',
        clientNum: 0,
        configstrings: {},
        terminate: false,
      })
      const stream = concatBytes([headerBytes, buildMvd2FrameBlock(3), MVD2_TERMINATOR])
      const path = join(dir, `synthetic-${version}.mvd2`)
      await writeFile(path, stream)

      const header = await readDemoHeader(path)
      expect(header.ok, `version ${version} header`).toBe(true)

      const duration = (await readDemoFullPass(path)).duration
      expect(duration.ok, `version ${version} duration`).toBe(true)
      if (duration.ok) expect(duration.frames).toBeGreaterThan(0)
    }
  })

  it('the real test.dm2 lasts 410 frames and the real PFAU mvd2 6201 frames, plain and gzipped', async () => {
    const dm2Result = (await readDemoFullPass(FIXTURE_PATH)).duration
    expect(dm2Result).toEqual({ ok: true, frames: 410, durationMs: 41000, complete: true })

    const mvd2Result = (await readDemoFullPass(MVD2_FIXTURE_PATH)).duration
    expect(mvd2Result).toEqual({ ok: true, frames: 6201, durationMs: 620100, complete: true })

    const dm2Raw = await readFile(FIXTURE_PATH)
    const dm2GzPath = join(dir, 'test.dm2.gz')
    await writeFile(dm2GzPath, gzipSync(dm2Raw))
    expect((await readDemoFullPass(dm2GzPath)).duration).toEqual(dm2Result)

    const mvd2Raw = await readFile(MVD2_FIXTURE_PATH)
    const mvd2GzPath = join(dir, 'pfau.mvd2.gz')
    await writeFile(mvd2GzPath, gzipSync(mvd2Raw))
    expect((await readDemoFullPass(mvd2GzPath)).duration).toEqual(mvd2Result)

    // Format is sniffed from content, not the file extension.
    const mvd2NamedDm2Path = join(dir, 'pfau-mislabeled.dm2')
    await writeFile(mvd2NamedDm2Path, mvd2Raw)
    expect((await readDemoFullPass(mvd2NamedDm2Path)).duration).toEqual(mvd2Result)
  })

  it('the dm2 frame count equals the serverframe span of the real fixture (AC2)', async () => {
    // Independent oracle: trusts only the `.dm2` block framing (`[int32 LE length][payload]`,
    // `-1` terminated) - the same unambiguous wrapper every approach relies on - not the message
    // skip logic `createDm2FrameCounter` uses. Within each block (known to carry at most one
    // `svc_frame`), it takes the first byte equal to the `svc_frame` opcode (20) whose following 8
    // bytes read as a plausible (serverframe, deltaframe) pair - deltaframe is either -1 (keyframe)
    // or exactly serverframe - 1 (the common case), which a coincidental match in unrelated binary
    // payload data is vanishingly unlikely to satisfy.
    const raw = await readFile(FIXTURE_PATH)
    const SVC_FRAME = 20

    let first: number | null = null
    let last: number | null = null
    let offset = 0
    while (offset + 4 <= raw.length) {
      const length = raw.readInt32LE(offset)
      offset += 4
      if (length === -1) break
      if (length < 0 || offset + length > raw.length) break
      const blockEnd = offset + length

      for (let p = offset; p <= blockEnd - 9; p++) {
        if (raw[p] !== SVC_FRAME) continue
        const serverframe = raw.readInt32LE(p + 1)
        const deltaframe = raw.readInt32LE(p + 5)
        if (
          serverframe >= 0 &&
          serverframe < 10_000_000 &&
          (deltaframe === -1 || deltaframe === serverframe - 1)
        ) {
          if (first === null) first = serverframe
          last = serverframe
          break // a block carries at most one frame
        }
      }
      offset = blockEnd
    }

    expect(first).not.toBeNull()
    expect(last).not.toBeNull()
    const expectedFrames = (last as number) - (first as number) + 1

    const duration = (await readDemoFullPass(FIXTURE_PATH)).duration
    expect(duration.ok).toBe(true)
    if (duration.ok) expect(duration.frames).toBe(expectedFrames)
  })

  it('an OpenTDM demo yields Home [maq] and Away [shad], plain and gzipped', async () => {
    const expected = [
      { name: 'Home', players: ['maq'] },
      { name: 'Away', players: ['shad'] },
    ]
    expect((await readDemoFullPass(OPENTDM_FIXTURE_PATH)).roster?.teams).toEqual(expected)

    const gzPath = join(dir, 'opentdm.dm2.gz')
    await writeFile(gzPath, gzipSync(await readFile(OPENTDM_FIXTURE_PATH)))
    expect((await readDemoFullPass(gzPath)).roster?.teams).toEqual(expected)
  })

  it('an mvd2 demo has no roster', async () => {
    expect((await readDemoFullPass(MVD2_FIXTURE_PATH)).roster).toBeNull()
  })

  it('a missing path is unreadable', async () => {
    const result = await readDemoFullPass(join(dir, 'does-not-exist.demo'))
    expect(result).toEqual({ duration: { ok: false, reason: 'unreadable' }, roster: null })
  })
})
