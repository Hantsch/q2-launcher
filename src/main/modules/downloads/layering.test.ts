import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_CSP } from '../../lib/renderer-source'

/**
 * Story 071 D5 (AC7): "the downloads pipeline is unreachable from the renderer and does no work
 * outside main". This is proven here by actually walking the real source tree at test time -
 * rather than hardcoding a file list - so the guard stays correct as files are added later.
 *
 * Three things are asserted:
 *  1. No file under `src/renderer/src` imports anything from `src/main/modules/downloads/`, by
 *     relative path or the `@main/*` alias (`tsconfig.node.json`) that resolves there.
 *  2. No file under `src/renderer/src` or `src/preload` contains a leaked/duplicated
 *     spawn-or-network token (`child_process`, `net.fetch`, `7za`, `spawn(`) - a plainer, less
 *     brittle check than parsing every possible call shape, and one that also catches a
 *     copy-pasted duplicate that was never a literal import.
 *  3. No file under `src/main` outside `src/main/modules/downloads/` - other than the small,
 *     named allowlist of pre-existing, unrelated spawn/network use sites - contains those same
 *     tokens, so the downloads pipeline's own spawn/network usage does not leak elsewhere in main.
 *  4. The production CSP (`connect-src 'self'`) is unchanged, pinned directly against the exported
 *     constant in `renderer-source.ts` - in addition to, not instead of, the pre-existing
 *     `renderer-source.test.ts`, which stays untouched.
 */

const REPO_ROOT = resolve(__dirname, '../../../..')
const RENDERER_SRC = resolve(REPO_ROOT, 'src/renderer/src')
const PRELOAD_SRC = resolve(REPO_ROOT, 'src/preload')
const MAIN_SRC = resolve(REPO_ROOT, 'src/main')
const DOWNLOADS_MODULE = resolve(REPO_ROOT, 'src/main/modules/downloads')

/**
 * Pre-existing, unrelated spawn/network use sites in `src/main` that predate this story and have
 * nothing to do with the downloads pipeline - named explicitly so the guard does not false-positive
 * on legitimate code while still catching anything new.
 *
 *  - `services/launch.ts` spawns the game executable (`child_process.spawn`).
 *  - `lib/win-registry.ts` shells out to `reg.exe` (`child_process.execFile`) to read the Windows
 *    registry, since every native alternative needs a prebuild.
 *  - `lib/renderer-source.ts` only *mentions* `net.fetch` in a doc comment (contrasting its own
 *    protocol handler with delegating to `net.fetch(file://...)`) - not an actual network call.
 *  - `modules/home/news/feed-fetcher.ts` (story 082 D5) only *mentions* `net.fetch` in its own
 *    module doc comment, contrasting the global `fetch` it actually uses with `net.fetch` (which it
 *    deliberately does not use, same reasoning as `renderer-source.ts` above) - not an actual
 *    network call via that API. Its real network calls go through the global `fetch`, which this
 *    guard does not - and is not meant to - flag: the `home` module's own `network` capability
 *    (`src/shared/types/module.ts`) is what authorizes them.
 */
const ALLOWED_MAIN_SPAWN_NETWORK_FILES = new Set(
  [
    'src/main/services/launch.ts',
    'src/main/lib/win-registry.ts',
    'src/main/lib/renderer-source.ts',
    'src/main/modules/home/news/feed-fetcher.ts',
  ].map((p) => resolve(REPO_ROOT, p)),
)

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

function listSourceFiles(root: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(root, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext)) && !full.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Matches every import/export/require specifier a `.ts`/`.tsx` file can contain. */
const IMPORT_SPECIFIER_PATTERN =
  /(?:import|export)(?:[^'"]*?)from\s*['"]([^'"]+)['"]|(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g

function importSpecifiersOf(fileContents: string): string[] {
  const specifiers: string[] = []
  for (const match of fileContents.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1] ?? match[2]
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}

/** Resolves a relative or `@main/*`-aliased specifier to an absolute path, or `null` otherwise. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    return resolve(dirname(fromFile), specifier)
  }
  if (specifier.startsWith('@main/')) {
    return resolve(MAIN_SRC, specifier.slice('@main/'.length))
  }
  return null
}

function isUnderDownloadsModule(resolvedPath: string): boolean {
  const normalized = resolvedPath.replace(/\\/g, '/')
  const downloads = DOWNLOADS_MODULE.replace(/\\/g, '/')
  return normalized === downloads || normalized.startsWith(`${downloads}/`)
}

const SPAWN_NETWORK_TOKENS = ['child_process', 'net.fetch', '7za', 'spawn(']

describe('downloads pipeline layering (story 071 AC7)', () => {
  it('is not imported by any file under src/renderer/src, by relative path or the @main alias', () => {
    const violations: string[] = []

    for (const file of listSourceFiles(RENDERER_SRC)) {
      const contents = readFileSync(file, 'utf-8')
      for (const specifier of importSpecifiersOf(contents)) {
        const resolved = resolveSpecifier(file, specifier)
        if (resolved && isUnderDownloadsModule(resolved)) {
          violations.push(`${file} imports "${specifier}" (resolves into downloads module)`)
        }
        // A stray, unresolvable `@main/modules/downloads/...` specifier (no relative-path
        // resolution rule matches it) is still a violation worth naming explicitly.
        if (specifier.includes('main/modules/downloads')) {
          violations.push(`${file} imports "${specifier}"`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('leaves no child_process/net.fetch/7za/spawn( token in src/renderer/src or src/preload', () => {
    const violations: string[] = []

    for (const root of [RENDERER_SRC, PRELOAD_SRC]) {
      for (const file of listSourceFiles(root)) {
        const contents = readFileSync(file, 'utf-8')
        for (const token of SPAWN_NETWORK_TOKENS) {
          if (contents.includes(token)) {
            violations.push(`${file} contains "${token}"`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('confines child_process/net.fetch/7za/spawn( usage in src/main to the downloads module and the pre-existing allowlist', () => {
    const violations: string[] = []

    for (const file of listSourceFiles(MAIN_SRC)) {
      if (isUnderDownloadsModule(file)) continue
      if (ALLOWED_MAIN_SPAWN_NETWORK_FILES.has(file)) continue

      const contents = readFileSync(file, 'utf-8')
      for (const token of SPAWN_NETWORK_TOKENS) {
        if (contents.includes(token)) {
          violations.push(`${file} contains "${token}"`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('leaves the production CSP unchanged (connect-src \'self\')', () => {
    expect(PRODUCTION_CSP).toContain("connect-src 'self'")
    expect(PRODUCTION_CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    )
  })
})
