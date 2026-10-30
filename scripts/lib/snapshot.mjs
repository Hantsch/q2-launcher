// The working tree as `git add -A` would commit it, and checkouts of a tree into a folder, both
// through throwaway indexes - no branch, ref or index of the repo is touched. Shared by
// verify-release.mjs and verify-linux.mjs.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { REPO_ROOT } from './paths.mjs'

function run(args, indexFile) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: indexFile ? { ...process.env, GIT_INDEX_FILE: indexFile } : process.env,
  })
  return result.status
}

/** Runs git and returns its trimmed stdout, or `null` if it failed. */
export function gitCapture(args, indexFile) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: indexFile ? { ...process.env, GIT_INDEX_FILE: indexFile } : process.env,
  })
  return result.status === 0 ? result.stdout.trim() : null
}

/**
 * HEAD plus uncommitted and untracked, non-ignored files, as an unreferenced tree. `subject` is
 * HEAD's sha, or a snapshot commit on top of it when the tree differs (`changed`). `null` when git
 * could not build it.
 */
export function snapshotWorkingTree(indexFile) {
  const tree =
    run(['read-tree', 'HEAD'], indexFile) === 0 &&
    run(['-c', 'core.safecrlf=false', 'add', '-A'], indexFile) === 0
      ? gitCapture(['write-tree'], indexFile)
      : null
  if (!tree) return null
  const head = gitCapture(['rev-parse', 'HEAD'])
  if (tree === gitCapture(['rev-parse', 'HEAD^{tree}'])) return { subject: head, changed: false }
  const subject = gitCapture(['commit-tree', tree, '-p', 'HEAD', '-m', 'verify snapshot'])
  return subject ? { subject, changed: true } : null
}

/** Checks `tree` out into `dir` through the throwaway `indexFile`. */
export function checkoutTree(tree, dir, gitConfig, indexFile) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const prefix = `${dir.replaceAll('\\', '/')}/`
  return (
    run([...gitConfig, 'read-tree', tree], indexFile) === 0 &&
    run([...gitConfig, 'checkout-index', '--all', `--prefix=${prefix}`], indexFile) === 0
  )
}
