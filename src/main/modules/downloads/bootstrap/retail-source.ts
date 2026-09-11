import type {
  DetectedRetailSource,
  RetailPakInfo,
  RetailSourceInspection,
  RetailSourceUnverifiedReasonKey,
} from '@shared/modules/downloads'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import type { DetectionResult, ScanOptions } from '@shared/types'
import { findChild, fileSize, isDirectory, resolveRelaxed } from '../../../lib/fs-utils'
import { assembleInstallation, type AssembleInstallationResult, type AssembleSource } from './assemble'

/**
 * Story 088 D1: fact-gathering pass over a candidate "I already own retail Quake II" source folder
 * (AC3) - the bootstrap wizard's other install path than the download flow. Fs-only and import-free
 * of `electron`, same discipline as `target.ts`'s `computeTargetVerdict`: this function only reports
 * facts, it never judges what the wizard should do with them.
 *
 * Only `<rootPath>/baseq2` is ever probed. `rerelease/baseq2` is deliberately never looked at - the
 * 2023 remaster is a whole second game (see `NON_GAME_DIRS` in `@shared/constants`), and a source
 * whose only `baseq2` lives under `rerelease/` reports as unverified rather than being silently
 * discovered there.
 */

const RETAIL_PAK_NAMES = ['pak0.pak', 'pak1.pak', 'pak2.pak'] as const

const MISSING_PAK: RetailPakInfo = { exists: false, sizeBytes: null, matchesRetailSize: false }

async function inspectPak(baseq2Path: string, name: (typeof RETAIL_PAK_NAMES)[number]): Promise<RetailPakInfo> {
  const actualPath = await findChild(baseq2Path, name)
  if (!actualPath) return MISSING_PAK

  const sizeBytes = await fileSize(actualPath)
  if (sizeBytes === null) return MISSING_PAK

  return { exists: true, sizeBytes, matchesRetailSize: sizeBytes === RETAIL_PAK_SIZES[name] }
}

export async function inspectRetailSource(rootPath: string): Promise<RetailSourceInspection> {
  const baseq2Path = await resolveRelaxed(rootPath, 'baseq2')
  const baseq2Exists = baseq2Path !== null && (await isDirectory(baseq2Path))

  const [pak0, pak1, pak2, hasVideo, hasPlayers] = await Promise.all([
    baseq2Exists ? inspectPak(baseq2Path, 'pak0.pak') : Promise.resolve(MISSING_PAK),
    baseq2Exists ? inspectPak(baseq2Path, 'pak1.pak') : Promise.resolve(MISSING_PAK),
    baseq2Exists ? inspectPak(baseq2Path, 'pak2.pak') : Promise.resolve(MISSING_PAK),
    baseq2Exists ? hasChildDir(baseq2Path, 'video') : Promise.resolve(false),
    baseq2Exists ? hasChildDir(baseq2Path, 'players') : Promise.resolve(false),
  ])

  let unverifiedReason: RetailSourceUnverifiedReasonKey | undefined
  if (!baseq2Exists) {
    unverifiedReason = 'bootstrap.retailSource.baseDirMissing'
  } else if (!pak0.exists) {
    unverifiedReason = 'bootstrap.retailSource.pak0Missing'
  } else if (!pak0.matchesRetailSize) {
    unverifiedReason = 'bootstrap.retailSource.pak0SizeMismatch'
  } else if (!pak1.exists) {
    unverifiedReason = 'bootstrap.retailSource.pak1Missing'
  } else if (!pak1.matchesRetailSize) {
    unverifiedReason = 'bootstrap.retailSource.pak1SizeMismatch'
  }

  return {
    rootPath,
    pak0,
    pak1,
    pak2,
    verified: unverifiedReason === undefined,
    ...(unverifiedReason ? { unverifiedReason } : {}),
    hasVideo,
    hasPlayers,
  }
}

/** Case-insensitive existence check for a child directory, same lookup style as `pak0.pak` above. */
async function hasChildDir(dir: string, name: string): Promise<boolean> {
  const actualPath = await findChild(dir, name)
  return actualPath !== null && (await isDirectory(actualPath))
}

