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
// no index touched), checks it out into two throwaway snapshot folders - one with this machine's
// line endings for the host phase, one with LF for the Linux phase - and runs in them:
//   host  (the `test (windows-latest)` leg + the release job's own Windows steps):
//         npm ci, typecheck, test, release plan, ui:verify (screens + axe), package:win|linux
//   linux (every PR workflow, through act + Docker, from the LF snapshot):
//         ci.yml, linux-verify.yml, linux-update.yml
// What is verified is the working tree as `git add -A` would commit it (HEAD plus uncommitted and
// untracked, non-ignored files), captured through a throwaway index into an unreferenced snapshot
// object - no branch, ref or index of yours is touched. When that differs from HEAD a warning says
// so: commit exactly that, or the PR runs on a different tree. Exit code 0 means every step passed;
// anything else prints which one did not.
//
// Usage: npm run verify:release [-- --base=origin/main]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT } from './lib/paths.mjs'

const IS_WIN = process.platform === 'win32'
const SNAPSHOT_ROOT = join(tmpdir(), 'q2-launcher-verify-release')
const HOST_DIR = join(SNAPSHOT_ROOT, 'host')
const LINUX_DIR = join(SNAPSHOT_ROOT, 'linux')
const ARTIFACT_DIR = join(SNAPSHOT_ROOT, 'act-artifacts')
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
    !checkoutTree(tree, HOST_DIR, []) ||
    !checkoutTree(tree, LINUX_DIR, ['-c', 'core.autocrlf=false'])
  ) {
    console.error('verify:release - could not check the merge tree out into the snapshot folders')
    process.exitCode = 1
    return
  }

  // --- host phase --------------------------------------------------------------
  const H = HOST_DIR
  runPhase(
    'host',
    [
      { label: 'npm ci', gate: true, run: () => npm(['ci'], H) === 0 },
      {
        label: 'install Electron binary',
        gate: true,
        run: () => run(process.execPath, ['node_modules/electron/install.js'], { cwd: H }) === 0,
      },
      { label: 'typecheck', run: () => npm(['run', 'typecheck'], H) === 0 },
      { label: 'test', run: () => npm(['test'], H) === 0 },
      {
        // release.yml's `plan` job, against the merged tree - but the tags live in this repo's
        // .git, which the snapshot has none of.
        label: 'release plan',
        run: () =>
          run(process.execPath, ['scripts/release.mjs', '--print-plan'], {
            cwd: H,
            env: { GIT_DIR: join(REPO_ROOT, '.git') },
          }) === 0,
      },
      { label: 'ui:verify (screens + axe)', run: () => npm(['run', 'ui:verify'], H) === 0 },
      {
        label: IS_WIN ? 'package:win' : 'package:linux',
        run: () =>
          npm(['run', IS_WIN ? 'package:win' : 'package:linux'], H, {
            CSC_IDENTITY_AUTO_DISCOVERY: 'false',
          }) === 0,
      },
    ],
    results,
  )

  // --- linux phase (act) -------------------------------------------------------
  const act = process.env.ACT ?? 'act'
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
        label: 'act + docker available',
        gate: true,
        run: () => {
          if (capture(act, ['--version']) === null) {
            console.error(
              'act not found - install it (Windows: `winget install nektos.act`, then open a new shell) or set ACT=<path>.',
            )
            return false
          }
          if (capture('docker', ['info', '--format', '{{.ServerVersion}}']) === null) {
            console.error('Docker is not running - start Docker Desktop.')
            return false
          }
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
    ],
    results,
  )

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
