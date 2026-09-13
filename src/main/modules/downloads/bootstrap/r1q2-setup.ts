import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findRepoRoot } from '../7za-path'
import type { BootstrapLog } from './ports'

/**
 * Story 080 D3: the three small, independently testable pieces R1Q2 needs beyond what
 * `assemble.ts`/`job.ts` already do generically - detecting the x86 VC++ runtime its binaries
 * import (AC5), seeding the one cvar a fresh install needs to find its renderer (AC4), and
 * installing the license text that backs AC8's "the installed license files expose completed
 * license notices" claim. `job.ts` reaches these only through the `R1q2SetupPort` (`ports.ts`), so
 * it can be tested with fakes; the exports here are the real, production implementations.
 */

/**
 * Whether `vcruntime140.dll` (part of the x86 Visual C++ Redistributable) is present under one of
 * Windows' well-known system directories. `SysWOW64` first - where a 64-bit Windows keeps its
 * 32-bit system DLLs - falling back to `System32` (a 32-bit Windows has no `SysWOW64` at all).
 * `fileExists` is injected rather than reaching for `node:fs` directly, so a unit test can fake
 * "present"/"missing" without touching the real machine; `realFileExists` below is the production
 * implementation.
 */
export async function probeX86Runtime(deps: {
  fileExists: (path: string) => Promise<boolean>
}): Promise<boolean> {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const candidates = [
    join(systemRoot, 'SysWOW64', 'vcruntime140.dll'),
    join(systemRoot, 'System32', 'vcruntime140.dll'),
  ]
  for (const candidate of candidates) {
    if (await deps.fileExists(candidate)) return true
  }
  return false
}

/** The production `fileExists` for `probeX86Runtime` - a real `node:fs/promises` `access` probe. */
export async function realFileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Forces R1Q2's renderer choice on a fresh install (AC4): the pinned package only carries
 * `ref_r1gl.dll`, not `ref_gl.dll`, so `win32/vid_dll.c`'s own default of `vid_ref "gl"` would leave
 * a first launch unable to find a renderer at all. Writes `baseq2/autoexec.cfg` with a single
 * `set vid_ref "r1gl"` line - but only when that file does not already exist, which is what makes a
 * retry preserve whatever the user has since written into it. Never throws on a pre-existing file:
 * that case is a no-op, not an error.
 */
export async function seedR1glConfig(targetRoot: string): Promise<void> {
  const path = join(targetRoot, 'baseq2', 'autoexec.cfg')
  try {
    await access(path)
    return
  } catch {
    // Does not exist yet - fall through and write it.
  }
  await mkdir(join(targetRoot, 'baseq2'), { recursive: true })
  await writeFile(path, 'set vid_ref "r1gl"\n')
}

/**
 * Story 080 finding fix: resolves the absolute path to the checked-in R1Q2 GPL-3.0.txt license
 * text, mirroring `resolveExtractorPath`'s exact shape (`../7za-path.ts`) - the earlier
 * `DEFAULT_LICENSE_SOURCE` hardcoded an absolute path on the author's own machine, which does not
 * exist on any other checkout, packaged build, or CI, so `installR1q2Notices` threw ENOENT
 * everywhere else and AC8's license notice was silently never installed for a real user.
 *
 * Dev: `resources/licenses/r1q2/GPL-3.0.txt`, found by the same repo-root walk-up
 * `resolveExtractorPath` uses (`findRepoRoot`). Packaged: `process.resourcesPath/licenses/r1q2/
 * GPL-3.0.txt`, matching this module's `electron-builder.yml` `extraResources` entry
 * (`resources/licenses/r1q2` -> `licenses/r1q2`).
 *
 * Deliberately takes its inputs as parameters rather than importing `electron` at module scope,
 * for the same reason `resolveExtractorPath` does - plain, synchronous, and testable without a
 * real Electron runtime.
 */
export interface R1q2LicensePathInput {
  /** `app.isPackaged` in production; pass `false` in dev and in tests. */
  isPackaged: boolean
  /** `process.resourcesPath` in production; ignored when `isPackaged` is `false`. */
  resourcesPath?: string
  /** Repo root in dev; ignored when `isPackaged` is `true`. Defaults to this file's repo root. */
  repoRoot?: string
}

const LICENSE_RELATIVE_PATH = ['licenses', 'r1q2', 'GPL-3.0.txt']

const DEFAULT_REPO_ROOT = findRepoRoot(__dirname)

export function resolveR1q2LicensePath(input: R1q2LicensePathInput): string {
  return input.isPackaged
    ? join(input.resourcesPath ?? '', ...LICENSE_RELATIVE_PATH)
    : join(input.repoRoot ?? DEFAULT_REPO_ROOT, 'resources', ...LICENSE_RELATIVE_PATH)
}

/**
 * Copies the R1Q2 mirror's GPLv3 license text into the installed target (AC8), so "the installed
 * license files expose completed license notices" is literally true of the files on disk rather
 * than only of the wizard's own UI copy. `licenseSourceOverride` lets a test (or `job.ts`, which
 * resolves the real path through `resolveR1q2LicensePath`/`BootstrapDeps.resolveR1q2LicensePath`)
 * point this at a specific file; it has no hardcoded production default of its own any more.
 *
 * Best-effort, matching this file's neighbours (`removeDir`/`listExtraction` in `job.ts`): a missing
 * or unreadable license file is logged through `log` and swallowed, never a reason to fail the whole
 * bootstrap over a text file.
 */
export async function installR1q2Notices(
  targetRoot: string,
  licenseSourceOverride?: string,
  log?: BootstrapLog,
): Promise<void> {
  // No hardcoded production default any more (see the finding fix above): the real path is
  // resolved by the caller (`job.ts`, through `BootstrapDeps.resolveR1q2LicensePath`) and always
  // passed in explicitly. `licenseSourceOverride` stays optional only so a caller with nothing to
  // pass gets the same best-effort "log and swallow" behaviour as every other missing-file case
  // here, rather than a distinct crash.
  const source = licenseSourceOverride ?? ''
  try {
    const text = await readFile(source, 'utf8')
    await writeFile(join(targetRoot, 'LICENSE-r1q2-GPL-3.0.txt'), text)
  } catch (error) {
    log?.warn(`could not install the R1Q2 GPLv3 license notice into ${targetRoot}: ${String(error)}`)
  }
}
