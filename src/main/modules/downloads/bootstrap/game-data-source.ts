import { copyFile, mkdir } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { GameDataSourceVerdict } from '@shared/modules/downloads'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import { findChild, fileSize, isDirectory, pathKey, resolveRelaxed } from '../../../lib/fs-utils'
import { isUnsafeAbsolutePath } from './target'

/**
 * Story 089 D2: fact-gathering and copy for a hand-picked "point at an existing folder" game-data
 * source (AC3-AC7) - the wizard's third `BootstrapDataSource` alongside the download and detected-
 * store-install paths. Same discipline as `retail-source.ts`/`target.ts`: `inspectGameDataSource`
 * only reports facts, it never judges what the wizard should do with them, and only `<rootPath>/
 * baseq2` is ever probed - a `rerelease`-only layout is deliberately never discovered here either.
 */

const RETAIL_PAK_NAMES = ['pak0.pak', 'pak1.pak', 'pak2.pak'] as const

export async function inspectGameDataSource(rootPath: string): Promise<GameDataSourceVerdict> {
  // Paths from the renderer are never trusted (CLAUDE.md). Checked before any read of the folder's
  // contents, same ordering `computeTargetVerdict` uses for its own `unsafePath` short-circuit.
  if (await isUnsafeAbsolutePath(rootPath)) {
    return { rootPath, kind: 'unusable', reason: 'bootstrap.gameDataSource.unsafePath', paks: [] }
  }

  if (!(await isDirectory(rootPath))) {
    return { rootPath, kind: 'unusable', reason: 'bootstrap.gameDataSource.rootMissing', paks: [] }
  }

  const baseq2Path = await resolveRelaxed(rootPath, 'baseq2')
  if (!baseq2Path) {
    return { rootPath, kind: 'unusable', reason: 'bootstrap.gameDataSource.baseDirMissing', paks: [] }
  }

  const found = await Promise.all(
    RETAIL_PAK_NAMES.map(async (name) => {
      const actualPath = await findChild(baseq2Path, name)
      if (!actualPath) return null
      const sizeBytes = await fileSize(actualPath)
      if (sizeBytes === null) return null
      return { name, sizeBytes, retail: sizeBytes === RETAIL_PAK_SIZES[name] }
    }),
  )
  const paks = found.filter((pak): pak is NonNullable<(typeof found)[number]> => pak !== null)

  const pak0 = paks.find((pak) => pak.name === 'pak0.pak')
  if (!pak0) {
    return { rootPath, kind: 'unusable', reason: 'bootstrap.gameDataSource.pak0Missing', paks }
  }

  const pak1 = paks.find((pak) => pak.name === 'pak1.pak')
  const kind = pak0.retail && pak1?.retail ? 'retail' : 'demo'

  return { rootPath, kind, paks }
}

/**
 * Story 089 D2: whether `candidate` and `other` overlap - either is inside (or equal to) the other.
 * Split out from `inspectGameDataSource` deliberately: rejecting "the source is the target (or
 * contains/is contained by it)" needs *both* paths together, and `inspectGameDataSource` only ever
 * sees the source's `rootPath` - only the caller that already has both (the bootstrap job, at job
 * start, D3) can run this check.
 */
export function isPathContainedBy(candidate: string, other: string): boolean {
  const candidateKey = pathKey(candidate)
  const otherKey = pathKey(other)
  return (
    candidateKey === otherKey ||
    candidateKey.startsWith(otherKey + sep) ||
    otherKey.startsWith(candidateKey + sep)
  )
}

/** The only files a copy may ever produce - `baseq2/pak0.pak`+`pak1.pak`+`pak2.pak`, nothing else,
 * however the source folder's own `baseq2` is laid out (AC7: no `ctf`/`xatrix`/`rogue`, no loose
 * files). Deliberately a fixed allowlist, never a directory copy. */
const COPY_ENTRIES = RETAIL_PAK_NAMES

export async function copyGameDataSource(
  rootPath: string,
  targetRoot: string,
): Promise<{ copied: string[] }> {
  const baseq2Path = await resolveRelaxed(rootPath, 'baseq2')
  if (!baseq2Path) return { copied: [] }

  const targetBaseq2 = join(targetRoot, 'baseq2')
  await mkdir(targetBaseq2, { recursive: true })

  const copied: string[] = []
  for (const name of COPY_ENTRIES) {
    const sourcePath = await findChild(baseq2Path, name)
    if (!sourcePath) continue
    // `copyFile` writes independent bytes - never a symlink/hardlink, whatever the source's own
    // link mode is (same guarantee `retail-source.ts`'s `cp`-based copy makes for the other source).
    await copyFile(sourcePath, join(targetBaseq2, name))
    copied.push(`baseq2/${name}`)
  }
  return { copied }
}
