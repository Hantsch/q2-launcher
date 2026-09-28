/**
 * Maps a demo index row's `DemoUnreadable` (a stable reason code, never prose — see
 * `src/shared/demos/readability.ts`) to the i18n key and interpolation params the renderer needs
 * to show why a demo couldn't be read.
 */

import type { DemoUnreadable, DemoUnreadableReason } from '@shared/demos/readability'

export const UNREADABLE_REASON_KEYS: Record<DemoUnreadableReason, string> = {
  empty: 'replays.unreadable.reason.empty',
  truncated: 'replays.unreadable.reason.truncated',
  'not-a-demo': 'replays.unreadable.reason.not-a-demo',
  'unknown-protocol': 'replays.unreadable.reason.unknown-protocol',
  'header-too-large': 'replays.unreadable.reason.header-too-large',
  unreadable: 'replays.unreadable.reason.unreadable',
  'unknown-version': 'replays.unreadable.reason.unknown-version',
  'entry-too-large': 'replays.unreadable.reason.entry-too-large',
  encrypted: 'replays.unreadable.reason.encrypted',
}

export function unreadableReasonMessage(u: DemoUnreadable): {
  key: string
  params?: { protocol?: number; version?: number }
} {
  const key = UNREADABLE_REASON_KEYS[u.reason]

  const params: { protocol?: number; version?: number } = {}
  if (u.protocol !== undefined) params.protocol = u.protocol
  if (u.version !== undefined) params.version = u.version

  if (Object.keys(params).length === 0) return { key }
  return { key, params }
}
