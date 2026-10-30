import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  CORE_COMMANDS,
  LINUX_COMMAND,
  commandsFor,
  initialRecord,
  parseRehearseArgs,
  skippedLinuxLine,
  statusView,
} from './lib/rehearsal.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts', 'rehearse.mjs')
const NODE = process.execPath

let tmp
let runs
let planFile

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'q2l-rehearsal-'))
  runs = join(tmp, 'runs')
  planFile = join(tmp, 'plan.json')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

const env = () => ({ ...process.env, Q2L_REHEARSAL_ROOT: runs, Q2L_REHEARSAL_PLAN: planFile })
const stand = (name, script, extra = {}) => ({
  name,
  command: NODE,
  args: ['-e', script],
  ...extra,
})
const writeMarker = (file) => `require('fs').writeFileSync(${JSON.stringify(file)}, 'ran')`

/** Starts the launcher through a shell, as `npm run rehearse` does, and waits for it to exit. */
function launch(plan) {
  writeFileSync(planFile, JSON.stringify(plan))
  const result = spawnSync(`"${NODE}" "${SCRIPT}"`, {
    cwd: ROOT,
    env: env(),
    shell: true,
    encoding: 'utf-8',
  })
  return result
}

function onlyRunDir() {
  const names = readdirSync(runs)
  expect(names).toHaveLength(1)
  return join(runs, names[0])
}

const readRecord = (dir) => JSON.parse(readFileSync(join(dir, 'record.json'), 'utf-8'))

async function waitForVerdict(dir, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const record = readRecord(dir)
    if (record.status !== 'running') return record
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`the rehearsal in ${dir} did not finish within ${timeoutMs} ms`)
}

const status = () =>
  spawnSync(NODE, [SCRIPT, '--status'], { cwd: ROOT, env: env(), encoding: 'utf-8' })

describe('release rehearsal', () => {
  test('the launcher returns before the detached run finishes and the run completes the record', async () => {
    const launched = launch({
      commands: [stand('verify:linux', 'setTimeout(() => {}, 3000)'), stand('verify:release', '')],
    })
    expect(launched.status, launched.stderr).toBe(0)
    const dir = onlyRunDir()
    expect(dir).toMatch(/\d{8}-\d{6}$/)
    expect(launched.stdout).toContain(dir)
    expect(launched.stdout).toContain('npm run rehearse -- --status')

    const running = readRecord(dir)
    expect(running.status).toBe('running')
    expect(Number.isInteger(running.pid)).toBe(true)
    expect(running.pid).not.toBe(launched.pid)

    // The launcher and its shell are gone by now; only the detached runner can finish the record.
    const record = await waitForVerdict(dir)
    expect(record.status).toBe('passed')
    expect(record.commands.map((c) => [c.name, c.status, c.exitCode])).toEqual([
      ['verify:linux', 'passed', 0],
      ['verify:release', 'passed', 0],
    ])
    expect(existsSync(join(dir, 'verify-linux.log'))).toBe(true)

    const report = status()
    expect(report.status).toBe(0)
    expect(report.stdout).toContain('verdict: PASSED')
    expect(report.stdout).toMatch(/passed\s+verify:release \(\d+s\)/)
  }, 60_000)

  test('commands run one after the other, never concurrently', async () => {
    const lock = join(tmp, 'lock')
    const exclusive =
      'const fs = require("fs");' +
      'if (fs.existsSync(' +
      JSON.stringify(lock) +
      ')) process.exit(7);' +
      'fs.writeFileSync(' +
      JSON.stringify(lock) +
      ', "x");' +
      'setTimeout(() => { fs.rmSync(' +
      JSON.stringify(lock) +
      '); }, 500)'
    const launched = launch({
      commands: [stand('verify:linux', exclusive), stand('verify:release', exclusive)],
    })
    expect(launched.status, launched.stderr).toBe(0)
    const record = await waitForVerdict(onlyRunDir())
    expect(record.status).toBe('passed')
  }, 60_000)

  test('a failing command is recorded failed and the next one still runs', async () => {
    const marker = join(tmp, 'second-ran')
    const launched = launch({
      commands: [
        stand('verify:linux', 'console.error("boom"); process.exit(3)'),
        stand('verify:release', writeMarker(marker)),
      ],
    })
    expect(launched.status, launched.stderr).toBe(0)
    const dir = onlyRunDir()
    const record = await waitForVerdict(dir)

    expect(record.status).toBe('failed')
    expect(record.commands[0]).toMatchObject({
      name: 'verify:linux',
      status: 'failed',
      exitCode: 3,
    })
    expect(record.commands[1]).toMatchObject({
      name: 'verify:release',
      status: 'passed',
      exitCode: 0,
    })
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(join(dir, 'verify-linux.log'), 'utf-8')).toMatch(/Z boom\r?\n/)

    const report = status()
    expect(report.status).toBe(1)
    expect(report.stdout).toContain('verdict: FAILED')
  }, 60_000)

  test('status reports a running record whose pid is gone as aborted', () => {
    const goneDir = join(runs, '20261005-120000')
    mkdirSync(goneDir, { recursive: true })
    const gonePid = spawnSync(NODE, ['-e', '']).pid
    const running = (pid) => ({
      startedAt: '2026-10-05T12:00:00.000Z',
      status: 'running',
      pid,
      commands: [{ name: 'verify:release', status: 'running' }],
    })
    writeFileSync(join(goneDir, 'record.json'), JSON.stringify(running(gonePid)))

    const aborted = status()
    expect(aborted.status).toBe(2)
    expect(aborted.stdout).toContain('verdict: ABORTED')

    // A newer record whose runner is alive (this test process stands in for it) is still running.
    const aliveDir = join(runs, '20261005-120001')
    mkdirSync(aliveDir)
    writeFileSync(join(aliveDir, 'record.json'), JSON.stringify(running(process.pid)))
    const live = status()
    expect(live.status).toBe(2)
    expect(live.stdout).toContain('rehearsal 20261005-120001')
    expect(live.stdout).toContain('verdict: RUNNING')
  })
})

