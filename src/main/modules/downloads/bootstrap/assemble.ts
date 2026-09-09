import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ENGINE_DEFINITIONS } from '@shared/types'

/**
 * Story 074 D3, revised by 076 D1. Assembles a clean `baseq2` installation out of the bootstrap
 * wizard's separate archive extractions (Q2PRO engine build, `q2-314-demo-x86.exe`,
 * `q2-3.20-x86-full-ctf.exe`).
 *
 * AC8 is a hard negative requirement: the 3.20 package also contains a `ctf/` payload that must
 * never end up in the target installation, alongside `xatrix/`/`rogue/` from other real-world Q2
 * archives. The mechanism that guarantees this is an *allowlist*, not a filter: `buildAssemblePlan`
 * enumerates the exact files this function is willing to copy, and `assembleInstallation` never
 * reads or copies anything outside that list - no recursive directory copy of an extraction tree,
 * ever, however that tree is laid out. `video/*`/`players/*` are the only "glob-like" entries, and
 * even those are expanded by listing that one specific subdirectory's immediate children, not by
 * touching anything else in the source tree.
 *
 * Story 076 D1: the allowlist now matches the *real* archives (confirmed by extracting the pinned
 * packages), not the guessed layout 074 D8 shipped with. Two shapes changed to make that possible:
 *
 * - `from` is now an ordered list of candidate relative paths, tried in turn - a package's real
 *   layout can differ from an older guess without dropping the old candidate (a future re-pin could
 *   go back to it).
 * - Every entry now carries `role` (which manifest package it belongs to) and `required` (whether a
 *   missing copy means the installation isn't playable). Both are unused by this file - D2/D3 will
 *   read them to report `missingRequired` - but D1 populates them correctly on every entry.
 */

/** Which manifest package (see `content/q2_community_content/gamedata/manifest.json`) an entry's source comes from. */
export type AssembleFileRole = 'engine' | 'demo' | 'point-release'

/** One file to copy, resolved relative to a source extraction dir and to the target installation root. */
export interface AssembleFileEntry {
  /** Relative paths inside one of the extracted source trees (`sources`), tried in order - first that exists wins. */
  from: string[]
  /** Relative path inside the target installation root, e.g. `baseq2/pak0.pak`. */
  to: string
  /** Which package this file's source belongs to. */
  role: AssembleFileRole
  /** Whether a missing copy of this entry means the assembled installation is not playable. */
  required: boolean
}

export interface BuildAssemblePlanInput {
  /** Whether the wizard's video/players toggle is on - see the module doc comment above. */
  includeVideoAndPlayers: boolean
}

/** The q2pro engine definition - the only engine the bootstrap wizard assembles today. */
function getQ2proDefinition() {
  const definition = ENGINE_DEFINITIONS.find((engine) => engine.kind === 'q2pro')
  if (!definition) {
    throw new Error('ENGINE_DEFINITIONS has no q2pro entry - bootstrap assembly cannot resolve a target binary name')
  }
  return definition
}

/**
 * The fixed, non-glob part of the allowlist.
 *
 * Every `from` candidate here is a path relative to an extracted archive's own root. Confirmed
 * against the real pinned packages (story 076): the demo's `pak0.pak` sits under
 * `Install/Data/baseq2/pak0.pak` (the older `baseq2/pak0.pak` guess is kept as a fallback
 * candidate, tried first, in case a future re-pin goes back to a plain layout); the engine zip's
 * binary is `q2pro64.exe` at the archive root, not `q2pro.exe`; the point-release package also
 * ships `baseq2/pak1.pak` (previously missing from the allowlist entirely) alongside the already-
 * correct `baseq2/pak2.pak`; and the engine zip ships `baseq2/q2pro.menu` alongside the binary and
 * `baseq2/gamex86_64.dll`.
 */
