/**
 * The HTTP list transport seam (story 109, D4): fetches q2servers.com's `?raw=1`/`?raw=2` list
 * over an injectable `FetchImpl` and hands the response body to the matching pure codec
 * (`src/shared/servers/http-list.ts`, D2).
 *
 * The fetch goes through `fetchWithPolicy`, so a source that stalls ends at its time budget and one
 * that streams without end stops at the size cap; the body read is inside that budget, so a body
 * that errors or hangs mid-read is a failure outcome rather than a rejection. `fetchImpl` is a
 * required parameter, so this file never imports `electron` and runs under plain Vitest.
 *
 * A timeout, network error, abort or body-read error is `transport-error`; a body over the cap is
 * `truncated`; a non-2xx response is `http-status` carrying the status code (`MasterSourceFailure`
 * itself is not widened for it, since only this transport seam produces it). A 2xx body is handed
 * to D2's codec unchanged, so a codec-level defect (`empty-body`, `truncated`, ...) is reported
 * exactly as D2 already tests it.
 */

import type { ParsedServerAddress } from '@shared/servers/address'
import { parseHttpListBinary, parseHttpListText } from '@shared/servers/http-list'
import type { MasterSourceFailure } from '@shared/servers/master-records'
import { fetchWithPolicy, type FetchImpl } from '../../lib/http'

export const HTTP_LIST_TIMEOUT_MS = 10_000
export const HTTP_LIST_MAX_BYTES = 2 * 1024 * 1024

/** `?raw=1` is the text shape, `?raw=2` is the bare packed binary shape (see `http-list.ts`). */
export type HttpListRaw = 1 | 2

export interface ResolveHttpListSourceOptions {
  raw: HttpListRaw
  fetchImpl: FetchImpl
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
}

/**
 * Result of resolving one HTTP list source. Mirrors `HttpListResult` (D2) but widens the failure
 * case with an optional `status`, carried only for `http-status` — defined locally rather than by
 * touching `master-records.ts` in this deliverable.
 */
export type HttpListSourceResult =
  | { ok: true; addresses: ParsedServerAddress[]; skipped: { value: string; reason: string }[] }
  | { ok: false; reason: MasterSourceFailure; status?: number }

/**
 * Fetches `url` through `fetchImpl` and decodes the response body with the codec matching
 * `opts.raw`. Never throws: every transport failure is a `HttpListSourceResult`.
 */
export async function resolveHttpListSource(
  url: string,
  opts: ResolveHttpListSourceOptions,
): Promise<HttpListSourceResult> {
  const outcome = await fetchWithPolicy(url, {
    fetchImpl: opts.fetchImpl,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    retries: 0,
    timeoutMs: opts.timeoutMs ?? HTTP_LIST_TIMEOUT_MS,
    maxBytes: opts.maxBytes ?? HTTP_LIST_MAX_BYTES,
  })

  if (!outcome.ok) {
    if (outcome.kind === 'too-large') return { ok: false, reason: 'truncated' }
    if (outcome.kind === 'http-status') {
      return { ok: false, reason: 'http-status', status: outcome.status ?? 0 }
    }
    return { ok: false, reason: 'transport-error' }
  }

  if (opts.raw === 1) return parseHttpListText(new TextDecoder().decode(outcome.body))
  return parseHttpListBinary(outcome.body)
}
