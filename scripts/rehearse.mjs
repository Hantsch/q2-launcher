// `npm run rehearse` - runs the slow pre-merge rehearsal (verify:release, ci:local, ci:local:flows)
// in a detached process and keeps a timed pass/fail record, so whoever started it - a person or an
// agent whose tool call ends after a few minutes - can walk away and poll for the verdict later.
// The rules (record, shard parsing, verdict) live in lib/rehearsal.mjs; this file does the I/O.
//
// Usage:
//   npm run rehearse                 start a run in .rehearsal/<UTC yyyymmdd-hhmmss>/ and return
//   npm run rehearse -- --status     summarise the newest run; exit 0 passed, 1 failed, 2 running
//                                    or aborted
//   node scripts/rehearse.mjs --run <dir>   the detached runner itself (started by the launcher)
//
// Each command's output goes to <dir>/<command>.log, every line prefixed with the time it arrived:
// act prints no timestamps itself, and the per-shard wall time is read from those prefixes.
//
// Test seams, never set by hand: Q2L_REHEARSAL_ROOT (absolute) replaces .rehearsal/, and
// Q2L_REHEARSAL_PLAN names a JSON file `{ commands: [{ name, command, args, shards? }], preflight:
// { act, docker } }` that replaces the npm commands and the act/Docker probes - with it, no act,
// Docker or container is ever touched.
import { spawn } from 'node:child_process'
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dockerRunning, removeStaleActContainers, resolveAct } from './lib/act.mjs'
import { REPO_ROOT } from './lib/paths.mjs'
import {
  DEFAULT_COMMANDS,
  finalStatus,
  initialRecord,
  logFileName,
  marginOk,
  newestRunDir,
  parseShards,
  preflightReason,
  runDirName,
  statusView,
} from './lib/rehearsal.mjs'

const IS_WIN = process.platform === 'win32'
const SELF = fileURLToPath(import.meta.url)
const RUNNER_START_TIMEOUT_MS = 15_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function rehearsalRoot() {
  const override = process.env.Q2L_REHEARSAL_ROOT
  if (!override) return join(REPO_ROOT, '.rehearsal')
  if (!isAbsolute(override)) throw new Error(`Q2L_REHEARSAL_ROOT must be absolute, got ${override}`)
  return override
}

function loadPlan() {
  const file = process.env.Q2L_REHEARSAL_PLAN
  if (!file) return { commands: DEFAULT_COMMANDS, preflight: null, stub: false }
  const plan = JSON.parse(readFileSync(file, 'utf-8'))
  return { commands: plan.commands, preflight: plan.preflight ?? null, stub: true }
}

const recordPath = (dir) => join(dir, 'record.json')

function readRecord(dir) {
  try {
    return JSON.parse(readFileSync(recordPath(dir), 'utf-8'))
  } catch {
    return null
  }
}

