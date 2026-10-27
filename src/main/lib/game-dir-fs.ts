import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** ASCII-only lowercase: `toLowerCase()` would fold e.g. U+212A KELVIN SIGN onto `k`. */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

export async function listNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/** Paths of the `names` (children of `dir`) equal to `wanted` ignoring ASCII case (Linux can have several). */
export function matching(dir: string, names: string[], wanted: string): string[] {
  const key = asciiLower(wanted)
  return names.filter((n) => asciiLower(n) === key).map((n) => join(dir, n))
}

export async function matchingChildren(dir: string, wanted: string): Promise<string[]> {
  return matching(dir, await listNames(dir), wanted)
}
