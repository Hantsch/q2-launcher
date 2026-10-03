import { contentRepoUrl } from '../../../lib/content-repo'
import { fetchWithPolicy, type FetchImpl } from '../../../lib/http'
import type { NewsSource } from './harness'

/**
 * Story 082, first half: retrieve `news/index.json` and the `.md` documents it references -
 * conditionally, with a 5s budget and one retry per request - and hand the raw material to the
 * caller. Validation is `feed-pipeline.ts`'s job, persistence is `feed-cache.ts`'s, deciding
 * when to fetch and what to emit is the news service's. Nothing here parses frontmatter,
 * touches the disk or reads the clock.
 *
 * ## The 304 path is the risky part, so it is spelled out
 *
 * Conditional GET is **per document** (Decisions (Sprint)): raw.githubusercontent's ETags are
 * per-file, so an index-only validator would miss an edited `.md` entirely and freeze the feed
 * forever. The ETag map therefore carries one entry per document plus one for the index
 * (`NEWS_INDEX_DOCUMENT`), and every request sends its own `If-None-Match`.
 *
 * That creates one trap worth naming, because the failure it produces is silent: **a rebuild needs
 * every document's text, but a `304` hands back no body.** The cache stores validated *slides*, not
 * raw documents, so a caller that got "index changed, documents unchanged" could not rebuild the
 * feed at all - it would have an index it cannot resolve and slides it cannot re-derive. So this
 * fetcher never returns half the material:
 *
 *  - **nothing at all changed** (index and every document answered `304`) - `{ kind: 'unchanged' }`.
 *    The caller reuses its cached slides and refreshes `retrievedAt`; nothing needs rebuilding.
 *  - **anything changed** - `{ kind: 'changed', index, documents }` with the complete set. Whatever
 *    answered `304` in the first pass, *including the index itself*, is re-requested without
 *    `If-None-Match` so the material is whole. Those extra requests only happen on a cycle that
 *    actually changed something, which is the rare cycle.
 *  - **the index could not be retrieved, or nothing changed but something failed** -
 *    `{ kind: 'failed' }`. The caller keeps its cached feed *and its old `retrievedAt`*: a feed
 *    whose documents 500ed was not successfully retrieved, and dressing it up as fresh would hide
 *    exactly the staleness that must stay visible.
 *
 * The second trap is the ETag map that comes back. `etags` on a `changed` result contains an entry
 * **only** for documents whose text is in `documents` - a document that failed has its previous
 * ETag *dropped*, deliberately. Carrying it over would mean the next refresh sends
 * `If-None-Match`, gets a `304`, concludes "unchanged", and keeps serving a cached feed that never
 * contained that entry: a permanently missing slide, with no failure anywhere to point at. An empty
 * string value means "known document, but the server named no validator" - the request then goes
 * out unconditionally, and the key still keeps the document on the map (see `knownDocuments()`).
 *
 * ## Transport
 *
 * The global `fetch` (Node/Electron built-in), like `src/main/lib/content-repo.ts` uses for
 * manifests - not `net.fetch`, which would need an Electron runtime for a JSON GET. `fetchImpl` is
 * an injection seam for the news service's tests; this module's own tests use the real `fetch` pointed at
 * a `node:http` server on `127.0.0.1`, so no test mocks the global.
 *
 * The retry budget is exactly one extra request, immediately, and only for a timeout, a network
 * error or a 5xx (Decisions (Sprint)). A 4xx is a content mistake - a renamed or missing document -
 * and a second identical request cannot fix it.
 */

/** ETag-map key for the index. Contains a slash, which `isSafeNewsDocumentName()` forbids in a
 * document name, so no `.md` entry can ever collide with it. */
export const NEWS_INDEX_DOCUMENT = 'news/index.json'

/** Repo directory both the index and every entry document live in (concept §6). */
export const NEWS_DIRECTORY = 'news'

/** Per-request budget. Decisions (Sprint): ~5s. */
export const NEWS_FETCH_TIMEOUT_MS = 5_000

/** Extra requests after a retryable failure. Decisions (Sprint): 1. */
export const NEWS_FETCH_RETRIES = 1

/** Cap per news document (index or `.md`); the feed is foreign content read fully into memory. */
export const NEWS_DOCUMENT_MAX_BYTES = 1024 * 1024

