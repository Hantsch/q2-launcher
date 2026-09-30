/**
 * Builds synthetic `.mvd2` byte streams for `mvd2-frames.test.ts`: the `"MVD2"` magic, a
 * `mvd_serverdata` block, optional header configstrings, then any list of blocks, each assembled
 * from message builders (`mvd2Msg`). The companion of `mvd2-frames.ts` (which shapes the wire
 * layouts it must skip): hand-assembled bytes a test can shape precisely, never anything captured
 * off a real client/server.
 *
 * Deliberately simpler than `mvd2-header.ts`'s real-world header: `mvd2-frames.ts` returns
 * `'frameless'` the instant it reads `mvd_serverdata`'s `protocol`/`version`, so this writer never
 * needs the trailing `servercount`/`gamedir`/`clientNum`/inline-configstring-run bytes a real MVD
 * header carries — they would be dead weight for what this counter reads.
 *
 * Output is written into a growable `Uint8Array`, so tens of MiB build quickly.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { encodeLatin1 } from '../servers/protocol'

const MVD_SERVERDATA = 4
const MVD_CONFIGSTRING = 5
const MVD_FRAME = 6
const MVD_UNICAST = 8
const MVD_UNICAST_R = 9
const MVD_SOUND = 16
const MVD_PRINT = 17

const SVCMD_BITS = 5

const SND_VOLUME = 1 << 0
const SND_ATTENUATION = 1 << 1
const SND_OFFSET = 1 << 4
const SND_INDEX16 = 1 << 5

export type MulticastVariant = 'all' | 'phs' | 'pvs' | 'all_r' | 'phs_r' | 'pvs_r'

const MULTICAST_OP: Record<MulticastVariant, number> = {
  all: 10,
  phs: 11,
  pvs: 12,
  all_r: 13,
  phs_r: 14,
  pvs_r: 15,
}

export type Mvd2StreamMessage =
  | { kind: 'frame' }
  | { kind: 'print'; level: number; text: string }
  | { kind: 'configstring'; index: number; value: string }
  | { kind: 'unicast'; reliable: boolean; clientNum: number; bytes: readonly number[] }
  | { kind: 'multicast'; variant: MulticastVariant; leaf: number; bytes: readonly number[] }
  | {
      kind: 'sound'
      index: number
      index16?: boolean
      volume?: number
      attenuation?: number
      offset?: number
      sendchan: number
    }
  | { kind: 'serverdata'; protocol: number; version: number }
  | { kind: 'raw'; opcode: number; bytes: readonly number[] }

/** Message builders for `buildMvd2Stream`'s blocks. */
export const mvd2Msg = {
  /** `mvd_frame` — the body after it (portal bits, player/entity deltas) is never decoded, so it
   * carries no fields here. */
  frame: (): Mvd2StreamMessage => ({ kind: 'frame' }),
  print: (text: string, level = 2): Mvd2StreamMessage => ({ kind: 'print', level, text }),
  configstring: (index: number, value: string): Mvd2StreamMessage => ({ kind: 'configstring', index, value }),
  unicast: (clientNum: number, bytes: readonly number[] = []): Mvd2StreamMessage => ({
    kind: 'unicast',
    reliable: false,
    clientNum,
    bytes,
  }),
  unicastR: (clientNum: number, bytes: readonly number[] = []): Mvd2StreamMessage => ({
    kind: 'unicast',
    reliable: true,
    clientNum,
    bytes,
  }),
  multicast: (variant: MulticastVariant, bytes: readonly number[] = [], leaf = 0): Mvd2StreamMessage => ({
    kind: 'multicast',
    variant,
    leaf,
    bytes,
  }),
  sound: (opts: Omit<Extract<Mvd2StreamMessage, { kind: 'sound' }>, 'kind'>): Mvd2StreamMessage => ({
    kind: 'sound',
    ...opts,
  }),
  serverdata: (protocol: number, version = 2010): Mvd2StreamMessage => ({ kind: 'serverdata', protocol, version }),
  raw: (opcode: number, bytes: readonly number[] = []): Mvd2StreamMessage => ({ kind: 'raw', opcode, bytes }),
}

export interface BuildMvd2StreamOptions {
  protocol?: number // default 37 — the MVD wire protocol
  version?: number // default 2010
  /** Configstrings sent as `mvd_configstring` messages in one block right after the serverdata
   * block. A real header instead inlines an opcode-less index/string run ended by a sentinel
   * (`mvd2-header.ts`), but the frame counter never reads past `mvd_serverdata`'s own fields, so
   * this simpler shape (still frame-less, still after the header block) exercises the same path. */
  headerConfigstrings?: Record<number, string>
  blocks: readonly (readonly Mvd2StreamMessage[])[]
  /** Appends the `0`-length terminator block. */
  terminate?: boolean
  /** Bytes appended after everything else (after the terminator, if any). */
  trailing?: readonly number[]
}

