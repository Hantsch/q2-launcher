import type { LocalizedMessage } from './common'

/** State of the update-check service (electron-updater based). Story 097. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'upToDate' | 'available' | 'error'
  update: { version: string; notes: string; releasedAt: string | null } | null
  error: LocalizedMessage | null
  /** Any completed attempt, success or failure. */
  lastCheckedAt: string | null
  /** Drives the 24h auto-check window (AC4). */
  lastSuccessAt: string | null
  /** `false` in an unpackaged build (AC5). */
  supported: boolean
}
