/**
 * Counts the server frames in a `.dm2` demo — exactly, not as an estimate — so the demo's length
 * is `frames × DEMO_FRAME_MS` (`./frame-count.ts`).
 *
 * ## Why counting `svc_frame` is exact
 *
 * A `.dm2` file is a sequence of `[int32 LE length][payload]` blocks ended by a `-1` length word.
 * The client writes one block per received server frame: q2pro's demo recorder
 * (`src/client/demo.c`, `CL_EmitDemoFrame`) collects the frame's reliable/unreliable messages
 * (prints, sounds, temp entities, configstring updates, ...) into the demo buffer, appends the one
 * `svc_frame` it re-encodes, and flushes the buffer as one block; the original 3.20 client writes
 * each received packet (which carries at most one frame) as one block. So a block carries **at
 * most one** `svc_frame`, after any number of other messages. Blocks without a frame exist too:
 * the gamestate blocks (serverdata, configstrings, baselines), a frame q2pro dropped because it
 * did not fit (`frames_dropped`), prints/stufftexts between frames, and a mid-demo map change
 * (a fresh `svc_serverdata`). q2pro's own player counts demo frames the same way: it increments
 * `cls.demo.frames_read` once per parsed `svc_frame` (`src/client/parse.c`, `CL_ParseFrame`).
 *
 * Counting blocks would therefore over-count; this module instead walks each block's messages
 * from the start until it meets `svc_frame` (count it, next block) or a message that cannot
 * precede a frame in the same block (`svc_serverdata`, `svc_spawnbaseline` — next block).
 * Every other message it knows is sized and skipped; anything else is `undecodable` rather than
 * guessed at, so a mis-sized field surfaces as a failure instead of silently realigning onto a
 * wrong count. Everything after `svc_frame` inside a block (playerinfo, packetentities) is never
 * decoded — its encoding is the part that varies most between protocols.
 *
 * Accuracy on the real fixtures (`docs/fixtures/demos/`): `test.dm2` counts 410 frames (41.0 s)
 * and the PFAU `.mvd2` counts 6201 frames (10:20); on both, a naive block count happens to be 0
 * frames off, which is why the frame-less-block synthetic tests exist — they are what proves this
 * is not a block estimate.
 *
 * ## Protocol deviations (confirmed in q2pro `master`, read for facts only)
 *
 * Demo protocols 3434/3435/3436 are q2pro's "extended" demo protocols
 * (`PROTOCOL_VERSION_EXTENDED_*` in `inc/common/protocol.h`); on playback q2pro parses them as
 * protocol 34 with the extended configstring remap plus, per version:
 *
 * - **3434+** (`cl.csr.extended`): `svc_sound` reads a 16-bit sound index when flag
 *   `SND_INDEX16` (bit 5) is set; protocol 34 always reads one byte and ignores that bit.
 * - **3435+** (`MSG_ES_EXTENSIONS_2`, `PROTOCOL_VERSION_EXTENDED_LIMITS_2`): every position read
 *   through `CL_ReadPos` — temp-entity positions and `svc_sound`'s position — is an extended
 *   coordinate: an `uint16` word, followed by one more byte when the word's low bit is set (2 or 3
 *   bytes per axis instead of a fixed `int16`).
 * - **3436** (`PROTOCOL_VERSION_EXTENDED_PLAYERFOG`): only adds player-state bits, which live
 *   inside `svc_frame`'s body — nothing this counter sizes changes.
 *
 * Unchanged across all four: muzzleflash (`uint16` + byte), print, configstring (`uint16` index),
 * inventory, layout/stufftext/centerprint, download, and the opcode byte itself (demo playback runs
 * as protocol 34, so the r1q2 opcode high bits are never valid).
 *
 * The temp-entity field table follows q2pro's `CL_ParseTEntPacket`, which is the protocol-34
 * table of the original client (as tabulated in packetflinger/libq2, Apache-2.0) plus the
 * rerelease types q2pro accepts in every protocol (`TE_BLUEHYPERBLASTER_2` .. `TE_EXPLOSION2_NL`,
 * `TE_DAMAGE_DEALT` = 128). `TE_FLAME` (32) has no reader in any client and is `undecodable`.
 *
 * ## Observing the walk
 *
 * An optional `Dm2FrameObserver` receives each `svc_serverdata` protocol, `svc_configstring` and
 * `svc_layout` the walk passes (so only what precedes a block's `svc_frame`). Observing decodes
 * those payloads but never moves the cursor differently: the offsets are the skip path's own, so
 * the count is the same with or without an observer. A failed count may already have forwarded
 * messages from the failing block.
 *
 * Never throws; every loop consumes at least one byte per iteration. Pure by contract: this file
 * lives in `src/shared`, so no `node:*` import, no DOM types, no `Buffer`, no IPC.
 */

