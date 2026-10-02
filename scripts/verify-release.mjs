// `npm run verify:release` - the local gate that answers "will the PR into main go green, and will
// the release run once it is merged?" before anything is pushed.
//
// Why a plain `npm test && npm run package:*` never answered that (both failed PR runs of
// 2026-09-26 were green locally):
//   1. GitHub runs a PR's checks on the MERGE of the PR branch into main, not on the branch. When
//      main has moved on (e.g. the `release: x.y.z [skip ci]` commit the release job pushes), the
//      branch alone is a different tree - and `release.mjs --print-plan` refuses on it outright
//      ("tag vX already exists"), because the branch still carries the old version.
//   2. The PR runs more than unit tests: `ui:verify`'s axe-core gate (linux-verify.yml), three
//      Linux user-journey flows (ci.yml) and the AppImage self-update e2e (linux-update.yml).
//   3. Those run on Linux; this machine is Windows.
//   4. act, run from the working tree, copies untracked/ignored files (node_modules, release/, …)
//      that a GitHub checkout never has.
//
// So this script: computes the PR's merge tree (`git merge-tree --write-tree`, no commit, no ref,
// no index touched), checks it out into two throwaway snapshot folders - one for the host phase,
// one for the Linux phase - and runs in them (.gitattributes' `eol=lf` makes both LF whatever
// core.autocrlf says; the pins below only keep each checkout matching its runner's git):
//   host  (the `test (windows-latest)` leg + the release job's own Windows steps):
//         npm ci, typecheck, test, release plan, ui:verify (screens + axe), package:win|linux
//   linux (every PR workflow, through act + Docker, from the Linux snapshot):
//         ci.yml, linux-verify.yml, linux-update.yml
// What is verified is the working tree as `git add -A` would commit it (HEAD plus uncommitted and
// untracked, non-ignored files), captured through a throwaway index into an unreferenced snapshot
// object - no branch, ref or index of yours is touched. When that differs from HEAD a warning says
// so: commit exactly that, or the PR runs on a different tree. Exit code 0 means every step passed;
// anything else prints which one did not.
//
// The host phase runs as GitHub's Windows runner would, not as this machine does (see
// runnerEnv()): CI/GITHUB_ACTIONS set, TZ=UTC, and a TEMP that is not its own realpath - the
// runner's tmpdir() is an 8.3 short path (C:\Users\RUNNER~1\...), which on 2026-09-30 failed tests
// that were green here. The host checkout pins core.autocrlf=true like the runner's git does.
//
// Last, the release job itself is rehearsed at the version the release would get (story 096's
// `release.mjs --dry-run`, the same code the release job runs, minus commit/tag/publish):
// release.yml's `build-linux` job through act - taken from release.yml itself, only its `needs`
// replaced by the planned version - and then, on the host, the Windows build at that version
// plus the asset check over both platforms' files.
//
// act and Docker are checked first, so a missing prerequisite fails in seconds rather than after
// the ~5 min host phase. Run it by hand once dev is in the state you want to release - it is not
// wired into any git hook on purpose: a push to dev is not a release.
//
// Usage: npm run verify:release [-- --base=origin/main]
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { REPO_ROOT } from './lib/paths.mjs'

const IS_WIN = process.platform === 'win32'
const SNAPSHOT_ROOT = join(tmpdir(), 'q2-launcher-verify-release')
const HOST_DIR = join(SNAPSHOT_ROOT, 'host')
const LINUX_DIR = join(SNAPSHOT_ROOT, 'linux')
const ARTIFACT_DIR = join(SNAPSHOT_ROOT, 'act-artifacts')
const RELEASE_ARTIFACT_DIR = join(SNAPSHOT_ROOT, 'act-release-artifacts')
const LINUX_ASSETS_DIR = join(SNAPSHOT_ROOT, 'linux-assets')
// Docker's default 64 MB /dev/shm is too small for Chromium: the renderer crashes ("Target
// crashed", "Unable to capture screenshot") on image-heavy screens. GitHub's VMs have no such cap.
const SHM = '--shm-size=2g'

