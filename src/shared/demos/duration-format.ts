/**
 * Formats a demo's playback duration for display.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 *
 * `ms` is untrusted-ish derived data (a parsed frame count times a frame duration), so this
 * never throws: `null`, `undefined`, `NaN`, `+Infinity`/`-Infinity` and any value `<= 0` all
 * resolve to the `unknown` case rather than a guessed or zero duration. The `unknown` case is
 * rendered by the demo list (shipping in S27, not this sprint) via the i18n key
 * `replays.duration.unknown` — this module only decides which case applies, never any text
 * for it.
 */
export type FormattedDemoDuration = { kind: 'known'; text: string } | { kind: 'unknown' }

export function formatDemoDuration(ms: number | null | undefined): FormattedDemoDuration {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) {
    return { kind: 'unknown' }
  }

  const totalSeconds = Math.max(1, Math.round(ms / 1000))

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return { kind: 'known', text: `${minutes}:${String(seconds).padStart(2, '0')}` }
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return {
    kind: 'known',
    text: `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  }
}
