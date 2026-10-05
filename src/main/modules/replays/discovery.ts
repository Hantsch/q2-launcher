import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { NON_GAME_DIRS } from '@shared/constants'
import {
  demoSourceKey,
  type DemoFormat,
  type DemoSource,
  type DiscoveredDemo,
  type ReplaysExtraFolder,
  type ReplaysSourceError,
} from '@shared/modules/replays'
import type { DiscoveredFolder } from '@shared/replays/demo-folders'
import type { Installation } from '@shared/types'
import {
  canonicalizePath,
  listDir,
  listDirOrReason,
  pathKey,
  type DirListing,
} from '../../lib/fs-utils'
import type { ZipDeps } from '../../lib/zip-entries'
import { LAUNCHER_DIR_NAME } from './demo-staging'
import { expandZip } from './zip-demos'

/**
 * Story 141: finds demo files already sitting on disk, across every known installation's game
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

/** A `DiscoveredDemo` plus the real filesystem path it was found at - main-only, never crosses IPC. */
export type DiscoveredDemoFile = DiscoveredDemo & { absolutePath: string }

/**
 * One scanned demo root's directory - main-side only, never sent to the renderer, which addresses
 * folders by `sourceKey` + relative segments. `dir` is the spelling every file's `absolutePath` is
 * joined from; `canonicalDir` the real path loose-file ids hash. A source can have two roots (a
 * game dir's root-dir and write-dir `demos`), listed in scan order (story 242)
 */
export interface DemoRootDir {
  sourceKey: string
  source: DemoSource
  dir: string
  canonicalDir: string
}

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
  const isQ2pro = installation.engineKind === 'q2pro' || installation.recordedEngineKind === 'q2pro'
  if (platform === 'linux' && isQ2pro) return [join(homeDir, '.q2pro')]
  return []
}

/**
 * Every `demos` folder an installation can hold demos in, for display: each game dir's under the
 * root, then each effective write dir's (story 238).
 */
export function demoFolderPaths(
  installation: DiscoverableInstallation,
  ctx: DiscoverContext,
): string[] {
  return [
    ...installation.gameDirs.map((gameDir) => join(installation.rootPath, gameDir, 'demos')),
    ...effectiveWriteDirs(installation, ctx).flatMap((writeDir) =>
      installation.gameDirs.map((gameDir) => join(writeDir, gameDir, 'demos')),
    ),
  ]
}

/** Case-insensitive lookup of a `demos` child folder; null if there is none (or the parent can't be read). */
async function findDemosDir(gameDirPath: string): Promise<string | null> {
  const listing = await listDir(gameDirPath)
  const actual = listing.byLowerName.get('demos')
  return actual ? join(gameDirPath, actual) : null
}

interface ScannedFile {
  fileName: string
  format: DemoFormat
  gzip: boolean
  folder: string[]
}

interface ScannedZip {
  fileName: string
  folder: string[]
}

/**
 * Every recognised demo file at any depth below `demosDir`, the `.zip` archives sitting beside
 * them (story 143), and every directory (the root as `[]`, empty ones included). A directory
 * whose real path is already in `visited` is never entered; each directory entered is added, so
 * a loop or a second route to the same folder is walked once. `skipLauncher` leaves out the
 * launcher's own `_launcher` staging folder directly under an installation `demos/`.
 * Story 151: reports *why*, via `listDirOrReason`, when `demosDir` itself cannot be listed -
 * distinct from a game dir simply having no `demos` folder at all (never an error, see
 * `findDemosDir`). A subfolder that cannot be listed is skipped.
 */
async function scanDemosDir(
  demosDir: string,
  visited: Set<string>,
  skipLauncher: boolean,
): Promise<
  | { ok: true; files: ScannedFile[]; zips: ScannedZip[]; dirs: string[][] }
  | { ok: false; reason: ReplaysSourceError['reason'] }