/**
 * Story 088 D2: the one store `InstallationSource` values a detected candidate must carry to
 * become a `DetectedRetailSource` (AC1/Decisions (Sprint): "offered only if it is a store source").
 * A `manual`/`unknown` hit, or any other `InstallationSource`, is [[089]]'s existing-folder source,
 * not this one, and is silently dropped here rather than surfaced as a rejected candidate.
 */
const STORE_SOURCES = ['steam', 'gog', 'epic'] as const
type StoreInstallationSource = (typeof STORE_SOURCES)[number]

function isStoreSource(source: string): source is StoreInstallationSource {
  return (STORE_SOURCES as readonly string[]).includes(source)
}

/** Narrow view of `DetectionService.scan` (`app.detection`, the module seam) - narrow so a test can
 * fake it without constructing a real `DetectionService`. */
export interface RetailSourceDetection {
  scan(options: ScanOptions): Promise<DetectionResult>
}

/**
 * Story 088 D2: the detection half of the bootstrap wizard's "copy from a detected installation"
 * data source (AC1/AC2). Reaches the store detection the launcher already has through the module
 * seam (`deps.detection.scan`, `app.detection` in production) - a fast pass only (`{}`, no
 * `deepScan`, no `drives`), since offering the copy option must never trigger the slow, opt-in
 * whole-drive walk. Every surviving `steam`/`gog`/`epic` candidate is re-inspected with
 * `inspectRetailSource` above, so the wizard renders a verdict for each one rather than trusting the
 * detector's own (much looser) "looks like Quake II" check.
 */
export async function listDetectedRetailSources(deps: {
  detection: RetailSourceDetection
}): Promise<DetectedRetailSource[]> {
  const result = await deps.detection.scan({})

  const storeCandidates = result.candidates.filter((candidate) => isStoreSource(candidate.source))

  return Promise.all(
    storeCandidates.map(async (candidate) => ({
      source: candidate.source as StoreInstallationSource,
      rootPath: candidate.rootPath,
      inspection: await inspectRetailSource(candidate.rootPath),
    })),
  )
}

/**
 * Story 088 D3: copies a detected (or manually chosen, per [[089]]) retail installation's game data
 * into `targetRoot` - `baseq2/pak0.pak`+`pak1.pak` (+`pak2.pak` when it size-matches
 * `RETAIL_PAK_SIZES`), and `baseq2/video`+`baseq2/players` when `includeVideoAndPlayers` is on.
 * Reuses `assemble.ts`'s allowlist copier (`assembleInstallation`) rather than a second copier
 * (Decisions (Sprint): "reuses the allowlist that already makes AC7 a property of the code") - the
 * same mechanism that already guarantees a demo/point-release run never leaks `ctf`/`xatrix`/
 * `rogue` guarantees this run produces `baseq2` only, from `sourceRoot`'s own tree. `cp` (used by
 * `assembleInstallation`) copies real bytes, never a symlink or hardlink, whatever the source's
 * link mode is - see `assembleInstallation`'s own doc comment.
 *
 * No `engine` is passed: this call assembles game data only, onto an installation whose engine
 * files come from [[074]]'s existing download step (a fresh bootstrap run) or already exist
 * (an in-place [[090]] upgrade) - either way, not this function's concern.
 */
export async function copyRetailGameData(input: {
  /** The verified retail installation's root - the same path `inspectRetailSource` was given. */
  sourceRoot: string
  /** Absolute path to the installation root being assembled or upgraded. */
  targetRoot: string
  /** The wizard's video/players toggle - see `assemble.ts`'s module doc comment. */
  includeVideoAndPlayers: boolean
}): Promise<AssembleInstallationResult> {
  const sources: AssembleSource[] = [
    { packageId: 'retail-source', dir: input.sourceRoot, role: 'retail' },
  ]

  return assembleInstallation({
    sources,
    targetRoot: input.targetRoot,
    includeVideoAndPlayers: input.includeVideoAndPlayers,
    dataSource: 'store-copy',
  })
}