/**
 * An index entry's `file` is foreign content used to build a URL, so it is refused unless it is one
 * boring path segment: ASCII letters/digits/`_`/`.`/`-`, starting with a letter or digit. That rules
 * out traversal (`..`), an absolute path, a scheme (`https://evil/x.md` - the `:` and `/` fail) and
 * a query in one check. Same shape as `isSafeDownloadFileName()` (`lib/net/download-cache-paths.ts`) and the mod
 * directory token in `docs/ARCHITECTURE.md`'s "Paths are never trusted"; the device-name rule is
 * absent because nothing here becomes a file name on disk.
 */
const SAFE_DOCUMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

const MAX_DOCUMENT_NAME_LENGTH = 200

export function isSafeNewsDocumentName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_DOCUMENT_NAME_LENGTH && SAFE_DOCUMENT_NAME.test(name)
}

/** Satisfied by both the global `fetch` and Electron's `net.fetch`; see the module comment. */
export type NewsFetchImpl = FetchImpl

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`); kept minimal for the tests. */
export interface NewsFetchLog {
  info(message: string): void
  warn(message: string): void
}

/** How one document's text was obtained on this cycle. Reported for the caller's log line only -
 * `refreshed` (answered `304`, then re-requested unconditionally because something else changed) is
 * indistinguishable from `fetched` as far as the feed is concerned. */
export type NewsDocumentStatus = 'fetched' | 'refreshed' | 'failed'

export interface NewsDocumentFailure {
  file: string
  reason: string
}

/** Something changed: the caller has to re-run `buildFeed()` on this complete material. */
export interface ChangedNewsFetch {
  kind: 'changed'
  /** The parsed `news/index.json`. `unknown` on purpose - it is foreign JSON, and `buildFeed()`
   * takes it exactly like this. */
  index: unknown
  /** Raw `.md` text keyed by the index's own `file` value, ready for `buildFeed({ documents })`. */
  documents: Record<string, string>
  /** The map to persist next to the rebuilt feed: the index plus every document in `documents`,
   * and nothing else. See the module comment on why a failed document is left out. */
  etags: Record<string, string>
  /** Per document, including the ones that failed. */
  statuses: Record<string, NewsDocumentStatus>
  /** `refreshed` when the index answered `304` and was re-requested for its body. */
  indexStatus: 'fetched' | 'refreshed'
  /** Documents the index references that could not be retrieved. Not fatal: the rest of the feed
   * still arrives, and the pipeline drops the entries whose text is missing. */
  failures: NewsDocumentFailure[]
}

/** Index and every referenced document answered `304`: the cached slides are still current. */
export interface UnchangedNewsFetch {
  kind: 'unchanged'
  /** Unchanged from what was passed in - returned so the caller can persist one shape either way. */
  etags: Record<string, string>
}

/** No usable material. The caller keeps its cached feed and its `retrievedAt`. */
export interface FailedNewsFetch {
  kind: 'failed'
  reason: string
  /** The map that was passed in, untouched: the caller still holds the feed it belongs to. */
  etags: Record<string, string>
}

/** `resolveNewsSource()` said `skip`; not a single request was made. */
export interface SkippedNewsFetch {
  kind: 'skipped'
}

export type FetchNewsResult =
  ChangedNewsFetch | UnchangedNewsFetch | FailedNewsFetch | SkippedNewsFetch

export interface FetchNewsDocumentsOptions {
  /** From `resolveNewsSource()`. `skip` answers `{ kind: 'skipped' }` without a request. */
  source: NewsSource
  /** The cache's ETag map: `NEWS_INDEX_DOCUMENT` plus one key per known document. */
  etags?: Readonly<Record<string, string>>
  timeoutMs?: number
  retries?: number
  fetchImpl?: NewsFetchImpl
  log?: NewsFetchLog
}

interface ResolvedOptions {
  timeoutMs: number
  retries: number
  fetchImpl: NewsFetchImpl
  log?: NewsFetchLog
}

/** One request's outcome. */
type RequestOutcome =
  | { kind: 'ok'; text: string; etag: string }
  | { kind: 'not-modified' }
  | { kind: 'failed'; reason: string }

const defaultFetchImpl: NewsFetchImpl = (url, init) => fetch(url, init)

/** One request plus, for a timeout/network/5xx failure, exactly `options.retries` more. */
async function request(
  url: string,
  etag: string | undefined,
  options: ResolvedOptions,
): Promise<RequestOutcome> {
  // An empty stored value means "known document, no validator" - the request then goes out
  // unconditionally rather than with a meaningless `If-None-Match: `.
  const headers: Record<string, string> =
    etag !== undefined && etag !== '' ? { 'if-none-match': etag } : {}

  const outcome = await fetchWithPolicy(url, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    maxBytes: NEWS_DOCUMENT_MAX_BYTES,
    headers,
    onRetry: (reason) => options.log?.warn(`news: ${url} failed (${reason}); retrying once`),
  })
  if (outcome.ok) {
    return {
      kind: 'ok',
      text: new TextDecoder().decode(outcome.body),
      etag: outcome.headers.get('etag') ?? '',
    }
  }
  if (outcome.kind === 'http-status' && outcome.status === 304) return { kind: 'not-modified' }
  return { kind: 'failed', reason: outcome.reason }
}

/** The base every news URL is built on: the production content repo, or the harness's loopback. */
function baseUrlFor(source: NewsSource): string | undefined {
  return source.kind === 'loopback' ? source.base : undefined
}

function documentUrl(file: string, base: string | undefined): string {
  return contentRepoUrl(`${NEWS_DIRECTORY}/${file}`, base)
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

/**
 * The document names an index refers to, in index order, deduplicated and safety-checked. Never
 * throws and never rejects the whole index: a malformed row is skipped here and dropped with a
 * warning by `buildFeed()`, which is the one place that reports on entries.
 */
function referencedDocuments(index: unknown, log?: NewsFetchLog): string[] {
  if (typeof index !== 'object' || index === null) return []
  const entries = (index as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []

  const files: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = (entry as { file?: unknown }).file
    if (typeof raw !== 'string') continue
    const file = raw.trim()
    if (!isSafeNewsDocumentName(file)) {
      log?.warn(
        `news: refused document name ${JSON.stringify(raw)}; not a single safe path segment`,
      )
      continue
    }
    if (seen.has(file)) continue
    seen.add(file)
    files.push(file)
  }
  return files
}

/**
 * The documents the previous cycle knew about - the only way to learn the document list when the
 * index answers `304`, since a `304` carries no body. Every document that reached the cache has a
 * key here, with an empty value when the server named no ETag, which is what keeps this list
 * complete rather than "the documents that happened to have a validator".
 */
function knownDocuments(etags: Readonly<Record<string, string>>): string[] {
  return Object.keys(etags).filter(
    (key) => key !== NEWS_INDEX_DOCUMENT && isSafeNewsDocumentName(key),
  )
}

/**
 * Fetches the news feed's raw material. See the module comment for the four possible results and
 * why a partial one is never among them.
 */
export async function fetchNewsDocuments(
  options: FetchNewsDocumentsOptions,
): Promise<FetchNewsResult> {
  const previous: Record<string, string> = { ...(options.etags ?? {}) }

  // Defensive: the news service is expected not to call this at all under a `skip` source, but "the news fetch
  // makes no outbound request in a harness run" is a promise worth keeping in the one place
  // that would make the request, not only in the one place that decides to.
  if (options.source.kind === 'skip') {
    options.log?.info('news: fetch skipped (ui-harness gate open, no loopback base named)')
    return { kind: 'skipped' }
  }

  const resolved: ResolvedOptions = {
    timeoutMs: options.timeoutMs ?? NEWS_FETCH_TIMEOUT_MS,
    retries: options.retries ?? NEWS_FETCH_RETRIES,
    fetchImpl: options.fetchImpl ?? defaultFetchImpl,
    ...(options.log !== undefined ? { log: options.log } : {}),
  }
  const base = baseUrlFor(options.source)
  const indexUrl = contentRepoUrl(NEWS_INDEX_DOCUMENT, base)

  const firstIndex = await request(indexUrl, previous[NEWS_INDEX_DOCUMENT], resolved)
  if (firstIndex.kind === 'failed') {
    return {
      kind: 'failed',
      reason: `${NEWS_INDEX_DOCUMENT}: ${firstIndex.reason}`,
      etags: previous,
    }
  }

  let index: unknown
  let indexEtag = ''
  let indexStatus: 'fetched' | 'refreshed' = 'fetched'
  if (firstIndex.kind === 'ok') {
    const parsed = parseJson(firstIndex.text)
    if (!parsed.ok) {
      // Not retryable and not a transport problem: the file that is there is not JSON.
      return {
        kind: 'failed',
        reason: `${NEWS_INDEX_DOCUMENT}: response was not valid JSON`,
        etags: previous,
      }
    }
    index = parsed.value
    indexEtag = firstIndex.etag
  }

  const candidates =
    firstIndex.kind === 'ok' ? referencedDocuments(index, options.log) : knownDocuments(previous)

  const firstPass = new Map<string, RequestOutcome>()
  for (const file of candidates) {
    firstPass.set(file, await request(documentUrl(file, base), previous[file], resolved))
  }

  const changed =
    firstIndex.kind === 'ok' || [...firstPass.values()].some((outcome) => outcome.kind === 'ok')

  if (!changed) {
    // The index answered `304` and so did every document, so the cached slides are exactly right.
    // Unless something failed: then this cycle retrieved nothing, and saying "unchanged" would let
    // the caller refresh `retrievedAt` on a feed it did not actually manage to confirm.
    const failed = [...firstPass.entries()].find(([, outcome]) => outcome.kind === 'failed')
    if (failed !== undefined) {
      const [file, outcome] = failed
      const reason = outcome.kind === 'failed' ? outcome.reason : 'unknown'
      return { kind: 'failed', reason: `${file}: ${reason}`, etags: previous }
    }
    return { kind: 'unchanged', etags: previous }
  }

  // Something changed, so the whole feed gets rebuilt - and `buildFeed()` needs every document's
  // text, not just the changed ones. The index goes first: without its body there is no entry list
  // to rebuild from at all.
  if (firstIndex.kind === 'not-modified') {
    const again = await request(indexUrl, undefined, resolved)
    if (again.kind !== 'ok') {
      const reason = again.kind === 'failed' ? again.reason : 'unexpected 304 without a validator'
      return { kind: 'failed', reason: `${NEWS_INDEX_DOCUMENT}: ${reason}`, etags: previous }
    }
    const parsed = parseJson(again.text)
    if (!parsed.ok) {
      return {
        kind: 'failed',
        reason: `${NEWS_INDEX_DOCUMENT}: response was not valid JSON`,
        etags: previous,
      }
    }
    index = parsed.value
    indexEtag = again.etag
    indexStatus = 'refreshed'
  }

  // Re-read from the index body rather than reusing `candidates`: after a `refreshed` index the
  // body is the authority on which documents exist, and it may name one the ETag map never had.
  const files = referencedDocuments(index, options.log)
  const documents: Record<string, string> = {}
  const etags: Record<string, string> = { [NEWS_INDEX_DOCUMENT]: indexEtag }
  const statuses: Record<string, NewsDocumentStatus> = {}
  const failures: NewsDocumentFailure[] = []

  for (const file of files) {
    const first = firstPass.get(file)
    let outcome = first
    let status: NewsDocumentStatus = 'fetched'

    if (first === undefined) {
      // A document the refreshed index names but the first pass never saw. Unconditional: there is
      // no cached slide it could belong to, so a `304` here would leave nothing to rebuild with.
      outcome = await request(documentUrl(file, base), undefined, resolved)
    } else if (first.kind === 'not-modified') {
      // Unconditional on purpose: the first pass proved the content is the cached one, this pass
      // is only about having the text to rebuild with.
      outcome = await request(documentUrl(file, base), undefined, resolved)
      status = 'refreshed'
    }

    if (outcome === undefined || outcome.kind !== 'ok') {
      const reason =
        outcome !== undefined && outcome.kind === 'failed'
          ? outcome.reason
          : 'the document could not be retrieved'
      // Its previous ETag is deliberately NOT carried over - see the module comment.
      statuses[file] = 'failed'
      failures.push({ file, reason })
      options.log?.warn(`news: ${file} could not be retrieved (${reason}); entry dropped`)
      continue
    }

    documents[file] = outcome.text
    etags[file] = outcome.etag
    statuses[file] = status
  }

  return { kind: 'changed', index, documents, etags, statuses, indexStatus, failures }
}
