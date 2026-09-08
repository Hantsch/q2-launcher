import {
  DOWNLOADS_HANDLERS,
  type ArchiveCacheStatus,
  type ClearArchiveCacheResult,
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
