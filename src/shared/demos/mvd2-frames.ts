/**
 * Counts the server frames in an `.mvd2` (multi-view demo) recording — exactly, not as an
 * estimate — so the demo's length is `frames × DEMO_FRAME_MS` (`./frame-count.ts`).
 *
 * ## Framing
 *
 * An `.mvd2` file starts with the 4-byte ASCII magic `"MVD2"`, then a sequence of
 * `[uint16 LE length][payload]` blocks, ended by a block whose length word is `0` (no payload
 * follows the terminator — see `mvd2-header.ts`, which parses the same framing for block 1).
 * Each MVD opcode byte packs two fields: its low 5 bits are the op (`SVCMD_BITS` in q2pro), its
 * high 3 bits are "extra bits" — for the length-prefixed ops below, the extra bits are the top 3
 * bits of an 11-bit length, the length byte that follows holds the low 8: `length = byte |
 * (extra << 8)`. The first block must open with `mvd_serverdata` (op `4`): `int32 protocol`
 * (must be `37`, the MVD wire protocol) then `uint16 version` (`2009..2013`, matching
 * `mvd2-header.ts`'s `MVD_VERSIONS`) — anything else is `not-a-demo`. A `mvd_serverdata` message
 * is otherwise frame-less, whether it is the opening header or a mid-file gamestate (a mid-file
 * map change resends it); on a non-first occurrence only its `protocol` is re-checked (`=== 37`,
 * else `undecodable`) — mirroring `dm2-frames.ts`'s treatment of a mid-demo `svc_serverdata`.
 *
 * ## Why counting `mvd_frame` is exact
 *
 * q2pro's MVD recorder writes exactly one `mvd_frame` (op `6`) per server frame: `emit_frame()`
 * (`src/server/mvd.c`) is called once per frame and its first byte is always `mvd_frame` — there is
 * no "nodelta" variant in use (the enum reserves `mvd_frame_nodelta` = `7`, but no code path ever
 * writes it, so it is treated as `undecodable` like any other unhandled op). So walking each
 * block's messages from the start until `mvd_frame` (count it, next block) is exact, the same
 * method `dm2-frames.ts` uses for `.dm2`; a block count would over-count the gamestate/configstring/
 * print blocks that carry no frame at all, which is why the frame-less-block synthetic test exists.
 *
 * ## Per-op layouts (confirmed in q2pro `master`, read for facts only — nothing GPL copied, this
 * project is not GPL)
 *
 * - `mvd_nop` (1): no payload.
 * - `mvd_configstring` (5): `uint16 index` + NUL-terminated string (`SV_MvdConfigstring` writes an
 *   index/string pair identically to the client demo format).
 * - `mvd_print` (17): `byte level` + NUL-terminated string.
 * - `mvd_unicast` (8) / `mvd_unicast_r` (9): a reliable/unreliable pair that share one layout —
 *   `byte lengthLow`, `byte clientNum`, then `length` bytes, where `length = lengthLow | (extra <<
 *   8)` (`SV_MvdUnicast` in `mvd.c`: `SZ_WriteByte(buf, op | (cursize >> 8 << SVCMD_BITS));
 *   SZ_WriteByte(buf, cursize & 255); SZ_WriteByte(buf, clientNum); SZ_Write(buf, data, cursize)`).
 * - `mvd_multicast_all` (10) / `mvd_multicast_all_r` (13): `byte lengthLow`, then `length` bytes,
 *   same length encoding as unicast, no leaf.
 * - `mvd_multicast_phs` (11) / `mvd_multicast_pvs` (12) / `mvd_multicast_phs_r` (14) /
 *   `mvd_multicast_pvs_r` (15): as `_all`, but a `uint16 leaf` is written between the length byte
 *   and the data (`SV_MvdMulticast`: `SZ_WriteByte(...); SZ_WriteByte(len & 255); if (to)
 *   SZ_WriteShort(buf, leafnum); SZ_Write(...)`).
 * - `mvd_sound` (16): confirmed via `SV_MvdStartSound` — `byte flags`, then the sound index as
 *   `uint16` when `flags & SND_INDEX16` else `byte`, then `byte volume` iff `SND_VOLUME`, `byte
 *   attenuation` iff `SND_ATTENUATION`, `byte timeofs` iff `SND_OFFSET`, and finally **always** a
 *   `uint16` (`sendchan = (entnum << 3) | (channel & 7)`) — unlike `.dm2`'s `svc_sound`, MVD never
 *   checks `SND_POS`/`SND_ENT`: entity and channel are always packed into that trailing word, and
 *   no position is ever written. This layout does not change across MVD versions 2009–2013 (only
 *   `mvd2-header.ts`'s inline configstring layout does).
 * - Anything else — `mvd_bad` (0), `mvd_disconnect` (2), `mvd_reconnect` (3),
 *   `mvd_frame_nodelta` (7), `mvd_stufftext` (18), `mvd_num_types` (19) and up, or an opcode past
 *   the table — is `undecodable` rather than guessed at.
 *
 * Sources read for these facts only: q2pro `master`, `src/server/mvd.c` (`emit_frame`,
 * `SV_MvdUnicast`, `SV_MvdMulticast`, `SV_MvdStartSound`) and `inc/common/protocol.h` (the
 * `mvd_ops_e` enum, `SVCMD_BITS`, `PROTOCOL_VERSION_MVD_MINIMUM`/`_CURRENT` = 2009/2013). aq2replay
 * was not reachable from this environment, so only q2pro was used to confirm the wire layouts.
 *
 * Never throws; every loop consumes at least one byte per iteration. Pure by contract: this file
 * lives in `src/shared`, so no `node:*` import, no DOM types, no `Buffer`, no IPC.
 */

