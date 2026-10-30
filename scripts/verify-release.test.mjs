import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  blockingRuns,
  COVERAGE,
  coveringEntry,
  hostSteps,
  localStep,
  runPhase,
  uncovered,
} from './lib/verify-release-plan.mjs'
import { statusVerdict } from './lib/verify-release-record.mjs'
import { loadWorkflow, loadWorkflows } from './lib/workflow-yaml.mjs'

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'verify-release.mjs'),
  'utf-8',
)

describe('verify:release', () => {
  test('verify:release starts no act run and needs no Docker', () => {
    expect(SOURCE).not.toMatch(/\.\/lib\/act\.mjs/)
    expect(SOURCE).not.toMatch(/\.\/lib\/build-linux-workflow\.mjs/)
    expect(SOURCE).not.toMatch(/\.github\/workflows\//)
  })
})

describe('npm run check', () => {
  test('npm run check runs format, typecheck, lint and tests in that order and stops at the first failure', () => {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
    )
    const check = pkg.scripts.check
    expect(check.split('&&').map((s) => s.trim())).toEqual([
      'npm run format:check',
      'npm run typecheck',
      'npm run lint',
      'npm test',
    ])
    expect(check).not.toContain(';')
    expect(check).not.toContain('||')
  })
})

const realHostSteps = () => hostSteps({ uiFlows: loadWorkflow('ui-flows.yml') })

describe('verify:release covers the blocking CI steps', () => {
  test('every blocking step of the PR workflows and the release job has a local step or a stated reason', () => {
    const runs = blockingRuns(loadWorkflows())
    expect(runs.length).toBeGreaterThan(0)
    expect(uncovered(runs)).toEqual([])

    const labels = realHostSteps().map((step) => step.label)
    for (const entry of COVERAGE) {
      if (entry.local === false) expect(entry.reason).toMatch(/\S/)
      else if (!entry.step.includes('$')) expect(labels).toContain(entry.step)
    }
    for (const { run } of runs) {
      const entry = coveringEntry(run)
      if (entry.local !== false) expect(labels).toContain(localStep(entry, run))
    }
  })

  test('a blocking step added to a PR workflow and missing from verify:release is reported', () => {
    const workflows = [
      {
        file: 'ci.yml',
        doc: {
          on: { pull_request: { branches: ['main'] } },
          jobs: { test: { steps: [{ run: 'npm test' }, { run: 'npm run brand-new-gate' }] } },
        },
      },
    ]
    expect(uncovered(blockingRuns(workflows)).map(({ run }) => run)).toEqual([
      'npm run brand-new-gate',
    ])
  })

  test('a workflow a PR job calls is blocking, advisory steps and dispatch-only workflows are not', () => {
    const workflows = [
      {
        file: 'pr.yml',
        doc: {
          on: ['pull_request'],
          jobs: {
            called: { uses: './.github/workflows/gate.yml' },
            advisory: { 'continue-on-error': true, steps: [{ run: 'npm run advisory-job' }] },
            test: { steps: [{ run: 'npm run advisory-step', 'continue-on-error': true }] },
          },
        },
      },
      {
        file: 'gate.yml',
        doc: {
          on: { workflow_call: {} },
          jobs: { g: { steps: [{ run: 'npm run called-gate' }] } },
        },
      },
      {
        file: 'manual.yml',
        doc: { on: { workflow_dispatch: {} }, jobs: { m: { steps: [{ run: 'npm run manual' }] } } },
      },
    ]
    expect(uncovered(blockingRuns(workflows)).map(({ run }) => run)).toEqual([
      'npm run called-gate',
    ])
  })

  test('verify:release runs every flow windows-verify runs', () => {
    const flows = loadWorkflow('ui-flows.yml')
      .jobs['windows-verify'].steps.map((step) => /^npm run ui:flow -- (\S+)$/.exec(step.run ?? ''))
      .filter(Boolean)
      .map((match) => match[1])
    expect(flows.length).toBeGreaterThan(0)
    const labels = realHostSteps().map((step) => step.label)
    for (const flow of flows) expect(labels).toContain(`npm run ui:flow -- ${flow}`)
  })
})

describe('verify:release step order', () => {
  test('check runs right after npm ci and before ui:verify and any packaging, and gates the rest', () => {
    const steps = realHostSteps()
    const labels = steps.map((step) => step.label)
    const check = labels.indexOf('npm run check')
    expect(labels.slice(0, check)).toEqual(['npm ci'])
    expect(check).toBeLessThan(labels.indexOf('npm run ui:verify'))
    for (const later of ['npm run package:dir:smoke', labels.at(-1)]) {
      expect(check).toBeLessThan(labels.indexOf(later))
    }
    expect(steps.filter((step) => step.gate).map((step) => step.label)).toEqual([
      'npm ci',
      'npm run check',
    ])
  })

  test('a failing check runs no later step', () => {
    const steps = realHostSteps()
    const invoked = []
    const results = runPhase(
      'host',
      steps,
      (step) => {
        invoked.push(step.label)
        return step.label !== 'npm run check'
      },
      { log: () => {} },
    )
    expect(invoked).toEqual(['npm ci', 'npm run check'])
    expect(results.map((result) => result.status)).toEqual([
      'passed',
      'FAILED',
      ...steps.slice(2).map(() => 'skipped'),
    ])
  })

  test('a failing step after the gates is reported and the run goes on', () => {
    const steps = realHostSteps()
    const results = runPhase('host', steps, (step) => step.label !== 'npm run ui:verify', {
      log: () => {},
    })
    expect(results.filter((result) => result.status === 'FAILED').map((r) => r.label)).toEqual([
      'host: npm run ui:verify',
    ])
    expect(results.filter((result) => result.status === 'skipped')).toEqual([])
  })
})

