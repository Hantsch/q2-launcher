import type { ModCatalogEntry, ModGameDir } from '@shared/modules/mods'

/** One tile of the Mods view: a catalog entry, a local game directory, or both for one gamedir. */
export interface ModTileModel {
  /** The game directory name; the tile's identity (case-insensitive across both sources). */
  gameDir: string
  /** The catalog's display name; absent for a local-only directory. */
  name: string | null
  description: string | null
  /** The matching directory on disk, if there is one. */
  local: ModGameDir | null
  /** The catalog entry, if the gamedir is in the catalog. */
  catalog: ModCatalogEntry | null
}

/** One tile per (case-insensitive) gamedir: catalog entries first, then local-only directories. */
export function mergeModTiles(
  catalogEntries: readonly ModCatalogEntry[],
  gameDirs: readonly ModGameDir[],
): ModTileModel[] {
  const localByKey = new Map(gameDirs.map((dir) => [dir.gameDir.toLowerCase(), dir]))
  const tiles: ModTileModel[] = []
  const seen = new Set<string>()
  for (const entry of catalogEntries) {
    const key = entry.gamedir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const local = localByKey.get(key) ?? null
    tiles.push({
      gameDir: local?.gameDir ?? entry.gamedir,
      name: entry.name,
      description: entry.description,
      local,
      catalog: entry,
    })
  }
  for (const dir of gameDirs) {
    const key = dir.gameDir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tiles.push({ gameDir: dir.gameDir, name: null, description: null, local: dir, catalog: null })
  }
  return tiles
}