describe('the Linux checks are opt-in', () => {
  test('without --linux the plan holds verify:release only', () => {
    expect(commandsFor({ linux: false }).map((c) => c.name)).toEqual(['verify:release'])
    expect(commandsFor()).toEqual(CORE_COMMANDS)
    expect(commandsFor({ linux: false })).not.toContain(LINUX_COMMAND)
  })

  test('with --linux verify:linux runs first, then verify:release', () => {
    expect(commandsFor({ linux: true }).map((c) => c.name)).toEqual([
      'verify:linux',
      'verify:release',
    ])
    // The core list is not mutated by opting in.
    expect(CORE_COMMANDS).toHaveLength(1)
  })

  test('the skip line names verify:linux and how to include it', () => {
    const line = skippedLinuxLine()
    expect(line).toContain('verify:linux')
    expect(line).toContain('npm run rehearse -- --linux')
  })

  test('the launcher arguments: --linux only where a run is started', () => {
    expect(parseRehearseArgs([])).toEqual({ mode: 'launch', linux: false, dir: null })
    expect(parseRehearseArgs(['--linux'])).toEqual({ mode: 'launch', linux: true, dir: null })
    expect(parseRehearseArgs(['--status'])).toEqual({ mode: 'status', linux: false, dir: null })
    expect(parseRehearseArgs(['--run', 'd'])).toEqual({ mode: 'run', linux: false, dir: 'd' })
    expect(parseRehearseArgs(['--run', 'd', '--linux'])).toEqual({
      mode: 'run',
      linux: true,
      dir: 'd',
    })
    for (const bad of [['--status', '--linux'], ['--bogus'], ['--run'], ['--run', 'd', 'e']]) {
      expect(parseRehearseArgs(bad).mode, bad.join(' ')).toBe('usage')
    }
  })

  test('the record lists the skipped leg and --status shows how to opt in', () => {
    const skipped = initialRecord(new Date('2026-10-08T08:00:00Z'), CORE_COMMANDS, [
      LINUX_COMMAND.name,
    ])
    expect(skipped.skipped).toEqual(['verify:linux'])
    expect(skipped.commands.map((c) => c.name)).toEqual(['verify:release'])
    const { lines } = statusView('20261008-080000', skipped, true)
    expect(lines).toContain('  skipped  verify:linux (opt in with: npm run rehearse -- --linux)')

    const opted = initialRecord(new Date(), commandsFor({ linux: true }))
    expect(opted.skipped).toEqual([])
    expect(statusView('x', opted, true).lines.join('\n')).not.toContain('opt in with')
    // A record written before this field existed still renders.
    const legacy = { ...skipped }
    delete legacy.skipped
    expect(statusView('x', legacy, true).lines.join('\n')).not.toContain('skipped')
  })
})
