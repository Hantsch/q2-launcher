// Runs every flow under scripts/flows/ once, each against a freshly seeded fixture, and exits 1 if
// any failed. This is the profile's `e2e-all` (.claude/ai-scrum.md): the sprint's regression gate.
// `ui:verify` only screenshots and audits screens; the flows are what caught S18's cross-story
// regression. Each flow runs in its own process, so one crash cannot take the rest down.
//
// Flows listed in scripts/flows/quarantine.json are expected to fail and do not break the run; see
// lib/flow-gate.mjs for the rules.
//
// Usage: `npm run ui:flows [-- <flow>... --shard=i/n --timeout=<seconds>]`
//   <flow>...         run only these flows
//   --shard=i/n      run the i-th of n round-robin slices of the (selected) flows
//   --timeout=<s>    kill a flow that runs longer than s seconds (default 300) and count it failed
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { currentSprint, parseShard, runGate, selectShard, summaryLines } from './lib/flow-gate.mjs'
import { REPO_ROOT } from './lib/paths.mjs'

function run(script, args) {
  return spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', script), ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  }).status
}

const DEFAULT_TIMEOUT_SECONDS = 300
const USAGE =
  'usage: npm run ui:flows [-- <flow>... --shard=i/n --timeout=<seconds>]  (1 <= i <= n, timeout > 0)'

// A surviving Electron would make the next flow fail with "another instance is already running",
// so the whole tree goes, and the caller awaits it.
function killTree(child) {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on(
        'close',
        resolve,
      )
    })
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // already gone
  }
  return Promise.resolve()
}

/** Runs a script in its own process; resolves `{ status, timedOut }` once the whole tree is gone. */
function runTimed(script, args, timeoutSeconds) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, 'scripts', script), ...args], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    })
    let timedOut = false
    const timer = setTimeout(async () => {
      timedOut = true
      await killTree(child)
    }, timeoutSeconds * 1000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ status: 1, timedOut: false })
    })
    child.on('exit', (status) => {
      clearTimeout(timer)
      resolve({ status, timedOut })
    })
  })
}

function usageError() {
  console.error(USAGE)
  process.exit(1)
}

function listDirs(dir) {
  return existsSync(dir) ? readdirSync(dir) : []
}

async function main() {
  const flowsDir = join(REPO_ROOT, 'scripts', 'flows')
  const known = readdirSync(flowsDir)
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => file.slice(0, -'.mjs'.length))
    .sort()
  const args = process.argv.slice(2)
  const requested = args.filter((arg) => !arg.startsWith('--'))
  const selected = requested.length > 0 ? requested : known
  let shard = null
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS
  for (const flag of args.filter((arg) => arg.startsWith('--'))) {
    const [key, value = ''] = flag.split('=')
    if (key === '--shard') shard = parseShard(value)
    else if (key === '--timeout') timeoutSeconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) : 0
    else usageError()
    if (shard === null && key === '--shard') usageError()
    if (!(timeoutSeconds > 0)) usageError()
  }
  const names = shard ? selectShard(selected, shard.index, shard.count) : selected
  const entries = JSON.parse(readFileSync(join(flowsDir, 'quarantine.json'), 'utf8'))
  const sprintsDir = join(REPO_ROOT, 'docs', 'sprints')
  const current = currentSprint(listDirs(sprintsDir), listDirs(join(sprintsDir, 'done')))

  const startedAt = Date.now()
  const result = await runGate({
    names,
    entries,
    knownFlows: known,
    current,
    runFlow: async (name, index) => {
      console.log(`
[${index + 1}/${names.length}] ${name}`)
      const flowStart = Date.now()
      // Flows never reseed themselves and some mutate their fixture; reseeding is ~0.5s.
      const seeded = run('seed.mjs', []) === 0
      const outcome = seeded ? await runTimed('flow.mjs', [name], timeoutSeconds) : { status: 1 }
      const took = ((Date.now() - flowStart) / 1000).toFixed(1)
      const verdict = outcome.timedOut
        ? `timed out after ${timeoutSeconds}s`
        : outcome.status === 0
          ? 'passed'
          : 'failed'
      console.log(`  ${name}: ${verdict} (${took}s)`)
      return outcome.status === 0 && !outcome.timedOut
    },
  })

  const seconds = Math.round((Date.now() - startedAt) / 1000)
  console.log('')
  for (const line of summaryLines(result, names.length, seconds)) console.log(line)
  if (!result.ok) process.exitCode = 1
}

await main()
