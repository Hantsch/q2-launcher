// Story 096 D4: the release runner - the one file in the release pipeline that is allowed to touch
// git, gh, the filesystem and the build. Everything it *decides* is decided in `lib/release/`
// (D1's `planRelease`, D3's `collectAssets`); this file only performs I/O and ordering.
//
// It is also the only file with irreversible side effects (a pushed tag, a published GitHub
// release), so its three no-mutation paths are structured to be provable rather than argued:
//
//   1. `runRelease` performs no I/O itself - every effect goes through an injected collaborator
//      (`ReleaseDeps`), so `release.test.mjs` can assert "the write/spawn stubs were never called"
//      instead of hoping a real run would have behaved.
//   2. The CI guard is the very first thing that happens, before any file is read, before
//      `planRelease`, before the build: a non-dry run outside `CI=true` can never legitimately
//      proceed (the profile bars pushing to `main` by hand), so there is nothing to compute.
//   3. The version bump (`CHANGELOG.md`, `package.json`, `package-lock.json`) lands on disk before
//      the build runs, in both a dry and a real run - electron-builder reads `package.json`'s
//      `"version"` to decide the build's output directory (`release/<version>`) and every
//      artifact's filename, so the build has to run against the bumped version or the asset check
//      right after it is checking a directory nothing was ever built into. A dry run reverts those
//      three files back to what was read at the start immediately after the asset check succeeds,
//      so it ends up touching nothing; a real run leaves them bumped and continues into
//      git add/commit/tag/push and `gh release create`.
//
// Usage: `npm run release -- --dry-run` locally; `node scripts/release.mjs [--version <v>]
// [--bump <major|minor|patch>]` with `CI=true` from `.github/workflows/release.yml` (D5).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAssets } from './lib/release/artifacts.mjs'
import { planRelease, ReleaseRefused } from './lib/release/plan.mjs'

/** `<repo>/scripts/release.mjs` -> `<repo>`. Never `process.cwd()`: npm scripts, CI and a plain
 * `node scripts/release.mjs` from a subfolder all have to resolve the same repo. */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * The literal string `plan.mjs` puts where `gh release create --notes-file` needs a real path.
 * That module has no fs access, so writing `notes` to a temp file and substituting its path here
 * is this file's job - and a placeholder that survived to the spawn is a hard error, never a
 * published release whose notes are the string `<release-notes-file>`.
 */
const NOTES_FILE_PLACEHOLDER = '<release-notes-file>'

const BUMPS = ['major', 'minor', 'patch']

/**
 * @typedef {Object} ReleaseArgs
 * @property {boolean} dryRun
 * @property {string} [requestedVersion] - bare version, no leading `v` (AC6).
 * @property {'major'|'minor'|'patch'} [bump]
 */

/**
 * Parses this script's CLI arguments. Pure - no env, no fs - so the argument surface is testable
 * on its own. Anything unrecognised throws rather than being ignored: a typo'd flag on a command
 * that publishes a release must not silently degrade into "release whatever you derived".
 *
 * @param {string[]} argv - e.g. `process.argv.slice(2)`.
 * @returns {ReleaseArgs}
 * @throws {Error} with an operator-readable message naming the accepted forms.
 */
export function parseArgs(argv) {
  /** @type {ReleaseArgs} */
  const args = { dryRun: false, requestedVersion: undefined, bump: undefined }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (arg === '--version' || arg === '--bump') {
      index += 1
      const value = argv[index]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`release: ${arg} needs a value (e.g. ${usageFor(arg)})`)
      }
      if (arg === '--version') {
        // `plan.mjs` builds the tag itself as `v${version}`; a `v`-prefixed value here would tag
        // `vv1.0.0`. Rejecting beats silently stripping - the operator sees which form is meant.
        if (/^v/i.test(value)) {
          throw new Error(
            `release: --version takes a bare version without a leading "v" (got "${value}"); ` +
              `the tag is derived as v<version>`,
          )
        }
        args.requestedVersion = value
      } else {
        if (!BUMPS.includes(value)) {
          throw new Error(`release: --bump must be one of ${BUMPS.join(', ')} (got "${value}")`)
        }
        args.bump = /** @type {'major'|'minor'|'patch'} */ (value)
      }
      continue
    }

    throw new Error(
      `release: unknown argument "${arg}" - expected --dry-run, --version <v>, ` +
        `--bump <${BUMPS.join('|')}>`,
    )
  }

  return args
}

/** @param {string} arg @returns {string} */
function usageFor(arg) {
  return arg === '--version' ? '--version 1.0.0-beta.1' : `--bump ${BUMPS.join('|')}`
}

