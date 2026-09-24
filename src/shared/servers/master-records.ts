/**
 * The UDP master reply codec (story 109, D1): unpacking a master server's `query` reply — packed
 * 4-byte-IPv4 + 2-byte-big-endian-port records behind a fixed header — into an address set, and
 * assembling several such replies (the master answers over multiple datagrams, per concept §6.5)
 * into one deduplicated set.
 *
 * This module only decodes bytes already in hand; it does no networking itself — no `node:dgram`,
 * nothing socket-shaped. The transport seam that collects those datagrams off a live master is a
 * separate deliverable (`src/main/modules/servers/udp-master-source.ts`, D3).
 *
 * ## Byte-level header check
 *
 * Unlike `src/shared/servers/protocol.ts`'s `readConnectionlessReply`, the header here is matched
 * against the raw bytes, not decoded to latin1 and split on whitespace first: a packed address
 * record legitimately contains bytes like `0x20` and `0x0A` that would corrupt a text-oriented
 * split. See story 109's Decisions (Sprint) for why this is a deliberate deviation from the [[108]]
 * envelope helper rather than reuse of it.
 *
 * ## Result shape and address vocabulary
 *
 * Mirrors `src/shared/servers/protocol.ts`'s `{ ok: true, ... } | { ok: false, reason }` convention.
 * Every address a record produces is run through `parseServerAddress` (story 107), and
 * `assembleMasterAddresses` dedupes on the resulting `normalized` string — a master-supplied address
 * is validated by exactly the rule a hand-typed one is.
 *
 * ## Per-record failure vs. whole-body failure
 *
 * A single bad record (currently: port `0`) is dropped into a `skipped` list while the rest of the
 * body still succeeds — GB-S3 reports a failing *source*, not a failing line, and one bad row must
 * not lose the other 200 servers. Only a whole-body defect — too short to hold the header, a wrong
 * header, an empty body, or a trailing remainder that is not a whole number of 6-byte records — is
 * `{ ok: false }`. No padding is tolerated: a remainder of 1-5 bytes after the last full record is
 * `truncated`, never silently dropped.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC — it type-checks under `tsconfig.web.json` as well as `tsconfig.node.json`.
 */

import { parseServerAddress, type ParsedServerAddress } from './address'

/** The literal bytes every UDP master `query` reply starts with: four `0xFF` bytes followed by the
 * ASCII command token `servers ` (note the trailing space, which is part of the fixed header, not
 * the first record). Matched byte-for-byte — see the file doc comment. */
export const MASTER_REPLY_HEADER: Uint8Array = new Uint8Array([
  0xff, 0xff, 0xff, 0xff,
  // "servers "
  0x73, 0x65, 0x72, 0x76, 0x65, 0x72, 0x73, 0x20,
])

/** Number of bytes in one packed record: 4-byte IPv4 address + 2-byte big-endian port. */
const RECORD_LENGTH = 6

/**
 * Why a master or HTTP-list source's payload was rejected outright (as opposed to a single record
 * being dropped into `skipped`). This union is declared here because it is the shared type every
 * source codec in this story imports:
 * - `too-short`, `bad-header`, `truncated`, `empty-body` are produced by this module (D1) and by
 *   the HTTP list codecs (D2), which reuse the same packed-record reader.
 * - `no-reply`, `transport-error`, `http-status` are produced by the transport seams (D3/D4), not
 *   by any pure codec in this file — they describe how the *source*, not the payload, failed.
 */
export type MasterSourceFailure =
  | 'too-short'
  | 'bad-header'
  | 'truncated'
  | 'empty-body'
  | 'no-reply'
  | 'transport-error'
  | 'http-status'

/** Maps a source failure reason to its i18n key, `servers.source.error.<reason>`, mirroring
 * `serverAddressRejectionKey` (story 107, D3) — the matching `en.json` entries live under
 * `servers.source.error.*`. */
export function masterSourceFailureKey(reason: MasterSourceFailure): string {
  return `servers.source.error.${reason}`
}

