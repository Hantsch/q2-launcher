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
import { marginOk, parseShards } from './lib/rehearsal.mjs'

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
const shardLine = (i, text) => `[ui-flows/UI flows (ubuntu-latest, xvfb, shard ${i}/4)] ${text}`
const print = (...lines) => lines.map((line) => `console.log(${JSON.stringify(line)});`).join('')
const writeMarker = (file) => `require('fs').writeFileSync(${JSON.stringify(file)}, 'ran')`

/** Starts the launcher through a shell, as `npm run rehearse` does, and waits for it to exit. */
function launch(plan) {
  writeFileSync(planFile, JSON.stringify(plan))
  const startedAt = Date.now()
  const result = spawnSync(`"${NODE}" "${SCRIPT}"`, {
    cwd: ROOT,
    env: env(),
    shell: true,
    encoding: 'utf-8',
  })
  return { ...result, ms: Date.now() - startedAt }
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

const PREFLIGHT_OK = { act: 'act', docker: true }

describe('release rehearsal', () => {
  test('the launcher returns at once and the detached run completes the record', async () => {
    const sleep3 = 'setTimeout(() => {}, 3000)'
    const launched = launch({
      preflight: PREFLIGHT_OK,
      commands: [
        stand('verify:release', sleep3),
        stand('ci:local', sleep3),
        stand(
          'ci:local:flows',
          `${print(shardLine(1, 'Start image=node'))}` +
            `setTimeout(() => {${print(shardLine(1, 'Job succeeded'))}}, 3000)`,
          { shards: true },
        ),
      ],
    })
    expect(launched.status, launched.stderr).toBe(0)
    // Three commands of 3 s each: back in under 3 s means it waited for none of them.
    expect(launched.ms).toBeLessThan(3000)
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
      ['verify:release', 'passed', 0],
      ['ci:local', 'passed', 0],
      ['ci:local:flows', 'passed', 0],
    ])
    for (const command of record.commands) expect(command.seconds).toBeGreaterThanOrEqual(2)
    expect(record.commands[2].shards).toEqual([
      { shard: '1/4', seconds: expect.any(Number), status: 'passed' },
    ])
    expect(record.commands[2].shards[0].seconds).toBeGreaterThanOrEqual(2)
    expect(record.marginOk).toBe(true)
    expect(existsSync(join(dir, 'ci-local-flows.log'))).toBe(true)

    const report = status()
    expect(report.status).toBe(0)
    expect(report.stdout).toContain('verdict: PASSED')
    expect(report.stdout).toMatch(/passed\s+ci:local:flows \(\d+s\)/)
  }, 60_000)

  test('a failing command is recorded failed and the next one still runs', async () => {
    const marker = join(tmp, 'second-ran')
    const launched = launch({
      preflight: PREFLIGHT_OK,
      commands: [
        stand('verify:release', 'console.error("boom"); process.exit(3)'),
        stand('ci:local', writeMarker(marker)),
      ],
    })
    expect(launched.status, launched.stderr).toBe(0)
    const dir = onlyRunDir()
    const record = await waitForVerdict(dir)

    expect(record.status).toBe('failed')
    expect(record.commands[0]).toMatchObject({
      name: 'verify:release',
      status: 'failed',
      exitCode: 3,
    })
    expect(record.commands[1]).toMatchObject({ name: 'ci:local', status: 'passed', exitCode: 0 })
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(join(dir, 'verify-release.log'), 'utf-8')).toMatch(/Z boom\r?\n/)

    const report = status()
    expect(report.status).toBe(1)
    expect(report.stdout).toContain('verdict: FAILED')
  }, 60_000)

  test('missing Docker fails the record with its reason before any command runs', async () => {
    const marker = join(tmp, 'command-ran')
    const launched = launch({
      preflight: { act: 'act', docker: false },
      commands: [
        stand('verify:release', writeMarker(marker)),
        stand('ci:local', writeMarker(marker)),
      ],
    })
    expect(launched.status, launched.stderr).toBe(0)
    const dir = onlyRunDir()
    const record = await waitForVerdict(dir)

    expect(record.status).toBe('failed')
    expect(record.reason).toMatch(/Docker is not running/)
    expect(record.commands.map((c) => c.status)).toEqual(['skipped', 'skipped'])
    expect(existsSync(marker)).toBe(false)
    expect(readdirSync(dir).filter((name) => name.endsWith('.log'))).toEqual([])
  }, 60_000)

  test("per-shard wall time is parsed from act's job-prefixed output", () => {
    const log = [
      '2026-10-05T10:00:00.000Z > q2-launcher@0.6.0 ci:local:flows',
      `2026-10-05T10:00:01.000Z ${shardLine(1, '🚀  Start image=catthehacker/ubuntu:act-latest')}`,
      `2026-10-05T10:04:00.000Z ${shardLine(1, '  | 12 flows passed')}`,
      `2026-10-05T10:09:31.400Z ${shardLine(1, '🏁  Job succeeded')}`,
      `2026-10-05T10:09:32.000Z ${shardLine(2, '🚀  Start image=catthehacker/ubuntu:act-latest')}`,
      `2026-10-05T10:20:02.000Z ${shardLine(2, '🏁  Job failed')}`,
      // act's own duration on the end line beats the 11 min between the shard's first and last line
      `2026-10-05T10:20:03.000Z ${shardLine(3, '🚀  Start')}`,
      `2026-10-05T10:31:03.000Z ${shardLine(3, '🏁  Job succeeded [7m30.2s]')}`,
      // a shard that never reached its end line did not finish
      `2026-10-05T10:31:04.000Z ${shardLine(4, '🚀  Start')}`,
      `2026-10-05T10:33:04.000Z ${shardLine(4, '  | still running')}`,
      // a line without the runner's arrival time cannot move a shard's first or last line
      shardLine(1, 'printed without a timestamp'),
      'Error: Job "UI flows" failed',
    ].join('\r\n')

    expect(parseShards(log)).toEqual([
      { shard: '1/4', seconds: 570, status: 'passed' },
      { shard: '2/4', seconds: 630, status: 'failed' },
      { shard: '3/4', seconds: 450, status: 'passed' },
      { shard: '4/4', seconds: 120, status: 'failed' },
    ])
  })

  test('a shard over the 15-minute margin fails the record', async () => {
    expect(marginOk([{ shard: '1/4', seconds: 900, status: 'passed' }])).toBe(true)
    expect(marginOk([])).toBe(false)

    const launched = launch({
      preflight: PREFLIGHT_OK,
      commands: [
        stand('verify:release', ''),
        stand(
          'ci:local:flows',
          print(shardLine(1, 'Job succeeded [9m0s]'), shardLine(2, 'Job succeeded [15m1s]')),
          { shards: true },
        ),
      ],
    })
    expect(launched.status, launched.stderr).toBe(0)
    const record = await waitForVerdict(onlyRunDir())

    expect(record.commands.map((c) => c.status)).toEqual(['passed', 'passed'])
    expect(record.commands[1].shards).toEqual([
      { shard: '1/4', seconds: 540, status: 'passed' },
      { shard: '2/4', seconds: 901, status: 'passed' },
    ])
    expect(record.marginOk).toBe(false)
    expect(record.status).toBe('failed')

    const report = status()
    expect(report.status).toBe(1)
    expect(report.stdout).toMatch(/shard 2\/4: passed \(901s\) - over the 900s margin/)
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
