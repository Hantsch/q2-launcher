import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DOWNLOADS_ERROR_KEYS, type DownloadsErrorKey } from '@shared/modules/downloads'
import { resolveExtractorPath } from '../lib/archive/7za-path'
import { extractArchive, markVerified, type ExtractorHandle } from '../lib/archive/extractor'
import {
  downloadPackage,
  type DownloadPackageOptions,
  type DownloadSource,
  type UrlAttempt,
} from '../lib/net/fetcher'
import { getDownloadsCacheDir } from '../lib/net/download-cache-paths'

/**
 * Story 190 D3: download one package into the downloads cache, verify it, and extract it into a
 * staging directory (`cache/downloads/extract/<jobId>-<index>`). It is the download/extract section
 * of `engine/update-job.ts` without the job: the caller owns the job (creation, progress, finish,
 * cancel wiring) and the staging directory's cleanup. Nothing is written outside the downloads
 * cache, and the extractor is never spawned for a download that failed or was not verified.
 */

export type StageDownloadFn = typeof downloadPackage
export type StageExtractFn = typeof extractArchive

export interface StagePackageInput {
  /** Without a `sha256` only `verify: { sizeOnly: true }` can succeed. */
  source: DownloadSource
  jobId: string
  /** Distinguishes several packages staged by one job: the directory is `<jobId>-<index>`. */
  index: number
  /** Overrides the `<jobId>-<index>` directory, for a caller that owns (and cleans up) its own staging path. */
  extractDir?: string
  verify?: DownloadPackageOptions['verify']
  userDataPath: string
  signal: AbortSignal
  /** Download progress in bytes. */
  onProgress?: (receivedBytes: number) => void
  /** Extraction progress (0-1), or `null` when the extractor's output did not parse. */
  onExtractProgress?: (ratio: number | null) => void
  /** Called with the extractor handle so the caller's cancel can kill it. */
  onExtractor?: (handle: ExtractorHandle) => void
  resolveExtractor: () => { path: string; exists: boolean }
  download?: StageDownloadFn
  extract?: StageExtractFn
  options?: Pick<DownloadPackageOptions, 'fetchImpl' | 'log'>
}

type StageFailure = {
  ok: false
  key: DownloadsErrorKey
  cancelled: boolean
  stage: 'download' | 'prepare' | 'extract'
  reason: string
  /** Download failures only: every URL tried. */
  attempts?: UrlAttempt[]
  /** The last URL tried (download), or the one the verified archive came from (prepare/extract). */
  url?: string
  /** Prepare/extract failures only: the verified archive's size. */
  sizeBytes?: number
  /** Extract failures only: the extractor's own key, before `key` narrowed it to the fixed set. */
  extractorKey?: string
}

export type StagePackageResult =
  | { ok: true; archivePath: string; extractDir: string; url: string; sizeBytes: number }
  | StageFailure

/** Production extractor resolution, so callers outside `downloads/` never touch the 7-Zip module. */
export function resolveVendoredExtractor(isPackaged: boolean): { path: string; exists: boolean } {
  return resolveExtractorPath({
    isPackaged,
    resourcesPath: process.resourcesPath,
  })
}

/** Directory segment under the downloads cache that holds one directory per job. */
export const EXTRACT_SEGMENT = 'extract'

/** Job ids are `randomUUID()`s from main; the guard keeps a future caller-supplied id out of the
 * path anyway - the same "refuse, do not sanitise" stance `download-cache-paths.ts` takes for a file name. */
const SAFE_JOB_ID = /^[A-Za-z0-9_-]{1,64}$/

/** `userData/cache/downloads/extract/<jobId>` (Decisions (Sprint), "Paths"). */
export function getExtractDir(userDataPath: string, jobId: string): string {
  if (!SAFE_JOB_ID.test(jobId)) throw new Error(`refused job id ${JSON.stringify(jobId)}`)
  return join(getDownloadsCacheDir(userDataPath), EXTRACT_SEGMENT, jobId)
}

/**
 * The extractor's `Outcome` carries a plain string, so only a member of the fixed set may reach a
 * job; anything else is `downloads.error.extractionFailed`.
 */