/** Runs a command with inherited stdio; returns its exit status (`null` on spawn failure). */
function run(command, args, { cwd = REPO_ROOT, env, shell = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
    shell,
  })
  if (result.error)
    console.error(`verify:release - could not start ${command}: ${result.error.message}`)
  return result.status
}

/** Runs a command and returns its trimmed stdout, or `null` if it failed. */
function capture(command, args, { cwd = REPO_ROOT, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    env: env ? { ...process.env, ...env } : process.env,
  })
  return result.status === 0 ? result.stdout.trim() : null
}

const npm = (args, cwd, env) => run(IS_WIN ? 'npm.cmd' : 'npm', args, { cwd, env, shell: IS_WIN })

/**
 * `ACT`, else `act` on the PATH, else (Windows) winget's install folder - winget only puts act on
 * the PATH of shells started after the install, which agent and IDE shells often are not.
 */
function resolveAct() {
  if (process.env.ACT) return process.env.ACT
  if (capture('act', ['--version']) !== null) return 'act'
  if (IS_WIN && process.env.LOCALAPPDATA) {
    const packages = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
    const dir = existsSync(packages)
      ? readdirSync(packages).find((name) => name.startsWith('nektos.act_'))
      : undefined
    if (dir && existsSync(join(packages, dir, 'act.exe'))) return join(packages, dir, 'act.exe')
  }
  return null
}

/** Removes act job containers left behind by an aborted run - they break the next one. */
function removeStaleActContainers() {
  const ids = capture('docker', ['ps', '-aq', '--filter', 'name=act-'])
  if (ids) run('docker', ['rm', '-f', ...ids.split(/\s+/)])
}

