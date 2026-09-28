import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { NON_GAME_DIRS } from '@shared/constants'
import type {
  DemoFormat,
  DemoSource,
  DiscoveredDemo,
  ReplaysExtraFolder,
} from '@shared/modules/replays'
import type { Installation } from '@shared/types'
import { canonicalizePath, listDir, pathKey } from '../../lib/fs-utils'
import type { ZipDeps } from '../../lib/zip-entries'
import { expandZip } from './zip-demos'

/**
 * Story 141 D2: finds demo files already sitting on disk, across every known installation's game
 * dirs and (on Linux, for Q2PRO) its write dir - no download, no parsing of the demo's own header
 * yet (that is a later deliverable). This file never touches `ipcMain` or persisted state; it is a
 * pure-ish scan over the filesystem, called by the module's handler.
 */

/** The subset of `Installation` this scan actually needs - keeps fixtures small in tests. */
export type DiscoverableInstallation = Pick<
  Installation,
  'id' | 'name' | 'rootPath' | 'gameDirs' | 'engineKind' | 'recordedEngineKind' | 'writeDirPath'
>

export interface DiscoverContext {
  platform: NodeJS.Platform
  homeDir: string
  zipDeps: ZipDeps
}

/** A single failed zip expansion, surfaced alongside `demos` for a later story to wire up. */
export interface ArchiveError {
  archivePath: string
  code: string
}

/** A `DiscoveredDemo` plus the real filesystem path it was found at - main-only, never crosses IPC. */
export type DiscoveredDemoFile = DiscoveredDemo & { absolutePath: string }

/**
 * Recognises a demo file by its (lowercased) name alone: `.dm2`, `.mvd2`, and their gzip-compressed
 * forms. Anything else - a sidecar like `.dm2.json`, an archive, a save file - is not a demo.
 */
export function recogniseDemoFile(name: string): { format: DemoFormat; gzip: boolean } | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.mvd2.gz')) return { format: 'mvd2', gzip: true }
  if (lower.endsWith('.dm2.gz')) return { format: 'dm2', gzip: true }
  if (lower.endsWith('.mvd2')) return { format: 'mvd2', gzip: false }
  if (lower.endsWith('.dm2')) return { format: 'dm2', gzip: false }
  return null
}

/**
 * Where Q2PRO's own write dir lives, when this installation could actually have one. Q2PRO's
 * `homedir` is a command-line-only cvar the launcher never passes (concept
 * docs/concepts/demo-browser.md §7), so the only write dir this scan ever looks at is the engine's
 * own hardcoded default, `~/.q2pro` on Linux - never `installation.writeDirPath` (that field is a
 * launcher concept, an r1q2/yquake2 "write somewhere else" override, and has nothing to do with
 * where Q2PRO itself decided to put its demos). Windows Q2PRO has no such implicit write dir, and
 * no other engine has one at all, so every other combination yields nothing.
 */
export function effectiveWriteDirs(
  installation: DiscoverableInstallation,
  { platform, homeDir }: DiscoverContext,
): string[] {
  const isQ2pro =
    installation.engineKind === 'q2pro' || installation.recordedEngineKind === 'q2pro'
  if (platform === 'linux' && isQ2pro) return [join(homeDir, '.q2pro')]
  return []
}

/** Case-insensitive lookup of a `demos` child folder; null if there is none (or the parent can't be read). */
async function findDemosDir(gameDirPath: string): Promise<string | null> {
  const listing = await listDir(gameDirPath)
  const actual = listing.byLowerName.get('demos')
  return actual ? join(gameDirPath, actual) : null
}

/**
 * Every recognised demo file directly inside `demosDir` - one level, never recursive - plus the
 * names of any `.zip` archives sitting alongside them (story 143 D3), read from the same listing.
 */
async function scanDemosDir(demosDir: string): Promise<{
  files: Array<{ fileName: string; format: DemoFormat; gzip: boolean }>
  zipFiles: string[]
}> {
  const listing = await listDir(demosDir)
  const files: Array<{ fileName: string; format: DemoFormat; gzip: boolean }> = []
  const zipFiles: string[] = []
  for (const fileName of listing.files) {
    const recognised = recogniseDemoFile(fileName)
    if (recognised) files.push({ fileName, ...recognised })
    else if (fileName.toLowerCase().endsWith('.zip')) zipFiles.push(fileName)
  }
  return { files, zipFiles }
}

/**
 * Immediate subdirectories of a write dir that look like game dirs: not one of `NON_GAME_DIRS`, and
 * carrying a `demos` child of their own. A write dir the engine never created (or that isn't
 * readable) simply has none.
 */