describe('verify:release --status', () => {
  const record = {
    headSha: 'a'.repeat(40),
    verifiedTree: 't'.repeat(40),
    includedUncommitted: false,
    base: 'origin/main',
    baseSha: 'b'.repeat(40),
    result: 'green',
    failed: [],
    finishedAt: '2026-01-01T00:00:00.000Z',
  }
  const current = {
    headTree: record.verifiedTree,
    headSha: record.headSha,
    baseSha: record.baseSha,
  }

  test('the status is verified only for a green record of the current tree on an unchanged origin/main', () => {
    const cases = []
    for (const result of ['green', 'red'])
      for (const treeEqual of [true, false])
        for (const baseEqual of [true, false])
          for (const fetchFailed of [false, true])
            cases.push({ result, treeEqual, baseEqual, fetchFailed })
    expect(cases).toHaveLength(16)
    for (const { result, treeEqual, baseEqual, fetchFailed } of cases) {
      const verdict = statusVerdict(
        { ...record, result, failed: result === 'red' ? ['host: npm run ui:verify'] : [] },
        {
          ...current,
          headTree: treeEqual ? record.verifiedTree : 'c'.repeat(40),
          baseSha: baseEqual ? record.baseSha : 'd'.repeat(40),
          fetchFailed,
        },
      )
      const verified = result === 'green' && treeEqual && baseEqual && !fetchFailed
      expect(verdict.exitCode, JSON.stringify({ result, treeEqual, baseEqual, fetchFailed })).toBe(
        verified ? 0 : 1,
      )
    }
    const all = statusVerdict(
      { ...record, result: 'red', failed: ['x'] },
      { headTree: 'c'.repeat(40), headSha: 'e'.repeat(40), baseSha: 'd'.repeat(40) },
    )
    const reasons = all.lines.filter((line) => line.startsWith('NOT verified'))
    expect(reasons).toHaveLength(3)
    expect(reasons.join(' ')).toMatch(/red/)
    expect(reasons.join(' ')).toMatch(/moved from bbbbbbb to ddddddd/)
    const failedFetch = statusVerdict(record, { ...current, baseSha: null, fetchFailed: true })
    expect(failedFetch.lines.join(' ')).toMatch(/fetch failed/)
  })

  test('a run that verified uncommitted changes counts as verified once exactly those are committed', () => {
    const verdict = statusVerdict(
      { ...record, includedUncommitted: true },
      { ...current, headSha: 'f'.repeat(40) },
    )
    expect(verdict.exitCode).toBe(0)
  })

  test('--status without a record says so and exits 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-release-status-'))
    try {
      const result = spawnSync(
        process.execPath,
        [join(dirname(fileURLToPath(import.meta.url)), 'verify-release.mjs'), '--status'],
        {
          encoding: 'utf-8',
          env: { ...process.env, VERIFY_RELEASE_RECORD: join(dir, 'missing', 'last-run.json') },
        },
      )
      expect(result.status).toBe(2)
      expect(result.stdout + result.stderr).toContain('no verify:release record')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('--status with an unparseable record says so and exits 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-release-status-'))
    try {
      const file = join(dir, 'last-run.json')
      writeFileSync(file, 'not json')
      const result = spawnSync(
        process.execPath,
        [join(dirname(fileURLToPath(import.meta.url)), 'verify-release.mjs'), '--status'],
        { encoding: 'utf-8', env: { ...process.env, VERIFY_RELEASE_RECORD: file } },
      )
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('unreadable verify:release record')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('verify:release picks the runs that can block', () => {
  const doc = (on, jobs) => ({ on, jobs })
  const job = (extra = {}) => ({ steps: [{ name: 's', run: 'echo hi' }], ...extra })

  test('runs of release.yml and of a pull_request workflow count, those of dispatch/push-only workflows do not', () => {
    const runs = blockingRuns([
      { file: 'release.yml', doc: doc({ workflow_dispatch: null }, { a: job() }) },
      { file: 'pr.yml', doc: doc({ pull_request: null }, { b: job() }) },
      { file: 'other.yml', doc: doc({ workflow_dispatch: null, push: null }, { c: job() }) },
    ])
    expect(runs.map((r) => r.job).sort()).toEqual(['a', 'b'])
  })

  test('a job with continue-on-error true is dropped, an expression stays blocking', () => {
    const runs = blockingRuns([
      {
        file: 'pr.yml',
        doc: doc(
          { pull_request: null },
          {
            advisory: job({ 'continue-on-error': true }),
            dynamic: job({ 'continue-on-error': '${{ matrix.x }}' }),
          },
        ),
      },
    ])
    expect(runs.map((r) => r.job)).toEqual(['dynamic'])
  })

  test('a job calling a reusable workflow that is not there is an uncovered run', () => {
    const runs = blockingRuns([
      {
        file: 'pr.yml',
        doc: doc({ pull_request: null }, { call: { uses: './.github/workflows/missing.yml' } }),
      },
    ])
    expect(uncovered(runs)).toEqual([
      expect.objectContaining({ job: 'call', run: 'uses: ./.github/workflows/missing.yml' }),
    ])
  })

  test('every COVERAGE regex is anchored to one command shape', () => {
    for (const { match } of COVERAGE) {
      expect(match.source.startsWith('^')).toBe(true)
      expect(match.source.endsWith('$')).toBe(true)
    }
    expect(COVERAGE.filter((entry) => entry.match.test('npm run brand-new-gate'))).toEqual([])
  })
})
