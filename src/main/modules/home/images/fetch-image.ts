import { rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  NEWS_FETCH_RETRIES,
  NEWS_FETCH_TIMEOUT_MS,
  type NewsFetchLog,
} from '../news/feed-fetcher'
import {
  SAFE_NEWS_IMAGE_EXTENSIONS,
  isSafeNewsImageFileName,
  newsImageFileName,
} from './paths'

/**
 * Story 084 D2: fetch one slide image, decide whether it is safe to cache, and never leave an
 * invalid or partial file behind. Mirrors `downloads/fetcher.ts` (injectable fetch, `.part`-then-
 * promote) and `downloads/verify.ts` (a size gate that runs before anything is trusted) - minus
 * mirrors and manifest hashes, because a slide image has neither: there is one URL, and nothing
 * declares its expected size or digest up front. What stands in for that declaration here is a
 * fixed budget this module enforces itself: at most `MAX_IMAGE_BYTES`, a content-type this module
 * recognises as an image, and a decoded size within `MAX_IMAGE_DIMENSION_PX`.
 *
 * ## Why the network budget is borrowed, not reinvented
 *
 * `feed-fetcher.ts` (082 D5) already sets the launcher's opinion on how long an outbound request to
 * the content repo gets before it counts as unreachable - 5s, one retry, only for a timeout,
 * network error or 5xx. An image fetch is the same kind of request against the same kind of
 * upstream, so it uses the *same* constants (`NEWS_FETCH_TIMEOUT_MS`, `NEWS_FETCH_RETRIES`) rather
 * than a second, possibly-drifting budget, and its default transport is the same global `fetch`
 * that module's `defaultFetchImpl` uses - not `net.fetch`, which would need an Electron runtime to
 * even import.
 *
 * ## The four outcomes, and why only one of them deletes anything
 *
 * - `cached` - the body passed every check and now lives at its content-addressed path.
 * - `rejected` - the body was retrieved but is not an image this launcher will show: too big
 *   (either the declared `content-length` or the bytes actually received), not an accepted
 *   content-type, undecodable, or decoded to something wider or taller than
 *   `MAX_IMAGE_DIMENSION_PX`. A previously cached copy, if any, is left alone - a bad *new* response
 *   says nothing about whether the *old* cached bytes are still good, so the safer, and correct,
 *   assumption is to keep serving the last known-good image.
 * - `gone` - the upstream answered `404` or `410`. That is the one status pair the story treats as
 *   "this image was deliberately withdrawn", so it is the only outcome that deletes the cached copy
 *   - across every extension this module could have written it under, since a `404`/`410` carries no
 *   `content-type` to say which one it was.
 * - `unavailable` - a timeout, a thrown network error, a `5xx`, or any other non-`404`/`410` failure
 *   status. All of these say "we don't know", not "it's gone" or "it's bad", so the cached copy (if
 *   any) is left completely untouched.
 *
 * ## The `.part` file
 *
 * The body is buffered in memory while it streams (it is capped at `MAX_IMAGE_BYTES`, a few
 * megabytes at most, so this is cheap), written whole to `<name>.<ext>.part`, and only *then*
 * decoded. A decode failure or an oversized image deletes the `.part` file and returns `rejected` -
 * the promoted name is never used for anything that has not passed `decodeImage`.
 */

/** Satisfied by both the global `fetch` and Electron's `net.fetch`. */
export type ImageFetchImpl = (url: string, init: { signal: AbortSignal }) => Promise<Response>

/** What `decodeImage` reports. `ok: false` covers both "this failed to decode" and "this decoded to
 * nothing" (Electron's `nativeImage.isEmpty()`) - both mean "not an image", not a crash. */
export interface DecodeImageResult {
  ok: boolean
  width?: number
  height?: number
}

/**
 * "Is this really an image, and how big is it" is one injectable step so tests can hand back a
 * verdict without real image bytes or an Electron runtime, and production can hand the same bytes
 * to Electron's `nativeImage`.
 */