import { BlockBuffer, DEMO_MAX_BLOCK_BYTES, framesResult } from './frame-count'
import type { FrameCounter, FrameCountResult } from './frame-count'
import { decodeLatin1 } from '../servers/protocol'

/** Receives the messages a `.dm2` frame count walks past (see "Observing the walk"). */
export interface Dm2FrameObserver {
  onServerdata(protocol: number): void
  /** `value` is the NUL-less string, decoded byte-for-byte as latin1. */
  onConfigstring(index: number, value: string): void
  onLayout(text: string): void
}

const SVC_MUZZLEFLASH = 1
const SVC_MUZZLEFLASH2 = 2
const SVC_TEMP_ENTITY = 3
const SVC_LAYOUT = 4
const SVC_INVENTORY = 5
const SVC_NOP = 6
const SVC_DISCONNECT = 7
const SVC_RECONNECT = 8
const SVC_SOUND = 9
const SVC_PRINT = 10
const SVC_STUFFTEXT = 11
const SVC_SERVERDATA = 12
const SVC_CONFIGSTRING = 13
const SVC_SPAWNBASELINE = 14
const SVC_CENTERPRINT = 15
const SVC_DOWNLOAD = 16
const SVC_FRAME = 20

const SND_VOLUME = 1 << 0
const SND_ATTENUATION = 1 << 1
const SND_POS = 1 << 2
const SND_ENT = 1 << 3
const SND_OFFSET = 1 << 4
const SND_INDEX16 = 1 << 5

const MAX_ITEMS = 256
const TE_STEAM = 40

const ACCEPTED_PROTOCOLS = new Set([34, 3434, 3435, 3436])

/**
 * Temp-entity field layouts, keyed by `TE_*` type: `p` = position (3 coordinates), `d` = direction
 * (byte), `b` = byte, `s` = int16. `TE_STEAM` additionally carries an `int32` when its leading
 * entity is not -1 (handled in `skipTempEntity`).
 */
const TE_LAYOUT: Partial<Record<number, string>> = {}
function defineTe(layout: string, types: number[]): void {
  for (const t of types) TE_LAYOUT[t] = layout
}
// GUNSHOT BLOOD BLASTER SHOTGUN SPARKS SCREEN_SPARKS SHIELD_SPARKS BULLET_SPARKS GREENBLOOD
// BLASTER2 MOREBLOOD HEATBEAM_SPARKS HEATBEAM_STEAM ELECTRIC_SPARKS FLECHETTE
// BLUEHYPERBLASTER_2 BERSERK_SLAM
defineTe('pd', [0, 1, 2, 4, 9, 12, 13, 14, 26, 30, 42, 43, 44, 46, 55, 56, 58])
// SPLASH LASER_SPARKS WELDING_SPARKS TUNNEL_SPARKS
defineTe('bpdb', [10, 15, 25, 29])
// RAILTRAIL BUBBLETRAIL BFG_LASER BLUEHYPERBLASTER RAILTRAIL2 DEBUGTRAIL BUBBLETRAIL2 BFG_ZAP
defineTe('pp', [3, 11, 23, 27, 31, 34, 41, 57])
// EXPLOSION1 EXPLOSION2 ROCKET_EXPLOSION GRENADE_EXPLOSION ROCKET_EXPLOSION_WATER
// GRENADE_EXPLOSION_WATER BFG_EXPLOSION BFG_BIGEXPLOSION BOSSTPORT PLASMA_EXPLOSION
// PLAIN_EXPLOSION CHAINFIST_SMOKE TRACKER_EXPLOSION TELEPORT_EFFECT DBALL_GOAL NUKEBLAST
// WIDOWSPLASH EXPLOSION1_BIG EXPLOSION1_NP EXPLOSION1_NL EXPLOSION2_NL
defineTe('p', [5, 6, 7, 8, 17, 18, 20, 21, 22, 28, 35, 45, 47, 48, 49, 51, 52, 53, 54, 62, 63])
// PARASITE_ATTACK MEDIC_CABLE_ATTACK HEATBEAM MONSTER_HEATBEAM GRAPPLE_CABLE_2 LIGHTNING_BEAM
defineTe('spp', [16, 19, 38, 39, 59, 61])
defineTe('sppp', [24]) // GRAPPLE_CABLE
defineTe('sspp', [33]) // LIGHTNING
defineTe('ps', [36]) // FLASHLIGHT
defineTe('ppb', [37]) // FORCEWALL
defineTe('sbpdbs', [TE_STEAM]) // STEAM (+ int32 when entity != -1)
defineTe('sp', [50]) // WIDOWBEAMOUT
defineTe('sb', [60]) // POWER_SPLASH
defineTe('s', [128]) // DAMAGE_DEALT

