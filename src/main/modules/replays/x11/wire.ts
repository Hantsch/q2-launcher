/**
 * X11 core-protocol wire codec for the handful of requests the X11 stage needs (story 198). Pure:
 * `Buffer` in, `Buffer` out, no socket. Every request and reply is little-endian, matching the
 * 'l' byte-order byte `encodeSetupRequest` sends. Layouts follow the X Window System Protocol,
 * Appendix B ("Protocol Encoding"), and the X-Resource extension 1.2 spec for `QueryClientIds`.
 *
 * Decoders never throw on bad input: a buffer that ends before the packet does is `truncated`
 * (read more bytes and retry), one whose bytes contradict their own length fields is `garbled`.
 */

export type WireError = 'truncated' | 'garbled'
export type WireResult<T> = { ok: true; value: T } | { ok: false; error: WireError }

const TRUNCATED: WireResult<never> = { ok: false, error: 'truncated' }
const GARBLED: WireResult<never> = { ok: false, error: 'garbled' }
const done = <T>(value: T): WireResult<T> => ({ ok: true, value })

const X11_MAJOR_VERSION = 11
const OPCODE_CONFIGURE_WINDOW = 12
const OPCODE_INTERN_ATOM = 16
const OPCODE_CHANGE_PROPERTY = 18
const OPCODE_GET_PROPERTY = 20
const OPCODE_SEND_EVENT = 25
const OPCODE_QUERY_EXTENSION = 98
const XRES_MINOR_QUERY_CLIENT_IDS = 4
/** XRes `XResClientIdSpec.mask` bit asking for the PID of the client that owns the XID. */
const XRES_LOCAL_CLIENT_PID = 2
const EVENT_CLIENT_MESSAGE = 33
const EVENT_GENERIC = 35
const PROP_MODE_REPLACE = 0
/** ConfigureWindow value-mask bits x|y|width|height; their values follow in this bit order. */
const CONFIGURE_XYWH = 0x0001 | 0x0002 | 0x0004 | 0x0008

/**
 * Replies the stage reads are a few dozen bytes. A length field claiming more than this is a stream
 * that has lost its framing, not a packet worth waiting for.
 */
const MAX_PACKET_BYTES = 16 * 1024 * 1024

const pad4 = (n: number): number => (4 - (n % 4)) % 4

/**
 * One request: opcode, a data byte, the length in 4-byte units (header included), the body, zero
 * padding up to the next multiple of 4. Without BIG-REQUESTS the length is a CARD16.
 */
function request(opcode: number, data: number, body: Buffer): Buffer {
  const size = 4 + body.length + pad4(body.length)
  if (size / 4 > 0xffff) throw new RangeError(`X11 request too long: ${size} bytes`)
  const out = Buffer.alloc(size)
  out[0] = opcode
  out[1] = data
  out.writeUInt16LE(size / 4, 2)
  body.copy(out, 4)
  return out
}

/** CARD16 n, 2 unused, then the STRING8 itself (request() pads it). */
function counted(name: string): Buffer {
  const bytes = Buffer.from(name, 'latin1')
  const body = Buffer.alloc(4 + bytes.length)
  body.writeUInt16LE(bytes.length, 0)
  bytes.copy(body, 4)
  return body
}

function card32s(values: readonly number[]): Buffer {
  const out = Buffer.alloc(4 * values.length)
  values.forEach((v, i) => out.writeUInt32LE(v >>> 0, 4 * i))
  return out
}

// ---- connection setup --------------------------------------------------------------------------

/** The client's connection-setup block: byte order 'l', protocol 11.0, then the padded auth name/data. */
export function encodeSetupRequest(authName: string, authData: Buffer): Buffer {
  const name = Buffer.from(authName, 'latin1')
  const out = Buffer.alloc(
    12 + name.length + pad4(name.length) + authData.length + pad4(authData.length),
  )
  out[0] = 0x6c
  out.writeUInt16LE(X11_MAJOR_VERSION, 2)
  out.writeUInt16LE(0, 4)
  out.writeUInt16LE(name.length, 6)
  out.writeUInt16LE(authData.length, 8)
  name.copy(out, 12)
  authData.copy(out, 12 + name.length + pad4(name.length))
  return out
}

