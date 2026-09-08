import {
  DOWNLOADS_HANDLERS,
  type ArchiveCacheStatus,
  type ClearArchiveCacheResult,
  type DownloadFailure,
  type DownloadsSettings,
} from '@shared/modules/downloads'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the downloads module's settings/cache handlers (story 072 D5). One function
 * per handler in its contract - mirrors `modules/library/client.ts`. */
export function getDownloadsSettings(): Promise<Outcome<DownloadsSettings>> {
  return callModule<DownloadsSettings>('downloads', DOWNLOADS_HANDLERS.getSettings)
}

export function patchDownloadsSettings(
  patch: Partial<DownloadsSettings>,
): Promise<Outcome<DownloadsSettings>> {
  return callModule<DownloadsSettings>('downloads', DOWNLOADS_HANDLERS.patchSettings, patch)
}

export function getArchiveCacheStatus(): Promise<Outcome<ArchiveCacheStatus>> {
  return callModule<ArchiveCacheStatus>('downloads', DOWNLOADS_HANDLERS.cacheStatus)
}

export function clearArchiveCache(): Promise<Outcome<ClearArchiveCacheResult>> {
  return callModule<ClearArchiveCacheResult>('downloads', DOWNLOADS_HANDLERS.clearCache)
}

/** Story 073 D3/D4: the persisted, pruned failure log (`downloads.failures`, D1/D2). */
export function getDownloadFailures(): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.failures)
}

/** Marks one failure-log entry dismissed; it stays recoverable for 7 days (D1/D2). */
export function dismissDownloadFailure(id: string): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.dismissFailure, { id })
}

/** Un-dismisses a failure-log entry, moving it back out of the dismissed history (D1/D2). */
export function restoreDownloadFailure(id: string): Promise<Outcome<DownloadFailure[]>> {
  return callModule<DownloadFailure[]>('downloads', DOWNLOADS_HANDLERS.restoreFailure, { id })
}
