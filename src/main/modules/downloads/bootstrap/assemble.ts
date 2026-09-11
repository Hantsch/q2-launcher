import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import { ENGINE_DEFINITIONS, type EngineKind } from '@shared/types'
import { resolveRelaxed } from '../../../lib/fs-utils'

/**
 * Story 074 D3, revised by 076 D1 and 080 D2. Assembles a clean `baseq2` installation out of the
 * bootstrap wizard's separate archive extractions (an engine build - Q2PRO or R1Q2 -,
 * `q2-314-demo-x86.exe`, `q2-3.20-x86-full-ctf.exe`).
 *
 * Story 080 D2 (AC1/AC3/AC5/AC7): the fixed allowlist is now split into an engine-independent
 * block (demo + point-release game data) and an engine-specific block chosen by
 * `buildAssemblePlan`'s `engine` input. `findSource` also now restricts its search, per entry, to
 * `sources` whose `role` matches that entry's own role - so an `engine`-role entry (the client
 * binary, the renderer, the game module DLL) can only ever be satisfied by the engine package's
 * own extraction, never by a demo/point-release archive that happens to carry a same-named file.
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
 *
 * Story 088 D3: a second game-data source, `dataSource: 'store-copy'`, reuses this same allowlist
 * mechanism (AC7) rather than a second copier. Its game-data block is `baseq2/pak0.pak`+`pak1.pak`
 * (role `'retail'`, required) plus `baseq2/pak2.pak` (role `'retail'`, optional) - never the
 * demo/point-release entries. `pak2.pak` also carries `expectedSizeBytes`: a found-but-wrong-size
 * file is treated exactly like a missing one (skipped, not copied) - the copier's existing "missing
 * optional entries are silently skipped" behaviour, generalised to "wrong-size" as well as
 * "absent", so a 3.20 pak2 that doesn't match `RETAIL_PAK_SIZES` never lands in the target.
 *
 * Story 089 D3: a third game-data source, `dataSource: 'existing-folder'`, joins them on the same
 * terms (AC7) - role `'folder'`, one required entry per pak the picked folder was just found to
 * hold (`folderPakNames`), and nothing else. It is a *computed* block rather than a fixed one for
 * the one reason the other two do not need: a demo folder legitimately has no `pak1.pak`, so a
 * fixed list would fail such a run for a file the wizard already said it would not find.
 */

/** Which manifest package (see `content/q2_community_content/gamedata/manifest.json`) an entry's
 * source comes from - or, for `'retail'`, the detected store installation being copied from
 * (story 088 D3), or, for `'folder'`, the folder the user hand-picked (story 089 D3). */
export type AssembleFileRole = 'engine' | 'demo' | 'point-release' | 'retail' | 'folder'

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
  /**
   * Story 088 D3: when set, a found source file whose actual size doesn't match this exact byte
   * count is treated as not found (skipped, never copied) - used for the optional `pak2.pak` retail
   * entry, whose "present but wrong version" case must not silently copy unverified data.
   */
  expectedSizeBytes?: number
}

export interface BuildAssemblePlanInput {
  /**
   * Which engine this run is assembling - selects the engine-specific block below. Optional
   * (story 088 D3): `copyRetailGameData` calls `buildAssemblePlan`/`assembleInstallation` for game
   * data only, with no engine package to copy, so an omitted `engine` yields a plan with no
   * engine-role entries at all rather than defaulting to one engine's binaries.
   */
  engine?: EngineKind
  /** Whether the wizard's video/players toggle is on - see the module doc comment above. */
  includeVideoAndPlayers: boolean
  /**
   * Story 088 D3: which game-data block this plan copies - the demo + point-release archives
   * (`'free-download'`, [[074]]'s original and only source) or a detected retail installation's
   * own `baseq2` (`'store-copy'`, [[088]]). Defaults to `'free-download'` so every caller that
   * predates this story keeps compiling and behaving unchanged.
   *
   * Story 089 D3 adds `'existing-folder'`: a folder the user hand-picked, whose block is built from
   * `folderPakNames` rather than from a fixed list - see there.
   */
  dataSource?: 'free-download' | 'store-copy' | 'existing-folder'
  /**
   * Story 089 D3: for a `'existing-folder'` run only, the pak file names that folder was just found
   * to actually hold (`GameDataSourceVerdict.paks`, re-derived from disk by `inspectGameDataSource`
   * immediately before the job registered anything). One required entry is built per name, and
   * nothing else is ever copied out of that folder - so AC7's "baseq2 only" is guaranteed by the
   * same fixed-allowlist mechanism as the other two sources, not by a filter.
   *
   * Passed in rather than re-derived here because "which paks does this folder have" is a fact about
   * the disk that the caller already established and this pure function must not go and re-read: a
   * second look could disagree with the verdict the run was admitted on. A demo folder therefore
   * yields exactly one required entry (`pak0.pak`), which is why a demo source is not failed by
   * `missingRequired` for the `pak1.pak` it never had.
   */
  folderPakNames?: string[]
}

