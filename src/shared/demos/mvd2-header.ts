/**
 * Parses the header of an `.mvd2` (multi-view demo) file — enough of it to answer "what map,
 * which players" without reading the whole recording.
 *
 * An `.mvd2` file starts with the 4-byte ASCII magic `"MVD2"`, followed by a sequence of
 * `[uint16 LE length][payload]` blocks, terminated by a block whose length word is `0` (no payload
 * follows the terminator). This parser only ever looks at block 1 — the `mvd_serverdata` message
 * plus the run of inline configstrings that follows it inside that same block. Everything after
 * block 1 (however large the recording is) is never read.
 *
 * Block 1's payload, all little-endian:
 * 1. `cmd` byte — its low 5 bits must equal `4` (`mvd_serverdata`); before protocol version 2012
 *    its top 3 bits carry the flags word (see below).
 * 2. `int32 protocol` — must be `37` (the MVD wire protocol).
 * 3. `uint16 version` — one of `2009..2013`; selects which configstring index layout applies (see
 *    `Dm2Layout` in `dm2-header.ts`, reused here rather than redefined).
 * 4. `uint16 flags`, but only from version 2012 on — before that, flags come from `cmd`'s top 3
 *    bits instead.
 * 5. `int32 servercount` — read and discarded.
 * 6. NUL-terminated `gamedir` string.
 * 7. `int16 clientNum` — the MVD dummy spectator's own client slot, excluded from `players`.
 * 8. A run of inline configstrings: `uint16 index` then, unless `index` is the layout's
 *    `MAX_CONFIGSTRINGS` end marker, a NUL-terminated string value; repeats until the end marker
 *    (or the block runs out).
 *
 * Layout selection: `extended` iff `version >= 2011 && (flags & 4) !== 0`, else `original` — reuses
 * `ORIGINAL_LAYOUT`/`EXTENDED_LAYOUT` from `dm2-header.ts`, the same two configstring tables the
 * `.dm2` parser uses.
 *
 * Strings are NUL-terminated and decoded with `decodeLatin1` (`../servers/protocol.ts`)
 * byte-for-byte: Quake II is not UTF-8 and high-bit bytes (its built-in colour charset) must
 * survive exactly.
 *
 * Never throws: any malformed/foreign/truncated input resolves to a typed `Mvd2Unparsable` reason
 * rather than an exception, and every loop below advances the cursor or returns on every
 * iteration — no path can spin forever on hostile input.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { decodeLatin1 } from '../servers/protocol'
import { EXTENDED_LAYOUT, ORIGINAL_LAYOUT } from './dm2-header'
import type { Dm2Layout, Dm2Unparsable } from './dm2-header'

/** A demo header this large without resolving is treated as foreign/corrupt data. Block 1's
 * length is a `uint16`, so the largest possible header is the magic (4) + length word (2) + the
 * largest block payload (65,535) = 65,541 bytes — there is no "still truncated, keep growing" case
 * the way `.dm2` has, since a block's own length word bounds it. */
export const MVD2_HEADER_MAX_BYTES = 65_541

const MVD_SERVERDATA = 4

type Mvd2Version = 2009 | 2010 | 2011 | 2012 | 2013

/** A successfully parsed `.mvd2` header. */
export type Mvd2Header = {
  ok: true
  format: 'mvd2'
  protocol: 37
  mvdVersion: Mvd2Version
  layout: 'original' | 'extended'
  gameDir: string
  levelName: string
  map: string | null
  pov: null
  players: string[]
  largestBlockBytes: number
  bytesConsumed: number
}

/** Why the header could not be resolved into an `Mvd2Header`. `protocol`/`version` are set only
 * for the reasons that read those fields. */
export type Mvd2Unparsable = {
  ok: false
  reason: Dm2Unparsable['reason'] | 'unknown-version'
  protocol?: number
  version?: number
}

export type Mvd2HeaderResult = Mvd2Header | Mvd2Unparsable

/** A byte cursor bounded to `[offset, limit)` — here always block 1's payload. */
interface Cursor {
  bytes: Uint8Array
  offset: number
}

function readInt32LE(cursor: Cursor, limit: number): number | null {
  if (cursor.offset + 4 > limit) return null
  const b = cursor.bytes
  const o = cursor.offset
  const value = b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24) | 0
  cursor.offset += 4
  return value
}

function readUint16LE(cursor: Cursor, limit: number): number | null {
  if (cursor.offset + 2 > limit) return null
  const b = cursor.bytes
  const o = cursor.offset
  const value = b[o]! | (b[o + 1]! << 8)
  cursor.offset += 2
  return value
}

function readByte(cursor: Cursor, limit: number): number | null {
  if (cursor.offset + 1 > limit) return null
  const value = cursor.bytes[cursor.offset]!
  cursor.offset += 1
  return value
}

/** Reads a NUL-terminated string within `[cursor.offset, limit)`. Returns `null` (without
 * advancing) if the NUL is never found before `limit`. */
