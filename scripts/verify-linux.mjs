// `npm run verify:linux` - runs every Linux check locally, through act + Docker, and only warns.
//
// What it runs, from a snapshot of the working tree (as `git add -A` would commit it): every
// ubuntu job of the dispatch-only workflows (linux.yml, linux-verify.yml, linux-update.yml) and
// release.yml's `build-linux` at the version the release would get (the AppImage build).
// Linux is an additional target: the result is GREEN or YELLOW, a failed or skipped check is a
// `warning:` line and the exit code stays 0. Only a missing act or Docker exits 1, before anything runs.
//
// Takes ~40 min. Run it after the sprint's regression gate, and never concurrently with
// `verify:release` - both use act's containers and Docker's resources.
//
// Usage: npm run verify:linux
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { dockerRunning, removeStaleActContainers, resolveAct } from './lib/act.mjs'
import { buildLinuxWorkflowText } from './lib/build-linux-workflow.mjs'
import { REPO_ROOT } from './lib/paths.mjs'
import { checkoutTree, snapshotWorkingTree } from './lib/snapshot.mjs'
import { isAppImageRun, linuxRuns, preflight, verdict } from './lib/verify-linux.mjs'

const SNAPSHOT_ROOT = join(tmpdir(), 'q2-launcher-verify-linux')
const LINUX_DIR = join(SNAPSHOT_ROOT, 'linux')
const ARTIFACT_DIR = join(SNAPSHOT_ROOT, 'act-artifacts')
// Chromium needs more than Docker's default 64 MB /dev/shm; the AppImage and self-update runs need FUSE.
const CONTAINER_OPTIONS = '--privileged --shm-size=2g'

/** release.yml's `plan` job, against the snapshot: the version its release would get, or the refusal. */
function plannedVersion(sha) {
  const result = spawnSync(process.execPath, ['scripts/release.mjs', '--print-plan'], {
    cwd: LINUX_DIR,
    env: { ...process.env, GIT_DIR: join(REPO_ROOT, '.git') },
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    const reason = (result.stderr || result.stdout || '').trim().split('\n').pop()
    return { reason: `release plan refused: ${reason || `exit ${result.status}`}` }
  }
  return { file: writeAppImageWorkflow(JSON.parse(result.stdout).version, sha) }
}

function writeAppImageWorkflow(version, sha) {
  const text = buildLinuxWorkflowText(
    readFileSync(join(LINUX_DIR, '.github/workflows/release.yml'), 'utf-8'),
    version,
    sha,
  )
  const file = join(LINUX_DIR, '.verify-linux-build-linux.yml')
  writeFileSync(file, text)
  return file
}

function main() {
  const act = resolveAct()
  const docker = act !== null && dockerRunning()
  const problem = preflight({ act, docker })
  if (problem) {
    console.error(problem)
    process.exitCode = 1
    return
  }

  mkdirSync(SNAPSHOT_ROOT, { recursive: true })
  const snap = snapshotWorkingTree(join(SNAPSHOT_ROOT, 'work.index'))
  if (!snap) {
    console.error('verify:linux - could not snapshot the working tree')
    process.exitCode = 1
    return
  }
  if (snap.changed) {
    console.warn('verify:linux - warning: the snapshot includes uncommitted changes')
  }
  const tree = spawnSync('git', ['rev-parse', `${snap.subject}^{tree}`], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  }).stdout.trim()
  if (
    !checkoutTree(
      tree,
      LINUX_DIR,
      ['-c', 'core.autocrlf=false'],
      join(SNAPSHOT_ROOT, 'linux.index'),
    )
  ) {
    console.error('verify:linux - could not check the working tree out into the snapshot folder')
    process.exitCode = 1
    return
  }

  const workflowsDir = join(LINUX_DIR, '.github/workflows')
  const workflows = readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml'))
    .sort()
    .map((file) => ({ file, doc: yaml.load(readFileSync(join(workflowsDir, file), 'utf-8')) }))

  removeStaleActContainers()
  rmSync(ARTIFACT_DIR, { recursive: true, force: true })
  const results = []
  for (const run of linuxRuns(workflows)) {
    const label = `${run.workflow} ${run.job}`
    let workflowFile = `.github/workflows/${run.workflow}`
    if (isAppImageRun(run)) {
      const planned = plannedVersion(snap.subject)
      if (planned.reason) {
        results.push({ ...run, status: 'skipped', reason: `skipped: ${planned.reason}` })
        continue
      }
      workflowFile = planned.file
    }
    console.log(`\n=== verify:linux - ${label} ===`)
    const status = spawnSync(
      act,
      [
        'workflow_dispatch',
        '-W',
        workflowFile,
        ...(isAppImageRun(run) ? [] : ['-j', run.job]),
        // One VM per job on GitHub; act's parallel jobs share a tool cache and race on it.
        '--concurrent-jobs',
        '1',
        '--artifact-server-path',
        ARTIFACT_DIR,
        '--container-options',
        CONTAINER_OPTIONS,
      ],
      { cwd: LINUX_DIR, stdio: 'inherit' },
    ).status
    results.push(
      status === 0
        ? { ...run, status: 'passed' }
        : { ...run, status: 'failed', reason: `failed: act exited ${status}` },
    )
  }

  const { lines, exitCode } = verdict(results)
  console.log(`\n${lines.join('\n')}`)
  process.exitCode = exitCode
}

main()