export type SetupReply =
  | {
      status: 'success'
      resourceIdBase: number
      resourceIdMask: number
      roots: Array<{ root: number }>
      /** Bytes the setup reply occupies; anything after it is the first reply/event. */
      byteLength: number
    }
  | { status: 'failed' | 'authenticate'; reason: string; byteLength: number }

/**
 * The server's setup reply. Every status shares an 8-byte header whose CARD16 at offset 6 is the
 * remaining length in 4-byte units. Success walks past the vendor string (padded to 4), the 8-byte
 * pixmap FORMATs and each SCREEN's DEPTH/VISUALTYPE lists to reach every screen's root window.
 */
export function decodeSetupReply(buf: Buffer): WireResult<SetupReply> {
  if (buf.length < 8) return TRUNCATED
  const status = buf[0]
  if (status > 2) return GARBLED
  const byteLength = 8 + 4 * buf.readUInt16LE(6)
  if (buf.length < byteLength) return TRUNCATED

  if (status === 0) {
    const reasonLength = buf[1]
    if (8 + reasonLength > byteLength) return GARBLED
    return done({
      status: 'failed',
      reason: buf.toString('latin1', 8, 8 + reasonLength),
      byteLength,
    })
  }
  if (status === 2) {
    // Authenticate carries no reason length: the reason is the additional data minus its NUL padding.
    const reason = buf.toString('latin1', 8, byteLength).replace(/\0+$/, '')
    return done({ status: 'authenticate', reason, byteLength })
  }

  if (byteLength < 40) return GARBLED
  const vendorLength = buf.readUInt16LE(24)
  const screenCount = buf[28]
  const formatCount = buf[29]
  let at = 40 + vendorLength + pad4(vendorLength) + 8 * formatCount
  const roots: Array<{ root: number }> = []
  for (let s = 0; s < screenCount; s++) {
    if (at + 40 > byteLength) return GARBLED
    roots.push({ root: buf.readUInt32LE(at) })
    const depthCount = buf[at + 39]
    at += 40
    for (let d = 0; d < depthCount; d++) {
      if (at + 8 > byteLength) return GARBLED
      at += 8 + 24 * buf.readUInt16LE(at + 2)
    }
  }
  if (at > byteLength) return GARBLED
  return done({
    status: 'success',
    resourceIdBase: buf.readUInt32LE(12),
    resourceIdMask: buf.readUInt32LE(16),
    roots,
    byteLength,
  })
}

// ---- requests ----------------------------------------------------------------------------------

/** InternAtom with only-if-exists = false, so the reply always carries an atom. */
export function encodeInternAtom(name: string): Buffer {
  return request(OPCODE_INTERN_ATOM, 0, counted(name))
}

export interface GetPropertyRequest {
  window: number
  property: number
  /** 0 = AnyPropertyType. */
  type: number
  /** Offset into the value, in 32-bit units. */
  longOffset?: number
  /** Maximum value length to return, in 32-bit units. */
  longLength: number
}

/** GetProperty with delete = false. */
export function encodeGetProperty(req: GetPropertyRequest): Buffer {
  return request(
    OPCODE_GET_PROPERTY,
    0,
    card32s([req.window, req.property, req.type, req.longOffset ?? 0, req.longLength]),
  )
}

export interface ChangePropertyRequest {
  window: number
  property: number
  type: number
  /** Format-32 items (CARD32/ATOM/WINDOW). */
  values: readonly number[]
}

