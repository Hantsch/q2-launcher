import { describe, expect, test, vi } from 'vitest'
import { UNRELEASED_PLACEHOLDER } from './lib/release/changelog.mjs'
import { planRelease } from './lib/release/plan.mjs'
import { ghReleaseArgv, parseArgs, runRelease } from './release.mjs'

/**
 * Story 096 D4 - the runner's three "accepted when" criteria: a dry run prints version + notes and
 * touches nothing; a non-dry run outside CI refuses; the git/gh command list matches what
 * `plan.mjs` produced.
 *
 * Every effect the runner can have is an injected collaborator, so "touches nothing" is asserted
 * as "this stub was never called" - no git, no gh, no electron-builder, no real file is involved
 * in any test here. That is the whole point of the seam: the irreversible paths (a pushed tag, a
 * published release) are proven side-effect-free without ever being performed.
 */

const TODAY = '2026-03-01'
const NOTES_FILE = '/tmp/q2-release-fake/RELEASE_NOTES.md'
const ASSETS = [
  '/repo/release/1.0.0-beta.2/Q2 Launcher-1.0.0-beta.2-win-x64.exe',
  '/repo/release/1.0.0-beta.2/Q2 Launcher-1.0.0-beta.2-win-x64.zip',
  '/repo/release/1.0.0-beta.2/Q2 Launcher-1.0.0-beta.2-win-x64.exe.blockmap',
  '/repo/release/1.0.0-beta.2/Q2 Launcher-1.0.0-beta.2-win-x64.zip.blockmap',
  '/repo/release/1.0.0-beta.2/latest.yml',
]

const PKG_TEXT = JSON.stringify({ name: 'q2-launcher', version: '1.0.0-beta.1' }, null, 2) + '\n'
const LOCK_TEXT =
  JSON.stringify(
    {
      name: 'q2-launcher',
      version: '1.0.0-beta.1',
      lockfileVersion: 3,
      packages: { '': { name: 'q2-launcher', version: '1.0.0-beta.1' } },
    },
    null,
    2,
  ) + '\n'

const POPULATED_CHANGELOG = `# Changelog

## Unreleased

### Added
- a new thing

### Fixed
- a bug

## 1.0.0-beta.1 — 2026-01-01

### Added
- the first beta
`

const EMPTY_CHANGELOG = `# Changelog

## Unreleased

${UNRELEASED_PLACEHOLDER}

## 1.0.0-beta.1 — 2026-01-01

### Added
- the first beta
`

const TAGS = ['v1.0.0-beta.1']

/**
 * @param {{ env?: Record<string, string|undefined>, changelogText?: string }} [options]
 * @returns {import('./release.mjs').ReleaseDeps & Record<string, any>}
 */
function createDeps({ env = { CI: 'true' }, changelogText = POPULATED_CHANGELOG } = {}) {
  const files = {
    'CHANGELOG.md': changelogText,
    'package.json': PKG_TEXT,
    'package-lock.json': LOCK_TEXT,
  }
  return {
    readFile: vi.fn((path) => {
      if (!(path in files)) throw new Error(`unexpected read of ${path}`)
      return files[path]
    }),
    writeFile: vi.fn(),
    listTags: vi.fn(() => [...TAGS]),
    runBuild: vi.fn(),
    collectAssets: vi.fn(() => [...ASSETS]),
    writeNotesFile: vi.fn(() => NOTES_FILE),
    run: vi.fn(),
    today: vi.fn(() => TODAY),
    env,
    log: vi.fn(),
    logError: vi.fn(),
  }
}

/** Every collaborator that changes something outside the runner's own memory. */
function assertNothingMutated(deps) {
  expect(deps.writeFile).not.toHaveBeenCalled()
  expect(deps.writeNotesFile).not.toHaveBeenCalled()
  expect(deps.run).not.toHaveBeenCalled()
}

