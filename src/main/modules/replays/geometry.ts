const GEOMETRY = /^(\d+)x(\d+)([+-]-?\d+)([+-]-?\d+)$/

export interface ParsedGeometry {
  width: number
  height: number
  x: number
  y: number
}

/**
 * Formats `WxH+X+Y` with one sign per origin (`200x100-1920+0`): Q2PRO reads the number after a
 * single sign with strtol, so the `+-1920` form would parse as 0.
 */
export function formatGeometry(width: number, height: number, x: number, y: number): string {
  const sign = (n: number): string => (n < 0 ? `${n}` : `+${n}`)
  return `${width}x${height}${sign(x)}${sign(y)}`
}

/** Parses `WxH+X+Y` / `WxH-X+Y` (also the legacy `+-N` form for a negative origin); null otherwise. */
export function parseGeometry(geometry: string): ParsedGeometry | null {
  const m = GEOMETRY.exec(geometry)
  if (!m) return null
  return {
    width: Number(m[1]),
    height: Number(m[2]),
    x: Number(m[3]!.replace(/^[+-](?=-)/, '')),
    y: Number(m[4]!.replace(/^[+-](?=-)/, '')),
  }
}
