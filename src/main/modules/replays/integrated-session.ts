import { randomUUID as nodeRandomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readdir, realpath as nodeRealpath, stat as nodeStat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiscoveredDemo } from '@shared/modules/replays'
import { DEMO_BASE_GAME_DIR, demoGameDir } from '@shared/replays/demo-play'
import { fail, ok, type Installation, type Outcome } from '@shared/types'
import { isInside, listDir } from '../../lib/fs-utils'
import { SAFE_FILE_NAME, WRONG_INSTALLATION } from './demo-play'
import { LAUNCHER_DIR_NAME, readDemoEntry, stagedFileName } from './demo-staging'
import { effectiveWriteDirs, type DiscoverContext } from './discovery'

/**
 * The integrated player's session: main decides which files of the active installation
 * the in-app engine may read, pins each one's realpath and size, and hands the renderer only an
 * opaque token plus `{ index, vpath, size }` rows. Every later read names a token and an index -
 * never a path - and is re-checked against what was pinned here. (story 289)
 */

export const INTEGRATED_DATA_LIMIT_BYTES = 1024 ** 3

const NOT_FOUND = 'replays.play.error.notFound'
const FILE_MISSING = 'replays.play.error.fileMissing'
const GAME_DIR_MISSING = 'replays.play.error.gameDirMissing'
const UNSAFE_NAME = 'replays.play.unavailable.unsafeName'
const MVD2 = 'replays.player.unavailable.mvd2Integrated'
const DATA_TOO_LARGE = 'replays.integrated.error.dataTooLarge'
/** A later prepare started while this one ran; only the latest may hold the session. */
const SUPERSEDED = 'replays.integrated.error.superseded'

const ASSET_FOLDERS = new Set([
  'maps',
  'textures',
  'models',
  'sprites',
  'sound',
  'pics',
  'players',
  'env',
])
const PACK_FILE = /^pak.*\.pak$|\.pkz$/i

/** The slice of `node:fs/promises` the session reads through - a seam for tests. */
export interface IntegratedSessionFs {
  realpath: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ size: number; isFile(): boolean }>
}

export interface IntegratedSessionDeps {
  /** Main's current index rows (`ReplaysScanService.read`). */
  readDemos: () => Promise<readonly DiscoveredDemo[]>
  /** Mirrors `ReplaysScanService.resolveFile`. */
  resolveFile: (
    id: string,
  ) => { absolutePath: string; archiveEntry: DiscoveredDemo['archiveEntry'] } | undefined
  installations: () => readonly Installation[]
  activeInstallationId: () => string | null
  discoveryContext: () => DiscoverContext
  fs?: IntegratedSessionFs
  randomUUID?: () => string
  limitBytes?: number
}

export interface IntegratedManifestEntry {
  index: number
  /** Lower-case Quake path, `/`-separated, relative to the engine's base dir. */
  vpath: string
  size: number
}

export interface IntegratedManifest {
  token: string
  /** Lower-case, as every vpath under it. */
  gameDir: string
  files: IntegratedManifestEntry[]
  /** Always the last index: `files.length`. */
  demo: IntegratedManifestEntry
}

export type IntegratedResolved =
  { kind: 'file'; path: string; size: number } | { kind: 'bytes'; bytes: Uint8Array; size: number }

export interface IntegratedSession {
  prepare: (demoId: string, installationId: string) => Promise<Outcome<IntegratedManifest>>
  release: (token: string) => Outcome<void>
  resolve: (token: string, index: number) => Promise<IntegratedResolved | null>
}

/** Main-only: what one manifest index is served from. */
type PinnedSource =
  | { kind: 'file'; path: string; realPath: string; size: number }
  | { kind: 'bytes'; bytes: Uint8Array; size: number }

type PinnedFile = Extract<PinnedSource, { kind: 'file' }>

