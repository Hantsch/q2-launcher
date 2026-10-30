// `npm run verify:release` - the local gate that answers "will the PR into main go green, and will
// the release run once it is merged?" before anything is pushed.
//
// Why a plain `npm test && npm run package:*` never answered that (both failed PR runs of
// 2026-09-26 were green locally):
//   1. GitHub runs a PR's checks on the MERGE of the PR branch into main, not on the branch. When
//      main has moved on (e.g. the `release: x.y.z` commit the release job pushes), the branch
//      alone is a different tree - and `release.mjs --print-plan` refuses on it outright
//      ("tag vX already exists"), because the branch still carries the old version.
//   2. The PR and the release run more than unit tests: `ui:verify`'s axe-core gate, the
//      core-journey flows and a launch smoke of the packaged app.
//
// So this script: computes the PR's merge tree (`git merge-tree --write-tree`, no commit, no ref,
// no index touched), checks it out into a throwaway snapshot folder and runs in it (.gitattributes'
// `eol=lf` makes it LF whatever core.autocrlf says; the pin below only keeps the checkout matching
// the runner's git). What is verified is the working tree as `git add -A` would commit it (HEAD
// plus uncommitted and untracked, non-ignored files), captured through a throwaway index into an
// unreferenced snapshot object - no branch, ref or index of yours is touched. When that differs
// from HEAD a warning says so: commit exactly that, or the PR runs on a different tree.
//
// In the snapshot it runs every blocking step of the PR workflows and the release job, in the
// order of hostSteps() in scripts/lib/verify-release-plan.mjs: npm ci and `npm run check` first
// (format, typecheck, lint, unit tests - a failure there skips the rest), then the audit, the
// release plan, the Electron binary, the Windows UI verify (fetch:7za, build:dev, ui:verify and
// every flow ui-flows.yml's windows-verify job runs, read from the snapshot), the packaged launch
// smoke (package:dir:smoke, then about-release-notes against the unpacked app) and last
// `release.mjs --dry-run` at the planned version (the release job's own code minus commit, tag
// and publish). After the two gates a failing step is reported and the run goes on, so one run
// names every red step. A test (scripts/verify-release.test.mjs) fails when a blocking CI step has
// no local step here and no stated reason. Linux is not part of this gate: `npm run verify:linux`
// runs every Linux check under act + Docker. Exit code 0 means every step passed.
//
// The steps run as GitHub's Windows runner would, not as this machine does (see runnerEnv()):
// CI/GITHUB_ACTIONS set, TZ=UTC, and a TEMP that is not its own realpath - the runner's tmpdir() is
// an 8.3 short path (C:\Users\RUNNER~1\...), which on 2026-09-30 failed tests that were green here.
// The checkout pins core.autocrlf=true like the runner's git does.
//
// Run it by hand once dev is in the state you want to release - it is not wired into any git hook
// on purpose: a push to dev is not a release.
//
// Every run that got as far as the merge tree leaves .verify-release/last-run.json (green or red);
// `--status` fetches, compares it with HEAD's tree and the base the run merged into, and exits 0 only when it still holds
// (2 without a record) - it runs nothing else.
//
// Usage: npm run verify:release [-- --base=origin/main] | [-- --status]
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { REPO_ROOT } from './lib/paths.mjs'
import { checkoutTree, snapshotWorkingTree } from './lib/snapshot.mjs'
import { buildRecord, statusVerdict } from './lib/verify-release-record.mjs'
import { hostSteps, PACKAGED_APP, runPhase } from './lib/verify-release-plan.mjs'
import { loadWorkflow } from './lib/workflow-yaml.mjs'

const IS_WIN = process.platform === 'win32'
const SNAPSHOT_ROOT = join(tmpdir(), 'q2-launcher-verify-release')
const HOST_DIR = join(SNAPSHOT_ROOT, 'host')
const RECORD_PATH =
  process.env.VERIFY_RELEASE_RECORD || join(REPO_ROOT, '.verify-release', 'last-run.json')

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

// Through cmd.exe on Windows, which splits an unquoted argument at its spaces (the packaged app).
const npm = (args, cwd, env) =>
  run(
    IS_WIN ? 'npm.cmd' : 'npm',
    IS_WIN ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : args,
    { cwd, env, shell: IS_WIN },
  )

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

function parseBase(argv) {
  const flag = argv.find((arg) => arg.startsWith('--base='))
  return flag ? flag.slice('--base='.length) : 'origin/main'
}