/** Write-then-rename, so a concurrent `--status` never reads a half-written record. */
function writeRecord(dir, record) {
  const tmp = `${recordPath(dir)}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`)
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, recordPath(dir))
      return
    } catch (error) {
      // Windows refuses the rename while a reader has the target open; that lasts milliseconds.
      if (attempt >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
      sleepSync(50)
    }
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** `env` with act's folder first on the PATH - the ci:local scripts call a bare `act`. */
function withActOnPath(env, act) {
  if (!act || !isAbsolute(act)) return env
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'
  return { ...env, [key]: `${dirname(act)}${delimiter}${env[key] ?? ''}` }
}

/** Runs one command with stdout+stderr, each line timestamped, into `logPath`; resolves its exit code. */
function runLogged(command, env, logPath) {
  const { cmd, args, shell } =
    command.command === undefined
      ? { cmd: 'npm', args: ['run', command.name], shell: IS_WIN }
      : { cmd: command.command, args: command.args ?? [], shell: false }
  const out = createWriteStream(logPath)
  const stamp = (line) => out.write(`${new Date().toISOString()} ${line}\n`)
  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    env,
    shell,
    // The runner has no console; without this every console child opens a window.
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise((resolve) => {
    child.on('error', (error) => {
      stamp(`rehearse: could not start ${cmd}: ${error.message}`)
      resolve(1)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
  const drained = [child.stdout, child.stderr].map(
    (stream) =>
      new Promise((resolve) =>
        createInterface({ input: stream, crlfDelay: Infinity })
          .on('line', stamp)
          .on('close', resolve),
      ),
  )
  return Promise.all([exited, ...drained]).then(
    ([code]) => new Promise((resolve) => out.end(() => resolve(code))),
  )
}

async function runRehearsal(dir) {
  const plan = loadPlan()
  const record = readRecord(dir) ?? initialRecord(new Date(), plan.commands)
  record.pid = process.pid
  writeRecord(dir, record)
  try {
    const probes = plan.preflight ?? { act: resolveAct(), docker: dockerRunning() }
    const reason = preflightReason(probes)
    if (reason !== null) {
      record.commands = plan.commands.map(({ name }) => ({ name, status: 'skipped' }))
      record.reason = reason
      return
    }
    const env = withActOnPath(process.env, probes.act)
    for (const [index, command] of plan.commands.entries()) {
      if (!plan.stub) removeStaleActContainers()
      record.commands[index] = { name: command.name, status: 'running' }
      writeRecord(dir, record)
      const startedAt = Date.now()
      const logPath = join(dir, logFileName(command.name))
      const exitCode = await runLogged(command, env, logPath)
      const entry = {
        name: command.name,
        status: exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      }
      if (command.shards) {
        entry.shards = parseShards(readFileSync(logPath, 'utf-8'))
        record.marginOk = marginOk(entry.shards)
      }
      record.commands[index] = entry
      writeRecord(dir, record)
    }
  } catch (error) {
    record.reason = `rehearse crashed: ${error.stack ?? error}`
  } finally {
    record.status = record.reason ? 'failed' : finalStatus(record)
    record.finishedAt = new Date().toISOString()
    writeRecord(dir, record)
  }
}

async function launch() {
  const plan = loadPlan()
  const root = rehearsalRoot()
  mkdirSync(root, { recursive: true })
  const startedAt = new Date()
  const dir = join(root, runDirName(startedAt))
  try {
    mkdirSync(dir)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    console.error(`rehearse: a rehearsal started this second already: ${dir}`)
    return 1
  }
  writeRecord(dir, initialRecord(startedAt, plan.commands))
  // `detached` keeps the runner out of libuv's kill-on-close job, which takes down a Node parent's
  // attached children when the parent exits; it outlives this launcher and the shell that started
  // it. A host that puts its whole tree in a kill-on-close job without breakaway would still end it.
  const child = spawn(process.execPath, [SELF, '--run', dir], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  let spawnError = null
  child.on('error', (error) => {
    spawnError = error
  })
  child.unref()
  // Until the runner has written its own pid, `--status` would call the run aborted.
  const deadline = Date.now() + RUNNER_START_TIMEOUT_MS
  while (spawnError === null && !Number.isInteger(readRecord(dir)?.pid)) {
    if (Date.now() > deadline) break
    await sleep(100)
  }
  if (!Number.isInteger(readRecord(dir)?.pid)) {
    console.error(
      `rehearse: the runner did not start${spawnError ? `: ${spawnError.message}` : ''}`,
    )
    return 1
  }
  console.log(`rehearsal running in ${dir}`)
  console.log('poll it with: npm run rehearse -- --status')
  return 0
}

function status() {
  const root = rehearsalRoot()
  let names = []
  try {
    names = readdirSync(root)
  } catch {
    // no root yet: no rehearsal has run
  }
  const name = newestRunDir(names)
  const record = name === null ? null : readRecord(join(root, name))
  if (record === null) {
    console.error(`rehearse: no rehearsal record under ${root}`)
    return 1
  }
  const { lines, exitCode } = statusView(name, record, pidAlive(record.pid))
  for (const line of lines) console.log(line)
  return exitCode
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) return launch()
  if (args.length === 1 && args[0] === '--status') return status()
  if (args.length === 2 && args[0] === '--run') {
    await runRehearsal(args[1])
    return 0
  }
  console.error('usage: npm run rehearse [-- --status]')
  return 1
}

process.exitCode = await main()