/** ChangeProperty, mode Replace, format 32; the item count is in format units, not bytes. */
export function encodeChangeProperty(req: ChangePropertyRequest): Buffer {
  const head = Buffer.alloc(20)
  head.writeUInt32LE(req.window, 0)
  head.writeUInt32LE(req.property, 4)
  head.writeUInt32LE(req.type, 8)
  head[12] = 32
  head.writeUInt32LE(req.values.length, 16)
  return request(
    OPCODE_CHANGE_PROPERTY,
    PROP_MODE_REPLACE,
    Buffer.concat([head, card32s(req.values)]),
  )
}

export interface ClientMessageRequest {
  /** Window the event is sent to (for EWMH requests: the root). */
  destination: number
  eventMask: number
  propagate?: boolean
  /** The window the message is about. */
  window: number
  messageType: number
  /** Up to five format-32 data items; missing ones are sent as 0. */
  data: readonly number[]
}

/** SendEvent carrying a 32-byte format-32 ClientMessage event. */
export function encodeSendClientMessage(req: ClientMessageRequest): Buffer {
  if (req.data.length > 5) throw new RangeError('A ClientMessage carries at most five 32-bit items')
  const body = Buffer.alloc(40)
  body.writeUInt32LE(req.destination, 0)
  body.writeUInt32LE(req.eventMask >>> 0, 4)
  body[8] = EVENT_CLIENT_MESSAGE
  body[9] = 32
  // Event bytes 2-3 (sequence number) stay 0: the server overwrites them for a sent event.
  body.writeUInt32LE(req.window, 12)
  body.writeUInt32LE(req.messageType, 16)
  card32s(req.data).copy(body, 20)
  return request(OPCODE_SEND_EVENT, req.propagate ? 1 : 0, body)
}