describe('runRelease - a dry run prints version + notes and touches nothing', () => {
  test('bumps the version to build against, then reverts it - runs no git or gh command', () => {
    // Deliberately not CI: a dry run is the one thing that stays available locally.
    const deps = createDeps({ env: {} })

    const result = runRelease({ dryRun: true }, deps)

    expect(result.code).toBe(0)
    expect(result.status).toBe('dry-run')
    expect(result.version).toBe('1.0.0-beta.2')
    expect(result.tag).toBe('v1.0.0-beta.2')

    // AC5: "prints the version it would release and the notes it would publish".
    const printed = deps.log.mock.calls.map(([line]) => line).join('\n')
    expect(printed).toContain('1.0.0-beta.2')
    expect(printed).toContain('- a new thing')
    expect(printed).toContain('- a bug')
    expect(result.notes).toContain('- a new thing')

    // AC5: "performs every step including the build" - the build and the asset check DO run,
    // against the BUMPED version, because that's what electron-builder itself reads from
    // package.json to pick its output directory and name its artifacts.
    expect(deps.runBuild).toHaveBeenCalledTimes(1)
    expect(deps.collectAssets).toHaveBeenCalledWith('release/1.0.0-beta.2', '1.0.0-beta.2')
    expect(result.assets).toEqual(ASSETS)

    // The bump (CHANGELOG.md, package.json, package-lock.json) is written BEFORE the build runs
    // and the asset check follows it, then - because this is a dry run - the same three files are
    // written AGAIN, this time with their ORIGINAL content, after the asset check succeeds. Order
    // is exactly the bug that broke this before: write (bump) -> build -> collectAssets -> write
    // (revert).
    const writeCalls = deps.writeFile.mock.calls
    expect(writeCalls.map(([path]) => path)).toEqual([
      'CHANGELOG.md',
      'package.json',
      'package-lock.json',
      'CHANGELOG.md',
      'package.json',
      'package-lock.json',
    ])
    // The bump writes carry the promoted/bumped content ...
    expect(writeCalls[0][1]).not.toBe(POPULATED_CHANGELOG)
    expect(writeCalls[1][1]).not.toBe(PKG_TEXT)
    expect(writeCalls[2][1]).not.toBe(LOCK_TEXT)
    // ... and the revert writes restore the exact text that was read at the start of the run.
    expect(writeCalls[3][1]).toBe(POPULATED_CHANGELOG)
    expect(writeCalls[4][1]).toBe(PKG_TEXT)
    expect(writeCalls[5][1]).toBe(LOCK_TEXT)

    const writeOrder = deps.writeFile.mock.invocationCallOrder
    const buildOrder = deps.runBuild.mock.invocationCallOrder[0]
    const assetsOrder = deps.collectAssets.mock.invocationCallOrder[0]
    expect(Math.max(writeOrder[0], writeOrder[1], writeOrder[2])).toBeLessThan(buildOrder)
    expect(buildOrder).toBeLessThan(assetsOrder)
    expect(assetsOrder).toBeLessThan(Math.min(writeOrder[3], writeOrder[4], writeOrder[5]))

    // ... and nothing is ever committed, tagged or published.
    expect(deps.writeNotesFile).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })

  test('an explicit --version reaches the plan, so the build and asset check target it', () => {
    const deps = createDeps({ env: {} })

    const result = runRelease({ dryRun: true, requestedVersion: '1.2.3' }, deps)

    expect(result.version).toBe('1.2.3')
    expect(result.tag).toBe('v1.2.3')
    expect(deps.collectAssets).toHaveBeenCalledWith('release/1.2.3', '1.2.3')

    // Bumped, then reverted back to the original three files - same shape as the test above.
    const writeCalls = deps.writeFile.mock.calls
    expect(writeCalls).toHaveLength(6)
    expect(writeCalls[3][1]).toBe(POPULATED_CHANGELOG)
    expect(writeCalls[4][1]).toBe(PKG_TEXT)
    expect(writeCalls[5][1]).toBe(LOCK_TEXT)
    expect(deps.writeNotesFile).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })

  test('a build failure still reverts the bump before the error propagates', () => {
    const deps = createDeps({ env: {} })
    const buildError = new Error('electron-builder exploded')
    deps.runBuild.mockImplementation(() => {
      throw buildError
    })

    expect(() => runRelease({ dryRun: true }, deps)).toThrow(buildError)

    // The revert still happened - same three files, same original content, even though runBuild
    // never let collectAssets run at all.
    const writeCalls = deps.writeFile.mock.calls
    expect(writeCalls.map(([path]) => path)).toEqual([
      'CHANGELOG.md',
      'package.json',
      'package-lock.json',
      'CHANGELOG.md',
      'package.json',
      'package-lock.json',
    ])
    expect(writeCalls[3][1]).toBe(POPULATED_CHANGELOG)
    expect(writeCalls[4][1]).toBe(PKG_TEXT)
    expect(writeCalls[5][1]).toBe(LOCK_TEXT)

    // Nothing downstream of the asset check ever ran.
    expect(deps.collectAssets).not.toHaveBeenCalled()
    expect(deps.writeNotesFile).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })

  test('a missing-asset failure (collectAssets throws) still reverts the bump before propagating', () => {
    const deps = createDeps({ env: {} })
    const assetsError = new Error('missing asset: latest.yml')
    deps.collectAssets.mockImplementation(() => {
      throw assetsError
    })

    expect(() => runRelease({ dryRun: true }, deps)).toThrow(assetsError)

    // The build did run (it's the asset check that failed), and the revert still happened.
    expect(deps.runBuild).toHaveBeenCalledTimes(1)
    const writeCalls = deps.writeFile.mock.calls
    expect(writeCalls.map(([path]) => path)).toEqual([
      'CHANGELOG.md',
      'package.json',
      'package-lock.json',
      'CHANGELOG.md',
      'package.json',
      'package-lock.json',
    ])
    expect(writeCalls[3][1]).toBe(POPULATED_CHANGELOG)
    expect(writeCalls[4][1]).toBe(PKG_TEXT)
    expect(writeCalls[5][1]).toBe(LOCK_TEXT)

    expect(deps.writeNotesFile).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })
})

