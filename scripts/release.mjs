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
// Story 101 D3 added the two-platform half. The Windows artifacts are still built right here, by
// the same `package:win` on the same `windows-latest` runner as before - nothing about how
// `latest.yml` is produced changed, because its `url` field is what every already-installed
// Windows client resolves an update through. The Linux artifacts are built by a separate CI job
// and arrive as files: `stageExtraAssets` copies them from `RELEASE_EXTRA_ASSETS_DIR` into the
// same `release/<version>/` directory AFTER the Windows build and BEFORE the asset check, so the
// Linux half is gated by the same "refuses when a file is missing" check as the Windows half
// instead of being a second, unchecked upload. A consequence worth knowing before you run one: a
// local dry run on Windows now refuses too, naming the AppImage and `latest-linux.yml`, unless you
// point `RELEASE_EXTRA_ASSETS_DIR` at a directory holding them - a rehearsal that skipped half the
// release would not be rehearsing it.
//
// Usage: `npm run release -- --dry-run` locally; `node scripts/release.mjs [--version <v>]
// [--bump <major|minor|patch>]` with `CI=true` from `.github/workflows/release.yml` (D5),
// `node scripts/release.mjs --print-plan` from that workflow's `plan` job, and
// `node scripts/release.mjs --promote-changelog --version <v>` from that workflow's `build-linux`
// job (story 101 F2 fix), so the AppImage it packages bundles a `CHANGELOG.md` whose `## <v>`
// section matches `app.getVersion()` the same way the Windows leg's does.
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectAssets, expectedAssets } from './lib/release/artifacts.mjs'
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
 * @property {boolean} printPlan - `--print-plan`: resolve the plan, print it as JSON on stdout and
 *   stop. Reads nothing but the three tracked files and `git tag`; writes, builds and publishes
 *   nothing. This is what lets CI's `plan` job decide the version before any runner starts a
 *   build, so a refusal (an empty `## Unreleased`, an existing tag) costs no build at all.
 * @property {boolean} promoteChangelog - `--promote-changelog --version <v>`: writes ONLY the
 *   promoted `CHANGELOG.md` (the same `plan.writes` entry a real run would write) to disk and
 *   stops - no `package.json`/`package-lock.json` bump, no build, no git/gh mutation. This is what
 *   lets the `build-linux` CI job's checkout bundle a `CHANGELOG.md` whose `## <version>` section
 *   matches `app.getVersion()` (`src/main/lib/release-notes.ts` resolves release notes by that
 *   match), using the exact same `promote()` call the `release` job's real run makes for the
 *   Windows leg - one implementation of "promote the changelog for version X", not two.
 * @property {string} [requestedVersion] - bare version, no leading `v` (AC6). Required alongside
 *   `promoteChangelog`: the version has to be the one the `plan` job already decided, never
 *   re-derived from the changelog in a second job.
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
  const args = {
    dryRun: false,
    printPlan: false,
    promoteChangelog: false,
    requestedVersion: undefined,
    bump: undefined,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--dry-run') {
      args.dryRun = true
      continue
    }

    if (arg === '--print-plan') {
      args.printPlan = true
      continue
    }

    if (arg === '--promote-changelog') {
      args.promoteChangelog = true
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
      `release: unknown argument "${arg}" - expected --dry-run, --print-plan, ` +
        `--promote-changelog, --version <v>, --bump <${BUMPS.join('|')}>`,
    )
  }

  if (args.promoteChangelog && args.requestedVersion === undefined) {
    throw new Error(
      'release: --promote-changelog requires --version <v> - the version the "plan" job already ' +
        'decided, never re-derived here',
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
 * @property {(repoRelativeDir: string, version: string) => string[]} stageExtraAssets - copies
 *   whatever `RELEASE_EXTRA_ASSETS_DIR` points at (the `build-linux` CI job's AppImage +
 *   `latest-linux.yml`, downloaded as a workflow artifact) into the release directory, and returns
 *   the filenames it staged. A no-op returning `[]` when that variable is unset, which is what a
 *   plain local dry run does.
 * @property {(repoRelativeDir: string, version: string,
 *   platform: 'win'|'linux'|'all') => string[]} collectAssets - 096-D3's check; throws naming what
 *   is missing. Returns full paths ready for `gh release create`.
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
 * @property {'released'|'dry-run'|'plan'|'promoted-changelog'|'refused'} status
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
 * CI guard -> plan (may refuse) -> [--print-plan: print the plan as JSON, stop here] -> print ->
 * bump writes -> build -> stage the pre-built Linux assets -> asset check (both platforms) ->
 * [dry run: revert the bump writes, stop here] -> notes file -> git add/commit/tag/push ->
 * gh release create.
 *
 * Story 101 D3 inserted exactly one step into that sequence - `stageExtraAssets`, strictly between
 * the build and the asset check. Before the build it would be pointless (electron-builder creates
 * `release/<version>/` as part of the build), and after the asset check it would defeat the check:
 * the whole point is that a missing AppImage refuses the release the same way a missing
 * `latest.yml` does, rather than being uploaded blind. Nothing upstream of it moved, so the
 * Windows build - and therefore the `url` inside `latest.yml` that every installed Windows client
 * resolves its update through - is produced by byte-for-byte the same steps it was before.
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
  const printPlan = options.printPlan === true
  const promoteChangelog = options.promoteChangelog === true
  const isCi = deps.env.CI === 'true'

  // AC5 + the CI decision: the only legitimate invocations are a dry run (anywhere), a
  // `--print-plan` (anywhere - it is strictly read-only, see its branch below), a
  // `--promote-changelog` (anywhere - it writes only a local `CHANGELOG.md` in the caller's own
  // checkout, never commits/tags/pushes/publishes, so it carries none of the risk the CI guard
  // exists for) and a real run under CI. A real run outside CI is refused here, before a single
  // file is read - there is no state it could have changed by the time it returns.
  if (!dryRun && !printPlan && !promoteChangelog && !isCi) {
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

  // `--print-plan` stops here, and this is the *only* thing it writes anywhere: one JSON object on
  // stdout, and nothing else on stdout, so CI can parse it without stripping the human-readable
  // lines below. It is deliberately above every write, the build and the asset check - the `plan`
  // job exists so that a refusal (empty `## Unreleased`, tag already exists) is discovered before
  // any runner spends twenty minutes on an electron-builder run. `writes`/`commands` are not
  // included: they are this file's business, and publishing the notes twice (once here, once in
  // `commands`' argv) would invite a caller to use the wrong copy.
  if (printPlan) {
    deps.log(JSON.stringify({ version: plan.version, tag: plan.tag, notes: plan.notes }, null, 2))
    return { code: 0, status: 'plan', version: plan.version, tag: plan.tag, notes: plan.notes }
  }

  // `--promote-changelog` stops here too, and writes exactly one file: `CHANGELOG.md`, with the
  // same content `plan.writes` would carry for a real run at this version - `planRelease` (and the
  // `promote()` call inside it) is the ONLY place that text is produced, so the `build-linux` job's
  // checkout and the `release` job's later real run are guaranteed to bundle byte-identical
  // `## <version>` sections. No `package.json`/`package-lock.json` write (that job already sets
  // `package.json`'s version itself, via `npm pkg set`, purely so electron-builder's output
  // directory/artifact names match), no build, no git/gh command.
  if (promoteChangelog) {
    const changelogWrite = plan.writes.find((write) => write.path === 'CHANGELOG.md')
    if (!changelogWrite) {
      throw new Error('release: planRelease produced no CHANGELOG.md write to promote')
    }
    deps.writeFile(changelogWrite.path, changelogWrite.content)
    deps.log(`changelog promoted for ${plan.version}`)
    return { code: 0, status: 'promoted-changelog', version: plan.version, tag: plan.tag }
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

  /** Runs the build, stages the pre-built Linux assets into the same directory, then checks both
   * platforms' asset sets, logs the resulting list and returns it. Pulled out so the dry-run
   * branch below can wrap exactly these steps in a `finally` without duplicating them. */
  const buildAndCollectAssets = () => {
    const releaseDir = `release/${plan.version}`
    deps.runBuild()
    // Between the build and the check, never after it: `collectAssets` is the thing that refuses a
    // half-published release, so the Linux files have to be on disk by the time it looks.
    const staged = deps.stageExtraAssets(releaseDir, plan.version)
    if (staged.length > 0) {
      deps.log(`staged: ${staged.join(', ')}`)
    }
    // `'all'`: one run publishes both platforms, so one check covers both. A Linux asset that the
    // `build-linux` job failed to produce (or failed to upload) is now a refusal naming that file,
    // exactly like a missing `latest.yml` already was.
    const collected = deps.collectAssets(releaseDir, plan.version, 'all')
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

/**
 * The real `stageExtraAssets`: copies every file in `sourceDir` into `targetDir`.
 *
 * `sourceDir` is `RELEASE_EXTRA_ASSETS_DIR`, which `.github/workflows/release.yml` points at the
 * directory `actions/download-artifact` unpacked the `build-linux` job's AppImage and
 * `latest-linux.yml` into. Unset (a plain local dry run, or a Windows-only run) means there is
 * nothing to stage: return `[]` and let `collectAssets` be the one that complains about whatever
 * is then missing.
 *
 * Two deliberate refusals, both of which would otherwise be silent:
 *
 *   1. A set-but-nonexistent `sourceDir` throws instead of staging nothing. The variable being set
 *      means someone meant for files to arrive; a typo'd path or a failed download step must not
 *      degrade into "we just did not stage anything".
 *   2. A source file whose name collides with one of the *Windows* expected assets throws rather
 *      than overwriting it. That guard exists for exactly one file: `latest.yml`. Every installed
 *      Windows client resolves its update through the `url` inside the `latest.yml` this release
 *      publishes, so a Linux job that ever uploaded a `latest.yml` (instead of
 *      `latest-linux.yml`) would, by overwriting the freshly built Windows one, break auto-update
 *      for every existing Windows install, permanently and invisibly. The names cannot collide
 *      today - that is the point of checking rather than assuming.
 *
 * Exported (like `ghReleaseArgv`) so its two refusals are unit-tested against real directories
 * rather than argued about - `createRealDeps` is the only production caller.
 *
 * @param {string} targetDir - absolute path to `release/<version>/`.
 * @param {string} version
 * @param {string|undefined} sourceDir
 * @returns {string[]} the filenames staged, in `readdir` order.
 */
export function stageExtraAssetsFrom(targetDir, version, sourceDir) {
  if (!sourceDir || sourceDir.trim() === '') return []

  const source = resolve(sourceDir)
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(
      `release: RELEASE_EXTRA_ASSETS_DIR points at "${sourceDir}", which is not a directory - ` +
        'refusing to publish a release whose pre-built assets never arrived',
    )
  }

  const protectedNames = new Set(expectedAssets(version, 'win'))
  const staged = []
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (protectedNames.has(entry.name)) {
      throw new Error(
        `release: refusing to stage "${entry.name}" over the freshly built Windows artifact of ` +
          `the same name (from "${sourceDir}")`,
      )
    }
    copyFileSync(join(source, entry.name), join(targetDir, entry.name))
    staged.push(entry.name)
  }
  return staged
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
    stageExtraAssets: (repoRelativeDir, version) =>
      stageExtraAssetsFrom(
        join(REPO_ROOT, repoRelativeDir),
        version,
        process.env.RELEASE_EXTRA_ASSETS_DIR,
      ),
    collectAssets: (repoRelativeDir, version, platform) =>
      collectAssets(join(REPO_ROOT, repoRelativeDir), version, platform),
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
