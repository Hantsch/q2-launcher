/**
 * Transport helper for the curated download manifests published in the
 * public `Hantsch/q2_community_content` repository, served over the
 * raw.githubusercontent.com CDN.
 *
 * This is the ONLY place the launcher's download pipeline may hardcode that
 * repo's base URL — other modules (e.g. `manifest-service.ts`) must import
 * `CONTENT_REPO_RAW_BASE` or `contentRepoUrl()` rather than duplicating it.
 */

import { fetchWithPolicy } from './http'

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024

export const CONTENT_REPO_RAW_BASE =
  'https://raw.githubusercontent.com/Hantsch/q2_community_content/main'

/** Thrown by `fetchContentJson` when the response status is not 2xx. */
export class ContentRepoHttpError extends Error {
  public readonly status: number

  constructor(status: number, url: string) {
    super(`content repo request failed: ${status} ${url}`)
    this.name = 'ContentRepoHttpError'
    this.status = status
  }
}

/**
 * Joins `baseUrl` (`CONTENT_REPO_RAW_BASE` unless told otherwise) with `path`, avoiding a double
 * or missing slash.
 *
 * `baseUrl` is a parameter as of story 074 D8, so the UI-verification harness can point manifest
 * traffic at its own `127.0.0.1` fixture server. It is **not** read from the environment here:
 * the only producer of a non-default value is `resolveDownloadSource()`
 * (`src/main/services/content/source.ts`), which is gated on `Q2L_UI_HARNESS === '1'` alone
 * and resolved once at module registration. This file has no opinion about that gate and no way to
 * open it - it just joins two strings.
 */
export function contentRepoUrl(path: string, baseUrl: string = CONTENT_REPO_RAW_BASE): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `${baseUrl}/${cleanPath}`
}

export interface FetchContentJsonOptions {
  /** Abort timeout in milliseconds. Defaults to 10s. */
  timeoutMs?: number
  /** Base URL to fetch from; defaults to `CONTENT_REPO_RAW_BASE`. See `contentRepoUrl()`. */
  baseUrl?: string
}

/**
 * Fetches `path` from the content repo and parses the response as JSON.
 *
 * No retries, no mirror fallback: one request, one timeout, one 2xx check.
 * The result is raw, unvalidated JSON — callers are responsible for
 * validating it (see `src/main/services/content/manifest-parse.ts`).
 */
export async function fetchContentJson<T = unknown>(
  path: string,
  opts?: FetchContentJsonOptions,
): Promise<T> {
  const url = contentRepoUrl(path, opts?.baseUrl)
  const outcome = await fetchWithPolicy(url, {
    // Read `fetch` per call so a stubbed global is honoured.
    fetchImpl: (u, i) => fetch(u, i),
    timeoutMs: opts?.timeoutMs ?? 10_000,
    retries: 0,
    maxBytes: MAX_MANIFEST_BYTES,
  })
  if (!outcome.ok) {
    if (outcome.kind === 'http-status' && outcome.status !== undefined) {
      throw new ContentRepoHttpError(outcome.status, url)
    }
    throw new Error(`content repo request failed: ${outcome.reason} ${url}`)
  }
  return JSON.parse(new TextDecoder().decode(outcome.body)) as T
}
