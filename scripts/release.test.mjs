import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { expectedAssets } from './lib/release/artifacts.mjs'
import { UNRELEASED_PLACEHOLDER } from './lib/release/changelog.mjs'
import { planRelease } from './lib/release/plan.mjs'
import { ghReleaseArgv, parseArgs, runRelease, stageExtraAssetsFrom } from './release.mjs'

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
const STAGED = ['Q2-Launcher-1.0.0-beta.2-linux-x86_64.AppImage', 'latest-linux.yml']
const ASSETS = [
  '/repo/release/1.0.0-beta.2/Q2-Launcher-1.0.0-beta.2-win-x64.exe',
  '/repo/release/1.0.0-beta.2/Q2-Launcher-1.0.0-beta.2-win-x64.zip',
  '/repo/release/1.0.0-beta.2/Q2-Launcher-1.0.0-beta.2-win-x64.exe.blockmap',
  '/repo/release/1.0.0-beta.2/latest.yml',
  `/repo/release/1.0.0-beta.2/${STAGED[0]}`,
  `/repo/release/1.0.0-beta.2/${STAGED[1]}`,
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
    stageExtraAssets: vi.fn(() => [...STAGED]),
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
    // Story 101 D3: one run publishes both platforms, so the one check covers both - `'all'`, not
    // the pre-101 Windows-only default.
    expect(deps.collectAssets).toHaveBeenCalledWith('release/1.0.0-beta.2', '1.0.0-beta.2', 'all')
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
    expect(deps.collectAssets).toHaveBeenCalledWith('release/1.2.3', '1.2.3', 'all')
    expect(deps.stageExtraAssets).toHaveBeenCalledWith('release/1.2.3', '1.2.3')

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

    // Nothing downstream of the build ever ran - staging included.
    expect(deps.stageExtraAssets).not.toHaveBeenCalled()
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

/**
 * Story 101 D3 / AC3. The Windows artifacts are built by `runBuild` on the spot; the Linux ones
 * are built by a separate CI job and only *arrive* as files, staged by `stageExtraAssets`. Where
 * that staging sits in the sequence is the entire acceptance criterion: one step later and
 * `collectAssets` - the thing that refuses a half-published release - would be looking at a
 * directory the Linux files had not reached yet, so they would be uploaded ungated, which is the
 * "second unchecked upload" AC3 exists to rule out.
 */
describe('runRelease - one run publishes both platforms', () => {
  test('the run stages the pre-built Linux assets before the asset check, not after it', () => {
    const deps = createDeps({ env: { CI: 'true' } })

    const result = runRelease({ dryRun: false }, deps)
    expect(result.code).toBe(0)

    expect(deps.stageExtraAssets).toHaveBeenCalledTimes(1)
    // Staged into the very directory the asset check then reads, at the bumped version.
    expect(deps.stageExtraAssets).toHaveBeenCalledWith('release/1.0.0-beta.2', '1.0.0-beta.2')
    expect(deps.collectAssets).toHaveBeenCalledWith('release/1.0.0-beta.2', '1.0.0-beta.2', 'all')

    // The actual order, not merely "all three were called": build -> stage -> check.
    const buildOrder = deps.runBuild.mock.invocationCallOrder[0]
    const stageOrder = deps.stageExtraAssets.mock.invocationCallOrder[0]
    const checkOrder = deps.collectAssets.mock.invocationCallOrder[0]
    expect(buildOrder).toBeLessThan(stageOrder)
    expect(stageOrder).toBeLessThan(checkOrder)
    // ... and the publish still happens strictly after the check, as it always did.
    expect(checkOrder).toBeLessThan(deps.run.mock.invocationCallOrder[0])

    // The published asset list is the one the two-platform check returned, both platforms in it.
    expect(result.assets).toEqual(ASSETS)
    expect(result.assets.some((path) => path.endsWith('latest.yml'))).toBe(true)
    expect(result.assets.some((path) => path.endsWith('latest-linux.yml'))).toBe(true)
    expect(result.assets.some((path) => path.endsWith('.AppImage'))).toBe(true)
  })

  test('a staging failure refuses before the asset check and publishes nothing', () => {
    const deps = createDeps({ env: { CI: 'true' } })
    const stagingError = new Error('release: RELEASE_EXTRA_ASSETS_DIR points at nothing')
    deps.stageExtraAssets.mockImplementation(() => {
      throw stagingError
    })

    expect(() => runRelease({ dryRun: false }, deps)).toThrow(stagingError)

    expect(deps.collectAssets).not.toHaveBeenCalled()
    expect(deps.writeNotesFile).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })
})

describe('runRelease - --print-plan decides the version without building anything', () => {
  test('prints one JSON object and touches nothing - no build, no staging, no check', () => {
    // No CI: the plan job aside, an operator has to be able to ask "what would this release?"
    // from anywhere, precisely because it cannot change anything.
    const deps = createDeps({ env: {} })

    const result = runRelease({ dryRun: false, printPlan: true }, deps)

    expect(result.code).toBe(0)
    expect(result.status).toBe('plan')
    expect(result.version).toBe('1.0.0-beta.2')

    // Everything written to stdout is that one JSON object - CI parses it as-is.
    expect(deps.log).toHaveBeenCalledTimes(1)
    const printed = JSON.parse(deps.log.mock.calls[0][0])
    expect(printed.version).toBe('1.0.0-beta.2')
    expect(printed.tag).toBe('v1.0.0-beta.2')
    expect(printed.notes).toContain('- a new thing')

    expect(deps.runBuild).not.toHaveBeenCalled()
    expect(deps.stageExtraAssets).not.toHaveBeenCalled()
    expect(deps.collectAssets).not.toHaveBeenCalled()
    assertNothingMutated(deps)
  })

  test('a refusal costs no build - the whole point of planning in a separate job', () => {
    const deps = createDeps({ env: { CI: 'true' }, changelogText: EMPTY_CHANGELOG })

    const result = runRelease({ dryRun: false, printPlan: true }, deps)

    expect(result.code).not.toBe(0)
    expect(result.status).toBe('refused')
    expect(deps.log).not.toHaveBeenCalled()
    expect(deps.runBuild).not.toHaveBeenCalled()
    expect(deps.stageExtraAssets).not.toHaveBeenCalled()
    assertNothingMutated(deps)
  })
})

describe('runRelease - --promote-changelog writes only the promoted CHANGELOG.md', () => {
  test('writes the same CHANGELOG.md content plan.writes carries, at the given version, and stops', () => {
    // Outside CI on purpose: like --print-plan, this must work from the build-linux job's own
    // checkout without CI=true being any part of the contract that lets it run.
    const deps = createDeps({ env: {} })

    const result = runRelease(
      { dryRun: false, promoteChangelog: true, requestedVersion: '1.0.0-beta.2' },
      deps,
    )

    expect(result.code).toBe(0)
    expect(result.status).toBe('promoted-changelog')
    expect(result.version).toBe('1.0.0-beta.2')

    const plan = planRelease({
      changelogText: POPULATED_CHANGELOG,
      pkgText: PKG_TEXT,
      lockText: LOCK_TEXT,
      tags: TAGS,
      requestedVersion: '1.0.0-beta.2',
      dryRun: false,
      isCi: false,
      today: TODAY,
    })
    const changelogWrite = plan.writes.find((write) => write.path === 'CHANGELOG.md')

    // Exactly one write, exactly CHANGELOG.md, byte-identical to what a real run's plan.writes
    // would carry for the same version - never package.json/package-lock.json, and never a second,
    // hand-rolled implementation of "promote the changelog".
    expect(deps.writeFile).toHaveBeenCalledTimes(1)
    expect(deps.writeFile).toHaveBeenCalledWith('CHANGELOG.md', changelogWrite.content)
    expect(changelogWrite.content).toContain('## 1.0.0-beta.2 —')
    expect(changelogWrite.content).toContain('- a new thing')

    expect(deps.runBuild).not.toHaveBeenCalled()
    expect(deps.stageExtraAssets).not.toHaveBeenCalled()
    expect(deps.collectAssets).not.toHaveBeenCalled()
    expect(deps.writeNotesFile).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })

  test('a plan refusal (empty Unreleased) still refuses, before any write', () => {
    const deps = createDeps({ env: {}, changelogText: EMPTY_CHANGELOG })

    const result = runRelease(
      { dryRun: false, promoteChangelog: true, requestedVersion: '1.0.0-beta.2' },
      deps,
    )

    expect(result.code).not.toBe(0)
    expect(result.status).toBe('refused')
    assertNothingMutated(deps)
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
      expect(deps.stageExtraAssets).not.toHaveBeenCalled()
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
    expect(deps.collectAssets).toHaveBeenCalledWith(`release/${plan.version}`, plan.version, 'all')
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

describe('stageExtraAssetsFrom - the one new piece of real I/O', () => {
  const VERSION = '1.0.0-beta.2'
  /** @type {string[]} */
  const scratch = []

  /** @param {string} label @returns {string} */
  function scratchDir(label) {
    const dir = mkdtempSync(join(tmpdir(), `q2-stage-${label}-`))
    scratch.push(dir)
    return dir
  }

  afterEach(() => {
    while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true })
  })

  test('copies every file from the source directory into the release directory', () => {
    const target = scratchDir('target')
    const source = scratchDir('source')
    const appImage = `Q2-Launcher-${VERSION}-linux-x86_64.AppImage`
    writeFileSync(join(source, appImage), 'appimage-bytes')
    writeFileSync(join(source, 'latest-linux.yml'), 'version: 1.0.0-beta.2\n')
    // A directory in the source (what actions/download-artifact can leave behind) is skipped,
    // not copied and not reported.
    mkdirSync(join(source, 'nested'))

    const staged = stageExtraAssetsFrom(target, VERSION, source)

    expect(staged.sort()).toEqual([appImage, 'latest-linux.yml'])
    expect(readdirSync(target).sort()).toEqual([appImage, 'latest-linux.yml'])
  })

  test('an unset source is a no-op: a plain local dry run stages nothing', () => {
    const target = scratchDir('target')

    expect(stageExtraAssetsFrom(target, VERSION, undefined)).toEqual([])
    expect(stageExtraAssetsFrom(target, VERSION, '')).toEqual([])
    expect(stageExtraAssetsFrom(target, VERSION, '   ')).toEqual([])
    expect(readdirSync(target)).toEqual([])
  })

  test('a source directory that does not exist throws instead of staging nothing', () => {
    const target = scratchDir('target')

    // Set-but-wrong means a failed download step or a typo'd path, and the release must say so
    // rather than quietly continue into a Windows-only asset set.
    expect(() => stageExtraAssetsFrom(target, VERSION, join(target, 'no-such-dir'))).toThrow(
      /RELEASE_EXTRA_ASSETS_DIR/,
    )
  })

  test('refuses to stage a file over a Windows artifact - latest.yml above all', () => {
    const target = scratchDir('target')
    const source = scratchDir('source')
    // The freshly built Windows metadata: its `url` is what every installed Windows client
    // resolves its update through, so overwriting it would break auto-update for all of them.
    writeFileSync(join(target, 'latest.yml'), 'the real windows metadata')
    writeFileSync(join(source, 'latest.yml'), 'a linux job that uploaded the wrong file')

    expect(() => stageExtraAssetsFrom(target, VERSION, source)).toThrow(/latest\.yml/)
    // Untouched, byte for byte.
    expect(readdirSync(target)).toEqual(['latest.yml'])

    // Every Windows-expected name is protected, not just the metadata file.
    for (const name of expectedAssets(VERSION, 'win')) {
      const clashing = scratchDir('clash')
      writeFileSync(join(clashing, name), 'x')
      expect(() => stageExtraAssetsFrom(target, VERSION, clashing)).toThrow(/refusing to stage/)
    }
  })
})

describe('parseArgs', () => {
  test('defaults to a real run with a derived version', () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      printPlan: false,
      promoteChangelog: false,
      requestedVersion: undefined,
      bump: undefined,
    })
  })

  test('reads --dry-run, --version and --bump', () => {
    expect(parseArgs(['--dry-run', '--version', '1.0.0-beta.1', '--bump', 'minor'])).toEqual({
      dryRun: true,
      printPlan: false,
      promoteChangelog: false,
      requestedVersion: '1.0.0-beta.1',
      bump: 'minor',
    })
  })

  test('reads --print-plan, which the CI plan job passes alongside the operator inputs', () => {
    expect(parseArgs(['--print-plan', '--bump', 'patch'])).toEqual({
      dryRun: false,
      printPlan: true,
      promoteChangelog: false,
      requestedVersion: undefined,
      bump: 'patch',
    })
  })

  test('reads --promote-changelog alongside the required --version', () => {
    expect(parseArgs(['--promote-changelog', '--version', '1.0.0-beta.2'])).toEqual({
      dryRun: false,
      printPlan: false,
      promoteChangelog: true,
      requestedVersion: '1.0.0-beta.2',
      bump: undefined,
    })
  })

  test('rejects --promote-changelog without --version - the build-linux job must not re-derive it', () => {
    expect(() => parseArgs(['--promote-changelog'])).toThrow(/--promote-changelog requires --version/)
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
