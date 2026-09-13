import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'

/**
 * Story 081 D3 (AC2, AC3): the shell gave the home route back to a registered module and deleted
 * the dead hero. This test does not trust a name string that a future edit could spoof - it walks
 * the actual directories the story forbids a home import in, and checks the actual file the hero
 * lived in is actually gone. If `HeroPanel.tsx` reappears, or a shell/views file re-imports a home
 * component, this fails.
 *
 * The only legitimate way to reach the home module's `View` is through the `RENDERER_MODULES`
 * registry in `src/renderer/src/modules/index.ts`, which sits outside both scanned directories, so
 * it never trips this guard.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SHELL_DIR = HERE
const VIEWS_DIR = join(HERE, '..', '..', 'views')
const HERO_PANEL_PATH = join(SHELL_DIR, 'HeroPanel.tsx')

function listFilesRecursively(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...listFilesRecursively(full))
    } else {
      out.push(full)
    }
  }
  return out
}

const THIS_FILE = fileURLToPath(import.meta.url)

function readAllSourceFiles(dirs: string[]): Array<{ path: string; text: string }> {
  return dirs
    .flatMap((dir) => listFilesRecursively(dir))
    .filter((path) => /\.(ts|tsx)$/.test(path))
    // Exclude this guard test itself: it necessarily names `HeroPanel` and home-view import
    // patterns in its own source (as strings/regexes), which would otherwise trip its own checks.
    .filter((path) => path !== THIS_FILE)
    .map((path) => ({ path, text: readFileSync(path, 'utf-8') }))
}

/** Every home-screen component this codebase has ever had, plus a generic pattern for the module path. */
const HOME_IMPORT_PATTERNS = [
  /from\s+['"].*\/views\/HomeView['"]/,
  /from\s+['"].*\/modules\/home\/HomeView['"]/,
  /import\s+.*HomeView/,
]

describe('shell home ownership (story 081)', () => {
  it('no shell file imports a home-screen component', () => {
    const files = readAllSourceFiles([SHELL_DIR, VIEWS_DIR])

    const offenders = files.filter(({ text }) =>
      HOME_IMPORT_PATTERNS.some((pattern) => pattern.test(text)),
    )

    expect(offenders.map((f) => f.path)).toEqual([])
  })

  it('the hero panel and its carousel dots are gone', () => {
    // The file itself is gone.
    expect(existsSync(HERO_PANEL_PATH)).toBe(false)

    // Nothing under shell/ or views/ mentions it any more (import, comment, or otherwise).
    const files = readAllSourceFiles([SHELL_DIR, VIEWS_DIR])
    const mentions = files.filter(({ text }) => text.includes('HeroPanel'))
    expect(mentions.map((f) => f.path)).toEqual([])

    // No hero.* i18n key survives anywhere in the tree - not just at the top level.
    expect(collectKeyPaths(en, '').some((path) => path === 'hero' || path.startsWith('hero.'))).toBe(
      false,
    )
  })
})

function collectKeyPaths(node: unknown, prefix: string): string[] {
  if (!node || typeof node !== 'object') return []
  const paths: string[] = []
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    paths.push(path, ...collectKeyPaths(child, path))
  }
  return paths
}