describe('runRelease - a non-dry run outside CI refuses', () => {
  for (const [label, env] of [
    ['CI unset', {}],
    ['CI=false', { CI: 'false' }],
    ['CI=1 (not the literal "true")', { CI: '1' }],
  ]) {
    test(`${label}: refuses before reading, building or mutating anything`, () => {
      const deps = createDeps({ env })

      const result = runRelease({ dryRun: false }, deps)

      expect(result.code).not.toBe(0)
      expect(result.status).toBe('refused')
      expect(result.reason).toContain('workflow_dispatch')
      expect(deps.logError).toHaveBeenCalledTimes(1)

      // Nothing at all happened - not even a read or a build.
      expect(deps.readFile).not.toHaveBeenCalled()
      expect(deps.listTags).not.toHaveBeenCalled()
      expect(deps.runBuild).not.toHaveBeenCalled()
      expect(deps.collectAssets).not.toHaveBeenCalled()
      assertNothingMutated(deps)
    })
  }

  test('a plan refusal (empty Unreleased) in CI exits non-zero without building or mutating', () => {
    const deps = createDeps({ changelogText: EMPTY_CHANGELOG })

    const result = runRelease({ dryRun: false }, deps)

    expect(result.code).not.toBe(0)
    expect(result.status).toBe('refused')
    expect(typeof result.reason).toBe('string')
    expect(result.reason.length).toBeGreaterThan(0)
    expect(deps.runBuild).not.toHaveBeenCalled()
    assertNothingMutated(deps)
  })
})

