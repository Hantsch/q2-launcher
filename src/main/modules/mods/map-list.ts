import { join } from 'node:path'
import { isSafeGameName } from '@shared/mods/server-local-content'
import type { ModMapList } from '@shared/modules/mods'
import type { EngineKind } from '@shared/types/engine'
import { readBspTitle } from '../../lib/bsp-title'
import { isFile } from '../../lib/fs-utils'
import { readPakDirectory } from '../../lib/pak-directory'
import { listZipEntries, type ZipDeps } from '../../lib/zip-entries'
import { asciiLower, listNames, matching, matchingChildren } from './game-dir-fs'

/**
 * The maps a player can start in a mod: loose `maps/<name>.bsp`, then `.pak` entries, then `.pkz`
 * entries (not for r1q2, which cannot read them), in the mod's folder first and `baseq2` second.
 *
 * Like `mapPresence`, no path segment below the root is ever taken from the caller: folders are
 * matched ASCII-case-insensitively against names `readdir` returned. Names inside archives are
 * archive content, so a stem must pass `isSafeGameName` before it is offered. Unreadable folders and
 * corrupt archives are skipped. (story 249)
 */

export interface MapListInput {
  /** Trusted: from the installation record, never from the renderer. */
  rootPath: string
  gameDir: string
  engineKind: EngineKind
}

export interface MapListDeps {
  zipDeps: ZipDeps
}

type Found = Map<string, { name: string; title?: string }>

/** The stem of `maps/<stem>.bsp` (after `\` -> `/`, ASCII case-insensitive, no deeper folder), if it is one. */
function mapStem(entry: string): string | undefined {
  const match = /^maps\/([^/]+)\.bsp$/i.exec(entry.replace(/\\/g, '/'))
  return match && isSafeGameName(match[1]) ? match[1] : undefined
}

function add(found: Found, stem: string, title: string | undefined): void {
  const key = asciiLower(stem)
  if (!found.has(key)) found.set(key, title === undefined ? { name: stem } : { name: stem, title })
}

async function collectGameDir(
  dir: string,
  found: Found,
  engineKind: EngineKind,
  deps: MapListDeps,
): Promise<void> {
  const names = await listNames(dir)
  for (const mapsDir of matching(dir, names, 'maps')) {
    for (const file of await listNames(mapsDir)) {
      const stem = mapStem(`maps/${file}`)
      if (stem === undefined || found.has(asciiLower(stem))) continue
      const path = join(mapsDir, file)
      if (await isFile(path)) add(found, stem, await readBspTitle(path))
    }
  }

  const archives = (ext: string): string[] =>
    names.filter((n) => asciiLower(n).endsWith(ext)).map((n) => join(dir, n))

  for (const pak of archives('.pak')) {
    const listing = await readPakDirectory(pak)
    if (!listing.ok) continue
    for (const entry of listing.entries) {
      const stem = mapStem(entry.name)
      if (stem === undefined || found.has(asciiLower(stem))) continue
      add(found, stem, await readBspTitle(pak, entry.offset, entry.offset + entry.length))
    }
  }
  if (engineKind === 'r1q2') return
  for (const pkz of archives('.pkz')) {
    const listing = await listZipEntries(pkz, deps.zipDeps)
    if (!listing.ok) continue
    for (const entry of listing.entries) {
      const stem = entry.isFolder ? undefined : mapStem(entry.path)
      if (stem !== undefined) add(found, stem, undefined)
    }
  }
}

export async function listMaps(input: MapListInput, deps: MapListDeps): Promise<ModMapList> {
  const wanted: string[] = []
  for (const name of [input.gameDir, 'baseq2']) {
    if (name === '' || !isSafeGameName(name)) continue
    if (!wanted.some((w) => asciiLower(w) === asciiLower(name))) wanted.push(name)
  }

  const found: Found = new Map()
  for (const name of wanted) {
    for (const dir of await matchingChildren(input.rootPath, name)) {
      await collectGameDir(dir, found, input.engineKind, deps)
    }
  }
  const maps = [...found.values()].sort((a, b) => {
    const x = asciiLower(a.name)
    const y = asciiLower(b.name)
    return x < y ? -1 : x > y ? 1 : 0
  })
  return { maps }
}
