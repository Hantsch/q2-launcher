/**
 * Builds synthetic `.dm2` byte streams for `dm2-frames.test.ts`: a serverdata block, optional
 * header configstrings, then any list of blocks, each assembled from message builders (`dm2Msg`).
 * The companion of `dm2-writer.ts` (which shapes header bytes only): hand-assembled bytes a test
 * can shape precisely, never anything captured off a real client/server.
 *
 * Messages are encoded for the stream's protocol exactly as q2pro reads them (see
 * `dm2-frames.ts`'s doc comment): 16-bit sound indices on 3434+, extended 2-or-3-byte coordinates
 * on 3435+. The temp-entity field list here is spelled out per type name, independently of the
 * counter's shape-grouped table, so a slip in one does not silently mirror into the other.
 *
 * Output is written into a growable `Uint8Array`, so tens of MiB build quickly.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { encodeLatin1 } from '../servers/protocol'

/** Temp-entity type numbers (`temp_event_t`). */
export const TE = {
  GUNSHOT: 0, BLOOD: 1, BLASTER: 2, RAILTRAIL: 3, SHOTGUN: 4, EXPLOSION1: 5, EXPLOSION2: 6,
  ROCKET_EXPLOSION: 7, GRENADE_EXPLOSION: 8, SPARKS: 9, SPLASH: 10, BUBBLETRAIL: 11,
  SCREEN_SPARKS: 12, SHIELD_SPARKS: 13, BULLET_SPARKS: 14, LASER_SPARKS: 15, PARASITE_ATTACK: 16,
  ROCKET_EXPLOSION_WATER: 17, GRENADE_EXPLOSION_WATER: 18, MEDIC_CABLE_ATTACK: 19,
  BFG_EXPLOSION: 20, BFG_BIGEXPLOSION: 21, BOSSTPORT: 22, BFG_LASER: 23, GRAPPLE_CABLE: 24,
  WELDING_SPARKS: 25, GREENBLOOD: 26, BLUEHYPERBLASTER: 27, PLASMA_EXPLOSION: 28,
  TUNNEL_SPARKS: 29, BLASTER2: 30, RAILTRAIL2: 31, FLAME: 32, LIGHTNING: 33, DEBUGTRAIL: 34,
  PLAIN_EXPLOSION: 35, FLASHLIGHT: 36, FORCEWALL: 37, HEATBEAM: 38, MONSTER_HEATBEAM: 39,
  STEAM: 40, BUBBLETRAIL2: 41, MOREBLOOD: 42, HEATBEAM_SPARKS: 43, HEATBEAM_STEAM: 44,
  CHAINFIST_SMOKE: 45, ELECTRIC_SPARKS: 46, TRACKER_EXPLOSION: 47, TELEPORT_EFFECT: 48,
  DBALL_GOAL: 49, WIDOWBEAMOUT: 50, NUKEBLAST: 51, WIDOWSPLASH: 52, EXPLOSION1_BIG: 53,
  EXPLOSION1_NP: 54, FLECHETTE: 55, BLUEHYPERBLASTER_2: 56, BFG_ZAP: 57, BERSERK_SLAM: 58,
  GRAPPLE_CABLE_2: 59, POWER_SPLASH: 60, LIGHTNING_BEAM: 61, EXPLOSION1_NL: 62,
  EXPLOSION2_NL: 63, DAMAGE_DEALT: 128,
} as const

export type TeName = keyof typeof TE

/**
 * Wire fields per temp-entity type, in read order: `pos` (3 coordinates), `dir` (byte), `byte`,
 * `short`. `TE_STEAM`'s trailing `int32` (present when its first short is not -1) is appended by
 * the encoder. `FLAME` has no reader in any client and is deliberately absent.
 */