export type DecodeImage = (bytes: Buffer) => DecodeImageResult | Promise<DecodeImageResult>

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`); kept minimal for the tests. */
export type FetchImageLog = NewsFetchLog

/** Content-types this launcher will ever cache, and the extension each is written under
 * (Decisions (Sprint): content-type is a cheap pre-filter, `decodeImage` is the real check). */
const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** Reuses 082's budget (`feed-fetcher.ts`) rather than inventing a second one for the same kind of
 * outbound request. */
export const IMAGE_FETCH_TIMEOUT_MS = NEWS_FETCH_TIMEOUT_MS
export const IMAGE_FETCH_RETRIES = NEWS_FETCH_RETRIES

/** Max accepted body size (Decisions (Sprint): ~5 MB) - checked against both the declared
 * `content-length` (cheap, before any bytes are read) and the bytes actually received (the header
 * can lie or be absent). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Max accepted width/height (Decisions (Sprint): ~4000px), via `decodeImage`. */
export const MAX_IMAGE_DIMENSION_PX = 4000

export interface FetchImageOptions {
  /** The image's own URL - also what its cache file name is content-addressed by (`paths.ts`). */
  sourceUrl: string
  /** `userData/cache/news-images` (`getNewsImagesCacheDir()`), already existing or not - this
   * module creates it if needed. */
  cacheDir: string
  fetchImpl?: ImageFetchImpl
  decodeImage?: DecodeImage
  timeoutMs?: number
  retries?: number
  log?: FetchImageLog
}

export type FetchImageResult =
  | { kind: 'cached'; fileName: string; path: string }
  | { kind: 'rejected'; reason: string }
  | { kind: 'gone' }
  | { kind: 'unavailable'; reason: string }

interface ResolvedOptions {
  timeoutMs: number
  retries: number
  fetchImpl: ImageFetchImpl
  decodeImage: DecodeImage
  log?: FetchImageLog
}

const defaultFetchImpl: ImageFetchImpl = (url, init) => fetch(url, init)

/**
 * Production `decodeImage`: Electron's `nativeImage.createFromBuffer()`, imported lazily so that
 * importing this module (and running its tests) needs no Electron runtime - the same reason
 * `downloads/fetcher.ts` imports `electron` lazily inside `electronNetFetch`.
 */
export const electronDecodeImage: DecodeImage = async (bytes) => {
  const { nativeImage } = await import('electron')
  try {
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return { ok: false }
    const { width, height } = image.getSize()
    return { ok: true, width, height }
  } catch {
    return { ok: false }
  }
}

/** `AbortSignal.timeout` rejects with a `TimeoutError`; anything else is a genuine network error. */
function describeError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no response within ${timeoutMs}ms`
  }
  const cause =
    error instanceof Error && error.cause !== undefined ? ` (${String(error.cause)})` : ''
  return `${String(error)}${cause}`
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function parseContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (raw === null) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function contentTypeExtension(response: Response): string | undefined {
  const raw = response.headers.get('content-type') ?? ''
  const contentType = raw.split(';')[0].trim().toLowerCase()
  return CONTENT_TYPE_EXTENSIONS[contentType]
}

/** One request's outcome, before any body has been read. `retry` never leaves `requestOnce()`. */
type RequestOutcome =
  | { kind: 'ok'; response: Response }
  | { kind: 'gone' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'retry'; reason: string }

/** 404/410 is treated as "withdrawn" (`gone`); 5xx is retried; any other non-`ok` status is
 * `unavailable` without a retry - a second identical request cannot tell us anything new about it. */
async function requestOnce(url: string, options: ResolvedOptions): Promise<RequestOutcome> {
  let response: Response
  try {
    response = await options.fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs) })
  } catch (error) {
    return { kind: 'retry', reason: describeError(error, options.timeoutMs) }
  }

  if (response.status === 404 || response.status === 410) {
    await discard(response)
    return { kind: 'gone' }
  }
  if (response.status >= 500) {
    await discard(response)
    return { kind: 'retry', reason: `HTTP ${response.status}` }
  }
  if (!response.ok) {
    await discard(response)
    return { kind: 'unavailable', reason: `HTTP ${response.status}` }
  }
  return { kind: 'ok', response }
}

/** One request plus, for a timeout/network/5xx failure, exactly `options.retries` more. */
async function requestWithRetry(
  url: string,
  options: ResolvedOptions,
): Promise<Exclude<RequestOutcome, { kind: 'retry' }>> {
  let reason = 'not attempted'
  for (let attempt = 0; ; attempt++) {
    const outcome = await requestOnce(url, options)
    if (outcome.kind !== 'retry') return outcome
    reason = outcome.reason
    if (attempt >= options.retries) break
    options.log?.warn(`news image ${url} failed (${reason}); retrying once`)
  }
  return { kind: 'unavailable', reason }
}

/**
 * Deletes every name `sourceUrl` could ever have been cached under (one per accepted extension).
 * The only place this module unlinks a file, and it re-checks the same two facts `image-cache.ts`'s
 * `enforceKeepSet()` does before it deletes anything: is this a name this module would have
 * written, and does it resolve to a direct child of the cache directory (no traversal)?
 */
async function deleteAnyCachedCopy(
  cacheDir: string,
  sourceUrl: string,
  log?: FetchImageLog,
): Promise<void> {
  const resolvedDir = resolve(cacheDir)
  for (const ext of SAFE_NEWS_IMAGE_EXTENSIONS) {
    const fileName = newsImageFileName(sourceUrl, ext)
    if (!isSafeNewsImageFileName(fileName)) continue
    const target = resolve(cacheDir, fileName)
    if (dirname(target) !== resolvedDir) continue
    try {
      await unlink(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        log?.warn(`could not delete stale cached image for ${sourceUrl}: ${String(error)}`)
      }
    }
  }
}

