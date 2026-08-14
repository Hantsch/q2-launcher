import type { EngineKind } from '@shared/types'

/**
 * Display formatting. Numbers go through `Intl` so they follow the user's
 * locale; the unit suffixes are stable across languages on purpose - MB is MB.
 */

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '-'
  if (bytes >= GB) return `${round(bytes / GB, 2)} GB`
  if (bytes >= MB) return `${round(bytes / MB, 0)} MB`
  if (bytes >= KB) return `${round(bytes / KB, 0)} KB`
  return `${Math.round(bytes)} B`
}

export function formatSpeed(bytesPerSecond: number | undefined): string {
  if (bytesPerSecond === undefined || bytesPerSecond <= 0) return '-'
  if (bytesPerSecond >= MB) return `${round(bytesPerSecond / MB, 1)} MB/s`
  return `${round(bytesPerSecond / KB, 0)} KB/s`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value))
}

export function formatPercent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`
}

/** Compact duration: `45s`, `12m`, `3h 20m`. */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '-'
  const total = Math.round(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** `2 days ago`, `just now`. Returns null for a missing timestamp. */
export function formatRelativeTime(iso: string | undefined): string | null {
  if (!iso) return null
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return null

  const deltaSeconds = (timestamp - Date.now()) / 1000
  const absolute = Math.abs(deltaSeconds)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  for (const [unit, unitSeconds] of RELATIVE_UNITS) {
    if (absolute >= unitSeconds) {
      return formatter.format(Math.round(deltaSeconds / unitSeconds), unit)
    }
  }
  return formatter.format(Math.round(deltaSeconds), 'second')
}

/**
 * Middle-truncates a path so both the drive and the folder name survive:
 * `C:\Program Files (x86)\Steam\...\Quake 2`.
 */
export function shortenPath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path
  const separator = path.includes('\\') ? '\\' : '/'
  const parts = path.split(separator)
  if (parts.length <= 2) return `\u2026${path.slice(-(maxLength - 1))}`

  const head = parts[0]
  const tail = parts[parts.length - 1]
  return `${head}${separator}\u2026${separator}${tail}`
}

/**
 * Two-character code for the engine an installation runs.
 *
 * Preferred over initials from the name: it is stable, meaningful and identical
 * for every install of the same client, which is what makes the rail scannable.
 */
const ENGINE_TILE_CODES: Partial<Record<EngineKind, string>> = {
  r1q2: 'R1',
  q2pro: 'QP',
  yquake2: 'YQ',
  kmquake2: 'KM',
  vkquake2: 'VK',
  q2rtx: 'RT',
  remaster: 'RM',
  vanilla: 'Q2',
}

export function tileCode(engineKind: EngineKind, name: string): string {
  return ENGINE_TILE_CODES[engineKind] ?? initialsFor(name)
}

/** Fallback badge for an installation whose engine is unknown, e.g. `CT`. */
export function initialsFor(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim()
  if (cleaned.length === 0) return 'Q2'

  const words = cleaned.split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

function round(value: number, digits: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value)
}