class ByteWriter {
  private buf = new Uint8Array(1024)
  length = 0

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return
    let capacity = this.buf.length * 2
    while (capacity < this.length + extra) capacity *= 2
    const grown = new Uint8Array(capacity)
    grown.set(this.buf.subarray(0, this.length))
    this.buf = grown
  }

  byte(v: number): void {
    this.ensure(1)
    this.buf[this.length++] = v & 0xff
  }

  short(v: number): void {
    this.byte(v)
    this.byte(v >>> 8)
  }

  long(v: number): void {
    this.short(v)
    this.short(v >>> 16)
  }

  bytes(values: ArrayLike<number>): void {
    this.ensure(values.length)
    for (let i = 0; i < values.length; i++) this.buf[this.length++] = values[i]! & 0xff
  }

  string(s: string): void {
    this.bytes(encodeLatin1(s))
    this.byte(0)
  }

  patchShort(at: number, v: number): void {
    this.buf[at] = v & 0xff
    this.buf[at + 1] = (v >>> 8) & 0xff
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

function writeServerdata(w: ByteWriter, protocol: number, version: number): void {
  w.byte(MVD_SERVERDATA)
  w.long(protocol)
  w.short(version)
}

/** Packs `length` into a length-prefixed op's opcode byte (extra bits, high 3) plus its length
 * byte (low 8): `mvd_unicast`/`mvd_unicast_r`/`mvd_multicast_*`, per `SV_MvdUnicast`/
 * `SV_MvdMulticast` in q2pro's `mvd.c`. */
function writeLengthPrefixedOp(
  w: ByteWriter,
  op: number,
  bytes: readonly number[],
  between?: (w: ByteWriter) => void,
): void {
  const length = bytes.length
  const extra = length >>> 8
  w.byte(op | (extra << SVCMD_BITS))
  w.byte(length & 0xff)
  if (between) between(w)
  w.bytes(bytes)
}

function writeMessage(w: ByteWriter, m: Mvd2StreamMessage): void {
  switch (m.kind) {
    case 'frame':
      w.byte(MVD_FRAME)
      return
    case 'print':
      w.byte(MVD_PRINT)
      w.byte(m.level)
      w.string(m.text)
      return
    case 'configstring':
      w.byte(MVD_CONFIGSTRING)
      w.short(m.index)
      w.string(m.value)
      return
    case 'unicast':
      writeLengthPrefixedOp(w, m.reliable ? MVD_UNICAST_R : MVD_UNICAST, m.bytes, (b) => b.byte(m.clientNum))
      return
    case 'multicast': {
      const hasLeaf = m.variant === 'phs' || m.variant === 'pvs' || m.variant === 'phs_r' || m.variant === 'pvs_r'
      writeLengthPrefixedOp(w, MULTICAST_OP[m.variant], m.bytes, hasLeaf ? (b) => b.short(m.leaf) : undefined)
      return
    }
    case 'sound': {
      let flags = 0
      if (m.volume !== undefined) flags |= SND_VOLUME
      if (m.attenuation !== undefined) flags |= SND_ATTENUATION
      if (m.offset !== undefined) flags |= SND_OFFSET
      if (m.index16) flags |= SND_INDEX16
      w.byte(MVD_SOUND)
      w.byte(flags)
      if (m.index16) w.short(m.index)
      else w.byte(m.index)
      if (m.volume !== undefined) w.byte(m.volume)
      if (m.attenuation !== undefined) w.byte(m.attenuation)
      if (m.offset !== undefined) w.byte(m.offset)
      w.short(m.sendchan)
      return
    }
    case 'serverdata':
      writeServerdata(w, m.protocol, m.version)
      return
    case 'raw':
      w.byte(m.opcode)
      w.bytes(m.bytes)
      return
  }
}

function writeBlock(w: ByteWriter, body: (w: ByteWriter) => void): void {
  const lengthAt = w.length
  w.short(0)
  body(w)
  w.patchShort(lengthAt, w.length - lengthAt - 2)
}

/**
 * Assembles a synthetic `.mvd2` stream: the `"MVD2"` magic, one `mvd_serverdata` block for
 * `protocol`/`version`, one block of `headerConfigstrings` (if any), then `blocks` in order (an
 * empty list = a zero-length block), then the optional `0`-length terminator and `trailing` bytes.
 */
export function buildMvd2Stream(opts: BuildMvd2StreamOptions): Uint8Array {
  const w = new ByteWriter()
  w.bytes([0x4d, 0x56, 0x44, 0x32]) // "MVD2"
  const protocol = opts.protocol ?? 37
  const version = opts.version ?? 2010
  writeBlock(w, (b) => writeServerdata(b, protocol, version))
  const cs = opts.headerConfigstrings
  if (cs !== undefined && Object.keys(cs).length > 0) {
    writeBlock(w, (b) => {
      for (const key of Object.keys(cs).map(Number).sort((x, y) => x - y)) {
        writeMessage(b, mvd2Msg.configstring(key, cs[key]!))
      }
    })
  }
  for (const block of opts.blocks) {
    writeBlock(w, (b) => {
      for (const m of block) writeMessage(b, m)
    })
  }
  if (opts.terminate) w.short(0)
  if (opts.trailing !== undefined) w.bytes(opts.trailing)
  return w.result()
}