function buildFixedEntries(): AssembleFileEntry[] {
  const q2pro = getQ2proDefinition()
  const engineTarget = q2pro.executables[0]

  return [
    // Demo package (`q2-314-demo-x86.exe`).
    {
      from: ['baseq2/pak0.pak', 'Install/Data/baseq2/pak0.pak'],
      to: 'baseq2/pak0.pak',
      role: 'demo',
      required: true,
    },

    // Point-release package (`q2-3.20-x86-full-ctf.exe`).
    { from: ['baseq2/pak1.pak'], to: 'baseq2/pak1.pak', role: 'point-release', required: true },
    { from: ['baseq2/pak2.pak'], to: 'baseq2/pak2.pak', role: 'point-release', required: true },

    // Engine package (`q2pro-client_win64_x64.zip`). `to` is derived from `ENGINE_DEFINITIONS`
    // rather than hardcoded, so "the name the target expects" is read from the one table
    // `inspectInstallation` already uses.
    { from: ['q2pro.exe', 'q2pro64.exe'], to: engineTarget, role: 'engine', required: true },
    // The engine build's own game module DLL - without it the engine binary above has nothing to
    // load a map with, so a "playable" installation missing this entry could not actually run a
    // map even though `inspectInstallation` may still call it playable (that inspector only checks
    // for the engine binary + base game dir, not for this DLL).
    { from: ['baseq2/gamex86_64.dll'], to: 'baseq2/gamex86_64.dll', role: 'engine', required: true },
    // Ships alongside the engine binary and DLL in the same package. Not required - its absence
    // doesn't make the installation unplayable, just missing a menu asset.
    { from: ['baseq2/q2pro.menu'], to: 'baseq2/q2pro.menu', role: 'engine', required: false },
  ]
}

/** One glob-dir entry: candidate source-relative dir paths, and the target-relative base they expand into. */
export interface GlobDirEntry {
  /** Relative dir paths inside a source tree, tried in order - first that exists wins. */
  from: string[]
  /** Relative dir path inside the target installation root that the children land under. */
  to: string
}

/**
 * Directories whose immediate children are copied by name when the toggle is on. Never required.
 * Exported (story 076 review finding F1) only so `archive-layouts.test.ts` can cross-check its
 * `from` candidates against the recorded listing too - `buildAssemblePlan()`'s fixed entries were
 * checked, but these glob dirs, being outside that plan, previously were not.
 */
export const GLOB_DIRS: GlobDirEntry[] = [
  // AC4: sourced from `baseq2/players/` and lands at `baseq2/players/` (not the source root, and
  // not bare `players` at the target root either).
  { from: ['baseq2/players'], to: 'baseq2/players' },
  { from: ['baseq2/video'], to: 'baseq2/video' },
]

/**
 * Pure: the explicit list of files this run intends to copy. Does not touch disk - `video/*`/
 * `players/*` are only named here as directories to expand later, in `assembleInstallation`,
 * against whichever source dir actually has them.
 */
export function buildAssemblePlan(input: BuildAssemblePlanInput): AssembleFileEntry[] {
  // `video/*`/`players/*` are not literal entries here - a glob is not a relative path. When the
  // toggle is on, `assembleInstallation` expands GLOB_DIRS at copy time against whichever source
  // dir actually has them, rather than this pure function guessing file names in advance.
  void input.includeVideoAndPlayers
  return buildFixedEntries()
}

/** One downloaded package's extraction dir, attributed back to the manifest package that produced it. */
export interface AssembleSource {
  /** The `ManifestPackage.id` this extraction belongs to. */
  packageId: string
  /** Absolute path to the package's extraction dir. */
  dir: string
}

export interface AssembleInstallationInput {
  /** One entry per downloaded package's extraction, tried in order for each allowlist entry. */
  sources: AssembleSource[]
  /** Absolute path to the installation root being assembled. */
  targetRoot: string
  includeVideoAndPlayers: boolean
}

/**
 * Story 078 D2 (AC7): what assembly looked for, and whether it found it - one per allowlist entry
 * (plan order) plus one per expanded glob dir. Mirrors `DownloadDiagnosticsAssemblyEntry`
 * (`shared/modules/downloads.ts`), which is filled from this shape one layer up.
 */
export interface AssembleEntryResult {
  /** The relative candidate path (or glob dir) that was found; when none was, every candidate that
   * was tried, joined by ` | ` (story 078 review finding M3) - so a report reader can tell "the
   * archive's real layout doesn't match any candidate" from "the allowlist only ever tries one
   * path", which a single candidate would silently collapse into the same row. */
  from: string
  /** Target-relative path this entry copies to. */
  to: string
  /** Whether a source provided this entry. */
  found: boolean
  /** The `packageId` of the source that served this entry, when `found` is true. */
  sourcePackageId?: string
}

