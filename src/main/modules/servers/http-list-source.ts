/**
 * The HTTP list transport seam (story 109, D4): fetches q2servers.com's `?raw=1`/`?raw=2` list
 * over an injectable `FetchImpl` and hands the response body to the matching pure codec
 * (`src/shared/servers/http-list.ts`, D2).
 *
 * `FetchImpl` is reused from `src/main/modules/downloads/fetcher.ts` rather than re-declared —
 * the same seam the news feed and the package downloader already inject a real `fetch` through in
 * their loopback tests. Unlike that module, this one has no Electron-based default of its own to
 * lazily import: `fetchImpl` is a required parameter, so this file never imports `electron` and
 * runs under plain Vitest (story 109 D4 acceptance: "the resolver runs under plain Vitest with a
 * plain fetch injected, with no Electron runtime").
 *
 * Only a non-2xx response is this module's own failure (`http-status`, carrying the status code —
 * `MasterSourceFailure` itself is not widened for it, since only this transport seam produces it).
 * A `fetchImpl` rejection (DNS failure, connection refused, aborted) is `transport-error`. A 2xx
 * body is handed to D2's codec unchanged — its `ok`/`reason`/`addresses`/`skipped` shape passes
 * straight through, so a codec-level defect (`empty-body`, `truncated`, ...) is reported exactly as
 * D2 already tests it.
 */

import type { ParsedServerAddress } from '@shared/servers/address'
import { parseHttpListBinary, parseHttpListText } from '@shared/servers/http-list'
import type { MasterSourceFailure } from '@shared/servers/master-records'
import type { FetchImpl } from '../downloads/fetcher'

/** `?raw=1` is the text shape, `?raw=2` is the bare packed binary shape (see `http-list.ts`). */
export type HttpListRaw = 1 | 2

export interface ResolveHttpListSourceOptions {
  raw: HttpListRaw
  fetchImpl: FetchImpl
  signal?: AbortSignal
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
 * `opts.raw`. Never throws: a transport-level rejection is caught and reported as
 * `transport-error`, and a non-2xx response is reported as `http-status` before any body is read.
 */
export async function resolveHttpListSource(
  url: string,
  opts: ResolveHttpListSourceOptions,
): Promise<HttpListSourceResult> {
  // `FetchImpl`'s `init.signal` is required (mirroring `fetcher.ts`'s own callers), so an absent
  // caller-supplied signal is backed by a controller that is never aborted, rather than a cast.
  const controller = new AbortController()
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  if (opts.signal?.aborted === true) controller.abort()

  let response: Response
  try {
    response = await opts.fetchImpl(url, { signal: controller.signal })
  } catch {
    return { ok: false, reason: 'transport-error' }
  }

  if (!response.ok) {
    return { ok: false, reason: 'http-status', status: response.status }
  }

  if (opts.raw === 1) {
    const text = await response.text()
    return parseHttpListText(text)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  return parseHttpListBinary(bytes)
}