/**
 * Every effect `runRelease` is allowed to have. The real implementations live in
 * `createRealDeps()` at the bottom of this file; tests inject stubs and assert which of these were
 * called and which were not.
 *
 * @typedef {Object} ReleaseDeps
 * @property {(repoRelativePath: string) => string} readFile
 * @property {(repoRelativePath: string, content: string) => void} writeFile
 * @property {() => string[]} listTags - existing `v*` tags.
 * @property {() => void} runBuild - `npm run package:win`; throws when the build fails.
 * @property {(repoRelativeDir: string, version: string) => string[]} collectAssets - D3's check;
 *   throws naming what is missing. Returns full paths ready for `gh release create`.
 * @property {(notes: string) => string} writeNotesFile - writes `notes` somewhere outside the repo
 *   and returns that path.
 * @property {(argv: string[]) => void} run - spawns a command; throws on a non-zero exit.
 * @property {() => string} today - `YYYY-MM-DD`.
 * @property {Record<string, string|undefined>} env
 * @property {(line: string) => void} log
 * @property {(line: string) => void} logError
 */

/**
 * @typedef {Object} ReleaseResult
 * @property {number} code - process exit code; non-zero on any refusal.
 * @property {'released'|'dry-run'|'refused'} status
 * @property {string} [version]
 * @property {string} [tag]
 * @property {string} [notes]
 * @property {string[]} [assets]
 * @property {string} [reason] - set when `status` is `'refused'`.
 */

/**
 * The whole release flow, minus the wiring of real I/O.
 *
 * Order is the point of this function, and it is deliberate:
 * CI guard -> plan (may refuse) -> print -> bump writes -> build -> asset check ->
 * [dry run: revert the bump writes, stop here] -> notes file -> git add/commit/tag/push ->
 * gh release create.
 *
 * AC5's "performs every step including the build" is why the build and the asset check sit *above*
 * the dry-run stop: a dry run that skipped them would prove nothing about the release it rehearses.
 * The bump writes sit *above the build itself* (in both a dry and a real run) for the same reason:
 * electron-builder reads `package.json`'s `"version"` for its output directory and every artifact's
 * filename, so the build has to run against the bumped version for the asset check right after it
 * to mean anything. D4's "a dry run touches nothing" note is reconciled by reverting those three
 * files right before the dry run returns - in a `finally`, so the revert runs whether the build and
 * asset check succeeded or one of them threw; a thrown error is reverted-then-rethrown, never
 * swallowed.
 *
 * @param {ReleaseArgs} options
 * @param {ReleaseDeps} deps
 * @returns {ReleaseResult}
 */
export function runRelease(options, deps) {
  const dryRun = options.dryRun === true
  const isCi = deps.env.CI === 'true'

  // AC5 + the CI decision: the only two legitimate invocations are a dry run (anywhere) and a real
  // run under CI. A real run outside CI is refused here, before a single file is read - there is no
  // state it could have changed by the time it returns.
  if (!dryRun && !isCi) {
    const reason =
      'release: refusing to commit, tag and publish outside CI. Run the "release" workflow ' +
      'via workflow_dispatch on GitHub, or pass --dry-run to rehearse locally.'
    deps.logError(reason)
    return { code: 1, status: 'refused', reason }
  }

  // Read once, kept around (not just handed to `planRelease`) so a dry run can revert to this
  // exact text later, byte for byte.
  const changelogText = deps.readFile('CHANGELOG.md')
  const pkgText = deps.readFile('package.json')
  const lockText = deps.readFile('package-lock.json')

  let plan
  try {
    plan = planRelease({
      changelogText,
      pkgText,
      lockText,
      tags: deps.listTags(),
      requestedVersion: options.requestedVersion,
      bump: options.bump,
      dryRun,
      isCi,
      today: deps.today(),
    })
  } catch (error) {
    // AC2/AC7: an empty `## Unreleased` or an existing tag is an expected, operator-facing refusal
    // - print the reason, exit non-zero, no stack trace. Anything else is a bug and keeps its stack.
    if (error instanceof ReleaseRefused) {
      deps.logError(`release refused: ${error.reason}`)
      return { code: 1, status: 'refused', reason: error.reason }
    }
    throw error
  }

  // AC5: the version and the notes are printed on every run, dry or not, before anything else
  // happens - this output is the dry run's whole product.
  deps.log(`version: ${plan.version}`)
  deps.log(`tag: ${plan.tag}`)
  deps.log('notes:')
  deps.log(plan.notes)

  // The bump lands on disk BEFORE the build, unconditionally (dry or real): electron-builder reads
  // `package.json`'s "version" to pick `directories.output` (`release/${version}`) and to name every
  // artifact, so building before this point would build the OLD version into the OLD directory,
  // and the asset check below - which looks in the NEW version's directory - would always fail.
  for (const write of plan.writes) {
    deps.writeFile(write.path, write.content)
  }

  /** Runs the build and the asset check, logs the resulting asset list, and returns it. Pulled out
   * so the dry-run branch below can wrap exactly these two steps in a `finally` without duplicating
   * them. */
  const buildAndCollectAssets = () => {
    deps.runBuild()
    const collected = deps.collectAssets(`release/${plan.version}`, plan.version)
    deps.log(`assets: ${collected.join(', ')}`)
    return collected
  }

  if (dryRun) {
    let assets
    try {
      assets = buildAndCollectAssets()
    } finally {
      // "Touches nothing" (D4's own acceptance note): put the three bumped files back exactly as
      // they were before this run started, so the working tree ends up byte-identical to how it
      // began - unconditionally, whether the build/asset check above succeeded or threw. Without
      // this in a `finally`, a real build failure or a genuinely missing asset (collectAssets'
      // whole job) would leave the bumped package.json/package-lock.json and the promoted
      // CHANGELOG.md (with "## Unreleased" now emptied) sitting on disk, and silently make the next
      // real release refuse for an unrelated, confusing reason ("Unreleased is empty").
      deps.writeFile('CHANGELOG.md', changelogText)
      deps.writeFile('package.json', pkgText)
      deps.writeFile('package-lock.json', lockText)
    }
    deps.log(
      'dry run - build ran for real and assets were checked, but the version bump was reverted; ' +
        'nothing committed, tagged or published.',
    )
    return {
      code: 0,
      status: 'dry-run',
      version: plan.version,
      tag: plan.tag,
      notes: plan.notes,
      assets,
    }
  }

  const assets = buildAndCollectAssets()

  // --- everything below this line mutates git or github.com -------------------------------------
  // (the version bump itself already landed on disk above, and - since we are not a dry run - stays
  // there; `git-add` below is what stages exactly those three files.)
  const notesFile = deps.writeNotesFile(plan.notes)
  for (const command of plan.commands) {
    deps.run(
      command.kind === 'gh-release' ? ghReleaseArgv(command.argv, notesFile, assets) : command.argv,
    )
  }

  return {
    code: 0,
    status: 'released',
    version: plan.version,
    tag: plan.tag,
    notes: plan.notes,
    assets,
  }
}

