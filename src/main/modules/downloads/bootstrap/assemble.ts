import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Story 074 D3. Assembles a clean `baseq2` installation out of the bootstrap wizard's separate
 * archive extractions (Q2PRO engine build, `q2-314-demo-x86.exe`, `q2-3.20-x86-full-ctf.exe`).
 *
 * AC8 is a hard negative requirement: the 3.20 package also contains a `ctf/` payload that must
 * never end up in the target installation, alongside `xatrix/`/`rogue/` from other real-world Q2
 * archives. The mechanism that guarantees this is an *allowlist*, not a filter: `buildAssemblePlan`
 * enumerates the exact files this function is willing to copy, and `assembleInstallation` never
 * reads or copies anything outside that list - no recursive directory copy of an extraction tree,
 * ever, however that tree is laid out. `video/*`/`players/*` are the only "glob-like" entries, and
 * even those are expanded by listing that one specific subdirectory's immediate children, not by
 * touching anything else in the source tree.
 */

/** One file to copy, resolved relative to a source extraction dir and to the target installation root. */
export interface AssembleFileEntry {
  /** Relative path inside one of the extracted source trees (`sourceDirs`, tried in order). */
  from: string
  /** Relative path inside the target installation root, e.g. `baseq2/pak0.pak`. */
  to: string
}

export interface BuildAssemblePlanInput {
  /** Whether the wizard's video/players toggle is on - see the module doc comment above. */
  includeVideoAndPlayers: boolean
}

/**
 * The fixed, non-glob part of the allowlist.
 *
 * Every `from` here is a path relative to an extracted archive's own root. Story 074 D8 ran all
 * three of these through the real pipeline - real `7za.exe`, real extraction, real
 * `inspectInstallation` afterwards - against its fixture archives
 * (`scripts/lib/fixture.mjs`'s `writeBootstrapFixture()`), which are laid out exactly like this,
 * i.e. paks under `baseq2/` and the engine binary at the archive root. That is what
 * `scripts/flows/bootstrap-wizard.mjs` proves end to end, and it matches the documented root
 * layout of the pinned Q2PRO release zip (`q2pro-client_win64_x64.zip`:
 * `q2pro.exe`/`q2ded.exe`/`baseq2/` at the top level).
 *
 * **Still unverified residue:** the two id Software packages the shipped manifest pins
 * (`content/q2_community_content/gamedata/manifest.json`) are self-extracting `.exe` installers,
 * and nobody has yet extracted either of them with `7za.exe` and looked at the result - so whether
 * the real demo's `pak0.pak` sits at `baseq2/pak0.pak` or under an installer-specific wrapper
 * directory is not something this comment can claim. If it turns out to be nested, the fix is to
 * add the extra literal path here (a longer allowlist), never a recursive search: AC8's guarantee
 * is that nothing outside this list is ever read.
 */
function buildFixedEntries(): AssembleFileEntry[] {
  return [
    { from: 'baseq2/pak0.pak', to: 'baseq2/pak0.pak' },
    { from: 'baseq2/pak2.pak', to: 'baseq2/pak2.pak' },
    { from: 'q2pro.exe', to: 'q2pro.exe' },
    // The engine build's own game module DLL - without it the engine binary above has nothing to
    // load a map with, so a "playable" installation missing this entry could not actually run a
    // map even though `inspectInstallation` may still call it playable (that inspector only checks
    // for the engine binary + base game dir, not for this DLL). Filename mirrors
    // `scripts/lib/fixture.mjs`'s `buildBootstrapPackages()` engine-package fixture, which writes
    // it at `baseq2/gamex86_64.dll` inside the engine archive on purpose (D8's own comment there:
    // "the real engine build does ship a `baseq2/` of its own (game DLLs)").
    // TODO: the pinned Q2PRO release zip's exact game-module filename (x86 vs x64 build) has not
    // yet been confirmed against a real download - if it differs, add the real name here alongside
    // (or instead of) this one; never widen this into anything but another literal entry.
    { from: 'baseq2/gamex86_64.dll', to: 'baseq2/gamex86_64.dll' },
  ]
}

/** Directories whose immediate children are copied by name when the toggle is on. */
const GLOB_DIRS = ['video', 'players'] as const

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

export interface AssembleInstallationInput {
  /** One directory per downloaded package's extraction, tried in order for each allowlist entry. */
  sourceDirs: string[]
  /** Absolute path to the installation root being assembled. */
  targetRoot: string
  includeVideoAndPlayers: boolean
}

export interface AssembleInstallationResult {
  /** Target-relative paths that were actually copied. */
  copiedFiles: string[]
}

/** Finds the first source dir (in order) that has `relativePath`, or null if none does. */
async function findSource(sourceDirs: string[], relativePath: string): Promise<string | null> {
  for (const sourceDir of sourceDirs) {
    const candidate = join(sourceDir, relativePath)
    try {
      await stat(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return null
}

/** Lists the immediate children of `dirRelativePath` in whichever source dir has it, by name. */
async function expandGlobDir(
  sourceDirs: string[],
  dirRelativePath: string,
): Promise<{ absoluteDir: string; names: string[] } | null> {
  for (const sourceDir of sourceDirs) {
    const absoluteDir = join(sourceDir, dirRelativePath)
    try {
      const names = await readdir(absoluteDir)
      return { absoluteDir, names }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Copies exactly the allowlisted files (`buildAssemblePlan`) out of `sourceDirs` into
 * `targetRoot`. Never copies a whole directory tree - `video/*`/`players/*` are expanded to their
 * immediate children and copied one by one. A missing allowlisted file is skipped, not thrown: a
 * job-level caller decides what "the download didn't produce a required file" means.
 */
export async function assembleInstallation(
  input: AssembleInstallationInput,
): Promise<AssembleInstallationResult> {
  const { sourceDirs, targetRoot, includeVideoAndPlayers } = input
  const copiedFiles: string[] = []

  const plan = buildAssemblePlan({ includeVideoAndPlayers })
  for (const entry of plan) {
    const source = await findSource(sourceDirs, entry.from)
    if (!source) continue

    const dest = join(targetRoot, entry.to)
    await mkdir(dirname(dest), { recursive: true })
    await cp(source, dest)
    copiedFiles.push(entry.to)
  }

  if (includeVideoAndPlayers) {
    for (const dirRelativePath of GLOB_DIRS) {
      const expanded = await expandGlobDir(sourceDirs, dirRelativePath)
      if (!expanded) continue

      const toBase = dirRelativePath === 'video' ? join('baseq2', 'video') : 'players'
      for (const name of expanded.names) {
        const source = join(expanded.absoluteDir, name)
        const toRelative = join(toBase, name)
        const dest = join(targetRoot, toRelative)
        await mkdir(dirname(dest), { recursive: true })
        await cp(source, dest, { recursive: true })
        copiedFiles.push(toRelative)
      }
    }
  }

  return { copiedFiles }
}