export interface ConfigureWindowRequest {
  window: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * ConfigureWindow setting x, y, width and height. Each VALUE occupies 32 bits; x/y are INT16 and
 * go out sign-extended, as Xlib writes them.
 */
export function encodeConfigureWindow(req: ConfigureWindowRequest): Buffer {
  const body = Buffer.alloc(24)
  body.writeUInt32LE(req.window, 0)
  body.writeUInt16LE(CONFIGURE_XYWH, 4)
  body.writeInt32LE(req.x, 8)
  body.writeInt32LE(req.y, 12)
  body.writeUInt32LE(req.width, 16)
  body.writeUInt32LE(req.height, 20)
  return request(OPCODE_CONFIGURE_WINDOW, 0, body)
}

export function encodeQueryExtension(name: string): Buffer {
  return request(OPCODE_QUERY_EXTENSION, 0, counted(name))
}

/**
 * X-Resource QueryClientIds for one spec `{ client: windowId, mask: LocalClientPID }`: asks for
 * the PID of the client owning that window. The request byte is the extension's major opcode and
 * the data byte its minor opcode.
 */
export function encodeQueryClientIds(majorOpcode: number, windowId: number): Buffer {
  return request(
    majorOpcode,
    XRES_MINOR_QUERY_CLIENT_IDS,
    card32s([1, windowId, XRES_LOCAL_CLIENT_PID]),
  )
}

// ---- server -> client packets ------------------------------------------------------------------

export type Packet =
  | { kind: 'reply'; sequence: number; length: number }
  | {
      kind: 'error'
      sequence: number
      length: number
      code: number
      badValue: number
      minorOpcode: number
      majorOpcode: number
    }
  /** `code` without the 0x80 sent-by-SendEvent bit. KeymapNotify carries no sequence number. */
  | { kind: 'event'; sequence: number; length: number; code: number }

/**
 * Frames the packet at the start of `buf`. Errors and events are 32 bytes (GenericEvent adds a
 * length like a reply); a reply is 32 + 4 * its CARD32 length bytes. `ok` means the whole packet
 * is in `buf`, so `buf.subarray(0, length)` is safe.
 */
export function readPacket(buf: Buffer): WireResult<Packet> {
  if (buf.length < 32) return TRUNCATED
  const code = buf[0]
  const sequence = buf.readUInt16LE(2)
  if (code === 0) {
    return done({
      kind: 'error',
      sequence,
      length: 32,
      code: buf[1],
      badValue: buf.readUInt32LE(4),
      minorOpcode: buf.readUInt16LE(8),
      majorOpcode: buf[10],
    })
  }
  // 0x80 / 0x81 would be a "sent" error or reply, which do not exist.
  if (code !== 1 && (code & 0x7f) < 2) return GARBLED
  const extended = code === 1 || (code & 0x7f) === EVENT_GENERIC
  const length = extended ? 32 + 4 * buf.readUInt32LE(4) : 32
  if (length > MAX_PACKET_BYTES) return GARBLED
  if (buf.length < length) return TRUNCATED
  if (code === 1) return done({ kind: 'reply', sequence, length })
  return done({ kind: 'event', sequence, length, code: code & 0x7f })
}

/** The reply's total byte length once `buf` is known to hold one complete reply. */
function replyLength(buf: Buffer): WireResult<number> {
  const packet = readPacket(buf)
  if (!packet.ok) return packet
  if (packet.value.kind !== 'reply') return GARBLED
  return done(packet.value.length)
}

/** The atom InternAtom returned; 0 (None) only when only-if-exists was set. */
export function decodeInternAtomReply(buf: Buffer): WireResult<number> {
  const length = replyLength(buf)
  if (!length.ok) return length
  return done(buf.readUInt32LE(8))
}

export interface PropertyValue {
  /** 0 (None) together with format 0 when the property does not exist. */
  type: number
  format: number
  bytesAfter: number
  /** The items in the reply's format (8, 16 or 32 bits each); empty for format 0. */
  values: number[]
}

export function decodeGetPropertyReply(buf: Buffer): WireResult<PropertyValue> {
  const length = replyLength(buf)
  if (!length.ok) return length
  const format = buf[1]
  const type = buf.readUInt32LE(8)
  const bytesAfter = buf.readUInt32LE(12)
  if (format === 0) return done({ type, format, bytesAfter, values: [] })
  if (format !== 8 && format !== 16 && format !== 32) return GARBLED
  const count = buf.readUInt32LE(16)
  const width = format / 8
  if (32 + count * width > length.value) return GARBLED
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    const at = 32 + i * width
    values.push(width === 4 ? buf.readUInt32LE(at) : width === 2 ? buf.readUInt16LE(at) : buf[at])
  }
  return done({ type, format, bytesAfter, values })
}

export function decodeQueryExtensionReply(
  buf: Buffer,
): WireResult<{ present: boolean; majorOpcode: number }> {
  const length = replyLength(buf)
  if (!length.ok) return length
  return done({ present: buf[8] !== 0, majorOpcode: buf[9] })
}

/**
 * The PID from a QueryClientIds reply, or null when the server reported none (a remote client, or
 * an X server that cannot tell). Each XResClientIdValue is spec (client, mask), a CARD32 byte
 * length, then that many bytes of value; only a LocalClientPID value is read.
 */
export function decodeQueryClientIdsReply(buf: Buffer): WireResult<number | null> {
  const length = replyLength(buf)
  if (!length.ok) return length
  const idCount = buf.readUInt32LE(8)
  let at = 32
  for (let i = 0; i < idCount; i++) {
    if (at + 12 > length.value) return GARBLED
    const mask = buf.readUInt32LE(at + 4)
    const valueBytes = buf.readUInt32LE(at + 8)
    if (valueBytes % 4 !== 0 || at + 12 + valueBytes > length.value) return GARBLED
    if ((mask & XRES_LOCAL_CLIENT_PID) !== 0 && valueBytes >= 4)
      return done(buf.readUInt32LE(at + 12))
    at += 12 + valueBytes
  }
  return done(null)
}
