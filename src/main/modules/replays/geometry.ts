const GEOMETRY = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/

export interface ParsedGeometry {
  width: number
  height: number
  x: number
  y: number
}

/** Parses the `WxH+X+Y` form the stage code emits (a negative coordinate is `+-N`); null otherwise. */
export function parseGeometry(geometry: string): ParsedGeometry | null {
  const m = GEOMETRY.exec(geometry)
  if (!m) return null
  return { width: Number(m[1]), height: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }
}