interface LocatedRoot {
  realRoot: string
  baseDir: string | null
  gameDir: string | null
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Regular files under `dir`, depth-first in name order; a symlinked or junctioned dir is not entered. */
async function walk(dir: string, rel: string[]): Promise<{ path: string; rel: string[] }[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // ENOENT/EACCES: an unreadable folder contributes nothing
    return []
  }
  entries.sort((a, b) => byName(a.name, b.name))
  const out: { path: string; rel: string[] }[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(path, [...rel, entry.name])))
    // A symlinked entry is a candidate only if it stats as a file inside the root.
    else if (entry.isFile() || entry.isSymbolicLink()) out.push({ path, rel: [...rel, entry.name] })
  }
  return out
}

export function createIntegratedSession(deps: IntegratedSessionDeps): IntegratedSession {
  const fs: IntegratedSessionFs = deps.fs ?? { realpath: nodeRealpath, stat: nodeStat }
  const randomUUID = deps.randomUUID ?? nodeRandomUUID
  const limitBytes = deps.limitBytes ?? INTEGRATED_DATA_LIMIT_BYTES

  let active: { token: string; sources: PinnedSource[] } | null = null
  let latestPrepare = 0

  async function locate(root: string, gameKey: string): Promise<LocatedRoot | null> {
    let realRoot: string
    try {
      realRoot = await fs.realpath(root)
    } catch {
      // a write dir the engine has not created yet holds nothing
      return null
    }
    const listing = await listDir(root)
    // Looked up through the listing, so a header-supplied game dir with separators or `..` never
    // matches anything.
    const child = (key: string): string | null => {
      const name = listing.byLowerName.get(key)
      return name !== undefined && listing.dirs.includes(name) ? join(root, name) : null
    }
    return { realRoot, baseDir: child(DEMO_BASE_GAME_DIR), gameDir: child(gameKey) }
  }

  async function collect(
    root: LocatedRoot,
    gameKey: string,
    found: Map<string, PinnedFile>,
  ): Promise<void> {
    const add = async (vpath: string, path: string): Promise<void> => {
      if (found.has(vpath)) return
      let realPath: string
      let info: { size: number; isFile(): boolean }
      try {
        realPath = await fs.realpath(path)
        info = await fs.stat(realPath)
      } catch {
        // gone or unreadable since the listing - not served
        return
      }
      if (!info.isFile() || !isInside(root.realRoot, realPath)) return
      found.set(vpath, { kind: 'file', path, realPath, size: info.size })
    }

    const packDirs: [string | null, string][] = [[root.baseDir, DEMO_BASE_GAME_DIR]]
    if (gameKey !== DEMO_BASE_GAME_DIR) packDirs.push([root.gameDir, gameKey])
    for (const [dir, prefix] of packDirs) {
      if (dir === null) continue
      const names = (await listDir(dir)).files.filter((name) => PACK_FILE.test(name)).sort(byName)
      for (const name of names) await add(`${prefix}/${name.toLowerCase()}`, join(dir, name))
    }

    if (root.gameDir === null) return
    let entries: Dirent[]
    try {
      entries = await readdir(root.gameDir, { withFileTypes: true })
    } catch {
      // the game dir vanished since it was located
      return
    }
    entries.sort((a, b) => byName(a.name, b.name))
    for (const entry of entries) {
      if (!entry.isDirectory() || !ASSET_FOLDERS.has(entry.name.toLowerCase())) continue
      for (const file of await walk(join(root.gameDir, entry.name), [entry.name])) {
        await add(`${gameKey}/${file.rel.join('/').toLowerCase()}`, file.path)
      }
    }
  }

  async function pinDemo(
    file: NonNullable<ReturnType<IntegratedSessionDeps['resolveFile']>>,
    context: DiscoverContext,
  ): Promise<Outcome<PinnedSource>> {
    if (file.archiveEntry) {
      try {
        if (!(await fs.stat(file.absolutePath)).isFile()) return fail(FILE_MISSING)
      } catch {
        // ENOENT: the archive is gone
        return fail(FILE_MISSING)
      }
      const read = await readDemoEntry(
        file.absolutePath,
        file.archiveEntry.entryPath,
        context.zipDeps,
      )
      if (!read.ok) return read
      return ok({ kind: 'bytes', bytes: read.value, size: read.value.byteLength })
    }
    try {
      const realPath = await fs.realpath(file.absolutePath)
      const info = await fs.stat(realPath)
      if (!info.isFile()) return fail(FILE_MISSING)
      return ok({ kind: 'file', path: file.absolutePath, realPath, size: info.size })
    } catch {
      // ENOENT: the demo file is gone
      return fail(FILE_MISSING)
    }
  }

  async function build(
    demoId: string,
    installationId: string,
  ): Promise<
    Outcome<{
      gameDir: string
      files: { vpath: string; source: PinnedSource }[]
      demo: { vpath: string; source: PinnedSource }
    }>
  > {
    const demo = (await deps.readDemos()).find((row) => row.id === demoId)
    const file = deps.resolveFile(demoId)
    if (!demo || !file) return fail(NOT_FOUND)

    const installation = deps.installations().find((i) => i.id === installationId)
    if (!installation || installation.id !== deps.activeInstallationId()) {
      return fail(WRONG_INSTALLATION)
    }
    if (demo.format === 'mvd2') return fail(MVD2)
    const demoName = stagedFileName({ ...demo, archiveEntry: file.archiveEntry })
    if (!SAFE_FILE_NAME.test(demoName)) return fail(UNSAFE_NAME)

    const gameDir = demoGameDir(demo)
    const gameKey = gameDir.toLowerCase()
    const context = deps.discoveryContext()
    // Priority order: a write dir's file shadows the installation's, as in the engine's search path.
    const rootPaths = [...effectiveWriteDirs(installation, context), installation.rootPath]
    const roots: LocatedRoot[] = []
    for (const rootPath of rootPaths) {
      const located = await locate(rootPath, gameKey)
      if (located) roots.push(located)
    }
    if (!roots.some((r) => r.baseDir !== null)) {
      return fail(GAME_DIR_MISSING, { mod: DEMO_BASE_GAME_DIR })
    }
    if (!roots.some((r) => r.gameDir !== null)) return fail(GAME_DIR_MISSING, { mod: gameDir })

    const demoSource = await pinDemo(file, context)
    if (!demoSource.ok) return demoSource

    const found = new Map<string, PinnedFile>()
    for (const root of roots) await collect(root, gameKey, found)
    const files = [...found.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([vpath, source]) => ({ vpath, source }))

    const total = files.reduce((sum, f) => sum + f.source.size, demoSource.value.size)
    if (total > limitBytes) return fail(DATA_TOO_LARGE, { sizeMb: Math.ceil(total / 2 ** 20) })

    return ok({
      gameDir: gameKey,
      files,
      demo: {
        vpath: `${gameKey}/demos/${LAUNCHER_DIR_NAME}/${demoName}`,
        source: demoSource.value,
      },
    })
  }

  return {
    async prepare(demoId, installationId) {
      active = null
      const generation = ++latestPrepare
      const built = await build(demoId, installationId)
      if (!built.ok) return built
      // Prepares overlap across awaits: an earlier one finishing late must not revive a session the
      // renderer has already replaced.
      if (generation !== latestPrepare) return fail(SUPERSEDED)
      const { gameDir, files, demo } = built.value
      const token = randomUUID()
      active = { token, sources: [...files.map((f) => f.source), demo.source] }
      return ok({
        token,
        gameDir,
        files: files.map((f, index) => ({ index, vpath: f.vpath, size: f.source.size })),
        demo: { index: files.length, vpath: demo.vpath, size: demo.source.size },
      })
    },

    release(token) {
      if (active?.token === token) active = null
      return ok(undefined)
    },

    async resolve(token, index) {
      const session = active
      if (session === null || session.token !== token) return null
      if (!Number.isInteger(index) || index < 0 || index >= session.sources.length) return null
      const source = session.sources[index]
      if (source.kind === 'bytes') return { kind: 'bytes', bytes: source.bytes, size: source.size }
      try {
        if ((await fs.realpath(source.path)) !== source.realPath) return null
        const info = await fs.stat(source.realPath)
        if (!info.isFile() || info.size !== source.size) return null
      } catch {
        // gone since prepare
        return null
      }
      // Released or replaced while the checks ran.
      if (active !== session) return null
      // The pinned realpath, never `source.path`: a link swapped after this check cannot redirect
      // the read.
      return { kind: 'file', path: source.realPath, size: source.size }
    },
  }
}