async function writeDirGameDirs(writeDir: string): Promise<string[]> {
  const listing = await listDir(writeDir)
  const out: string[] = []
  for (const dirName of listing.dirs) {
    if (NON_GAME_DIRS.has(dirName.toLowerCase())) continue
    const sub = await listDir(join(writeDir, dirName))
    if (sub.byLowerName.has('demos')) out.push(dirName)
  }
  return out
}

function idFor(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

interface Entry extends DiscoveredDemoFile {
  _instIndex: number
  _gameDirOrder: number
  _key: string
}

/**
 * Expands every zip archive found in one scanned folder into `entries`, tagging each row with the
 * same `_instIndex`/`_gameDirOrder` its sibling loose-file entries from that same folder get.
 * Dedup is via `seenKeys` alone (`archivePath\0entryPath`) - no shadow-by-filename handling, that
 * only applies to loose demo files. A zip `expandZip` can't even list is recorded in
 * `archiveErrors` instead of contributing rows.
 */
async function expandZipsInto(
  entries: Entry[],
  seenKeys: Set<string>,
  archiveErrors: ArchiveError[],
  demosDir: string,
  zipFiles: string[],
  source: DemoSource,
  instIndex: number,
  gameDirOrder: number,
  zipDeps: ZipDeps,
): Promise<void> {
  for (const zipFileName of zipFiles) {
    const absoluteZipPath = join(demosDir, zipFileName)
    let mtimeMs = 0
    try {
      mtimeMs = (await stat(absoluteZipPath)).mtimeMs
    } catch {
      // Unreadable stat - expandZip will very likely fail to read it too; mtimeMs simply stays 0.
    }

    const expanded = await expandZip(absoluteZipPath, source, mtimeMs, zipDeps)
    if (expanded.error) {
      archiveErrors.push({ archivePath: expanded.error.archivePath, code: expanded.error.code })
      continue
    }

    for (const row of expanded.rows) {
      const key = pathKey(absoluteZipPath) + '\u0000' + row.archiveEntry!.entryPath
      if (seenKeys.has(key)) continue
      seenKeys.add(key)
      entries.push({
        ...row,
        absolutePath: absoluteZipPath,
        _instIndex: instIndex,
        _gameDirOrder: gameDirOrder,
        _key: key,
      })
    }
  }
}

/**
 * Scans every installation's game dirs (and, where applicable, its write dir), plus every
 * user-added extra demo folder (story 142 D3), for demo files. `installations`' order is
 * precedence order: the same resolved file reachable through two installations is only ever
 * reported once, under the first installation that finds it. Within one installation and game
 * dir, a write-dir file shadows a root-dir file of the same name. Unreadable or missing folders at
 * any level simply contribute nothing - this never throws for that reason.
 *
 * `extraFolders` are scanned after every installation: an extra folder whose canonical path is
 * the same as an installation's own `demos` folder (already scanned above) is skipped entirely -
 * its files are already reported once, under the richer `installation` source - and two extra-
 * folder rows pointing at the same real folder under different spellings still yield each demo
 * only once, via the same `seenKeys` dedup installation scanning uses.
 */
export async function discoverDemos(
  installations: DiscoverableInstallation[],
  extraFolders: ReplaysExtraFolder[],
  ctx: DiscoverContext,
): Promise<{ demos: DiscoveredDemoFile[]; archiveErrors: ArchiveError[] }> {
  const seenKeys = new Set<string>()
  const canonicalInstallationDemosDirs = new Set<string>()
  const entries: Entry[] = []
  const archiveErrors: ArchiveError[] = []

  for (let instIndex = 0; instIndex < installations.length; instIndex++) {
    const installation = installations[instIndex]
    const gameDirOrder = new Map<string, number>()
    installation.gameDirs.forEach((gd, i) => gameDirOrder.set(gd, i))
    // gameDir -> fileName -> index into `entries`, root-dir hits only, for this installation.
    const rootIndex = new Map<string, Map<string, number>>()

    async function addFromDir(
      base: string,
      gameDir: string,
      isWriteDir: boolean,
    ): Promise<void> {
      const demosDir = await findDemosDir(join(base, gameDir))
      if (!demosDir) return
      const canonicalDemosDir = await canonicalizePath(demosDir)
      canonicalInstallationDemosDirs.add(pathKey(canonicalDemosDir))
      const { files, zipFiles } = await scanDemosDir(demosDir)

      for (const file of files) {
        const key = pathKey(join(canonicalDemosDir, file.fileName))
        const order = gameDirOrder.get(gameDir) ?? Number.MAX_SAFE_INTEGER

        if (isWriteDir) {
          const byFileName = rootIndex.get(gameDir)
          const rootEntryIndex = byFileName?.get(file.fileName)
          if (rootEntryIndex !== undefined) {
            // Shadow: this write-dir file replaces the root-dir entry with the same name.
            const old = entries[rootEntryIndex]
            seenKeys.delete(old._key)
            entries[rootEntryIndex] = {
              ...old,
              id: idFor(key),
              format: file.format,
              gzip: file.gzip,
              archiveEntry: null,
              map: null,
              unparsableReason: null,
              readable: true,
              unreadable: null,
              gameDir: null,
              pov: null,
              players: [],
              durationMs: null,
              fileTime: { birthtimeMs: 0, mtimeMs: 0 },
              nameFacts: null,
              absolutePath: join(demosDir, file.fileName),
              _gameDirOrder: order,
              _key: key,
            }
            seenKeys.add(key)
            continue
          }
        }

        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        entries.push({
          id: idFor(key),
          fileName: file.fileName,
          format: file.format,
          gzip: file.gzip,
          source: {
            kind: 'installation',
            installationId: installation.id,
            installationName: installation.name,
            gameDir,
          },
          archiveEntry: null,
          map: null,
          unparsableReason: null,
          readable: true,
          unreadable: null,
          gameDir: null,
          pov: null,
          players: [],
          durationMs: null,
          fileTime: { birthtimeMs: 0, mtimeMs: 0 },
          nameFacts: null,
          absolutePath: join(demosDir, file.fileName),
          _instIndex: instIndex,
          _gameDirOrder: order,
          _key: key,
        })
        if (!isWriteDir) {
          let byFileName = rootIndex.get(gameDir)
          if (!byFileName) {
            byFileName = new Map()
            rootIndex.set(gameDir, byFileName)
          }
          byFileName.set(file.fileName, entries.length - 1)
        }
      }

      const order = gameDirOrder.get(gameDir) ?? Number.MAX_SAFE_INTEGER
      await expandZipsInto(
        entries,
        seenKeys,
        archiveErrors,
        demosDir,
        zipFiles,
        { kind: 'installation', installationId: installation.id, installationName: installation.name, gameDir },
        instIndex,
        order,
        ctx.zipDeps,
      )
    }

    for (const gameDir of installation.gameDirs) {
      await addFromDir(installation.rootPath, gameDir, false)
    }

    const writeDirs = effectiveWriteDirs(installation, ctx)
    const writePairs: Array<{ writeDir: string; gameDir: string }> = []
    const extraGameDirNames = new Set<string>()
    for (const writeDir of writeDirs) {
      for (const gameDir of await writeDirGameDirs(writeDir)) {
        writePairs.push({ writeDir, gameDir })
        if (!gameDirOrder.has(gameDir)) extraGameDirNames.add(gameDir)
      }
    }
    const orderedExtras = [...extraGameDirNames].sort((a, b) => a.localeCompare(b))
    orderedExtras.forEach((gameDir, i) => gameDirOrder.set(gameDir, installation.gameDirs.length + i))

    for (const { writeDir, gameDir } of writePairs) {
      await addFromDir(writeDir, gameDir, true)
    }
  }

  for (let i = 0; i < extraFolders.length; i++) {
    const row = extraFolders[i]
    const canonical = await canonicalizePath(row.path)
    const key = pathKey(canonical)
    if (canonicalInstallationDemosDirs.has(key)) continue

    const { files, zipFiles } = await scanDemosDir(canonical)
    for (const file of files) {
      const fileKey = pathKey(join(canonical, file.fileName))
      if (seenKeys.has(fileKey)) continue
      seenKeys.add(fileKey)
      entries.push({
        id: idFor(fileKey),
        fileName: file.fileName,
        format: file.format,
        gzip: file.gzip,
        source: { kind: 'extraFolder', path: canonical },
        archiveEntry: null,
        map: null,
        unparsableReason: null,
        readable: true,
        unreadable: null,
        gameDir: null,
        pov: null,
        players: [],
        durationMs: null,
        fileTime: { birthtimeMs: 0, mtimeMs: 0 },
        nameFacts: null,
        absolutePath: join(canonical, file.fileName),
        _instIndex: installations.length + i,
        _gameDirOrder: 0,
        _key: fileKey,
      })
    }

    await expandZipsInto(
      entries,
      seenKeys,
      archiveErrors,
      canonical,
      zipFiles,
      { kind: 'extraFolder', path: canonical },
      installations.length + i,
      0,
      ctx.zipDeps,
    )
  }

  entries.sort(
    (a, b) =>
      a._instIndex - b._instIndex ||
      a._gameDirOrder - b._gameDirOrder ||
      a.fileName.localeCompare(b.fileName),
  )

  return {
    demos: entries.map(({ _instIndex, _gameDirOrder, _key, ...rest }) => rest),
    archiveErrors,
  }
}