export const TE_FIELDS: Partial<Record<TeName, readonly ('pos' | 'dir' | 'byte' | 'short')[]>> = {
  BLOOD: ['pos', 'dir'], GUNSHOT: ['pos', 'dir'], SPARKS: ['pos', 'dir'],
  BULLET_SPARKS: ['pos', 'dir'], SCREEN_SPARKS: ['pos', 'dir'], SHIELD_SPARKS: ['pos', 'dir'],
  SHOTGUN: ['pos', 'dir'], BLASTER: ['pos', 'dir'], GREENBLOOD: ['pos', 'dir'],
  BLASTER2: ['pos', 'dir'], FLECHETTE: ['pos', 'dir'], HEATBEAM_SPARKS: ['pos', 'dir'],
  HEATBEAM_STEAM: ['pos', 'dir'], MOREBLOOD: ['pos', 'dir'], ELECTRIC_SPARKS: ['pos', 'dir'],
  BLUEHYPERBLASTER_2: ['pos', 'dir'], BERSERK_SLAM: ['pos', 'dir'],
  SPLASH: ['byte', 'pos', 'dir', 'byte'], LASER_SPARKS: ['byte', 'pos', 'dir', 'byte'],
  WELDING_SPARKS: ['byte', 'pos', 'dir', 'byte'], TUNNEL_SPARKS: ['byte', 'pos', 'dir', 'byte'],
  BLUEHYPERBLASTER: ['pos', 'pos'], RAILTRAIL: ['pos', 'pos'], RAILTRAIL2: ['pos', 'pos'],
  BUBBLETRAIL: ['pos', 'pos'], DEBUGTRAIL: ['pos', 'pos'], BUBBLETRAIL2: ['pos', 'pos'],
  BFG_LASER: ['pos', 'pos'], BFG_ZAP: ['pos', 'pos'],
  GRENADE_EXPLOSION: ['pos'], GRENADE_EXPLOSION_WATER: ['pos'], EXPLOSION2: ['pos'],
  PLASMA_EXPLOSION: ['pos'], ROCKET_EXPLOSION: ['pos'], ROCKET_EXPLOSION_WATER: ['pos'],
  EXPLOSION1: ['pos'], EXPLOSION1_NP: ['pos'], EXPLOSION1_BIG: ['pos'], BFG_EXPLOSION: ['pos'],
  BFG_BIGEXPLOSION: ['pos'], BOSSTPORT: ['pos'], PLAIN_EXPLOSION: ['pos'],
  CHAINFIST_SMOKE: ['pos'], TRACKER_EXPLOSION: ['pos'], TELEPORT_EFFECT: ['pos'],
  DBALL_GOAL: ['pos'], WIDOWSPLASH: ['pos'], NUKEBLAST: ['pos'], EXPLOSION1_NL: ['pos'],
  EXPLOSION2_NL: ['pos'],
  PARASITE_ATTACK: ['short', 'pos', 'pos'], MEDIC_CABLE_ATTACK: ['short', 'pos', 'pos'],
  HEATBEAM: ['short', 'pos', 'pos'], MONSTER_HEATBEAM: ['short', 'pos', 'pos'],
  GRAPPLE_CABLE_2: ['short', 'pos', 'pos'], LIGHTNING_BEAM: ['short', 'pos', 'pos'],
  GRAPPLE_CABLE: ['short', 'pos', 'pos', 'pos'],
  LIGHTNING: ['short', 'short', 'pos', 'pos'],
  FLASHLIGHT: ['pos', 'short'],
  FORCEWALL: ['pos', 'pos', 'byte'],
  STEAM: ['short', 'byte', 'pos', 'dir', 'byte', 'short'],
  WIDOWBEAMOUT: ['short', 'pos'],
  POWER_SPLASH: ['short', 'byte'],
  DAMAGE_DEALT: ['short'],
}

export type Dm2StreamMessage =
  | { kind: 'frame'; serverframe: number; bodyBytes: number }
  | { kind: 'print'; level: number; text: string }
  | { kind: 'configstring'; index: number; value: string }
  | {
      kind: 'sound'
      index: number
      index16: boolean
      volume?: number
      attenuation?: number
      offset?: number
      entity?: number
      pos?: readonly [number, number, number]
    }
  | { kind: 'tempEntity'; type: number; coord: number; steamEntity: number }
  | { kind: 'baseline' }
  | { kind: 'serverdata'; protocol: number }
  | { kind: 'raw'; opcode: number; bytes: readonly number[] }

/** Message builders for `buildDm2Stream`'s blocks. */
export const dm2Msg = {
  /** `svc_frame` plus `bodyBytes` opaque bytes standing in for playerinfo/packetentities. */
  frame: (serverframe: number, bodyBytes = 24): Dm2StreamMessage => ({ kind: 'frame', serverframe, bodyBytes }),
  print: (text: string, level = 2): Dm2StreamMessage => ({ kind: 'print', level, text }),
  configstring: (index: number, value: string): Dm2StreamMessage => ({ kind: 'configstring', index, value }),
  sound: (opts: Omit<Extract<Dm2StreamMessage, { kind: 'sound' }>, 'kind' | 'index16'> & { index16?: boolean }): Dm2StreamMessage => ({
    kind: 'sound',
    index16: false,
    ...opts,
  }),
  /** A temp entity with every position set to `coord` (a raw coordinate short: 1/8 unit) and, for
   * `TE_STEAM`, its leading entity set to `steamEntity` (-1 = no trailing int32). */
  tempEntity: (type: number, opts: { coord?: number; steamEntity?: number } = {}): Dm2StreamMessage => ({
    kind: 'tempEntity',
    type,
    coord: opts.coord ?? 0,
    steamEntity: opts.steamEntity ?? -1,
  }),
  baseline: (): Dm2StreamMessage => ({ kind: 'baseline' }),
  serverdata: (protocol: number): Dm2StreamMessage => ({ kind: 'serverdata', protocol }),
  raw: (opcode: number, bytes: readonly number[] = []): Dm2StreamMessage => ({ kind: 'raw', opcode, bytes }),
}

export interface BuildDm2StreamOptions {
  protocol: number
  /** Configstrings sent in one block right after the serverdata block. */
  headerConfigstrings?: Record<number, string>
  blocks: readonly (readonly Dm2StreamMessage[])[]
  /** Appends the `-1` terminator. */
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

