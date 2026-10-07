import { join } from 'node:path'
import { isSafeGameName } from '@shared/mods/server-local-content'
import type { ModMapPresence } from '@shared/modules/mods'
import { isFile } from '../../lib/fs-utils'
import { asciiLower, listNames, matching, matchingChildren } from './game-dir-fs'
import { readPakDirectory } from '../../lib/pak-directory'
import { listZipEntries, type ZipDeps } from '../../lib/zip-entries'

/**
 * Story 192: does an installation have a server's map - loose, in a `.pak` or in a `.pkz`?
 *
 * The names (`gameDir`, `map`) come from a game server, i.e. from the network. They are never
 * joined onto a path: every path segment below the installation root is a name `readdir` returned,
 * matched against the wanted name ASCII-case-insensitively (so Linux finds `Baseq2/MAPS/Q2DM1.BSP`
 * too). The names are re-checked with `isSafeGameName` here as well, so this function is safe even
 * if a caller skipped the IPC schema. Unreadable folders and corrupt archives count as "not here".
 * `.pk3` is deliberately not read (not a Quake II r1q2 format).
 */

export interface MapPresenceInput {
  /** Trusted: from the installation record, never from the renderer. */
  rootPath: string
  gameDir?: string
  map: string
}

export interface MapPresenceDeps {
  zipDeps: ZipDeps
}

/** `entry` names the wanted map: `maps/<map>.bsp` after `\` -> `/`, ignoring ASCII case. */
function isMapEntry(entry: string, target: string): boolean {
  return asciiLower(entry.replace(/\\/g, '/')) === target
}

async function hasMapInGameDir(dir: string, map: string, deps: MapPresenceDeps): Promise<boolean> {
  const bspName = `${map}.bsp`
  const names = await listNames(dir)
  for (const mapsDir of matching(dir, names, 'maps')) {
    for (const file of await matchingChildren(mapsDir, bspName)) {
      if (await isFile(file)) return true
    }
  }

  const target = asciiLower(`maps/${bspName}`)
  const archives = (ext: string): string[] =>
    names.filter((n) => asciiLower(n).endsWith(ext)).map((n) => join(dir, n))

  for (const pak of archives('.pak')) {
    const listing = await readPakDirectory(pak)
    if (listing.ok && listing.names.some((n) => isMapEntry(n, target))) return true
  }
  // Last: listing a pkz spawns 7-Zip, so it only runs once everything cheaper has missed.
  for (const pkz of archives('.pkz')) {
    const listing = await listZipEntries(pkz, deps.zipDeps)
    if (listing.ok && listing.entries.some((e) => !e.isFolder && isMapEntry(e.path, target))) {
      return true
    }
  }
  return false
}

export async function mapPresence(
  input: MapPresenceInput,
  deps: MapPresenceDeps,
): Promise<ModMapPresence> {
  if (!isSafeGameName(input.map)) return { available: false }

  const wanted: string[] = []
  for (const name of [input.gameDir, 'baseq2']) {
    if (name === undefined || !isSafeGameName(name)) continue
    if (!wanted.some((w) => asciiLower(w) === asciiLower(name))) wanted.push(name)
  }

  for (const name of wanted) {
    for (const dir of await matchingChildren(input.rootPath, name)) {
      if (await hasMapInGameDir(dir, input.map, deps)) return { available: true }
    }
  }
  return { available: false }
}
