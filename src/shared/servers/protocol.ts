/**
 * The Quake II UDP "connectionless" (out-of-band) datagram envelope — the wire format every
 * classic-protocol server query/reply rides on, before any particular query's body is parsed.
 *
 * Every connectionless datagram starts with four `0xFF` bytes (`OOB_PREFIX`), followed by an
 * ASCII command token and, for replies, a body the command-specific parser (a later deliverable)
 * splits further. This module only handles that shared envelope: building the two outbound
 * queries (`info`/`status`) and peeling the prefix + command token off an inbound reply. It does
 * no networking itself — no `node:dgram`, nothing socket-shaped — that is a separate deliverable.
 *
 * ## Byte/string codec
 *
 * Quake II's wire text is not UTF-8: every byte 0x00-0xFF is a valid, meaningful payload byte
 * (server names, colours via the high-bit charset — see `src/shared/config/q2-charset.ts`).
 * `TextDecoder('utf-8')` would mangle any byte above 0x7F, and Node's `Buffer` `'latin1'`
 * encoding is off-limits because `src/shared` may never import `node:*` or `Buffer` (this file
 * type-checks under `tsconfig.web.json`, which carries no Node types at all). `decodeLatin1` /
 * `encodeLatin1` are a hand-rolled bijection between byte value and UTF-16 code unit — this is
 * NOT real ISO-8859-1 semantics (real latin-1 leaves 0x80-0x9F undefined), it is just an exact,
 * lossless round trip over 0-255, which is all this protocol needs.
 *
 * ## Result shape
 *
 * Mirrors `src/shared/servers/address.ts`'s convention: a failure carries a reason *code* (a
 * string-literal union), never a literal English message, so a caller can resolve it to an i18n
 * key the same way `serverAddressRejectionKey` does. `ServerReplyFailureReason` is the shared
 * six-reason vocabulary later deliverables (the `info`/`status` body parsers) reuse rather than
 * each inventing their own; `ServerReplyResult<T>` is the generic success/failure wrapper around
 * it.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

/** The four-byte "out of band" prefix that marks every Quake II connectionless UDP datagram. */
export const OOB_PREFIX: Uint8Array = new Uint8Array([0xff, 0xff, 0xff, 0xff])

/**
 * Decodes bytes to a string where byte value N becomes the UTF-16 code unit N, for every N in
 * 0-255. Exact inverse of `encodeLatin1`. Not real ISO-8859-1 — see the file doc comment.
 */
export function decodeLatin1(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] as number)
  }
  return out
}

/**
 * Encodes a string to bytes where UTF-16 code unit N becomes byte value `N & 0xFF`, for every
 * code unit. Exact inverse of `decodeLatin1` for strings it produced. Not real ISO-8859-1 — see
 * the file doc comment.
 */
export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff
  }
  return bytes
}

/** Why `readConnectionlessReply` (or a later, command-specific body parser built on it) rejected
 * an inbound datagram. Shared across the servers query/reply modules so every parser reuses the
 * same six-reason vocabulary instead of inventing its own. */
export type ServerReplyFailureReason =
  | 'too-short'
  | 'not-connectionless'
  | 'unexpected-command'
  | 'truncated'
  | 'malformed-infostring'
  | 'malformed-player-line'

/** A rejection carrying its reason code. */
export interface ServerReplyFailure {
  ok: false
  reason: ServerReplyFailureReason
}

/** Generic success/failure wrapper for a parsed server reply, mirroring
 * `src/shared/servers/address.ts`'s `{ ok: true, ... } | { ok: false, reason }` convention. `T` is
 * the success payload shape (e.g. `{ body: string }` here, a parsed infostring/player list for a
 * later deliverable). */
export type ServerReplyResult<T> = ({ ok: true } & T) | ServerReplyFailure

/**
 * Strips the connectionless envelope off an inbound datagram: verifies the 4-byte `OOB_PREFIX`,
 * decodes the rest as latin1, and checks that it starts with `expectedCommand` (matched
 * case-sensitively against the leading run of non-whitespace characters). Never throws — always
 * returns the result union.
 *
 * On success, `body` is everything after the command token with a single immediately-following
 * newline stripped, if present — the raw rest, left for a command-specific parser (a later
 * deliverable) to split further.
 */
export function readConnectionlessReply(
  bytes: Uint8Array,
  expectedCommand: string,
): ServerReplyResult<{ body: string }> {
  if (bytes.length < OOB_PREFIX.length + 1) return { ok: false, reason: 'too-short' }

  for (let i = 0; i < OOB_PREFIX.length; i++) {
    if (bytes[i] !== OOB_PREFIX[i]) return { ok: false, reason: 'not-connectionless' }
  }

  const decoded = decodeLatin1(bytes.subarray(OOB_PREFIX.length))

  const commandEnd = (() => {
    const match = /[\s\n]/.exec(decoded)
    return match ? match.index : decoded.length
  })()
  const command = decoded.slice(0, commandEnd)

  if (command !== expectedCommand) return { ok: false, reason: 'unexpected-command' }

  let rest = decoded.slice(commandEnd)
  if (rest.startsWith('\n')) rest = rest.slice(1)

  return { ok: true, body: rest }
}

/**
 * Builds the `info` connectionless query datagram: `OOB_PREFIX` + `"info " + protocol + "\n"`.
 *
 * `protocol` is our own code's outbound argument, not foreign inbound data, so a bad value throws
 * a `RangeError` rather than returning a result union — it must be an integer in 1-255 inclusive.
 */
export function buildInfoQuery(protocol: number): Uint8Array {
  if (!Number.isInteger(protocol) || protocol < 1 || protocol > 255) {
    throw new RangeError(`protocol must be an integer in 1-255, got ${protocol}`)
  }

  const commandBytes = encodeLatin1(`info ${protocol}\n`)
  const datagram = new Uint8Array(OOB_PREFIX.length + commandBytes.length)
  datagram.set(OOB_PREFIX, 0)
  datagram.set(commandBytes, OOB_PREFIX.length)
  return datagram
}

/** Builds the `status` connectionless query datagram: `OOB_PREFIX` + `"status\n"`. Never throws. */
export function buildStatusQuery(): Uint8Array {
  const commandBytes = encodeLatin1('status\n')
  const datagram = new Uint8Array(OOB_PREFIX.length + commandBytes.length)
  datagram.set(OOB_PREFIX, 0)
  datagram.set(commandBytes, OOB_PREFIX.length)
  return datagram
}
