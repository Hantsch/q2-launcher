import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Shared test helpers live in `src/test-support/`; these guards keep the copies from creeping
 * back into individual test files.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = join(repoRoot, 'src')

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

function filesDefining(needle) {
  const testSupport = join('src', 'test-support') + sep
  return [...walk(srcRoot)]
    .map((path) => relative(repoRoot, path))
    .filter((path) => /\.(ts|tsx)$/.test(path) && !path.startsWith(testSupport))
    .filter((path) => readFileSync(join(repoRoot, path), 'utf8').includes(needle))
}

describe('test kit guards', () => {
  it('no main test defines its own fakeAppContext', () => {
    expect(filesDefining('function fakeAppContext(')).toEqual([])
    expect(filesDefining('const fakeAppContext =')).toEqual([])
  })

  it('downloads job tests define no local fakeState/fakeLaunch/fakeExtractor/fakeManifest/fakeFetcher', () => {
    const downloads = join('src', 'main', 'modules', 'downloads') + sep
    const shared = join(downloads, 'test-support.ts')
    const local =
      /(?:function (?:fakeState|fakeLaunch|fakeExtractor|fakeManifest|fakeFetcher)\(|const (?:fakeState|fakeLaunch|fakeExtractor|fakeManifest|fakeFetcher) =)/
    const offenders = [...walk(srcRoot)]
      .map((path) => relative(repoRoot, path))
      .filter((path) => path.startsWith(downloads) && path !== shared && /\.(ts|tsx)$/.test(path))
      .filter((path) => local.test(readFileSync(join(repoRoot, path), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('no test under src defines its own makeInstallation', () => {
    expect(filesDefining('function makeInstallation(')).toEqual([])
    expect(filesDefining('const makeInstallation =')).toEqual([])
  })

  it('no test defines its own makeJob', () => {
    expect(filesDefining('function makeJob(')).toEqual([])
    expect(filesDefining('const makeJob =')).toEqual([])
  })

  it('every renderer client mock goes through mockClient', () => {
    const scoped = [join('src', 'renderer')]
    // Anchored to a line start so a doc comment that mentions `vi.mock('./client', ...)` is no call.
    const mockCall = /^[ \t]*vi\.mock\(\s*['"][^'"]*client['"]\s*,/gm
    const offenders = []
    for (const path of [...walk(srcRoot)].map((p) => relative(repoRoot, p))) {
      if (!/\.test\.(ts|tsx)$/.test(path) || !scoped.some((dir) => path.startsWith(dir + sep)))
        continue
      const text = readFileSync(join(repoRoot, path), 'utf8')
      for (const match of text.matchAll(mockCall)) {
        // The factory runs up to the next top-level statement; a blank line ends it.
        const rest = text.slice(match.index)
        const end = rest.search(/\r?\n\r?\n/)
        const factory = end === -1 ? rest : rest.slice(0, end)
        if (!/mockClient\s*[<(]/.test(factory)) offenders.push(path)
      }
    }
    expect(offenders).toEqual([])
  })

  it('round-trip describes carry no story numbers', () => {
    const dir = join(srcRoot, 'main', 'modules', 'config', 'round-trip')
    const offenders = []
    for (const path of walk(dir)) {
      if (!path.endsWith('.ts')) continue
      for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        if (/describe\(/.test(line) && /story \d{3}/i.test(line)) {
          offenders.push(`${relative(repoRoot, path)}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // Hard cap. An entry needs a reason; without one the cap is a failure, not a suggestion.
  const ALLOWED_OVER_CAP = {
    // 'src/path/to/file.test.ts': 'reason this file cannot be split',
  }

  it('no test file exceeds 1,500 lines', () => {
    const roots = [srcRoot, join(repoRoot, 'scripts')]
    const offenders = []
    for (const root of roots) {
      for (const full of walk(root)) {
        const path = relative(repoRoot, full).split(sep).join('/')
        const isTest = root === srcRoot ? /\.test\.(ts|tsx)$/.test(path) : /\.test\.mjs$/.test(path)
        if (!isTest || path in ALLOWED_OVER_CAP) continue
        const lines = readFileSync(full, 'utf8').split(/\r?\n/).length
        if (lines > 1500) offenders.push(`${path} (${lines} lines)`)
      }
    }
    expect(offenders, `test files over 1,500 lines: ${offenders.join(', ')}`).toEqual([])
  })

  it('ARCHITECTURE.md has a Testing section naming the kit, installTempDir and the 1,500-line cap', () => {
    const doc = readFileSync(join(repoRoot, 'docs', 'ARCHITECTURE.md'), 'utf8')
    const start = doc.search(/^## Testing\s*$/m)
    expect(start).toBeGreaterThanOrEqual(0)
    const rest = doc.slice(start + 3)
    const next = rest.search(/^## /m)
    const section = next === -1 ? rest : rest.slice(0, next)
    for (const needle of ['src/test-support/', 'installTempDir', '1,500']) {
      expect(section).toContain(needle)
    }
  })
})
