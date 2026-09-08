import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import type { DownloadsErrorKey, PackageSource } from '@shared/modules/downloads'
import {
  UnsafeDownloadFileNameError,
  ensureDownloadsCacheDir,
  getFinalPath,
  getPartPath,
} from './paths'
import { verifyAndPromote } from './verify'

/**
 * Story 071 D2, AC3/AC4: fetch one package and hand back a path only if the bytes at that path
 * are provably the bytes the package declared.
 *
 * The three pieces of state machinery here are each subtle enough to be worth naming, because
 * getting any of them wrong produces the same failure - a truncated or substituted archive that
 * the launcher then extracts and executes.
 *
 * **1. Hash while writing, never after.** Bytes are hashed on their way into `<name>.part`
 * (`createHash().update(chunk)` right next to `file.write(chunk)`), so nothing is buffered in
 * memory (a game-data package is ~190 MB) and there is no gap between "these are the bytes we
 * hashed" and "these are the bytes on disk". The size, in turn, is read back from the filesystem
 * by `verify.ts` - so a write that silently landed short is caught rather than vouched for by our
 * own byte counter.
 *
 * **2. The 30s budget is two timeouts, not a deadline.** A wall-clock timeout would make a large
 * download impossible to complete on a slow line; a download that is progressing is healthy no
 * matter how long it has been running. So there are two independent clocks: a *headers* timeout
 * (the server has 30s to start answering at all) and a *stall* timeout (once bytes are flowing,
 * 30s may pass between two chunks). The stall clock is restarted by every chunk that arrives
 * (`Timeout.refresh()`), which is what makes it a stall detector rather than a deadline.
 *
 * **3. Retry and mirror-advance are different failures.** A transport error (connection dropped,
 * headers timeout, stall, 5xx) says "this URL might work if we ask again", so it is retried up to
 * `transportRetries` times against the *same* URL. A size or hash mismatch says "this URL served
 * the wrong bytes", and asking it again for the same wrong bytes is pointless - it deletes the
 * `.part` file and advances to the next mirror immediately, with no retry (AC4). Only when the
 * primary URL and every mirror has been exhausted does the whole operation fail, always with
 * `downloads.error.allMirrorsFailed`. A local disk error is neither: no mirror can fix this
 * machine's disk, so it stops everything at once with `downloads.error.diskWrite`.
 *
 * The HTTP client is Electron's `net.fetch` (Decisions (Sprint): it honours the system proxy
 * without a dependency), but it is reached through an injectable `fetchImpl` so the tests can
 * point a real `fetch` at a real `node:http` server on `127.0.0.1` and run under plain Vitest,
 * with no Electron runtime. `electron` is imported lazily inside the default implementation for
 * the same reason - importing this module must not require an Electron process.
 */

/**
 * The one HTTP call this module makes. Deliberately narrow: a URL, an abort signal, a response.
 * Satisfied by both `net.fetch` and the global `fetch` (Electron's `GlobalResponse` *is* the
 * global `Response`), so the test double is the real thing pointed somewhere else, not a mock of
 * a response object.
 */
export type FetchImpl = (url: string, init: { signal: AbortSignal }) => Promise<Response>

/** Time the server has to produce response headers. Decisions (Sprint): 30s. */
export const DEFAULT_HEADERS_TIMEOUT_MS = 30_000

/** Time that may pass between two body chunks before the response counts as stalled. */
export const DEFAULT_STALL_TIMEOUT_MS = 30_000

/** Extra requests per URL after the first one failed on transport. Decisions (Sprint): 3. */
export const DEFAULT_TRANSPORT_RETRIES = 3

