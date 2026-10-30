// `npm run rehearse` - runs the slow pre-merge rehearsal (verify:release, and with `--linux`
// verify:linux first) in a detached process and keeps a timed pass/fail record, so whoever started
// it - a person or an agent whose tool call ends after a few minutes - can walk away and poll for
// the verdict later. The rules (command list, record, verdict) live in lib/rehearsal.mjs; this
// file does the I/O.
//
// Usage:
//   npm run rehearse                 start a run in .rehearsal/<UTC yyyymmdd-hhmmss>/ and return;
//                                    the Linux checks are skipped and one line says so
//   npm run rehearse -- --linux      the same, plus verify:linux, run before verify:release
//   npm run rehearse -- --status     summarise the newest run; exit 0 passed, 1 failed, 2 running
//                                    or aborted
//   node scripts/rehearse.mjs --run <dir> [--linux]   the detached runner itself (started by the
//                                    launcher, which passes its own --linux on)
//
// Each command's output goes to <dir>/<command>.log, every line prefixed with the time it arrived.
//
// Test seams, never set by hand: Q2L_REHEARSAL_ROOT (absolute) replaces .rehearsal/, and
// Q2L_REHEARSAL_PLAN names a JSON file `{ commands: [{ name, command, args }] }` that replaces the
// npm commands - with it, no npm script is ever started.
import { spawn } from 'node:child_process'
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT } from './lib/paths.mjs'
import {
  LINUX_FLAG,
  LINUX_COMMAND,
  commandsFor,
  finalStatus,
  initialRecord,
  logFileName,
  newestRunDir,
  parseRehearseArgs,
  runDirName,
  skippedLinuxLine,
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

/** The run's commands and the legs left out; a stub plan is taken verbatim, nothing is skipped. */
function loadPlan(linux) {
  const file = process.env.Q2L_REHEARSAL_PLAN
  if (!file) {
    return {
      commands: commandsFor({ linux }),
      skipped: linux ? [] : [LINUX_COMMAND.name],
    }
  }
  const plan = JSON.parse(readFileSync(file, 'utf-8'))
  return { commands: plan.commands, skipped: [] }
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

/** Runs one command with stdout+stderr, each line timestamped, into `logPath`; resolves its exit code. */
function runLogged(command, logPath) {
  const { cmd, args, shell } =
    command.command === undefined
      ? { cmd: 'npm', args: ['run', command.name], shell: IS_WIN }
      : { cmd: command.command, args: command.args ?? [], shell: false }
  const out = createWriteStream(logPath)
  const stamp = (line) => out.write(`${new Date().toISOString()} ${line}\n`)
  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
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

async function runRehearsal(dir, linux) {
  const plan = loadPlan(linux)
  const record = readRecord(dir) ?? initialRecord(new Date(), plan.commands, plan.skipped)
  record.pid = process.pid
  writeRecord(dir, record)
  try {
    for (const [index, command] of plan.commands.entries()) {
      record.commands[index] = { name: command.name, status: 'running' }
      writeRecord(dir, record)
      const startedAt = Date.now()
      const logPath = join(dir, logFileName(command.name))
      const exitCode = await runLogged(command, logPath)
      const entry = {
        name: command.name,
        status: exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        seconds: Math.round((Date.now() - startedAt) / 1000),
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

async function launch(linux) {
  const plan = loadPlan(linux)
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
  writeRecord(dir, initialRecord(startedAt, plan.commands, plan.skipped))
  // `detached` keeps the runner out of libuv's kill-on-close job, which takes down a Node parent's
  // attached children when the parent exits; it outlives this launcher and the shell that started
  // it. A host that puts its whole tree in a kill-on-close job without breakaway would still end it.
  const child = spawn(process.execPath, [SELF, '--run', dir, ...(linux ? [LINUX_FLAG] : [])], {
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
  if (plan.skipped.includes(LINUX_COMMAND.name)) console.log(skippedLinuxLine())
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
  const { mode, linux, dir } = parseRehearseArgs(process.argv.slice(2))
  if (mode === 'launch') return launch(linux)
  if (mode === 'status') return status()
  if (mode === 'run') {
    await runRehearsal(dir, linux)
    return 0
  }
  console.error(`usage: npm run rehearse [-- ${LINUX_FLAG} | --status]`)
  return 1
}

process.exitCode = await main()