function readCString(cursor: Cursor, limit: number): string | null {
  const b = cursor.bytes
  let end = cursor.offset
  while (end < limit && b[end] !== 0) end++
  if (end >= limit) return null // ran out of bytes before the terminating NUL
  const value = decodeLatin1(b.subarray(cursor.offset, end))
  cursor.offset = end + 1
  return value
}

const MVD_VERSIONS: ReadonlySet<number> = new Set([2009, 2010, 2011, 2012, 2013])

/**
 * Parses an `.mvd2` file's header: the magic, block 1's length-prefixed payload, the leading
 * `mvd_serverdata` message and the inline configstrings that follow it. See the file doc comment
 * for the exact format and stopping rule.
 */
export function parseMvd2Header(bytes: Uint8Array): Mvd2HeaderResult {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }

  if (
    bytes.length < 4 ||
    bytes[0] !== 0x4d ||
    bytes[1] !== 0x56 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x32
  ) {
    return { ok: false, reason: 'not-a-demo' }
  }

  if (bytes.length < 6) return { ok: false, reason: 'truncated' }

  const len = bytes[4]! | (bytes[5]! << 8)
  const blockStart = 6
  const blockEnd = blockStart + len
  if (blockEnd > bytes.length) return { ok: false, reason: 'truncated' }
  if (len === 0) return { ok: false, reason: 'not-a-demo' }

  const cursor: Cursor = { bytes, offset: blockStart }

  const cmd = readByte(cursor, blockEnd)
  if (cmd === null) return { ok: false, reason: 'not-a-demo' }
  if ((cmd & 31) !== MVD_SERVERDATA) return { ok: false, reason: 'not-a-demo' }

  const protocol = readInt32LE(cursor, blockEnd)
  if (protocol === null) return { ok: false, reason: 'not-a-demo' }
  if (protocol !== 37) return { ok: false, reason: 'unknown-protocol', protocol }

  const versionRead = readUint16LE(cursor, blockEnd)
  if (versionRead === null) return { ok: false, reason: 'not-a-demo' }
  if (!MVD_VERSIONS.has(versionRead))
    return { ok: false, reason: 'unknown-version', version: versionRead }
  const version = versionRead as Mvd2Version

  let flags: number
  if (version >= 2012) {
    const flagsRead = readUint16LE(cursor, blockEnd)
    if (flagsRead === null) return { ok: false, reason: 'not-a-demo' }
    flags = flagsRead
  } else {
    flags = cmd >> 5
  }

  const servercount = readInt32LE(cursor, blockEnd)
  if (servercount === null) return { ok: false, reason: 'not-a-demo' }

  const gameDirRead = readCString(cursor, blockEnd)
  if (gameDirRead === null) return { ok: false, reason: 'not-a-demo' }
  const gameDir = gameDirRead === '' ? 'baseq2' : gameDirRead

  const clientNumRead = readUint16LE(cursor, blockEnd)
  if (clientNumRead === null) return { ok: false, reason: 'not-a-demo' }
  const clientNum = clientNumRead > 0x7fff ? clientNumRead - 0x10000 : clientNumRead

  const layout: Dm2Layout = version >= 2011 && (flags & 4) !== 0 ? EXTENDED_LAYOUT : ORIGINAL_LAYOUT

  const configstrings = new Map<number, string>()
  for (;;) {
    const index = readUint16LE(cursor, blockEnd)
    if (index === null) return { ok: false, reason: 'not-a-demo' }
    if (index === layout.MAX_CONFIGSTRINGS) break
    if (index > layout.MAX_CONFIGSTRINGS) return { ok: false, reason: 'not-a-demo' }

    const value = readCString(cursor, blockEnd)
    if (value === null) return { ok: false, reason: 'not-a-demo' }
    configstrings.set(index, value)
  }

  const levelName = configstrings.get(layout.CS_NAME) ?? ''

  const modelsCs = configstrings.get(layout.CS_MODELS + 1)
  const map = modelsCs !== undefined ? stripMapPath(modelsCs) : null

  const players: string[] = []
  for (let i = 0; i < layout.MAX_CLIENTS; i++) {
    if (clientNum >= 0 && clientNum < 256 && i === clientNum) continue
    const slot = configstrings.get(layout.CS_PLAYERSKINS + i)
    if (slot !== undefined && slot !== '') players.push(upToBackslash(slot))
  }

  return {
    ok: true,
    format: 'mvd2',
    protocol: 37,
    mvdVersion: version,
    layout: layout.layout,
    gameDir,
    levelName,
    map,
    pov: null,
    players,
    largestBlockBytes: len,
    bytesConsumed: blockEnd,
  }
}

function upToBackslash(value: string): string {
  const i = value.indexOf('\\')
  return i === -1 ? value : value.slice(0, i)
}

function stripMapPath(value: string): string {
  let result = value
  if (/^maps\//i.test(result)) result = result.slice('maps/'.length)
  if (/\.bsp$/i.test(result)) result = result.slice(0, -'.bsp'.length)
  return result
}
