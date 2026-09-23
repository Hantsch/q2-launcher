// Runs every flow under scripts/flows/ once, each against a freshly seeded fixture, and exits 1 if
// any failed. This is the profile's `e2e-all` (.claude/ai-scrum.md): the sprint's regression gate.
// `ui:verify` only screenshots and audits screens; the flows are what caught S18's cross-story
// regression. Each flow runs in its own process, so one crash cannot take the rest down.
//
// Usage: `npm run ui:flows` — optionally with flow names to run a subset.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './lib/paths.mjs'

function run(script, args) {
  return spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', script), ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  }).status
}

function main() {
  const requested = process.argv.slice(2)
  const names =
    requested.length > 0
      ? requested
      : readdirSync(join(REPO_ROOT, 'scripts', 'flows'))
          .filter((file) => file.endsWith('.mjs'))
          .map((file) => file.slice(0, -'.mjs'.length))
          .sort()

  const failed = []
  const startedAt = Date.now()
  for (const [index, name] of names.entries()) {
    console.log(`\n[${index + 1}/${names.length}] ${name}`)
    // Flows never reseed themselves and some mutate their fixture; reseeding is ~0.5s.
    if (run('seed.mjs', []) !== 0 || run('flow.mjs', [name]) !== 0) failed.push(name)
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000)
  console.log(`\n${names.length - failed.length}/${names.length} flows passed in ${seconds}s`)
  if (failed.length > 0) {
    console.log(`failed: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

main()