import { BlockBuffer, framesResult } from './frame-count'
import type { FrameCounter, FrameCountResult } from './frame-count'

const MVD_NOP = 1
const MVD_SERVERDATA = 4
const MVD_CONFIGSTRING = 5
const MVD_FRAME = 6
const MVD_UNICAST = 8
const MVD_UNICAST_R = 9
const MVD_MULTICAST_ALL = 10
const MVD_MULTICAST_PHS = 11
const MVD_MULTICAST_PVS = 12
const MVD_MULTICAST_ALL_R = 13
const MVD_MULTICAST_PHS_R = 14
const MVD_MULTICAST_PVS_R = 15
const MVD_SOUND = 16
const MVD_PRINT = 17

/** Low 5 bits of an MVD opcode byte are the op; the high 3 bits ("extra bits") extend a
 * length-prefixed op's length by 3 more (high) bits. */
const SVCMD_BITS = 5
const OP_MASK = (1 << SVCMD_BITS) - 1

const SND_VOLUME = 1 << 0
const SND_ATTENUATION = 1 << 1
const SND_OFFSET = 1 << 4
const SND_INDEX16 = 1 << 5

const MVD_MIN_VERSION = 2009
const MVD_MAX_VERSION = 2013

const MAGIC = [0x4d, 0x56, 0x44, 0x32] // "MVD2"

/** Sentinel returned by the skip helpers when a field would run past the block end. */
const OVERRUN = -1

function skipString(bytes: Uint8Array, p: number, end: number): number {
  while (p < end) {
    if (bytes[p] === 0) return p + 1
    p++
  }
  return OVERRUN
}

function skipFixed(p: number, n: number, end: number): number {
  return p + n <= end ? p + n : OVERRUN
}

function readInt32LE(bytes: Uint8Array, p: number): number {
  return bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16) | (bytes[p + 3]! << 24) | 0
}

function readUint16LE(bytes: Uint8Array, p: number): number {
  return bytes[p]! | (bytes[p + 1]! << 8)
}

/** Skips one `mvd_sound` message's fields after its opcode byte; see the file doc comment. */
function skipMvdSound(bytes: Uint8Array, p: number, end: number): number {
  if (p >= end) return OVERRUN
  const flags = bytes[p]!
  p++
  p = skipFixed(p, (flags & SND_INDEX16) !== 0 ? 2 : 1, end)
  if (p !== OVERRUN && (flags & SND_VOLUME) !== 0) p = skipFixed(p, 1, end)
  if (p !== OVERRUN && (flags & SND_ATTENUATION) !== 0) p = skipFixed(p, 1, end)
  if (p !== OVERRUN && (flags & SND_OFFSET) !== 0) p = skipFixed(p, 1, end)
  if (p !== OVERRUN) p = skipFixed(p, 2, end) // sendchan: always present, no flag gates it
  return p
}

type BlockOutcome = 'frame' | 'frameless' | 'undecodable' | 'not-a-demo'

/**
 * Creates a streaming `.mvd2` frame counter. See the file doc comment for the counting method and
 * the confirmed per-op layouts.
 */