/**
 * Turns `plan.mjs`'s `gh release create` argv into a runnable one: the `--notes-file` placeholder
 * becomes a real path, and the asset paths are appended as the trailing positional arguments
 * (after the optional `--prerelease` flag, which is where `gh` expects them).
 *
 * @param {string[]} argv
 * @param {string} notesFile
 * @param {string[]} assets
 * @returns {string[]}
 */
export function ghReleaseArgv(argv, notesFile, assets) {
  const placeholderIndex = argv.indexOf(NOTES_FILE_PLACEHOLDER)
  if (placeholderIndex === -1) {
    throw new Error(
      `release: gh argv carries no "${NOTES_FILE_PLACEHOLDER}" to substitute - refusing to ` +
        'publish a release whose notes would be wrong',
    )
  }
  if (assets.length === 0) {
    throw new Error('release: no assets to upload - refusing to publish an empty release')
  }
  const resolved = [...argv]
  resolved[placeholderIndex] = notesFile
  return [...resolved, ...assets]
}

// --- real I/O ---------------------------------------------------------------------------------

/** @returns {string} */
function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/** @returns {ReleaseDeps} */
function createRealDeps() {
  return {
    readFile: (repoRelativePath) => readFileSync(join(REPO_ROOT, repoRelativePath), 'utf-8'),
    writeFile: (repoRelativePath, content) =>
      writeFileSync(join(REPO_ROOT, repoRelativePath), content, 'utf-8'),
    listTags: () =>
      execFileSync('git', ['tag', '--list', 'v*'], { cwd: REPO_ROOT, encoding: 'utf-8' })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    runBuild: () => {
      execFileSync(npmCommand(), ['run', 'package:win'], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
    },
    collectAssets: (repoRelativeDir, version) =>
      collectAssets(join(REPO_ROOT, repoRelativeDir), version),
    writeNotesFile: (notes) => {
      // Outside the repo on purpose: the notes are a `gh` input, not a tracked file, and must not
      // end up in the release commit.
      const dir = mkdtempSync(join(tmpdir(), 'q2-release-'))
      const file = join(dir, 'RELEASE_NOTES.md')
      writeFileSync(file, notes, 'utf-8')
      return file
    },
    run: (argv) => {
      execFileSync(argv[0], argv.slice(1), { cwd: REPO_ROOT, stdio: 'inherit' })
    },
    today: () => new Date().toISOString().slice(0, 10),
    env: process.env,
    log: (line) => console.log(line),
    logError: (line) => console.error(line),
  }
}

/** @returns {number} exit code. */
function main() {
  /** @type {ReleaseArgs} */
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    return 1
  }
  // A failing build, git or gh call throws out of here on purpose: a half-finished release is a
  // loud stack trace and a non-zero exit, never a quiet "mostly worked".
  return runRelease(args, createRealDeps()).code
}

/** True when this file was run directly (`node scripts/release.mjs`), not imported. Mirrors
 * `verify.mjs`'s guard, which is what keeps the tests from spawning a real release. */
function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  const self = fileURLToPath(import.meta.url)
  return process.platform === 'win32'
    ? resolve(entry).toLowerCase() === self.toLowerCase()
    : resolve(entry) === self
}

if (isDirectRun()) {
  process.exitCode = main()
}