describe('runRelease - the git/gh command list matches what plan.mjs produced', () => {
  test('every planned command is run in order, with the placeholders resolved', () => {
    const deps = createDeps({ env: { CI: 'true' } })

    const result = runRelease({ dryRun: false }, deps)
    expect(result.code).toBe(0)
    expect(result.status).toBe('released')

    // The same plan the runner computed internally, recomputed here from the same inputs.
    const plan = planRelease({
      changelogText: POPULATED_CHANGELOG,
      pkgText: PKG_TEXT,
      lockText: LOCK_TEXT,
      tags: TAGS,
      dryRun: false,
      isCi: true,
      today: TODAY,
    })

    // The contract, stated rather than derived: four git steps, then the publish.
    expect(plan.commands.map((command) => command.kind)).toEqual([
      'git-add',
      'git-commit',
      'git-tag',
      'git-push',
      'gh-release',
    ])

    const spawned = deps.run.mock.calls.map(([argv]) => argv)
    expect(spawned).toHaveLength(plan.commands.length)

    plan.commands.forEach((command, index) => {
      if (command.kind !== 'gh-release') {
        expect(spawned[index]).toEqual(command.argv)
        return
      }
      const argv = spawned[index]
      // The `<release-notes-file>` placeholder is replaced by the real temp-file path ...
      expect(argv).not.toContain('<release-notes-file>')
      expect(argv.slice(0, -ASSETS.length)).toEqual(
        command.argv.map((token) => (token === '<release-notes-file>' ? NOTES_FILE : token)),
      )
      expect(argv[argv.indexOf('--notes-file') + 1]).toBe(NOTES_FILE)
      // ... and the five real asset paths are the trailing positional arguments, after the
      // `--prerelease` flag a beta version carries.
      expect(argv).toContain('--prerelease')
      expect(argv.slice(-ASSETS.length)).toEqual(ASSETS)
    })

    // The notes `gh` publishes are the notes the plan produced.
    expect(deps.writeNotesFile).toHaveBeenCalledWith(plan.notes)

    // The three planned writes land on disk exactly once each (no dry-run revert here) ...
    expect(deps.writeFile.mock.calls.map(([path]) => path)).toEqual(
      plan.writes.map((write) => write.path),
    )
    plan.writes.forEach((write, index) => {
      expect(deps.writeFile.mock.calls[index][1]).toBe(write.content)
    })
    // ... BEFORE the build runs (electron-builder reads the bumped package.json), which runs
    // BEFORE the asset check, which runs BEFORE any git/gh command.
    expect(deps.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      deps.runBuild.mock.invocationCallOrder[0],
    )
    expect(deps.runBuild.mock.invocationCallOrder[0]).toBeLessThan(
      deps.collectAssets.mock.invocationCallOrder[0],
    )
    expect(deps.collectAssets.mock.invocationCallOrder[0]).toBeLessThan(
      deps.run.mock.invocationCallOrder[0],
    )
    // The asset check targets the same release directory the build actually wrote into - the
    // bumped version, derived consistently, not the pre-bump version that was on disk when the run
    // started.
    expect(deps.collectAssets).toHaveBeenCalledWith(`release/${plan.version}`, plan.version)
  })

  test('a gh argv whose notes placeholder is gone is a hard error, never a published release', () => {
    expect(() =>
      ghReleaseArgv(['gh', 'release', 'create', 'v1.2.3', '--title', '1.2.3'], NOTES_FILE, ASSETS),
    ).toThrow(/refusing to publish/)
  })

  test('an empty asset set is a hard error too', () => {
    expect(() =>
      ghReleaseArgv(
        ['gh', 'release', 'create', 'v1.2.3', '--notes-file', '<release-notes-file>'],
        NOTES_FILE,
        [],
      ),
    ).toThrow(/refusing to publish/)
  })
})

describe('parseArgs', () => {
  test('defaults to a real run with a derived version', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, requestedVersion: undefined, bump: undefined })
  })

  test('reads --dry-run, --version and --bump', () => {
    expect(parseArgs(['--dry-run', '--version', '1.0.0-beta.1', '--bump', 'minor'])).toEqual({
      dryRun: true,
      requestedVersion: '1.0.0-beta.1',
      bump: 'minor',
    })
  })

  test('rejects a v-prefixed version, which would tag vv1.0.0', () => {
    expect(() => parseArgs(['--version', 'v1.0.0'])).toThrow(/leading "v"/)
  })

  test('rejects an unknown flag, a missing value and an invalid bump', () => {
    expect(() => parseArgs(['--publish'])).toThrow(/unknown argument/)
    expect(() => parseArgs(['--version'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--bump', '--dry-run'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--bump', 'huge'])).toThrow(/must be one of/)
  })
})