/** Sentinel returned by the skip helpers when a field would run past the block end. */
const OVERRUN = -1

/** Skips one position (3 coordinates) at `p`; returns the new offset or `OVERRUN`. */
function skipPos(bytes: Uint8Array, p: number, end: number, extCoords: boolean): number {
  if (!extCoords) return p + 6 <= end ? p + 6 : OVERRUN
  for (let axis = 0; axis < 3; axis++) {
    if (p + 2 > end) return OVERRUN
    // Low bit of the little-endian word = low bit of its first byte: a third byte follows.
    const size = (bytes[p]! & 1) === 1 ? 3 : 2
    if (p + size > end) return OVERRUN
    p += size
  }
  return p
}

/** Skips a NUL-terminated string at `p`; `OVERRUN` if no NUL occurs before `end`. */
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

function skipTempEntity(bytes: Uint8Array, p: number, end: number, extCoords: boolean): number {
  if (p >= end) return OVERRUN
  const type = bytes[p]!
  p++
  const layout = TE_LAYOUT[type]
  if (layout === undefined) return OVERRUN
  const steamStart = p
  for (let i = 0; i < layout.length && p !== OVERRUN; i++) {
    const field = layout.charCodeAt(i)
    if (field === 0x70 /* p */) p = skipPos(bytes, p, end, extCoords)
    else if (field === 0x73 /* s */) p = skipFixed(p, 2, end)
    else p = skipFixed(p, 1, end) // d, b
  }
  if (p !== OVERRUN && type === TE_STEAM) {
    const entityIsMinusOne = bytes[steamStart] === 0xff && bytes[steamStart + 1] === 0xff
    if (!entityIsMinusOne) p = skipFixed(p, 4, end)
  }
  return p
}

function skipSound(bytes: Uint8Array, p: number, end: number, protocol: number): number {
  if (p >= end) return OVERRUN
  const flags = bytes[p]!
  p++
  p = skipFixed(p, protocol >= 3434 && (flags & SND_INDEX16) !== 0 ? 2 : 1, end)
  if (p !== OVERRUN && (flags & SND_VOLUME) !== 0) p = skipFixed(p, 1, end)
  if (p !== OVERRUN && (flags & SND_ATTENUATION) !== 0) p = skipFixed(p, 1, end)
  if (p !== OVERRUN && (flags & SND_OFFSET) !== 0) p = skipFixed(p, 1, end)
  if (p !== OVERRUN && (flags & SND_ENT) !== 0) p = skipFixed(p, 2, end)
  if (p !== OVERRUN && (flags & SND_POS) !== 0) p = skipPos(bytes, p, end, protocol >= 3435)
  return p
}

function skipDownload(bytes: Uint8Array, p: number, end: number): number {
  if (p + 3 > end) return OVERRUN
  const raw = bytes[p]! | (bytes[p + 1]! << 8)
  const size = raw > 0x7fff ? raw - 0x10000 : raw
  p += 3 // int16 size + byte percent
  if (size < -1) return OVERRUN // q2pro rejects this (MSG_ReadData with a negative length)
  return size > 0 ? skipFixed(p, size, end) : p
}

