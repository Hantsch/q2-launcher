/**
 * One timeout / retry / size policy for the launcher's HTTP fetches. Pure: the transport is
 * injected as `FetchImpl`, so nothing here knows about electron or any module (story 221).
 */

export type FetchImpl = (
  url: string,
  init: {
    signal: AbortSignal
    headers?: Record<string, string>
    method?: 'GET' | 'HEAD'
  },
) => Promise<Response>

export type FetchFailureKind = 'timeout' | 'aborted' | 'network' | 'http-status' | 'too-large'

export type FetchOutcome =
  | { ok: true; status: number; headers: Headers; body: Uint8Array }
  | {
      ok: false
      kind: FetchFailureKind
      status?: number
      headers?: Headers
      reason: string
    }

export type CappedBody = { ok: true; body: Uint8Array } | { ok: false; reason: string }

export interface FetchPolicy {
  fetchImpl: FetchImpl
  /** Per attempt, covering the response headers and the body read. */
  timeoutMs: number
  /** Extra attempts after the first. */
  retries: number
  maxBytes: number
  signal?: AbortSignal
  headers?: Record<string, string>
  method?: 'GET' | 'HEAD'
  retryDelayMs?: number
  onRetry?: (reason: string) => void
}

/** A never-aborting signal when none is given. */
export function composeSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const defined = signals.filter((s): s is AbortSignal => s !== undefined)
  return AbortSignal.any(defined)
}

/** Abortable sleep, so cancelling does not have to wait out a retry pause. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
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

export function describeFetchError(error: unknown, timeoutMs?: number): string {
  if (timeoutMs !== undefined && error instanceof Error && error.name === 'TimeoutError') {
    return `no response within ${timeoutMs}ms`
  }
  const cause =
    error instanceof Error && error.cause !== undefined ? ` (${String(error.cause)})` : ''
  return `${String(error)}${cause}`
}

function parseContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (raw === null) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Refuses on a declared length over the cap before reading; otherwise stops reading at the cap. */
export async function readBodyCapped(response: Response, maxBytes: number): Promise<CappedBody> {
  const declared = parseContentLength(response)
  if (declared !== null && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    return { ok: false, reason: `declared content-length ${declared} exceeds ${maxBytes} bytes` }
  }

  const stream = response.body
  if (stream === null) return { ok: true, body: new Uint8Array(0) }

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    const value = chunk.value
    if (value === undefined || value.byteLength === 0) continue

    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { ok: false, reason: `body exceeds ${maxBytes} bytes` }
    }
    chunks.push(value)
  }

  const body = new Uint8Array(received)
  let offset = 0
  for (const part of chunks) {
    body.set(part, offset)
    offset += part.byteLength
  }
  return { ok: true, body }
}

type Attempt = { outcome: FetchOutcome; retryable: boolean }

async function attemptOnce(url: string, policy: FetchPolicy): Promise<Attempt> {
  const timeoutSignal = AbortSignal.timeout(policy.timeoutMs)
  const signal = composeSignals(timeoutSignal, policy.signal)

  const failed = (error: unknown, prefix = ''): Attempt => {
    const kind =
      policy.signal?.aborted === true ? 'aborted' : timeoutSignal.aborted ? 'timeout' : 'network'
    const reason = `${prefix}${describeFetchError(error, policy.timeoutMs)}`
    return { outcome: { ok: false, kind, reason }, retryable: kind !== 'aborted' }
  }

  let response: Response
  try {
    response = await policy.fetchImpl(url, {
      signal,
      ...(policy.headers !== undefined ? { headers: policy.headers } : {}),
      ...(policy.method !== undefined ? { method: policy.method } : {}),
    })
  } catch (error) {
    return failed(error)
  }

  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel().catch(() => undefined)
    return {
      outcome: {
        ok: false,
        kind: 'http-status',
        status: response.status,
        headers: response.headers,
        reason: `HTTP ${response.status}`,
      },
      retryable: response.status >= 500,
    }
  }

  if (policy.method === 'HEAD') {
    await response.body?.cancel().catch(() => undefined)
    return {
      outcome: {
        ok: true,
        status: response.status,
        headers: response.headers,
        body: new Uint8Array(0),
      },
      retryable: false,
    }
  }

  let capped: CappedBody
  try {
    capped = await readBodyCapped(response, policy.maxBytes)
  } catch (error) {
    return failed(error, 'body could not be read: ')
  }
  if (!capped.ok) {
    return { outcome: { ok: false, kind: 'too-large', reason: capped.reason }, retryable: false }
  }
  return {
    outcome: { ok: true, status: response.status, headers: response.headers, body: capped.body },
    retryable: false,
  }
}

/** Never throws; every failure is a `FetchOutcome`. Timeout is per attempt. */
export async function fetchWithPolicy(url: string, policy: FetchPolicy): Promise<FetchOutcome> {
  let attempt = await attemptOnce(url, policy)
  for (let retry = 0; retry < policy.retries && attempt.retryable; retry++) {
    if (attempt.outcome.ok) break // type narrowing; retryable is false when ok
    policy.onRetry?.(attempt.outcome.reason)
    await delay(policy.retryDelayMs ?? 0, policy.signal)
    if (policy.signal?.aborted === true) {
      return { ok: false, kind: 'aborted', reason: 'aborted' }
    }
    attempt = await attemptOnce(url, policy)
  }
  return attempt.outcome
}