/** The 8.3 short form of an existing Windows path - the path itself when the volume has none. */
function shortPath(path) {
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${path}") do @echo %~sI"`], {
    encoding: 'utf-8',
    windowsVerbatimArguments: true,
  })
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : path
}

/**
 * The environment GitHub's runner gives every step, for the host phase. On Windows TEMP/TMP are
 * a path that is not its own realpath, like the runner's `C:UsersRUNNER~1AppDataLocalTemp`:
 * the 8.3 short form of a long folder name, or a junction where the volume makes no 8.3 names.
 */
function runnerEnv() {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', TZ: 'UTC' }
  if (!IS_WIN) return env
  const realTemp = join(SNAPSHOT_ROOT, 'runneradmin-temp')
  const link = join(SNAPSHOT_ROOT, 'runneradmin-link')
  rmSync(link, { recursive: true, force: true })
  rmSync(realTemp, { recursive: true, force: true })
  mkdirSync(realTemp, { recursive: true })
  let temp = shortPath(realTemp)
  if (temp === realTemp) {
    symlinkSync(realTemp, link, 'junction')
    temp = link
  }
  if (realpathSync.native(temp) === temp) throw new Error(`runner TEMP ${temp} is canonical`)
  return { ...env, TEMP: temp, TMP: temp }
}

/**
 * Writes release.yml's `build-linux` job as a standalone workflow into the Linux snapshot and
 * returns its path: the job exactly as release.yml has it, except that the `plan` job it needs is
 * replaced by the version that job would have printed, and its checkout's `ref` dropped: act only
 * copies the local tree in for a checkout without one (with one it clones from GitHub), and the
 * snapshot already is the tree that lands on main. act's copy carries no .git, so an empty repo
 * stands in for the one checkout leaves (no tags either: `--promote-changelog` lists them).
 */
function writeBuildLinuxWorkflow(version) {
  const release = yaml.load(readFileSync(join(LINUX_DIR, '.github/workflows/release.yml'), 'utf-8'))
  const { needs: _plan, ...job } = release.jobs['build-linux']
  const checkout = job.steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'))
  delete job.steps[checkout].with?.ref
  job.steps.splice(checkout + 1, 0, { run: 'git init --quiet' })
  const text = yaml
    .dump({
      name: 'verify-release build-linux',
      on: { workflow_dispatch: null },
      jobs: { 'build-linux': job },
    })
    .replaceAll('${{ needs.plan.outputs.version }}', version)
  if (text.includes('needs.')) throw new Error('build-linux uses a job output besides the version')
  const file = join(LINUX_DIR, '.verify-release-build-linux.yml')
  writeFileSync(file, text)
  return file
}

/** Unpacks the `linux-release-assets` artifact act's artifact server stored into LINUX_ASSETS_DIR. */
function extractLinuxAssets() {
  rmSync(LINUX_ASSETS_DIR, { recursive: true, force: true })
  mkdirSync(LINUX_ASSETS_DIR, { recursive: true })
  const zip = readdirSync(RELEASE_ARTIFACT_DIR, { recursive: true })
    .map((entry) => join(RELEASE_ARTIFACT_DIR, entry))
    .find((path) => /linux-release-assets[^\\/]*\.zip$/.test(path))
  if (!zip) {
    console.error(`verify:release - no linux-release-assets artifact under ${RELEASE_ARTIFACT_DIR}`)
    return false
  }
  // bsdtar reads zip; Git Bash's GNU tar (possibly first on the PATH) does not.
  const tar = IS_WIN
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'bsdtar'
  return (
    run(tar, ['-xf', zip, '-C', LINUX_ASSETS_DIR]) === 0 && readdirSync(LINUX_ASSETS_DIR).length > 0
  )
}

function parseBase(argv) {
  const flag = argv.find((arg) => arg.startsWith('--base='))
  return flag ? flag.slice('--base='.length) : 'origin/main'
}

/** Checks `tree` out into `dir` through a throwaway index - the repo's own index is never used. */
function checkoutTree(tree, dir, gitConfig) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const env = {
    GIT_INDEX_FILE: join(SNAPSHOT_ROOT, `${dir === HOST_DIR ? 'host' : 'linux'}.index`),
  }
  const prefix = `${dir.replaceAll('\\', '/')}/`
  return (
    run('git', [...gitConfig, 'read-tree', tree], { env }) === 0 &&
    run('git', [...gitConfig, 'checkout-index', '--all', `--prefix=${prefix}`], { env }) === 0
  )
}

/** A phase is a list of steps; a failing `gate` step (a prerequisite) skips the rest of its phase. */
function runPhase(name, steps, results) {
  let failed = false
  for (const step of steps) {
    const label = `${name}: ${step.label}`
    if (failed) {
      results.push({ label, status: 'skipped' })
      continue
    }
    console.log(`\n=== verify:release - ${label} ===`)
    const startedAt = Date.now()
    const ok = step.run() === true
    const seconds = Math.round((Date.now() - startedAt) / 1000)
    results.push({ label, status: ok ? 'passed' : 'FAILED', seconds })
    if (!ok && step.gate) failed = true
  }
}

function main() {
  const base = parseBase(process.argv.slice(2))
  const results = []

  mkdirSync(SNAPSHOT_ROOT, { recursive: true })

  // --- preflight: what the linux phase needs, before the host phase spends minutes ---
  const act = resolveAct()
  if (act === null) {
    console.error(
      'verify:release - act not found: install it (Windows: `winget install nektos.act`) or set ACT=<path>.',
    )
    process.exitCode = 1
    return
  }
  if (capture('docker', ['info', '--format', '{{.ServerVersion}}']) === null) {
    console.error('verify:release - Docker is not running: start Docker Desktop.')
    process.exitCode = 1
    return
  }

  // --- the working tree, as it would be committed -------------------------------
  const workIndex = { GIT_INDEX_FILE: join(SNAPSHOT_ROOT, 'work.index') }
  const workTree =
    run('git', ['read-tree', 'HEAD'], { env: workIndex }) === 0 &&
    run('git', ['-c', 'core.safecrlf=false', 'add', '-A'], { env: workIndex }) === 0
      ? capture('git', ['write-tree'], { env: workIndex })
      : null
  if (!workTree) {
    console.error('verify:release - could not snapshot the working tree')
    process.exitCode = 1
    return
  }
  let subject = capture('git', ['rev-parse', 'HEAD'])
  let subjectLabel = `HEAD ${subject.slice(0, 7)}`
  if (workTree !== capture('git', ['rev-parse', 'HEAD^{tree}'])) {
    subject = capture('git', [
      'commit-tree',
      workTree,
      '-p',
      'HEAD',
      '-m',
      'verify:release snapshot',
    ])
    subjectLabel += ' + uncommitted changes'
    console.warn(
      '\nverify:release - WARNING: verifying uncommitted changes too:\n' +
        `${capture('git', ['status', '--short'])}\n` +
        'Commit exactly these (and nothing else) before the PR, or it runs on a different tree.\n',
    )
  }

  // --- the PR's merge tree ---------------------------------------------------
  const remote = base.includes('/') ? base.slice(0, base.indexOf('/')) : null
  if (remote && run('git', ['fetch', '--quiet', remote]) !== 0) {
    console.error(`verify:release - git fetch ${remote} failed`)
    process.exitCode = 1
    return
  }
  // Changes on main since the branch point - usually the `release: x.y.z` commit. Merged in by the
  // PR instead of by you, git can file your new changelog entries under the released version and
  // leave `## Unreleased` empty. (A bare PR merge commit carries no changes and does not count.)
  if (run('git', ['diff', '--quiet', `${subject}...${base}`]) !== 0) {
    console.error(
      `verify:release - ${base} has changes your branch does not (e.g. a release commit):\n` +
        `${capture('git', ['log', '--oneline', '--no-merges', `${subject}..${base}`])}\n` +
        `Bring it up to date first: git merge ${base} - then check that your entries are still ` +
        'under "## Unreleased" in CHANGELOG.md.',
    )
    process.exitCode = 1
    return
  }
  const tree = capture('git', ['merge-tree', '--write-tree', base, subject])
  if (!tree || !/^[0-9a-f]{40}$/.test(tree)) {
    console.error(
      `verify:release - ${subjectLabel} does not merge cleanly into ${base}; the PR would conflict.`,
    )
    process.exitCode = 1
    return
  }
  const baseSha = capture('git', ['rev-parse', '--short', base])
  console.log(`verify:release - verifying ${subjectLabel} merged into ${base} ${baseSha}`)

  if (
    !checkoutTree(tree, HOST_DIR, IS_WIN ? ['-c', 'core.autocrlf=true'] : []) ||
    !checkoutTree(tree, LINUX_DIR, ['-c', 'core.autocrlf=false'])
  ) {
    console.error('verify:release - could not check the merge tree out into the snapshot folders')
    process.exitCode = 1
    return
  }

  // --- host phase --------------------------------------------------------------
  const H = HOST_DIR
  const R = runnerEnv()
  let plannedVersion = null
  runPhase(
    'host',
    [
      { label: 'npm ci', gate: true, run: () => npm(['ci'], H, R) === 0 },
      {
        label: 'install Electron binary',
        gate: true,
        run: () =>
          run(process.execPath, ['node_modules/electron/install.js'], { cwd: H, env: R }) === 0,
      },
      { label: 'typecheck', run: () => npm(['run', 'typecheck'], H, R) === 0 },
      { label: 'lint', run: () => npm(['run', 'lint'], H, R) === 0 },
      { label: 'test', run: () => npm(['test'], H, R) === 0 },
      {
        // release.yml's `plan` job, against the merged tree - but the tags live in this repo's
        // .git, which the snapshot has none of.
        label: 'release plan',
        run: () => {
          const result = spawnSync(process.execPath, ['scripts/release.mjs', '--print-plan'], {
            cwd: H,
            env: { ...process.env, ...R, GIT_DIR: join(REPO_ROOT, '.git') },
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'inherit'],
          })
          if (result.status !== 0) return false
          plannedVersion = JSON.parse(result.stdout).version
          console.log(`planned version: ${plannedVersion}`)
          return true
        },
      },
      { label: 'ui:verify (screens + axe)', run: () => npm(['run', 'ui:verify'], H, R) === 0 },
      // On Windows, package:win runs in the release phase's dry run, at the planned version.
      ...(IS_WIN
        ? []
        : [
            {
              label: 'package:linux',
              run: () =>
                npm(['run', 'package:linux'], H, { ...R, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }) ===
                0,
            },
          ]),
    ],
    results,
  )

  // --- linux phase (act) -------------------------------------------------------
  const actRun = (workflow, extra = []) =>
    run(
      act,
      [
        'workflow_dispatch',
        '-W',
        `.github/workflows/${workflow}`,
        '--artifact-server-path',
        ARTIFACT_DIR,
        // GitHub gives every job its own VM; act's parallel jobs share one tool cache, and the
        // loser of that race falls back to the image's own Node (npm 11), whose stricter `npm ci`
        // rejects this lockfile - a failure GitHub never sees.
        '--concurrent-jobs',
        '1',
        ...extra,
      ],
      {
        cwd: LINUX_DIR,
      },
    ) === 0
  runPhase(
    'linux',
    [
      {
        label: 'remove stale act containers',
        run: () => {
          removeStaleActContainers()
          return true
        },
      },
      { label: 'ci.yml', run: () => actRun('ci.yml', ['--container-options', SHM]) },
      {
        label: 'linux-verify.yml',
        run: () => actRun('linux-verify.yml', ['--container-options', `--privileged ${SHM}`]),
      },
      {
        label: 'linux-update.yml',
        run: () => actRun('linux-update.yml', ['--container-options', `--privileged ${SHM}`]),
      },
      ...(IS_WIN
        ? [
            {
              label: 'release.yml build-linux (planned version)',
              run: () => {
                if (plannedVersion === null) return false
                rmSync(RELEASE_ARTIFACT_DIR, { recursive: true, force: true })
                const built =
                  run(
                    act,
                    [
                      'workflow_dispatch',
                      '-W',
                      writeBuildLinuxWorkflow(plannedVersion),
                      '--artifact-server-path',
                      RELEASE_ARTIFACT_DIR,
                      '--container-options',
                      SHM,
                    ],
                    { cwd: LINUX_DIR },
                  ) === 0
                return built && extractLinuxAssets()
              },
            },
          ]
        : []),
    ],
    results,
  )

  // --- release phase: release.yml's Release step, as a dry run -----------------
  if (IS_WIN) {
    runPhase(
      'release',
      [
        {
          label: "release.mjs --dry-run (package:win + both platforms' assets)",
          run: () =>
            plannedVersion !== null &&
            existsSync(LINUX_ASSETS_DIR) &&
            run(
              process.execPath,
              ['scripts/release.mjs', '--dry-run', '--version', plannedVersion],
              {
                cwd: H,
                env: {
                  ...R,
                  GIT_DIR: join(REPO_ROOT, '.git'),
                  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
                  RELEASE_EXTRA_ASSETS_DIR: LINUX_ASSETS_DIR,
                },
              },
            ) === 0,
        },
      ],
      results,
    )
  }

  // --- summary -----------------------------------------------------------------
  console.log(`\nverify:release summary - ${subjectLabel} merged into ${base} ${baseSha}`)
  for (const { label, status, seconds } of results) {
    console.log(`  ${status.padEnd(7)} ${label}${seconds === undefined ? '' : ` (${seconds}s)`}`)
  }
  const ok = results.every((result) => result.status === 'passed')
  console.log(
    ok
      ? '\nverify:release: GREEN - the PR checks and the release should pass.'
      : '\nverify:release: RED - fix the failed step(s) above before opening the PR.',
  )
  if (existsSync(SNAPSHOT_ROOT)) console.log(`snapshots (kept for debugging): ${SNAPSHOT_ROOT}`)
  process.exitCode = ok ? 0 : 1
}

main()