/** The q2pro engine definition. */
function getQ2proDefinition() {
  const definition = ENGINE_DEFINITIONS.find((engine) => engine.kind === 'q2pro')
  if (!definition) {
    throw new Error('ENGINE_DEFINITIONS has no q2pro entry - bootstrap assembly cannot resolve a target binary name')
  }
  return definition
}

/** The r1q2 engine definition (story 080 D2). */
function getR1q2Definition() {
  const definition = ENGINE_DEFINITIONS.find((engine) => engine.kind === 'r1q2')
  if (!definition) {
    throw new Error('ENGINE_DEFINITIONS has no r1q2 entry - bootstrap assembly cannot resolve a target binary name')
  }
  return definition
}

/**
 * The demo + point-release entries: real Quake II game data, needed regardless of which engine
 * the user picked. Every `from` candidate here is a path relative to an extracted archive's own
 * root. Confirmed against the real pinned packages (story 076): the demo's `pak0.pak` sits under
 * `Install/Data/baseq2/pak0.pak` (the older `baseq2/pak0.pak` guess is kept as a fallback
 * candidate, tried first, in case a future re-pin goes back to a plain layout); the point-release
 * package also ships `baseq2/pak1.pak` (previously missing from the allowlist entirely) alongside
 * the already-correct `baseq2/pak2.pak`.
 */
function buildGameDataEntries(): AssembleFileEntry[] {
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
  ]
}

/**
 * Story 088 D3: the `'store-copy'` game-data block - a detected retail installation's own
 * `baseq2/pak0.pak`/`pak1.pak` (required) plus `baseq2/pak2.pak` (optional, and only when its size
 * matches `RETAIL_PAK_SIZES['pak2.pak']` - see `expectedSizeBytes` and `assembleInstallation`'s
 * copy loop). No demo or point-release entry ever appears here - AC7's "baseq2 only, no ctf/xatrix/
 * rogue" is already guaranteed by this being a fixed allowlist of exactly three files, same as the
 * free-download block above.
 */
function buildRetailGameDataEntries(): AssembleFileEntry[] {
  return [
    { from: ['baseq2/pak0.pak'], to: 'baseq2/pak0.pak', role: 'retail', required: true },
    { from: ['baseq2/pak1.pak'], to: 'baseq2/pak1.pak', role: 'retail', required: true },
    {
      from: ['baseq2/pak2.pak'],
      to: 'baseq2/pak2.pak',
      role: 'retail',
      required: false,
      expectedSizeBytes: RETAIL_PAK_SIZES['pak2.pak'],
    },
  ]
}

/**
 * Story 089 D3: the `'existing-folder'` game-data block - one entry per pak the hand-picked folder
 * was *just found to hold* (`BuildAssemblePlanInput.folderPakNames`), each `required`, each copied
 * from `baseq2/<name>` to `baseq2/<name>`.
 *
 * Two differences from `buildRetailGameDataEntries` above, both deliberate:
 *
 *  - **the list is the folder's, not a fixed three.** A `demo` verdict's folder has `pak0.pak` and
 *    no `pak1.pak`, and a fixed list would fail such a run at `missingRequired` for a file the
 *    wizard already told the user it was not going to find (AC4).
 *  - **no `expectedSizeBytes`.** The verdict this list comes from was produced by
 *    `inspectGameDataSource` moments earlier, and *it* is what decided retail vs. demo by size; a
 *    second size gate here would mean a `pak2.pak` this run was admitted with could still be
 *    silently dropped, and a demo folder's (legitimately non-retail-sized) pak0 could never be
 *    copied at all.
 */
function buildFolderGameDataEntries(names: string[]): AssembleFileEntry[] {
  // The names still go through this file's own allowlist rather than straight into a path: they
  // arrive from a verdict about a folder a *renderer-supplied* path named, and "an allowlist, not a
  // filter" (see the module comment) has to hold structurally here too, not by trusting the caller
  // to have derived them from the same fixed three. `RETAIL_PAK_SIZES` is the one shared table that
  // names them (`@shared/constants`), so there is no second list to keep current.
  const allowed = Object.keys(RETAIL_PAK_SIZES)
  return names
    .filter((name) => allowed.includes(name))
    .map((name) => ({
      from: [`baseq2/${name}`],
      to: `baseq2/${name}`,
      role: 'folder' as const,
      required: true,
    }))
}