function status() {
  if (!existsSync(RECORD_PATH)) {
    console.error(`verify:release - no verify:release record at ${RECORD_PATH}; run it first.`)
    return 2
  }
  let record
  try {
    record = JSON.parse(readFileSync(RECORD_PATH, 'utf-8'))
  } catch {
    record = null
  }
  if (typeof record?.base !== 'string' || !record.base) {
    console.error(
      `verify:release - unreadable verify:release record at ${RECORD_PATH}; run it again.`,
    )
    return 2
  }
  const base = record.base
  const remote = base.includes('/') ? base.slice(0, base.indexOf('/')) : null
  const fetchFailed = remote !== null && capture('git', ['fetch', '--quiet', remote]) === null
  const verdict = statusVerdict(record, {
    headTree: capture('git', ['rev-parse', 'HEAD^{tree}']),
    headSha: capture('git', ['rev-parse', 'HEAD']),
    baseSha: fetchFailed ? null : capture('git', ['rev-parse', base]),
    fetchFailed,
  })
  for (const line of verdict.lines) console.log(`verify:release - ${line}`)
  return verdict.exitCode
}

function main() {
  if (process.argv.includes('--status')) {
    process.exitCode = status()
    return
  }
  const base = parseBase(process.argv.slice(2))
  const results = []

  mkdirSync(SNAPSHOT_ROOT, { recursive: true })

  // --- the working tree, as it would be committed -------------------------------
  const snap = snapshotWorkingTree(join(SNAPSHOT_ROOT, 'work.index'))
  if (!snap) {
    console.error('verify:release - could not snapshot the working tree')
    process.exitCode = 1
    return
  }
  const { subject } = snap
  let subjectLabel = `HEAD ${capture('git', ['rev-parse', 'HEAD']).slice(0, 7)}`
  if (snap.changed) {
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
  const baseFullSha = capture('git', ['rev-parse', base])
  console.log(`verify:release - verifying ${subjectLabel} merged into ${base} ${baseSha}`)

  if (
    !checkoutTree(
      tree,
      HOST_DIR,
      IS_WIN ? ['-c', 'core.autocrlf=true'] : [],
      join(SNAPSHOT_ROOT, 'host.index'),
    )
  ) {
    console.error('verify:release - could not check the merge tree out into the snapshot folder')
    process.exitCode = 1
    return
  }

  // --- the steps ----------------------------------------------------------------
  const H = HOST_DIR
  const R = runnerEnv()
  // The release.mjs calls read the tags from this repo's .git, which the snapshot has none of.
  const releaseEnv = { ...R, GIT_DIR: join(REPO_ROOT, '.git') }
  let plannedVersion = null
  const execute = (step) => {
    const env = { ...R, ...step.env }
    switch (step.kind) {
      case 'npm':
        return npm(step.args, H, env) === 0
      case 'node':
        return run(process.execPath, step.args, { cwd: H, env }) === 0
      case 'release-plan': {
        const result = spawnSync(process.execPath, ['scripts/release.mjs', '--print-plan'], {
          cwd: H,
          env: { ...process.env, ...releaseEnv },
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'inherit'],
        })
        if (result.status !== 0) return false
        plannedVersion = JSON.parse(result.stdout).version
        console.log(`planned version: ${plannedVersion}`)
        return true
      }
      case 'release-dry-run':
        return (
          plannedVersion !== null &&
          run(process.execPath, ['scripts/release.mjs', '--dry-run', '--version', plannedVersion], {
            cwd: H,
            env: { ...releaseEnv, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
          }) === 0
        )
      default:
        throw new Error(`verify:release - unknown step kind ${step.kind}`)
    }
  }
  const steps = hostSteps({
    uiFlows: loadWorkflow('ui-flows.yml', H),
    packagedApp: join(H, PACKAGED_APP),
  })
  results.push(...runPhase('host', steps, execute))

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
  mkdirSync(dirname(RECORD_PATH), { recursive: true })
  writeFileSync(
    RECORD_PATH,
    `${JSON.stringify(
      buildRecord({
        headSha: capture('git', ['rev-parse', 'HEAD']),
        verifiedTree: capture('git', ['rev-parse', `${subject}^{tree}`]),
        includedUncommitted: snap.changed,
        base,
        baseSha: baseFullSha,
        failed: results.filter((r) => r.status !== 'passed').map((r) => r.label),
        finishedAt: new Date().toISOString(),
      }),
      null,
      2,
    )}
`,
  )
  console.log(`snapshots (kept for debugging): ${SNAPSHOT_ROOT}`)
  process.exitCode = ok ? 0 : 1
}

main()