function readInt32LE(bytes: Uint8Array, p: number): number {
  return bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16) | (bytes[p + 3]! << 24) | 0
}

type BlockOutcome = 'frame' | 'frameless' | 'undecodable' | 'not-a-demo'

/**
 * Creates a streaming `.dm2` frame counter. See the file doc comment for the counting method and
 * the per-protocol message sizes.
 */
export function createDm2FrameCounter(observer?: Dm2FrameObserver): FrameCounter {
  const buffer = new BlockBuffer()
  let consumedBytes = 0 // file offset of `buffer.readOffset`
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
    if (protocol === null && (p >= end || bytes[p] !== SVC_SERVERDATA)) return 'not-a-demo'
    while (p < end) {
      const opcode = bytes[p]!
      p++
      switch (opcode) {
        case SVC_FRAME:
          return 'frame'
        case SVC_SERVERDATA: {
          const first = protocol === null
          if (p + 4 > end) return first ? 'not-a-demo' : 'undecodable'
          const read = readInt32LE(bytes, p)
          if (!ACCEPTED_PROTOCOLS.has(read)) return first ? 'not-a-demo' : 'undecodable'
          protocol = read
          observer?.onServerdata(read)
          return 'frameless'
        }
        case SVC_SPAWNBASELINE:
          return 'frameless'
        case SVC_CONFIGSTRING: {
          const indexAt = p
          p = skipFixed(p, 2, end)
          if (p !== OVERRUN) {
            const valueAt = p
            p = skipString(bytes, p, end)
            if (observer !== undefined && p !== OVERRUN) {
              const index = bytes[indexAt]! | (bytes[indexAt + 1]! << 8)
              observer.onConfigstring(index, decodeLatin1(bytes.subarray(valueAt, p - 1)))
            }
          }
          break
        }
        case SVC_PRINT:
          p = skipFixed(p, 1, end)
          if (p !== OVERRUN) p = skipString(bytes, p, end)
          break
        case SVC_STUFFTEXT:
        case SVC_CENTERPRINT:
          p = skipString(bytes, p, end)
          break
        case SVC_LAYOUT: {
          const textAt = p
          p = skipString(bytes, p, end)
          if (observer !== undefined && p !== OVERRUN)
            observer.onLayout(decodeLatin1(bytes.subarray(textAt, p - 1)))
          break
        }
        case SVC_INVENTORY:
          p = skipFixed(p, MAX_ITEMS * 2, end)
          break
        case SVC_NOP:
        case SVC_DISCONNECT:
        case SVC_RECONNECT:
          break
        case SVC_MUZZLEFLASH:
        case SVC_MUZZLEFLASH2:
          p = skipFixed(p, 3, end)
          break
        case SVC_SOUND:
          p = skipSound(bytes, p, end, protocol!)
          break
        case SVC_DOWNLOAD:
          p = skipDownload(bytes, p, end)
          break
        case SVC_TEMP_ENTITY:
          p = skipTempEntity(bytes, p, end, protocol! >= 3435)
          break
        default:
          return 'undecodable'
      }
      if (p === OVERRUN) return 'undecodable'
    }
    return 'frameless'
  }

  function drain(): void {
    while (failure === null && !ended && buffer.available >= 4) {
      const bytes = buffer.bytes
      const at = buffer.readOffset
      const length = readInt32LE(bytes, at)
      if (length === -1) {
        ended = true
        consumedBytes += 4
        buffer.clear()
        return
      }
      if (length < 0 || length > DEMO_MAX_BLOCK_BYTES) {
        fail('not-a-demo', consumedBytes)
        return
      }
      if (buffer.available < 4 + length) return // wait for the rest of the block
      const outcome = decodeBlock(bytes, at + 4, at + 4 + length)
      if (outcome === 'not-a-demo' || outcome === 'undecodable') {
        fail(outcome, consumedBytes)
        return
      }
      if (outcome === 'frame') frames++
      buffer.consume(4 + length)
      consumedBytes += 4 + length
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
      // Not ended = the terminator never arrived (a cut last block or a missing `-1`).
      return framesResult(frames, ended)
    },
    get failed(): boolean {
      return failure !== null
    },
  }
}