  patchLong(at: number, v: number): void {
    this.buf[at] = v & 0xff
    this.buf[at + 1] = (v >>> 8) & 0xff
    this.buf[at + 2] = (v >>> 16) & 0xff
    this.buf[at + 3] = (v >>> 24) & 0xff
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

function writeCoord(w: ByteWriter, c: number, extCoords: boolean): void {
  if (!extCoords) return w.short(c)
  if (c >= -16384 && c < 16384) return w.short((c << 1) & 0xffff) // low bit 0: 2 bytes
  const v = ((c << 1) | 1) & 0xffffff // low bit 1: a third byte carries bits 16..23
  w.short(v & 0xffff)
  w.byte(v >>> 16)
}

function writePos(w: ByteWriter, c: number, extCoords: boolean): void {
  for (let i = 0; i < 3; i++) writeCoord(w, c, extCoords)
}

function writeServerdata(w: ByteWriter, protocol: number): void {
  w.byte(12)
  w.long(protocol)
  w.long(1) // servercount
  w.byte(1) // attractloop
  w.string('baseq2')
  w.short(0) // playernum
  w.string('The Edge')
}

function writeMessage(w: ByteWriter, m: Dm2StreamMessage, protocol: number): void {
  const extCoords = protocol >= 3435
  switch (m.kind) {
    case 'frame':
      w.byte(20)
      w.long(m.serverframe)
      w.long(m.serverframe - 1) // deltaframe
      for (let i = 0; i < m.bodyBytes; i++) w.byte(i * 7 + 3) // opaque body, never decoded
      return
    case 'print':
      w.byte(10)
      w.byte(m.level)
      w.string(m.text)
      return
    case 'configstring':
      w.byte(13)
      w.short(m.index)
      w.string(m.value)
      return
    case 'sound': {
      let flags = 0
      if (m.volume !== undefined) flags |= 1
      if (m.attenuation !== undefined) flags |= 2
      if (m.pos !== undefined) flags |= 4
      if (m.entity !== undefined) flags |= 8
      if (m.offset !== undefined) flags |= 16
      if (m.index16) flags |= 32
      w.byte(9)
      w.byte(flags)
      if (m.index16 && protocol >= 3434) w.short(m.index)
      else w.byte(m.index)
      if (m.volume !== undefined) w.byte(m.volume)
      if (m.attenuation !== undefined) w.byte(m.attenuation)
      if (m.offset !== undefined) w.byte(m.offset)
      if (m.entity !== undefined) w.short((m.entity << 3) | 1)
      if (m.pos !== undefined) for (const c of m.pos) writeCoord(w, c, extCoords)
      return
    }
    case 'tempEntity': {
      const name = (Object.keys(TE) as TeName[]).find((n) => TE[n] === m.type)
      const fields = name === undefined ? undefined : TE_FIELDS[name]
      w.byte(3)
      w.byte(m.type)
      if (fields === undefined) return // unknown/unreadable type: the type byte alone
      let firstShort = true
      for (const f of fields) {
        if (f === 'pos') writePos(w, m.coord, extCoords)
        else if (f === 'short') {
          w.short(name === 'STEAM' && firstShort ? m.steamEntity : 1)
          firstShort = false
        } else w.byte(f === 'dir' ? 5 : 7)
      }
      if (name === 'STEAM' && m.steamEntity !== -1) w.long(1500) // wait time
      return
    }
    case 'baseline':
      w.bytes([14, 0x81, 0x00, 0x01, 0x02, 0x03]) // entity bits + opaque delta, never decoded
      return
    case 'serverdata':
      writeServerdata(w, m.protocol)
      return
    case 'raw':
      w.byte(m.opcode)
      w.bytes(m.bytes)
      return
  }
}

function writeBlock(w: ByteWriter, body: (w: ByteWriter) => void): void {
  const lengthAt = w.length
  w.long(0)
  body(w)
  w.patchLong(lengthAt, w.length - lengthAt - 4)
}

/**
 * Assembles a synthetic `.dm2` stream: one `svc_serverdata` block for `protocol`, one block with
 * `headerConfigstrings` (if any), then `blocks` in order (an empty list = a zero-length block),
 * then the optional `-1` terminator and `trailing` bytes.
 */
export function buildDm2Stream(opts: BuildDm2StreamOptions): Uint8Array {
  const w = new ByteWriter()
  writeBlock(w, (b) => writeServerdata(b, opts.protocol))
  const cs = opts.headerConfigstrings
  if (cs !== undefined && Object.keys(cs).length > 0) {
    writeBlock(w, (b) => {
      for (const key of Object.keys(cs).map(Number).sort((x, y) => x - y)) {
        writeMessage(b, dm2Msg.configstring(key, cs[key]!), opts.protocol)
      }
    })
  }
  let protocol = opts.protocol // a mid-demo serverdata switches the encoding of what follows
  for (const block of opts.blocks) {
    writeBlock(w, (b) => {
      for (const m of block) {
        writeMessage(b, m, protocol)
        if (m.kind === 'serverdata') protocol = m.protocol
      }
    })
  }
  if (opts.terminate) w.long(-1)
  if (opts.trailing !== undefined) w.bytes(opts.trailing)
  return w.result()
}