/** Pause before a retry, multiplied by the retry number (0.5s, 1s, 1.5s). */
export const DEFAULT_RETRY_DELAY_MS = 500

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`); kept minimal for the tests. */
export interface DownloadLog {
  info(message: string): void
  warn(message: string): void
}

export interface DownloadProgress {
  /** The URL currently being read - which mirror this is may matter to a progress readout. */
  url: string
  receivedBytes: number
  /** From `content-length`, or `null` when the server did not declare one. */
  totalBytes: number | null
}

export interface DownloadPackageOptions {
  /** Root of the launcher's user data; the cache directory is built from it (`paths.ts`). */
  userDataPath: string
  fetchImpl?: FetchImpl
  headersTimeoutMs?: number
  stallTimeoutMs?: number
  transportRetries?: number
  retryDelayMs?: number
  onProgress?: (progress: DownloadProgress) => void
  /** Caller-owned cancellation (D4). Aborts the in-flight request and removes the `.part` file. */
  signal?: AbortSignal
  log?: DownloadLog
}

/** What happened at one URL, in order, for logging and for [[073]]'s failure log. */
export interface UrlAttempt {
  url: string
  /** Requests made against this URL: 1, plus every transport retry that was used. */
  requests: number
  outcome: 'verified' | 'verification-failed' | 'transport-failed' | 'disk-error' | 'cancelled'
  reason?: string
}

export type DownloadPackageResult =
  | {
      ok: true
      /** The verified file, `<cache>/<fileName>` - `.part` has been dropped. */
      path: string
      sizeBytes: number
      sha256: string
      /** Which URL finally served it. */
      url: string
      attempts: UrlAttempt[]
    }
  | {
      ok: false
      key: DownloadsErrorKey
      reason: string
      /**
       * True when `options.signal` stopped the download. Check this before showing `key`: a
       * cancellation is not a failure the user needs a reason for, and the fixed key set has no
       * member for "the user changed their mind".
       */
      cancelled: boolean
      attempts: UrlAttempt[]
    }

/** Outcome of a single request. `retryable` only ever means "against this same URL". */
type AttemptResult =
  | { kind: 'verified'; path: string; sizeBytes: number; sha256: string }
  | { kind: 'transport'; reason: string; retryable: boolean }
  | { kind: 'verification'; reason: string }
  | { kind: 'disk'; reason: string }
  | { kind: 'cancelled' }

/** Why *we* aborted a request, so an `AbortError` can be told apart from a dropped connection. */
type AbortKind = 'headers-timeout' | 'stall-timeout' | 'size-overrun' | 'cancelled'

/**
 * The real client. `electron` is imported lazily so that importing this module (and testing the
 * whole state machine) needs no Electron runtime; `net.fetch` uses the default session, which is
 * what makes it honour the system proxy.
 */
export const electronNetFetch: FetchImpl = async (url, init) => {
  const { net } = await import('electron')
  return net.fetch(url, init)
}

/** 408 and 429 are the server asking to be asked again; 5xx may be transient. 4xx is not. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function parseContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (raw === null) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Response bytes are transformed on the way in, so `content-length` is not the decoded size. */
function isEncoded(response: Response): boolean {
  const encoding = response.headers.get('content-encoding')
  return encoding !== null && encoding.trim() !== '' && encoding.trim().toLowerCase() !== 'identity'
}

/** Best-effort; a `.part` file that cannot be removed is truncated by the next attempt anyway. */
async function removePart(partPath: string): Promise<void> {
  try {
    await rm(partPath, { force: true })
  } catch {
    /* reported by the caller's outcome, never worth masking the real failure */
  }
}

/** Abortable sleep, so cancelling does not have to wait out a retry pause. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted === true) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * Ends a write stream and waits for `'close'`, i.e. for the file descriptor to actually be gone.
 * Both this and `discardFile()` wait, because the `.part` file is deleted immediately afterwards
 * on the failure path and Windows refuses to unlink a file that is still open.
 */
async function closeFile(file: ReturnType<typeof createWriteStream>): Promise<void> {
  if (file.closed) return
  const closed = once(file, 'close')
  file.end()
  await closed
}

async function discardFile(file: ReturnType<typeof createWriteStream>): Promise<void> {
  if (file.closed) return
  const closed = once(file, 'close').catch(() => undefined)
  file.destroy()
  await closed
}

interface AttemptContext {
  url: string
  source: PackageSource
  partPath: string
  finalPath: string
  fetchImpl: FetchImpl
  headersTimeoutMs: number
  stallTimeoutMs: number
  onProgress?: (progress: DownloadProgress) => void
  signal?: AbortSignal
}

/**
 * One request against one URL: stream it into `<name>.part` while hashing, then verify and
 * promote. Returns - never throws - so the mirror/retry state machine above stays readable.
 */
async function attemptDownload(context: AttemptContext): Promise<AttemptResult> {
  const { url, source, partPath, finalPath, fetchImpl, onProgress } = context

  if (context.signal?.aborted === true) return { kind: 'cancelled' }

  const controller = new AbortController()
  let abortKind: AbortKind | null = null

  const onExternalAbort = (): void => {
    abortKind = 'cancelled'
    controller.abort()
  }
  context.signal?.addEventListener('abort', onExternalAbort, { once: true })

  const abortWith = (kind: AbortKind): void => {
    abortKind = kind
    controller.abort()
  }

  /** Classifies a rejection: our own abort reasons first, anything else is transport. */
  const classify = (error: unknown): AttemptResult => {
    if (abortKind === 'cancelled') return { kind: 'cancelled' }
    if (abortKind === 'headers-timeout') {
      return {
        kind: 'transport',
        reason: `no response headers within ${context.headersTimeoutMs}ms`,
        retryable: true,
      }
    }
    if (abortKind === 'stall-timeout') {
      return {
        kind: 'transport',
        reason: `no bytes received for ${context.stallTimeoutMs}ms`,
        retryable: true,
      }
    }
    return { kind: 'transport', reason: String(error), retryable: true }
  }

  try {
    let response: Response
    const headersTimer = setTimeout(() => abortWith('headers-timeout'), context.headersTimeoutMs)
    try {
      response = await fetchImpl(url, { signal: controller.signal })
    } catch (error) {
      return classify(error)
    } finally {
      clearTimeout(headersTimer)
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return {
        kind: 'transport',
        reason: `HTTP ${response.status}`,
        retryable: isRetryableStatus(response.status),
      }
    }

    const totalBytes = parseContentLength(response)

    // Cheap pre-check: a mirror that declares the wrong length is serving the wrong file, and
    // finding that out after transferring 190 MB is a waste. Skipped for an encoded body, where
    // `content-length` describes the transfer and not the bytes we are going to hash.
    if (totalBytes !== null && totalBytes !== source.sizeBytes && !isEncoded(response)) {
      await response.body?.cancel().catch(() => undefined)
      return {
        kind: 'verification',
        reason: `declared content-length ${totalBytes}, package declares ${source.sizeBytes}`,
      }
    }

    if (response.body === null) {
      return { kind: 'transport', reason: 'response had no body', retryable: true }
    }

    const reader = response.body.getReader()
    const hash = createHash('sha256')
    const file = createWriteStream(partPath)
    // Without a listener, a write error is an uncaught exception rather than a failed download.
    // Collected in an array so the check below reads the real value (a captured `let` would be
    // narrowed away by the compiler).
    const writeErrors: Error[] = []
    file.on('error', (error: Error) => writeErrors.push(error))

    let received = 0
    const stallTimer = setTimeout(() => abortWith('stall-timeout'), context.stallTimeoutMs)

    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        // Bytes arrived: restart the stall clock. This - and only this - is what keeps a slow but
        // healthy transfer alive past the 30s budget.
        stallTimer.refresh()

        const value = chunk.value
        if (value === undefined || value.byteLength === 0) continue

        received += value.byteLength
        if (received > source.sizeBytes) {
          // A mirror streaming more than it promised is serving the wrong file, and is not
          // allowed to keep filling the disk while proving it.
          abortWith('size-overrun')
          throw new Error(`served more than the declared ${source.sizeBytes} bytes`)
        }

        hash.update(value)
        if (!file.write(value)) await once(file, 'drain')
        if (writeErrors.length > 0) throw writeErrors[0]

        onProgress?.({ url, receivedBytes: received, totalBytes })
      }

      clearTimeout(stallTimer)
      await closeFile(file)
      if (writeErrors.length > 0) throw writeErrors[0]
    } catch (error) {
      clearTimeout(stallTimer)
      await reader.cancel().catch(() => undefined)
      await discardFile(file)

      if (abortKind === 'size-overrun') {
        return {
          kind: 'verification',
          reason: `served more than the declared ${source.sizeBytes} bytes (got at least ${received})`,
        }
      }
      if (writeErrors.length > 0) {
        return { kind: 'disk', reason: `writing ${partPath} failed: ${String(writeErrors[0])}` }
      }
      return classify(error)
    }

    const verified = await verifyAndPromote({
      partPath,
      finalPath,
      expected: { sizeBytes: source.sizeBytes, sha256: source.sha256 },
      actualSha256: hash.digest('hex'),
      receivedBytes: received,
    })

    if (verified.ok) {
      return {
        kind: 'verified',
        path: verified.path,
        sizeBytes: verified.sizeBytes,
        sha256: verified.sha256,
      }
    }
    if (verified.key === 'downloads.error.diskWrite') {
      return { kind: 'disk', reason: verified.reason }
    }
    return { kind: 'verification', reason: `${verified.mismatch}: ${verified.reason}` }
  } finally {
    context.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Downloads `source`, verifies it against its declared size and SHA256, and returns the path of
 * the verified file in the downloads cache - or a failure key, having left no unverified file
 * behind.
 *
 * URLs are tried in order: `source.url` first, then each entry of `source.mirrors`. See the
 * module comment for what retries against one URL and what advances to the next.
 */
export async function downloadPackage(
  source: PackageSource,
  options: DownloadPackageOptions,
): Promise<DownloadPackageResult> {
  const attempts: UrlAttempt[] = []
  const log = options.log
  const transportRetries = options.transportRetries ?? DEFAULT_TRANSPORT_RETRIES
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

  let partPath: string
  let finalPath: string
  try {
    // A `fileName` originates in a manifest fetched off the internet, so the path it would build
    // is refused rather than sanitised (`paths.ts`). Nothing is requested if it is not a name.
    finalPath = getFinalPath(options.userDataPath, source.fileName)
    partPath = getPartPath(options.userDataPath, source.fileName)
    await ensureDownloadsCacheDir(options.userDataPath)
  } catch (error) {
    const reason =
      error instanceof UnsafeDownloadFileNameError
        ? error.message
        : `the downloads cache directory could not be created: ${String(error)}`
    log?.warn(`download refused before any request: ${reason}`)
    return { ok: false, key: 'downloads.error.diskWrite', reason, cancelled: false, attempts }
  }

  const urls = [source.url, ...source.mirrors]
  let lastReason = 'no URL was tried'

  for (const url of urls) {
    let requests = 0
    let result: AttemptResult = { kind: 'transport', reason: 'not attempted', retryable: false }

    for (let retry = 0; ; retry++) {
      requests += 1
      result = await attemptDownload({
        url,
        source,
        partPath,
        finalPath,
        fetchImpl: options.fetchImpl ?? electronNetFetch,
        headersTimeoutMs: options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS,
        stallTimeoutMs: options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
        ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      })

      if (result.kind !== 'verified') await removePart(partPath)
      if (result.kind !== 'transport' || !result.retryable || retry >= transportRetries) break

      log?.warn(`${url} failed (${result.reason}); retry ${retry + 1} of ${transportRetries}`)
      await delay(retryDelayMs * (retry + 1), options.signal)
      if (options.signal?.aborted === true) {
        result = { kind: 'cancelled' }
        break
      }
    }

    if (result.kind === 'verified') {
      attempts.push({ url, requests, outcome: 'verified' })
      log?.info(`verified ${source.fileName} (${result.sizeBytes} bytes) from ${url}`)
      return {
        ok: true,
        path: result.path,
        sizeBytes: result.sizeBytes,
        sha256: result.sha256,
        url,
        attempts,
      }
    }

    if (result.kind === 'cancelled') {
      attempts.push({ url, requests, outcome: 'cancelled' })
      log?.info(`download of ${source.fileName} cancelled`)
      return {
        ok: false,
        key: 'downloads.error.network',
        reason: 'the download was cancelled',
        cancelled: true,
        attempts,
      }
    }

    if (result.kind === 'disk') {
      attempts.push({ url, requests, outcome: 'disk-error', reason: result.reason })
      log?.warn(`download of ${source.fileName} stopped: ${result.reason}`)
      return {
        ok: false,
        key: 'downloads.error.diskWrite',
        reason: result.reason,
        cancelled: false,
        attempts,
      }
    }

    // Transport (retries exhausted) or verification (never retried): either way, this URL is
    // done and the next mirror gets its turn. Neither is terminal on its own.
    attempts.push({
      url,
      requests,
      outcome: result.kind === 'verification' ? 'verification-failed' : 'transport-failed',
      reason: result.reason,
    })
    lastReason = `${url}: ${result.reason}`
    log?.warn(
      result.kind === 'verification'
        ? `${url} served a file that failed verification (${result.reason}); trying the next mirror`
        : `${url} failed after ${requests} request(s) (${result.reason}); trying the next mirror`,
    )
  }

  log?.warn(`every URL for ${source.fileName} failed; last: ${lastReason}`)
  return {
    ok: false,
    key: 'downloads.error.allMirrorsFailed',
    reason: `all ${urls.length} URL(s) failed, last: ${lastReason}`,
    cancelled: false,
    attempts,
  }
}