export interface AssembleInstallationResult {
  /** Target-relative paths that were actually copied. */
  copiedFiles: string[]
  /** Required entries whose source was not found in any `sources`. Optional entries never appear here. */
  missingRequired: { role: AssembleFileRole; from: string[] }[]
  /** One record per allowlist entry (plan order) plus one per expanded glob dir - see `AssembleEntryResult`. */
  entries: AssembleEntryResult[]
}

/**
 * Finds the first candidate (in order) that exists in any source (in order), or null if none does.
 * Candidate order takes priority over source order, matching "an ordered candidate list, first
 * that exists wins" - a later candidate in an earlier source does not pre-empt an earlier candidate
 * found in a later source.
 */
async function findSource(
  sources: AssembleSource[],
  candidates: string[],
): Promise<{ absolutePath: string; relativePath: string; packageId: string } | null> {
  for (const relativePath of candidates) {
    for (const source of sources) {
      const absolutePath = join(source.dir, relativePath)
      try {
        await stat(absolutePath)
        return { absolutePath, relativePath, packageId: source.packageId }
      } catch {
        continue
      }
    }
  }
  return null
}

/** Lists the immediate children of the first existing candidate dir, by name. */
async function expandGlobDir(
  sources: AssembleSource[],
  candidates: string[],
): Promise<{ absoluteDir: string; relativePath: string; names: string[]; packageId: string } | null> {
  for (const dirRelativePath of candidates) {
    for (const source of sources) {
      const absoluteDir = join(source.dir, dirRelativePath)
      try {
        const names = await readdir(absoluteDir)
        return { absoluteDir, relativePath: dirRelativePath, names, packageId: source.packageId }
      } catch {
        continue
      }
    }
  }
  return null
}

/**
 * Copies exactly the allowlisted files (`buildAssemblePlan`) out of `sources` into
 * `targetRoot`. Never copies a whole directory tree - `video/*`/`players/*` are expanded to their
 * immediate children and copied one by one. A missing allowlisted file is skipped, not thrown: a
 * job-level caller decides what "the download didn't produce a required file" means.
 */
export async function assembleInstallation(
  input: AssembleInstallationInput,
): Promise<AssembleInstallationResult> {
  const { sources, targetRoot, includeVideoAndPlayers } = input
  const copiedFiles: string[] = []
  const missingRequired: { role: AssembleFileRole; from: string[] }[] = []
  const entries: AssembleEntryResult[] = []

  const plan = buildAssemblePlan({ includeVideoAndPlayers })
  for (const entry of plan) {
    const source = await findSource(sources, entry.from)
    if (!source) {
      entries.push({ from: entry.from.join(' | '), to: entry.to, found: false })
      if (entry.required) {
        missingRequired.push({ role: entry.role, from: entry.from })
      }
      continue
    }

    entries.push({
      from: source.relativePath,
      to: entry.to,
      found: true,
      sourcePackageId: source.packageId,
    })

    const dest = join(targetRoot, entry.to)
    await mkdir(dirname(dest), { recursive: true })
    await cp(source.absolutePath, dest)
    copiedFiles.push(entry.to)
  }

  if (includeVideoAndPlayers) {
    for (const globDir of GLOB_DIRS) {
      const expanded = await expandGlobDir(sources, globDir.from)
      if (!expanded) {
        entries.push({ from: globDir.from.join(' | '), to: globDir.to, found: false })
        continue
      }

      entries.push({
        from: expanded.relativePath,
        to: globDir.to,
        found: true,
        sourcePackageId: expanded.packageId,
      })

      for (const name of expanded.names) {
        const source = join(expanded.absoluteDir, name)
        const toRelative = join(globDir.to, name)
        const dest = join(targetRoot, toRelative)
        await mkdir(dirname(dest), { recursive: true })
        await cp(source, dest, { recursive: true })
        copiedFiles.push(toRelative)
      }
    }
  }

  return { copiedFiles, missingRequired, entries }
}