/**
 * Streams `response.body`, capping at `MAX_IMAGE_BYTES` of *actually received* bytes regardless of
 * what `content-length` claimed - the header is only a cheap pre-check, applied by the caller before
 * this runs. Returns the whole body as one `Buffer`; `undefined` means the cap was hit and the
 * stream was cancelled.
 */
async function readCappedBody(response: Response): Promise<Buffer | undefined> {
  const body = response.body
  if (body === null) return Buffer.alloc(0)

  const reader = body.getReader()
  const chunks: Buffer[] = []
  let received = 0

  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    const value = chunk.value
    if (value === undefined || value.byteLength === 0) continue

    received += value.byteLength
    if (received > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined)
      return undefined
    }
    chunks.push(Buffer.from(value))
  }

  return Buffer.concat(chunks)
}

/**
 * Fetches `options.sourceUrl`, validates the body, and promotes it into the news-image cache. See
 * the module comment for the four possible outcomes and which one deletes a previously cached copy.
 */
export async function fetchImage(options: FetchImageOptions): Promise<FetchImageResult> {
  const resolved: ResolvedOptions = {
    timeoutMs: options.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS,
    retries: options.retries ?? IMAGE_FETCH_RETRIES,
    fetchImpl: options.fetchImpl ?? defaultFetchImpl,
    decodeImage: options.decodeImage ?? electronDecodeImage,
    ...(options.log !== undefined ? { log: options.log } : {}),
  }

  const outcome = await requestWithRetry(options.sourceUrl, resolved)

  if (outcome.kind === 'gone') {
    await deleteAnyCachedCopy(options.cacheDir, options.sourceUrl, options.log)
    return { kind: 'gone' }
  }
  if (outcome.kind === 'unavailable') {
    return { kind: 'unavailable', reason: outcome.reason }
  }

  const response = outcome.response

  const ext = contentTypeExtension(response)
  if (ext === undefined) {
    await discard(response)
    const reason = `unsupported content-type ${JSON.stringify(response.headers.get('content-type'))}`
    return { kind: 'rejected', reason }
  }

  // Cheap pre-check before a single byte is read: a declared length over the cap is refused
  // outright, the same way `downloads/fetcher.ts` refuses a mirror's `content-length` up front.
  const declaredLength = parseContentLength(response)
  if (declaredLength !== null && declaredLength > MAX_IMAGE_BYTES) {
    await discard(response)
    return {
      kind: 'rejected',
      reason: `declared content-length ${declaredLength} exceeds ${MAX_IMAGE_BYTES} bytes`,
    }
  }

  let body: Buffer | undefined
  try {
    body = await readCappedBody(response)
  } catch (error) {
    return { kind: 'unavailable', reason: `body could not be read: ${String(error)}` }
  }
  if (body === undefined) {
    return { kind: 'rejected', reason: `body exceeds ${MAX_IMAGE_BYTES} bytes` }
  }

  const fileName = newsImageFileName(options.sourceUrl, ext)
  const finalPath = join(options.cacheDir, fileName)
  const partPath = `${finalPath}.part`

  try {
    await writeFile(partPath, body)
  } catch (error) {
    return { kind: 'unavailable', reason: `writing ${partPath} failed: ${String(error)}` }
  }

  let decoded: DecodeImageResult
  try {
    decoded = await resolved.decodeImage(body)
  } catch {
    decoded = { ok: false }
  }

  const tooWide = decoded.width !== undefined && decoded.width > MAX_IMAGE_DIMENSION_PX
  const tooTall = decoded.height !== undefined && decoded.height > MAX_IMAGE_DIMENSION_PX

  if (!decoded.ok || tooWide || tooTall) {
    await rm(partPath, { force: true })
    const reason = !decoded.ok
      ? 'the body could not be decoded as an image'
      : `image is ${decoded.width}x${decoded.height}px, over the ${MAX_IMAGE_DIMENSION_PX}px limit`
    return { kind: 'rejected', reason }
  }

  try {
    await rename(partPath, finalPath)
  } catch (error) {
    // A previously cached file at the target can be locked (Windows). Clear it and try once more -
    // mirrors `downloads/verify.ts`'s promotion retry.
    try {
      await rm(finalPath, { force: true })
      await rename(partPath, finalPath)
    } catch {
      await rm(partPath, { force: true })
      return {
        kind: 'unavailable',
        reason: `could not move the verified image into place: ${String(error)}`,
      }
    }
  }

  return { kind: 'cached', fileName, path: finalPath }
}
