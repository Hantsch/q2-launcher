/**
 * Codecs for q2servers.com's HTTP master list, story 109 D2.
 *
 * The HTTP master source publishes the same address set the UDP master's `query` reply carries,
 * over two shapes selectable by a `?raw=` query parameter:
 *
 *  - `?raw=1` — a plain-text list, one `host:port` per line.
 *  - `?raw=2` — the bare packed binary records (see `./master-records`), with no out-of-band
 *    header at all — unlike the UDP reply, there is no `\xFF\xFF\xFF\xFFservers ` prefix to skip,
 *    so this codec is `readPackedRecords` called at offset 0 and nothing else (story 109
 *    Decisions: "AC1 and AC4 are proven against one implementation").
 *
 * Pure, `src/shared` — no `node:*`, no Electron, no IPC — the actual HTTP fetch is a later
 * deliverable's transport seam (`src/main/modules/servers/http-list-source.ts`, D4); this module
 * only ever turns bytes/text it is handed into an address list.
 *
 * Every address is produced by `parseServerAddress` (story 107), so a master-supplied address is
 * validated by exactly the rule a hand-typed one is. A single bad line/record is not a source
 * failure — the Decisions record: "a per-record/per-line rejection is not a source failure" — it
 * is dropped into `skipped` while the rest of the list still parses. Only a whole-body defect
 * (empty body, or — for the binary shape — a length that is not a multiple of 6) fails the whole
 * parse, via the shared `MasterSourceFailure` reason union.
 */

import { parseServerAddress, type ParsedServerAddress } from './address'
import { readPackedRecords, type MasterSourceFailure } from './master-records'

/** Result shared by both HTTP list codecs — mirrors `readPackedRecords`'s shape (D1). */
export type HttpListResult =
  | { ok: true; addresses: ParsedServerAddress[]; skipped: { value: string; reason: string }[] }
  | { ok: false; reason: MasterSourceFailure }

/**
 * Parses the `?raw=1` text shape: one `host:port` (or `a.b.c.d:port`) per line, separated by LF
 * or CRLF. Blank lines and `#`-prefixed comment lines are skipped without being counted as
 * rejections. A line that fails `parseServerAddress` is recorded in `skipped` with its rejection
 * reason; the rest of the list still parses.
 *
 * An empty body — the raw text is empty/whitespace-only, or every line is blank/a comment — is a
 * whole-body failure (`empty-body`), not zero addresses.
 */
export function parseHttpListText(text: string): HttpListResult {
  const lines = text.split(/\r\n|\n/)

  const addresses: ParsedServerAddress[] = []
  const skipped: { value: string; reason: string }[] = []
  let sawContentLine = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line.startsWith('#')) continue

    sawContentLine = true

    const result = parseServerAddress(line)
    if (result.ok) {
      addresses.push(result)
    } else {
      skipped.push({ value: line, reason: result.reason })
    }
  }

  if (!sawContentLine) return { ok: false, reason: 'empty-body' }

  return { ok: true, addresses, skipped }
}

/**
 * Parses the `?raw=2` binary shape: bare packed 6-byte records (4-byte IPv4 + 2-byte big-endian
 * port), with no header — `readPackedRecords` is called at offset 0 directly, reusing D1's
 * truncated-remainder check rather than reimplementing it.
 *
 * `readPackedRecords` treats a zero-length range as zero records (`{ ok: true, addresses: [] }`),
 * which is correct for the UDP reply body after its header has already been validated — but here
 * there is no header, so a wholly empty binary body is this codec's own `empty-body` case, checked
 * before delegating.
 */
export function parseHttpListBinary(bytes: Uint8Array): HttpListResult {
  if (bytes.length === 0) return { ok: false, reason: 'empty-body' }

  return readPackedRecords(bytes, 0)
}
