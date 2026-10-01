import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app as electronApp } from 'electron'
import {
  DOWNLOADS_ERROR_KEYS,
  type DownloadsErrorKey,
  type PackageSource,
} from '@shared/modules/downloads'
import { resolveExtractorPath } from './7za-path'
import { extractArchive, markVerified, type ExtractorHandle } from './extractor'
import { downloadPackage, type DownloadPackageOptions } from './fetcher'
import { getExtractDir } from './pipeline'

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
  source: PackageSource
  jobId: string
  /** Distinguishes several packages staged by one job: the directory is `<jobId>-<index>`. */
  index: number
  userDataPath: string
  signal: AbortSignal
  /** Download progress in bytes. */
  onProgress?: (receivedBytes: number) => void
  /** Called with the extractor handle so the caller's cancel can kill it. */
  onExtractor?: (handle: ExtractorHandle) => void
  resolveExtractor: () => { path: string; exists: boolean }
  download?: StageDownloadFn
  extract?: StageExtractFn
  options?: Pick<DownloadPackageOptions, 'fetchImpl' | 'log'>
}

export type StagePackageResult =
  | { ok: true; archivePath: string; extractDir: string }
  | { ok: false; key: DownloadsErrorKey; cancelled: boolean }

/** Production extractor resolution, so callers outside `downloads/` never touch the 7-Zip module. */
export function resolveVendoredExtractor(): { path: string; exists: boolean } {
  return resolveExtractorPath({
    isPackaged: electronApp.isPackaged,
    resourcesPath: process.resourcesPath,
  })
}

function asErrorKey(key: string): DownloadsErrorKey {
  return (DOWNLOADS_ERROR_KEYS as readonly string[]).includes(key)
    ? (key as DownloadsErrorKey)
    : 'downloads.error.extractionFailed'
}

export async function stagePackage(input: StagePackageInput): Promise<StagePackageResult> {
  const { source, signal } = input
  const download = input.download ?? downloadPackage
  const extract = input.extract ?? extractArchive
  const cancelled: StagePackageResult = { ok: false, key: 'downloads.error.extractionFailed', cancelled: true }

  if (signal.aborted) return cancelled

  const downloaded = await download(source, {
    userDataPath: input.userDataPath,
    signal,
    ...(input.onProgress
      ? { onProgress: ({ receivedBytes }) => input.onProgress?.(receivedBytes) }
      : {}),
    ...input.options,
  })
  if (!downloaded.ok) {
    return { ok: false, key: downloaded.key, cancelled: downloaded.cancelled || signal.aborted }
  }
  if (signal.aborted) return cancelled

  const extractDir = getExtractDir(input.userDataPath, `${input.jobId}-${input.index}`)
  try {
    await mkdir(extractDir, { recursive: true })
  } catch {
    return { ok: false, key: 'downloads.error.diskWrite', cancelled: false }
  }
  if (signal.aborted) return cancelled

  const runExtract = async (archivePath: string): Promise<DownloadsErrorKey | null> => {
    const extractor = input.resolveExtractor()
    // No `await` between the cancel check and the handle being published, so a cancel cannot
    // land while the extractor runs unseen.
    const handle = extract({
      archive: markVerified(archivePath),
      extractDir,
      extractorPath: extractor.path,
      extractorExists: extractor.exists,
    })
    input.onExtractor?.(handle)
    const result = await handle.result
    if (signal.aborted) return null
    return result.ok ? null : asErrorKey(result.error.key)
  }

  const first = await runExtract(downloaded.path)
  if (signal.aborted) return cancelled
  if (first !== null) return { ok: false, key: first, cancelled: false }

  // 7-Zip reads a .tar.gz in two layers: the first pass yields only the inner .tar.
  let entries: string[]
  try {
    entries = await readdir(extractDir)
  } catch {
    return { ok: false, key: 'downloads.error.extractionFailed', cancelled: false }
  }
  if (entries.length === 1 && entries[0]!.toLowerCase().endsWith('.tar')) {
    const tarPath = join(extractDir, entries[0]!)
    const second = await runExtract(tarPath)
    if (signal.aborted) return cancelled
    if (second !== null) return { ok: false, key: second, cancelled: false }
    await rm(tarPath, { force: true }).catch(() => {})
  }

  return { ok: true, archivePath: downloaded.path, extractDir }
}