/**
 * The Q2PRO-specific entries. `to` is derived from `ENGINE_DEFINITIONS` rather than hardcoded, so
 * "the name the target expects" is read from the one table `inspectInstallation` already uses.
 */
function buildQ2proEngineEntries(): AssembleFileEntry[] {
  const q2pro = getQ2proDefinition()
  const engineTarget = q2pro.executables[0]

  return [
    // Engine package (`q2pro-client_win64_x64.zip`).
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

/**
 * The R1Q2-specific entries (story 080 D2, AC3). The three files measured against the real,
 * pinned `r1q2-b8012-msvs2022-win32` package: the client binary, its OpenGL renderer (the archive
 * carries only `ref_r1gl.dll`, at the installation root - not `baseq2`), and its own game module
 * DLL. `dedicated.exe` is deliberately never on this list (AC3's exclusion). No optional menu
 * entry - none is known to ship with this package.
 */
function buildR1q2EngineEntries(): AssembleFileEntry[] {
  const r1q2 = getR1q2Definition()
  const engineTarget = r1q2.executables[0]

  return [
    { from: ['r1q2.exe'], to: engineTarget, role: 'engine', required: true },
    { from: ['ref_r1gl.dll'], to: 'ref_r1gl.dll', role: 'engine', required: true },
    { from: ['baseq2/gamex86.dll'], to: 'baseq2/gamex86.dll', role: 'engine', required: true },
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
 * Which of the three game-data blocks this run copies. Written as one exhaustive switch (story 089
 * D3) rather than a chain of ternaries, so a fourth data source cannot silently fall into the
 * free-download block the way an unhandled value would.
 */
function selectGameDataEntries(input: BuildAssemblePlanInput): AssembleFileEntry[] {
  switch (input.dataSource) {
    case 'store-copy':
      return buildRetailGameDataEntries()
    case 'existing-folder':
      return buildFolderGameDataEntries(input.folderPakNames ?? [])
    default:
      return buildGameDataEntries()
  }
}

/**
 * Pure: the explicit list of files this run intends to copy. Does not touch disk - `video/*`/
 * `players/*` are only named here as directories to expand later, in `assembleInstallation`,
 * against whichever source dir actually has them.
 *
 * Dispatches on `input.engine` for the engine-specific block; the game-data entries (demo,
 * point-release, or - story 088 D3 - retail) are the same regardless of engine, and selected by
 * `input.dataSource` rather than by engine. `buildAssemblePlan` is only ever called with an engine
 * from `BOOTSTRAP_SUPPORTED_ENGINES` (the wizard/job gate it upstream), so an unknown engine here
 * throws rather than silently falling back to Q2PRO's plan. `engine` may be omitted entirely
 * (story 088 D3's `copyRetailGameData`, which copies game data only) - the plan then carries no
 * engine-role entries at all.
 */
export function buildAssemblePlan(input: BuildAssemblePlanInput): AssembleFileEntry[] {
  // `video/*`/`players/*` are not literal entries here - a glob is not a relative path. When the
  // toggle is on, `assembleInstallation` expands GLOB_DIRS at copy time against whichever source
  // dir actually has them, rather than this pure function guessing file names in advance.
  void input.includeVideoAndPlayers

  const gameData = selectGameDataEntries(input)

  if (input.engine === undefined) {
    return gameData
  }

  switch (input.engine) {
    case 'q2pro':
      return [...gameData, ...buildQ2proEngineEntries()]
    case 'r1q2':
      return [...gameData, ...buildR1q2EngineEntries()]
    default:
      throw new Error(
        `buildAssemblePlan cannot assemble an installation for unsupported engine ${JSON.stringify(input.engine)}`,
      )
  }
}

/** One downloaded package's extraction dir, attributed back to the manifest package that produced it. */
export interface AssembleSource {
  /** The `ManifestPackage.id` this extraction belongs to. */
  packageId: string
  /** Absolute path to the package's extraction dir. */
  dir: string
  /**
   * Story 080 D2 (AC5): which manifest-package role this extraction dir came from - `findSource`
   * restricts a plan entry's search to sources whose `role` matches the entry's own, so an
   * `engine`-role entry can never be satisfied by a `demo`/`point-release` source (or vice versa),
   * even when both happen to contain a file at the same relative path.
   */
  role: AssembleFileRole
}

export interface AssembleInstallationInput {
  /** One entry per downloaded package's extraction, tried in order for each allowlist entry. */
  sources: AssembleSource[]
  /** Absolute path to the installation root being assembled. */
  targetRoot: string
  /**
   * Which engine this run is assembling - selects the engine-specific allowlist entries. Optional
   * (story 088 D3): `copyRetailGameData` assembles game data only, with no engine entries.
   */
  engine?: EngineKind
  includeVideoAndPlayers: boolean
  /** Story 088 D3 / 089 D3: forwarded to `buildAssemblePlan` - see its own doc comment. */
  dataSource?: 'free-download' | 'store-copy' | 'existing-folder'
  /** Story 089 D3: forwarded to `buildAssemblePlan` - see its own doc comment. */
  folderPakNames?: string[]
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
 * Finds the first candidate (in order) that exists in any source of the matching `role` (in
 * order), or null if none does. Candidate order takes priority over source order, matching "an
 * ordered candidate list, first that exists wins" - a later candidate in an earlier source does
 * not pre-empt an earlier candidate found in a later source.
 *
 * Story 080 D2 (AC5): `sources` is filtered to `role` before searching - a `demo`/`point-release`
 * extraction can never satisfy an `engine`-role entry (or vice versa), even when it happens to
 * contain a file at the same relative path. Not applied to `expandGlobDir` below - `GLOB_DIRS`
 * search every source dir regardless of role, by design (see its own doc comment).
 */
async function findSource(
  sources: AssembleSource[],
  candidates: string[],
  role: AssembleFileRole,
): Promise<{ absolutePath: string; relativePath: string; packageId: string } | null> {
  const roleSources = sources.filter((source) => source.role === role)
  for (const relativePath of candidates) {
    for (const source of roleSources) {
      // Story 088 fix cycle (review F2): a `'retail'` source is a detected store installation, not
      // one of this launcher's own extractions - `inspectRetailSource` (`retail-source.ts`) already
      // resolves its `baseq2`/`pakN.pak` children case-insensitively, so the copier has to resolve
      // the exact same way. Resolving this candidate case-sensitively (`join` + `stat`) could pass
      // inspection and `verifyCopySource`'s re-check against a source spelled e.g.
      // `Baseq2/PAK0.PAK`, then fail here on a case-sensitive filesystem, after the installation is
      // already registered. Every other role's sources are this launcher's own extractions, whose
      // layout is already known exactly, so they keep the cheap case-sensitive `join`.
      //
      // Story 089 D3: `'folder'` is the same case for the same reason - a hand-picked folder is
      // foreign too, and `inspectGameDataSource` (`game-data-source.ts`) admitted it through
      // `resolveRelaxed`/`findChild`, so resolving it any more strictly here would fail a run that
      // was already registered on the strength of that verdict.
      const absolutePath =
        role === 'retail' || role === 'folder'
          ? await resolveRelaxed(source.dir, relativePath)
          : join(source.dir, relativePath)
      if (absolutePath === null) continue
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
  const { sources, targetRoot, engine, includeVideoAndPlayers, dataSource, folderPakNames } = input
  const copiedFiles: string[] = []
  const missingRequired: { role: AssembleFileRole; from: string[] }[] = []
  const entries: AssembleEntryResult[] = []

  const plan = buildAssemblePlan({ engine, includeVideoAndPlayers, dataSource, folderPakNames })
  for (const entry of plan) {
    const source = await findSource(sources, entry.from, entry.role)
    if (!source) {
      entries.push({ from: entry.from.join(' | '), to: entry.to, found: false })
      if (entry.required) {
        missingRequired.push({ role: entry.role, from: entry.from })
      }
      continue
    }

    // Story 088 D3: a found-but-wrong-size file (only `pak2.pak` sets `expectedSizeBytes` today)
    // is treated exactly like a missing one - skipped, never copied. `pak2.pak` is never
    // `required`, so this never adds to `missingRequired`.
    if (entry.expectedSizeBytes !== undefined) {
      const sourceStat = await stat(source.absolutePath)
      if (sourceStat.size !== entry.expectedSizeBytes) {
        entries.push({ from: entry.from.join(' | '), to: entry.to, found: false })
        if (entry.required) {
          missingRequired.push({ role: entry.role, from: entry.from })
        }
        continue
      }
    }

    entries.push({
      from: source.relativePath,
      to: entry.to,
      found: true,
      sourcePackageId: source.packageId,
    })

    const dest = join(targetRoot, entry.to)
    await mkdir(dirname(dest), { recursive: true })
    // Story 089 review F3: `cp`'s `dereference` defaults to `false`, so a symlinked source file
    // (reachable for every role now that this story lets the source folder be entirely
    // renderer/user-picked) would land as a symlink at `dest`, still pointing at the original -
    // not the independent copy AC3 promises. Forced true so the target is always real bytes.
    await cp(source.absolutePath, dest, { dereference: true })
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
        await cp(source, dest, { recursive: true, dereference: true })
        copiedFiles.push(toRelative)
      }
    }
  }

  return { copiedFiles, missingRequired, entries }
}
