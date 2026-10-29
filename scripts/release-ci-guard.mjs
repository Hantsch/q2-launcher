#!/usr/bin/env node
// Release ci guard CLI: refuses a release whose commit has no green `ci` run. (story 266)
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { decideCiGuard, resolveGuardTarget } from './lib/release/ci-guard.mjs'

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' })
  if (res.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} failed: ${res.stderr || res.error}`)
  return res.stdout.trim()
}

const POLL_MS = 30_000
const MAX_WAIT_MS = 60 * 60_000
// A push starts `ci` and `release` together, so `ci` may not have registered its run yet.
const NO_RUN_GRACE_MS = 3 * 60_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  const env = process.env
  const dryRun = env.RELEASE_DRY_RUN_INPUT === 'true'
  const override = env.RELEASE_SKIP_CI_GUARD_INPUT === 'true'
  const headSha = run('git', ['rev-parse', 'HEAD'])
  const parentSha = run('git', ['rev-parse', 'HEAD^'])
  const headMessage = run('git', ['log', '-1', '--format=%B', 'HEAD'])
  const targetSha = resolveGuardTarget({ headSha, headMessage, parentSha })

  const fetchRuns = () => {
    const endpoint = `repos/${env.GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${targetSha}&per_page=100`
    const found = JSON.parse(run('gh', ['api', endpoint])).workflow_runs
    if (!Array.isArray(found)) throw new Error('gh api returned no workflow_runs')
    return found
  }

  const started = Date.now()
  let decision
  for (;;) {
    const runs = !dryRun && !override ? fetchRuns() : []
    decision = decideCiGuard({ dryRun, override, targetSha, runs })
    const elapsed = Date.now() - started
    const waitingForRun = !decision.pass && runs.length === 0 && elapsed < NO_RUN_GRACE_MS
    if (!(decision.pending || waitingForRun) || elapsed >= MAX_WAIT_MS) break
    console.log(`${decision.reason}; waiting ${POLL_MS / 1000}s for ci`)
    await sleep(POLL_MS)
  }
  const { pass, reason } = decision
  if (override && !dryRun) {
    console.log(`::warning::ci guard skipped by ${env.GITHUB_ACTOR} for ${targetSha}`)
  }
  console.log(reason)
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `sha=${headSha}\n`)
  process.exit(pass ? 0 : 1)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