export function createMvd2FrameCounter(): FrameCounter {
  const buffer = new BlockBuffer()
  let consumedBytes = 0 // file offset of `buffer.readOffset`
  let magicChecked = false
  let protocol: number | null = null
  let frames = 0
  let ended = false
  let failure: FrameCountResult | null = null

  function fail(reason: 'not-a-demo' | 'undecodable', at: number): void {
    failure = { ok: false, reason, at }
    buffer.clear()
  }

  function decodeBlock(bytes: Uint8Array, start: number, end: number): BlockOutcome {
    let p = start
    if (protocol === null && (p >= end || (bytes[p]! & OP_MASK) !== MVD_SERVERDATA))
      return 'not-a-demo'
    while (p < end) {
      const opcodeByte = bytes[p]!
      const op = opcodeByte & OP_MASK
      const extra = opcodeByte >>> SVCMD_BITS
      p++
      switch (op) {
        case MVD_FRAME:
          return 'frame'
        case MVD_SERVERDATA: {
          const first = protocol === null
          if (p + 4 > end) return first ? 'not-a-demo' : 'undecodable'
          const read = readInt32LE(bytes, p)
          p += 4
          if (read !== 37) return first ? 'not-a-demo' : 'undecodable'
          if (first) {
            if (p + 2 > end) return 'not-a-demo'
            const version = readUint16LE(bytes, p)
            if (version < MVD_MIN_VERSION || version > MVD_MAX_VERSION) return 'not-a-demo'
            protocol = read
          }
          return 'frameless'
        }
        case MVD_NOP:
          break
        case MVD_CONFIGSTRING:
          p = skipFixed(p, 2, end)
          if (p !== OVERRUN) p = skipString(bytes, p, end)
          break
        case MVD_PRINT:
          p = skipFixed(p, 1, end)
          if (p !== OVERRUN) p = skipString(bytes, p, end)
          break
        case MVD_UNICAST:
        case MVD_UNICAST_R: {
          const lengthAt = p
          p = skipFixed(p, 1, end)
          if (p !== OVERRUN) {
            const length = bytes[lengthAt]! | (extra << 8)
            p = skipFixed(p, 1, end) // clientNum
            if (p !== OVERRUN) p = skipFixed(p, length, end)
          }
          break
        }
        case MVD_MULTICAST_ALL:
        case MVD_MULTICAST_ALL_R:
        case MVD_MULTICAST_PHS:
        case MVD_MULTICAST_PVS:
        case MVD_MULTICAST_PHS_R:
        case MVD_MULTICAST_PVS_R: {
          const lengthAt = p
          p = skipFixed(p, 1, end)
          if (p !== OVERRUN) {
            const length = bytes[lengthAt]! | (extra << 8)
            const hasLeaf =
              op === MVD_MULTICAST_PHS ||
              op === MVD_MULTICAST_PVS ||
              op === MVD_MULTICAST_PHS_R ||
              op === MVD_MULTICAST_PVS_R
            if (hasLeaf) p = skipFixed(p, 2, end)
            if (p !== OVERRUN) p = skipFixed(p, length, end)
          }
          break
        }
        case MVD_SOUND:
          p = skipMvdSound(bytes, p, end)
          break
        default:
          return 'undecodable'
      }
      if (p === OVERRUN) return 'undecodable'
    }
    return 'frameless'
  }

  function checkMagic(): 'ok' | 'bad' | 'pending' {
    const bytes = buffer.bytes
    const start = buffer.readOffset
    const available = buffer.available
    const n = Math.min(MAGIC.length, available)
    for (let i = 0; i < n; i++) if (bytes[start + i] !== MAGIC[i]) return 'bad'
    return available >= MAGIC.length ? 'ok' : 'pending'
  }

  function drain(): void {
    if (failure !== null || ended) return
    if (!magicChecked) {
      const state = checkMagic()
      if (state === 'pending') return
      if (state === 'bad') {
        fail('not-a-demo', consumedBytes)
        return
      }
      magicChecked = true
      buffer.consume(MAGIC.length)
      consumedBytes += MAGIC.length
    }
    while (failure === null && !ended && buffer.available >= 2) {
      const bytes = buffer.bytes
      const at = buffer.readOffset
      const length = readUint16LE(bytes, at)
      if (length === 0) {
        ended = true
        consumedBytes += 2
        buffer.clear()
        return
      }
      if (buffer.available < 2 + length) return // wait for the rest of the block
      const outcome = decodeBlock(bytes, at + 2, at + 2 + length)
      if (outcome === 'not-a-demo' || outcome === 'undecodable') {
        fail(outcome, consumedBytes)
        return
      }
      if (outcome === 'frame') frames++
      buffer.consume(2 + length)
      consumedBytes += 2 + length
    }
  }

  return {
    push(chunk: Uint8Array): void {
      if (failure !== null || ended || chunk.length === 0) return
      buffer.append(chunk)
      drain()
    },
    finish(): FrameCountResult {
      if (failure !== null) return failure
      if (protocol === null) return { ok: false, reason: 'not-a-demo' }
      // Not ended = the terminator never arrived (a cut last block or a missing `0` word).
      return framesResult(frames, ended)
    },
    get failed(): boolean {
      return failure !== null
    },
  }
}
