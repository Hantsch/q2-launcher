import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Story 100 D1. The suite must pass on any host (see `src/test-support/platform.ts`), which only
 * holds if nothing in the suite quietly assumes the platform it happens to be running on. A test
 * that does `expect(process.platform).toBe('win32')` (as `diagnostics.test.ts` used to) locks the
 * whole run to one OS instead of stubbing the case it actually needs via `stubPlatform`.
 *
 * This is a guard, not a one-off check: it scans every test file in the suite and fails if the
 * pattern comes back, so a future PR can't silently reintroduce it.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// A direct `expect(...)` assertion against `process.platform` - the pattern this guard forbids.
// Conditional branches like `if (process.platform === 'win32')` or a ternary that picks a
// platform-appropriate fixture value are not assertions about the host and are fine; several
// existing tests (e.g. `src/main/lib/archive/extractor.test.ts`,
// `src/main/services/installations.test.ts`) rely on exactly that pattern to build
// platform-correct behaviour rather than to assert the test host is a given platform.
const FORBIDDEN_PATTERN = /expect\((?:[^()]|\([^()]*\))*process\.platform/g

// `src/test-support/platform.ts` is the one file allowed to touch `process.platform` directly -
// it isn't a test file, so it is never walked below, but it's named here for clarity. This file
// itself is excluded too: it necessarily quotes the forbidden pattern in comments/strings while
// describing what it scans for, which would otherwise flag itself as an offender.
const ALLOWED_FILES = [
  join('src', 'test-support', 'platform.ts'),
  join('scripts', 'platform-assertions.test.mjs'),
]

const TEST_FILE = (name) => /\.test\.(ts|tsx|mjs)$/.test(name)

function walk(dir, matches, accept = TEST_FILE) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, matches, accept)
    } else if (entry.isFile() && accept(entry.name)) {
      matches.push(full)
    }
  }
  return matches
}

function findTestFiles() {
  const files = []
  walk(join(repoRoot, 'src'), files)
  walk(join(repoRoot, 'scripts'), files)
  return files
}

describe('no test asserts the host platform', () => {
  it('finds no expect() assertion against process.platform outside stubPlatform', () => {
    const offenders = []

    for (const file of findTestFiles()) {
      const relPath = relative(repoRoot, file).split(sep).join('/')
      if (ALLOWED_FILES.some((allowed) => relPath === allowed.split(sep).join('/'))) continue

      const text = readFileSync(file, 'utf8')
      const matches = text.match(FORBIDDEN_PATTERN)
      if (matches && matches.length > 0) {
        offenders.push(`${relPath}: ${matches.join(', ')}`)
      }
    }

    expect(
      offenders,
      `Found direct assertions against process.platform. Stub the platform with ` +
        `stubPlatform() from src/test-support/platform.ts instead:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})

describe('direct platform reads in main services and modules', () => {
  it('keeps direct process.platform reads in services and modules below 10, each with a reason', () => {
    const files = []
    const accept = (name) => name.endsWith('.ts') && !name.includes('.test.ts')
    walk(join(repoRoot, 'src', 'main', 'services'), files, accept)
    walk(join(repoRoot, 'src', 'main', 'modules'), files, accept)

    let count = 0
    const unexplained = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!line.includes('process.platform')) return
        count += line.split('process.platform').length - 1
        if (!line.includes('platform-read:') && !(lines[i - 1] ?? '').includes('platform-read:')) {
          unexplained.push(`${relative(repoRoot, file).split(sep).join('/')}:${i + 1}`)
        }
      })
    }

    expect(count, 'Use isWindows()/isLinux() from src/main/lib/platform.ts instead.').toBeLessThan(
      10,
    )
    expect(unexplained, 'Annotate each read with a "// platform-read: <reason>" comment.').toEqual(
      [],
    )
  })
})
