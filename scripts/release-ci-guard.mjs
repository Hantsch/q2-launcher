#!/usr/bin/env node
// Release ci guard CLI: refuses a release whose commit has no green `ci` run. (story 266)
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { decideCiGuard, resolveGuardTarget } from './lib/release/ci-guard.mjs'

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${res.stderr || res.error}`)
  return res.stdout.trim()
}

try {
  const env = process.env
  const dryRun = env.RELEASE_DRY_RUN_INPUT === 'true'
  const override = env.RELEASE_SKIP_CI_GUARD_INPUT === 'true'
  const headSha = run('git', ['rev-parse', 'HEAD'])
  const parentSha = run('git', ['rev-parse', 'HEAD^'])
  const headMessage = run('git', ['log', '-1', '--format=%B', 'HEAD'])
  const targetSha = resolveGuardTarget({ headSha, headMessage, parentSha })

  let runs = []
  if (!dryRun && !override) {
    const endpoint = `repos/${env.GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${targetSha}&per_page=100`
    runs = JSON.parse(run('gh', ['api', endpoint])).workflow_runs
    if (!Array.isArray(runs)) throw new Error('gh api returned no workflow_runs')
  }

  const { pass, reason } = decideCiGuard({ dryRun, override, targetSha, runs })
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
