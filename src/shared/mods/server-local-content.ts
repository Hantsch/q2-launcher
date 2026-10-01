/**
 * What a server's mod and map mean for the local installation: do I have the mod, can I get it,
 * and which gamedir should a map lookup use. Pure (no node/DOM/electron) so main and renderer
 * share one rule, including the catalog-entry-by-gamedir matcher.
 */
const SAFE_GAME_NAME = /^[A-Za-z0-9_.-]{1,64}$/

/** A single folder/file-stem name that can never escape its directory. Unlike
 * `isSafeGameDirName` it admits `baseq2`, so it also fits map names and the base game. */
export function isSafeGameName(value: string): boolean {
  if (typeof value !== 'string') return false
  if (!SAFE_GAME_NAME.test(value)) return false
  return value !== '.' && value !== '..'
}

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

export interface CatalogGameDirEntry {
  id: string
  gameDir: string
}

/** The catalog entry whose gamedir equals `gameDir` (ASCII case-insensitive); safe names only. */
export function findCatalogEntryByGameDir<T extends CatalogGameDirEntry>(
  catalog: readonly T[] | null,
  gameDir: string
): T | null {
  if (!catalog || !isSafeGameName(gameDir)) return null
  const want = asciiLower(gameDir)
  return catalog.find((e) => asciiLower(e.gameDir) === want) ?? null
}

export type ServerModStatus =
  | { kind: 'base' }
  | { kind: 'installed'; gameDir: string }
  | { kind: 'missing'; gameDir: string; safe: boolean; catalogId: string | null }

export function serverModStatus(input: {
  serverMod: string | undefined
  gameDirs: readonly string[]
  catalog: readonly CatalogGameDirEntry[] | null
}): ServerModStatus {
  const mod = (input.serverMod ?? '').trim()
  if (mod === '' || asciiLower(mod) === 'baseq2') return { kind: 'base' }
  const safe = isSafeGameName(mod)
  if (safe) {
    const want = asciiLower(mod)
    const hit = input.gameDirs.find((d) => asciiLower(d) === want)
    if (hit !== undefined) return { kind: 'installed', gameDir: hit }
  }
  const entry = safe ? findCatalogEntryByGameDir(input.catalog, mod) : null
  return { kind: 'missing', gameDir: mod, safe, catalogId: entry ? entry.id : null }
}

export function mapLookupTarget(
  status: ServerModStatus,
  map: string | undefined
): { map: string; gameDir?: string } | null {
  if (!map || !isSafeGameName(map)) return null
  if (status.kind === 'installed') return { map, gameDir: status.gameDir }
  if (status.kind === 'missing' && status.safe) return { map, gameDir: status.gameDir }
  return { map }
}