/** A record dropped from `addresses` without failing the whole payload — currently only a `0` port
 * (`reason: 'zero-port'`). `value` is the `host:port` string the record decoded to before the
 * record-level rejection, for diagnostics. */
export interface SkippedRecord {
  value: string
  reason: string
}

/** Result of successfully reading zero or more packed records from a byte range. */
export interface PackedRecordsResult {
  ok: true
  addresses: ParsedServerAddress[]
  skipped: SkippedRecord[]
}

/** A whole-payload failure: the byte range did not hold a well-formed sequence of records. */
export interface MasterSourceFailureResult {
  ok: false
  reason: MasterSourceFailure
}

export type MasterRecordsResult = PackedRecordsResult | MasterSourceFailureResult

/**
 * Reads packed 6-byte records (4-byte IPv4 + 2-byte big-endian port) from `bytes`, starting at
 * `offset`, to the end of `bytes`. A trailing remainder of 1-5 bytes after the last full record is
 * `truncated` — no padding is tolerated (see the file doc comment).
 *
 * Each record's raw octets and numeric port are formatted as `"a.b.c.d:port"` and run through
 * `parseServerAddress` for normalization/dedupe-key purposes; a record with port `0` is dropped
 * into `skipped` (`reason: 'zero-port'`) instead of failing the whole read.
 */
export function readPackedRecords(bytes: Uint8Array, offset: number): MasterRecordsResult {
  const remainderLength = bytes.length - offset
  if (remainderLength % RECORD_LENGTH !== 0) {
    return { ok: false, reason: 'truncated' }
  }

  const addresses: ParsedServerAddress[] = []
  const skipped: SkippedRecord[] = []

  for (let i = offset; i < bytes.length; i += RECORD_LENGTH) {
    const a = bytes[i] as number
    const b = bytes[i + 1] as number
    const c = bytes[i + 2] as number
    const d = bytes[i + 3] as number
    const port = ((bytes[i + 4] as number) << 8) | (bytes[i + 5] as number)

    const value = `${a}.${b}.${c}.${d}:${port}`

    if (port === 0) {
      skipped.push({ value, reason: 'zero-port' })
      continue
    }

    const parsed = parseServerAddress(value)
    if (!parsed.ok) {
      skipped.push({ value, reason: parsed.reason })
      continue
    }

    addresses.push(parsed)
  }

  return { ok: true, addresses, skipped }
}

/**
 * Unpacks one UDP master `query` reply datagram: checks the payload is at least as long as
 * `MASTER_REPLY_HEADER` (`too-short` if not), checks the header bytes match exactly (`bad-header`
 * if not), checks the body after the header is non-empty (`empty-body` if zero-length), then reads
 * the remainder as packed records via `readPackedRecords`.
 *
 * Never throws, never returns a partial address list on failure — see the file doc comment's
 * "Per-record failure vs. whole-body failure" section.
 */
export function unpackMasterReply(bytes: Uint8Array): MasterRecordsResult {
  if (bytes.length < MASTER_REPLY_HEADER.length) {
    return { ok: false, reason: 'too-short' }
  }

  for (let i = 0; i < MASTER_REPLY_HEADER.length; i++) {
    if (bytes[i] !== MASTER_REPLY_HEADER[i]) {
      return { ok: false, reason: 'bad-header' }
    }
  }

  if (bytes.length === MASTER_REPLY_HEADER.length) {
    return { ok: false, reason: 'empty-body' }
  }

  return readPackedRecords(bytes, MASTER_REPLY_HEADER.length)
}

/**
 * Unions several already-unpacked address lists (e.g. one per datagram) into a single set,
 * deduplicated by `normalized`, keeping first-seen order.
 */
export function assembleMasterAddresses(payloads: ParsedServerAddress[][]): ParsedServerAddress[] {
  const seen = new Set<string>()
  const result: ParsedServerAddress[] = []

  for (const payload of payloads) {
    for (const address of payload) {
      if (seen.has(address.normalized)) continue
      seen.add(address.normalized)
      result.push(address)
    }
  }

  return result
}