> {
  const root = await listDirOrReason(demosDir)
  if (!root.ok) return { ok: false, reason: root.reason }

  const files: ScannedFile[] = []
  const zips: ScannedZip[] = []
  const dirs: string[][] = [[]]

  async function walk(listing: DirListing, folder: string[]): Promise<void> {
    for (const fileName of listing.files) {
      const recognised = recogniseDemoFile(fileName)
      if (recognised) files.push({ fileName, ...recognised, folder })
      else if (fileName.toLowerCase().endsWith('.zip')) zips.push({ fileName, folder })
    }
    for (const dirName of listing.dirs) {
      if (skipLauncher && folder.length === 0 && dirName.toLowerCase() === LAUNCHER_DIR_NAME)
        continue
      const dirPath = join(demosDir, ...folder, dirName)
      const key = pathKey(await canonicalizePath(dirPath))
      if (visited.has(key)) continue
      visited.add(key)
      const path = [...folder, dirName]
      dirs.push(path)
      const sub = await listDirOrReason(dirPath)
      if (sub.ok) await walk(sub.listing, path)
    }
  }
  await walk(root.listing, [])
  return { ok: true, files, zips, dirs }
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

/**
 * Story 157: the same id a loose-file entry gets at discovery time (`idFor(pathKey(absolutePath))`
 * above), exposed so the rename guard/apply path can compute a renamed file's id without re-running
 * discovery.
 */
export function demoIdForPath(absolutePath: string): string {
  return idFor(pathKey(absolutePath))
}
interface Entry extends DiscoveredDemoFile {
  reachedBy: string[]
  _instIndex: number
  _gameDirOrder: number
  _key: string
}

/** Records that `installationId` reaches `entry` too; extra folders (null) never count. */
function reach(entry: Entry, installationId: string | null): void {
  if (installationId !== null && !entry.reachedBy.includes(installationId)) {
    entry.reachedBy.push(installationId)
  }
}

function sourceLabel(source: DemoSource): string {
  return source.kind === 'installation'
    ? `${source.installationName} / ${source.gameDir}`
    : source.path
}

/**
 * Collects every folder of every scanned root, keyed so the same folder reached twice (a game dir's
 * root-dir and write-dir `demos`, which share a source key) is listed once.
 */
function createFolderSink(): {
  add: (source: DemoSource, path: string[], archive: boolean) => void
  list: () => DiscoveredFolder[]
} {
  const byKey = new Map<string, DiscoveredFolder>()
  return {
    add(source, path, archive) {
      const sourceKey = demoSourceKey(source)
      const key = [sourceKey, ...path].join('\u0000')
      if (byKey.has(key)) return
      byKey.set(key, { sourceKey, source: sourceLabel(source), path, archive })
    },
    list: () => [...byKey.values()],
  }
}

/**
 * Expands every zip archive found in one scanned folder into `entries`, tagging each row with the
 * same `_instIndex`/`_gameDirOrder` its sibling loose-file entries from that same folder get.
 * Dedup is via `seenKeys` alone (`archivePath\0entryPath`) - no shadow-by-filename handling, that
 * only applies to loose demo files; an entry already seen is reached by `installationId` too. A
 * zip `expandZip` can't even list is recorded in `sourceErrors` (with the zip's own file name)
 * instead of contributing rows. An expanded zip is reported as an archive folder, plus one per
 * inner directory of its entries. `installationId` is null for an extra folder.
 */
async function expandZipsInto(
  entries: Entry[],
  seenKeys: Map<string, number>,
  installationId: string | null,
  sourceErrors: ReplaysSourceError[],
  folders: ReturnType<typeof createFolderSink>,
  demosDir: string,
  zips: ScannedZip[],
  source: DemoSource,
  instIndex: number,
  gameDirOrder: number,
  zipDeps: ZipDeps,
): Promise<void> {
  for (const { fileName: zipFileName, folder: zipFolder } of zips) {
    const absoluteZipPath = join(demosDir, ...zipFolder, zipFileName)
    let mtimeMs = 0
    try {
      mtimeMs = (await stat(absoluteZipPath)).mtimeMs
    } catch {
      // Unreadable stat - expandZip will very likely fail to read it too; mtimeMs simply stays 0.
    }

    const expanded = await expandZip(absoluteZipPath, source, mtimeMs, zipDeps, zipFolder)
    if (expanded.error) {
      sourceErrors.push({ source, archiveName: zipFileName, reason: expanded.error.code })
      continue
    }

    folders.add(source, [...zipFolder, zipFileName], true)
    for (const row of expanded.rows) {
      for (let len = zipFolder.length + 2; len <= row.folder.length; len++) {
        folders.add(source, row.folder.slice(0, len), true)
      }
      const key = pathKey(absoluteZipPath) + '\u0000' + row.archiveEntry!.entryPath
      const seen = seenKeys.get(key)
      if (seen !== undefined) {
        reach(entries[seen], installationId)
        continue
      }
      seenKeys.set(key, entries.length)
      entries.push({
        ...row,
        reachedBy: installationId === null ? [] : [installationId],
        absolutePath: absoluteZipPath,
        _instIndex: instIndex,
        _gameDirOrder: gameDirOrder,
        _key: key,
      })
    }
  }
}

/** One `demos` folder to scan: where it is, and which game dir / write-vs-root dir it belongs to. */
interface DemosRoot {
  gameDir: string
  isWriteDir: boolean
  demosDir: string
  canonicalDemosDir: string
}

/** Every `demos` root an installation contributes, in scan order, with `gameDirOrder` finalised. */
async function planInstallationRoots(
  installation: DiscoverableInstallation,
  ctx: DiscoverContext,
): Promise<{ gameDirOrder: Map<string, number>; roots: DemosRoot[] }> {
  const gameDirOrder = new Map<string, number>()
  installation.gameDirs.forEach((gd, i) => gameDirOrder.set(gd, i))

  // A mod folder the client only ever recorded demos into (e.g. `opentdm/`) carries no paks or
  // game library, so the inspector does not list it in `gameDirs` - but its `demos` are real.
  const extraGameDirNames = new Set<string>()
  const rootOnlyDirs: string[] = []
  for (const gameDir of await writeDirGameDirs(installation.rootPath)) {
    if (gameDirOrder.has(gameDir)) continue
    rootOnlyDirs.push(gameDir)
    extraGameDirNames.add(gameDir)
  }

  const writePairs: Array<{ writeDir: string; gameDir: string }> = []
  for (const writeDir of effectiveWriteDirs(installation, ctx)) {
    for (const gameDir of await writeDirGameDirs(writeDir)) {
      writePairs.push({ writeDir, gameDir })
      if (!gameDirOrder.has(gameDir)) extraGameDirNames.add(gameDir)
    }
  }
  const orderedExtras = [...extraGameDirNames].sort((a, b) => a.localeCompare(b))
  orderedExtras.forEach((gameDir, i) => gameDirOrder.set(gameDir, installation.gameDirs.length + i))

  const candidates = [
    ...installation.gameDirs.map((gameDir) => ({
      base: installation.rootPath,
      gameDir,
      isWriteDir: false,
    })),
    ...rootOnlyDirs.map((gameDir) => ({ base: installation.rootPath, gameDir, isWriteDir: false })),
    ...writePairs.map(({ writeDir, gameDir }) => ({ base: writeDir, gameDir, isWriteDir: true })),
  ]
  const roots: DemosRoot[] = []
  for (const { base, gameDir, isWriteDir } of candidates) {
    const demosDir = await findDemosDir(join(base, gameDir))
    if (!demosDir) continue
    roots.push({
      gameDir,
      isWriteDir,
      demosDir,
      canonicalDemosDir: await canonicalizePath(demosDir),
    })
  }
  return { gameDirOrder, roots }
}

/**
 * Scans every installation's game dirs (and, where applicable, its write dir), plus every
 * user-added extra demo folder (story 142), for demo files, at any depth below each `demos` folder.
 * `installations`' order is precedence order: the same resolved file reachable through two
 * installations is only ever reported once, under the first installation that finds it; its
 * `reachedBy` lists that one and every later installation that reaches it too. Within one
 * installation and game dir, a write-dir file shadows a root-dir file of the same relative path.
 * This never throws: a game dir with no `demos` folder at all (or a write dir the engine never
 * created) simply contributes nothing and is not an error (story 151) - but a `demos` folder
 * `findDemosDir` did find, or an extra folder, that then cannot be listed (permission denied,
 * replaced by a file, etc.) is reported in `sourceErrors`, one entry per failing source,
 * `archiveName: null`. A zip archive that cannot be expanded is reported the same way,
 * `archiveName` set to that zip's file name, alongside its folder's other, loose demos still being
 * listed normally. A subfolder that cannot be listed is skipped without an error.
 *
 * The walk never enters a directory twice: every root's real path is marked visited before any
 * walk starts, so a junction/symlink loop terminates, and a root nested inside another root is
 * only ever walked as its own root.
 *
 * `extraFolders` are scanned after every installation: an extra folder whose canonical path is
 * the same as an installation's own `demos` folder (already scanned above) is skipped entirely -
 * its files are already reported once, under the richer `installation` source, and no error is
 * ever produced for it - and two extra-folder rows pointing at the same real folder under
 * different spellings still yield each demo only once, via the same `seenKeys` dedup installation
 * scanning uses.
 */
export async function discoverDemos(
  installations: DiscoverableInstallation[],
  extraFolders: ReplaysExtraFolder[],
  ctx: DiscoverContext,
): Promise<{
  demos: DiscoveredDemoFile[]
  sourceErrors: ReplaysSourceError[]
  folders: DiscoveredFolder[]
  roots: DemoRootDir[]
}> {
  // Dedup key -> index into `entries`; a shadow replaces in place, so indices stay valid.
  const seenKeys = new Map<string, number>()
  const scannedRoots = new Map<string, Awaited<ReturnType<typeof scanDemosDir>>>()
  const rootDirs: DemoRootDir[] = []
  const entries: Entry[] = []
  const sourceErrors: ReplaysSourceError[] = []
  const folders = createFolderSink()

  const plans = []
  const canonicalInstallationDemosDirs = new Set<string>()
  for (const installation of installations) {
    const plan = await planInstallationRoots(installation, ctx)
    for (const root of plan.roots) {
      canonicalInstallationDemosDirs.add(pathKey(root.canonicalDemosDir))
    }
    plans.push({ installation, ...plan })
  }
  const canonicalExtras: string[] = []
  for (const row of extraFolders) canonicalExtras.push(await canonicalizePath(row.path))
  const visited = new Set([
    ...canonicalInstallationDemosDirs,
    ...canonicalExtras.map((p) => pathKey(p)),
  ])

  for (let instIndex = 0; instIndex < plans.length; instIndex++) {
    const { installation, gameDirOrder, roots } = plans[instIndex]
    // gameDir -> relative path -> index into `entries`, root-dir hits only, for this installation.
    const rootIndex = new Map<string, Map<string, number>>()

    for (const { gameDir, isWriteDir, demosDir, canonicalDemosDir } of roots) {
      const source: DemoSource = {
        kind: 'installation',
        installationId: installation.id,
        installationName: installation.name,
        gameDir,
      }
      // A root another installation already walked (a shared Linux Q2PRO write dir) reuses that
      // walk: its subfolders are in `visited` now, so a second walk would see only its top-level
      // files, and this installation would not reach the nested ones (story 238)
      const rootKey = pathKey(canonicalDemosDir)
      let scanned = scannedRoots.get(rootKey)
      if (!scanned) {
        scanned = await scanDemosDir(demosDir, visited, true)
        scannedRoots.set(rootKey, scanned)
      }
      if (!scanned.ok) {
        sourceErrors.push({ source, archiveName: null, reason: scanned.reason })
        continue
      }
      rootDirs.push({
        sourceKey: demoSourceKey(source),
        source,
        dir: demosDir,
        canonicalDir: canonicalDemosDir,
      })
      const { files, zips, dirs } = scanned
      for (const dir of dirs) folders.add(source, dir, false)
      const order = gameDirOrder.get(gameDir) ?? Number.MAX_SAFE_INTEGER

      for (const file of files) {
        const key = pathKey(join(canonicalDemosDir, ...file.folder, file.fileName))
        const relative = [...file.folder, file.fileName].join('/')

        if (isWriteDir) {
          const rootEntryIndex = rootIndex.get(gameDir)?.get(relative)
          if (rootEntryIndex !== undefined) {
            // Shadow: this write-dir file replaces the root-dir entry with the same relative path.
            // It keeps the root-dir entry's `reachedBy`, the same list object, accumulated so far.
            const old = entries[rootEntryIndex]
            seenKeys.delete(old._key)
            entries[rootEntryIndex] = {
              ...old,
              ...blankFacts(file),
              id: idFor(key),
              absolutePath: join(demosDir, ...file.folder, file.fileName),
              _gameDirOrder: order,
              _key: key,
            }
            seenKeys.set(key, rootEntryIndex)
            reach(entries[rootEntryIndex], installation.id)
            continue
          }
        }

        const seen = seenKeys.get(key)
        if (seen !== undefined) {
          reach(entries[seen], installation.id)
          continue
        }
        seenKeys.set(key, entries.length)
        entries.push({
          ...blankFacts(file),
          id: idFor(key),
          fileName: file.fileName,
          source,
          reachedBy: [installation.id],
          absolutePath: join(demosDir, ...file.folder, file.fileName),
          _instIndex: instIndex,
          _gameDirOrder: order,
          _key: key,
        })
        if (!isWriteDir) {
          let byPath = rootIndex.get(gameDir)
          if (!byPath) {
            byPath = new Map()
            rootIndex.set(gameDir, byPath)
          }
          byPath.set(relative, entries.length - 1)
        }
      }

      await expandZipsInto(
        entries,
        seenKeys,
        installation.id,
        sourceErrors,
        folders,
        demosDir,
        zips,
        source,
        instIndex,
        order,
        ctx.zipDeps,
      )
    }
  }

  for (let i = 0; i < extraFolders.length; i++) {
    const canonical = canonicalExtras[i]
    if (canonicalInstallationDemosDirs.has(pathKey(canonical))) continue

    const source: DemoSource = { kind: 'extraFolder', path: canonical }
    const scanned = await scanDemosDir(canonical, visited, false)
    if (!scanned.ok) {
      sourceErrors.push({ source, archiveName: null, reason: scanned.reason })
      continue
    }
    rootDirs.push({
      sourceKey: demoSourceKey(source),
      source,
      dir: canonical,
      canonicalDir: canonical,
    })
    const { files, zips, dirs } = scanned
    for (const dir of dirs) folders.add(source, dir, false)
    for (const file of files) {
      const fileKey = pathKey(join(canonical, ...file.folder, file.fileName))
      if (seenKeys.has(fileKey)) continue
      seenKeys.set(fileKey, entries.length)
      entries.push({
        ...blankFacts(file),
        id: idFor(fileKey),
        fileName: file.fileName,
        source,
        reachedBy: [],
        absolutePath: join(canonical, ...file.folder, file.fileName),
        _instIndex: installations.length + i,
        _gameDirOrder: 0,
        _key: fileKey,
      })
    }

    await expandZipsInto(
      entries,
      seenKeys,
      null,
      sourceErrors,
      folders,
      canonical,
      zips,
      source,
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
    sourceErrors,
    folders: folders.list(),
    roots: rootDirs,
  }
}

/** The fields a loose file has before its header is parsed - the same placeholders for every source. */
function blankFacts(file: ScannedFile): Omit<DiscoveredDemo, 'id' | 'fileName' | 'source'> {
  return {
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
    roster: null,
    fileTime: { birthtimeMs: 0, mtimeMs: 0 },
    folder: file.folder,
    nameFacts: null,
  }
}