export function asExtractionErrorKey(key: string): DownloadsErrorKey {
  return (DOWNLOADS_ERROR_KEYS as readonly string[]).includes(key)
    ? (key as DownloadsErrorKey)
    : 'downloads.error.extractionFailed'
}

export async function stagePackage(input: StagePackageInput): Promise<StagePackageResult> {
  const { source, signal } = input
  const download = input.download ?? downloadPackage
  const extract = input.extract ?? extractArchive
  const cancelled: StagePackageResult = {
    ok: false,
    key: 'downloads.error.extractionFailed',
    cancelled: true,
    stage: 'prepare',
    reason: 'cancelled',
  }

  if (signal.aborted) return cancelled

  const downloaded = await download(source, {
    userDataPath: input.userDataPath,
    signal,
    ...(input.verify ? { verify: input.verify } : {}),
    ...(input.onProgress
      ? { onProgress: ({ receivedBytes }) => input.onProgress?.(receivedBytes) }
      : {}),
    ...input.options,
  })
  if (!downloaded.ok) {
    return {
      ok: false,
      key: downloaded.key,
      cancelled: downloaded.cancelled || signal.aborted,
      stage: 'download',
      reason: downloaded.reason,
      attempts: downloaded.attempts,
      ...(downloaded.attempts.length > 0
        ? { url: downloaded.attempts[downloaded.attempts.length - 1]!.url }
        : {}),
    }
  }
  if (signal.aborted) return cancelled

  const extractDir =
    input.extractDir ?? getExtractDir(input.userDataPath, `${input.jobId}-${input.index}`)
  try {
    await mkdir(extractDir, { recursive: true })
  } catch (error) {
    return {
      ok: false,
      key: 'downloads.error.diskWrite',
      cancelled: false,
      stage: 'prepare',
      reason: `mkdir ${extractDir} failed: ${String(error)}`,
      url: downloaded.url,
      sizeBytes: downloaded.sizeBytes,
    }
  }
  if (signal.aborted) return cancelled

  const extractFailure = (extractorKey: string, archivePath: string): StageFailure => {
    const key = asExtractionErrorKey(extractorKey)
    return {
      ok: false,
      key,
      cancelled: false,
      stage: 'extract',
      reason: `extracting ${archivePath} failed with ${key}`,
      url: downloaded.url,
      sizeBytes: downloaded.sizeBytes,
      extractorKey,
    }
  }

  /** Resolves to the extractor's raw error key, or `null` for success or a cancel. */
  const runExtract = async (archivePath: string): Promise<string | null> => {
    const extractor = input.resolveExtractor()
    // No `await` between the cancel check and the handle being published, so a cancel cannot
    // land while the extractor runs unseen.
    const handle = extract({
      archive: markVerified(archivePath),
      extractDir,
      extractorPath: extractor.path,
      extractorExists: extractor.exists,
      ...(input.onExtractProgress
        ? { onProgress: (ratio) => input.onExtractProgress?.(ratio ?? null) }
        : {}),
    })
    input.onExtractor?.(handle)
    const result = await handle.result
    if (signal.aborted) return null
    return result.ok ? null : result.error.key
  }

  const first = await runExtract(downloaded.path)
  if (signal.aborted) return cancelled
  if (first !== null) return extractFailure(first, downloaded.path)

  // 7-Zip reads a .tar.gz in two layers: the first pass yields only the inner .tar.
  let entries: string[]
  try {
    entries = await readdir(extractDir)
  } catch (error) {
    return {
      ...extractFailure('downloads.error.extractionFailed', extractDir),
      reason: `reading ${extractDir} failed: ${String(error)}`,
    }
  }
  if (entries.length === 1 && entries[0]!.toLowerCase().endsWith('.tar')) {
    const tarPath = join(extractDir, entries[0]!)
    const second = await runExtract(tarPath)
    if (signal.aborted) return cancelled
    if (second !== null) return extractFailure(second, tarPath)
    await rm(tarPath, { force: true }).catch(() => {})
  }

  return {
    ok: true,
    archivePath: downloaded.path,
    extractDir,
    url: downloaded.url,
    sizeBytes: downloaded.sizeBytes,
  }
}
