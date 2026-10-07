import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, test } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOWS_DIR = join(ROOT, '.github/workflows')
const SETUP_ACTION = join(ROOT, '.github/actions/setup-node-electron/action.yml')

export function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf-8'))
}

/** Every `.github/workflows/*.yml`, parsed: `[{ file, doc }]`. */
export function loadWorkflows() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml'))
    .sort()
    .map((file) => ({ file, doc: loadYaml(join(WORKFLOWS_DIR, file)) }))
}

/** Every step of every job: `[{ file, job, step }]`. */
export function allSteps(workflows = loadWorkflows()) {
  return workflows.flatMap(({ file, doc }) =>
    Object.entries(doc.jobs ?? {}).flatMap(([job, def]) =>
      (def.steps ?? []).map((step) => ({ file, job, step })),
    ),
  )
}

const UI_FLOWS = join(WORKFLOWS_DIR, 'ui-flows.yml')

describe('ui-flows workflow', () => {
  test('ui-flows runs six shards on PRs into main and on dispatch only', () => {
    const doc = loadYaml(UI_FLOWS)
    // js-yaml (YAML 1.2 core) keeps `on` a string key.
    expect(Object.keys(doc.on).sort()).toEqual(['pull_request', 'workflow_dispatch'])
    expect(doc.on.pull_request.branches).toEqual(['main'])
    expect(doc.concurrency.group).toContain('github.ref')
    const job = doc.jobs['ui-flows']
    expect(job['runs-on']).toBe('ubuntu-latest')
    expect(job['timeout-minutes']).toBe(20)
    expect(job.strategy['fail-fast']).toBe(false)
    expect(job.strategy.matrix.shard).toEqual([1, 2, 3, 4, 5, 6])
    const runs = job.steps.map((s) => String(s.run ?? ''))
    expect(
      runs.some((r) =>
        /xvfb-run --auto-servernum npm run ui:flows -- --shard=\$\{\{ matrix\.shard \}\}\/6/.test(
          r,
        ),
      ),
    ).toBe(true)
    expect(runs).toContain('npm run fetch:7za')
    expect(runs).toContain('npm run build:dev')
    const flows = job.steps.find((s) => /ui:flows/.test(String(s.run ?? '')))
    expect(flows.env.ELECTRON_DISABLE_SANDBOX).toBe('1')
    const upload = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'))
    expect(upload.if).toBe('failure()')
    expect(upload.with.path).toContain('.ui-verify/screenshots/**')
  })

  test('windows-verify runs build, ui:verify and three flows on windows-latest and uploads screenshots', () => {
    const job = loadYaml(UI_FLOWS).jobs['windows-verify']
    expect(job['runs-on']).toBe('windows-latest')
    expect(job['timeout-minutes']).toBe(30)
    const runs = job.steps.filter((s) => s.run).map((s) => s.run)
    expect(runs).toEqual([
      'npm run fetch:7za',
      'npm run build:dev',
      'npm run ui:verify',
      'npm run ui:flow -- about-release-notes',
      'npm run ui:flow -- steam-handoff',
      'npm run ui:flow -- open-keycap-dialog',
    ])
    const upload = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'))
    expect(upload.if).toBe('always()')
    for (const p of ['.ui-verify/screenshots/**', '.ui-verify/a11y.json', '.ui-verify/a11y.md'])
      expect(upload.with.path).toContain(p)
  })
})

describe('Linux jobs are advisory on GitHub', () => {
  // Strict under act so the local verify:release / rehearse gate still reports a red Linux job.
  const ADVISORY = "${{ github.actor != 'nektos/act' }}"
  const LINUX_JOBS = [
    ['ci.yml', 'linux-journey'],
    ['ui-flows.yml', 'ui-flows'],
    ['linux-verify.yml', 'verify'],
    ['linux-update.yml', 'update'],
  ]

  test.each(LINUX_JOBS)('%s %s does not block a PR or release', (file, job) => {
    const def = loadWorkflows().find((w) => w.file === file).doc.jobs[job]
    expect(def['runs-on']).toBe('ubuntu-latest')
    expect(def['continue-on-error']).toBe(ADVISORY)
  })

  test('Windows jobs and the release pipeline stay blocking', () => {
    const { doc: ui } = loadWorkflows().find((w) => w.file === 'ui-flows.yml')
    expect(ui.jobs['windows-verify']['continue-on-error']).toBeUndefined()
    const { doc: release } = loadWorkflows().find((w) => w.file === 'release.yml')
    for (const def of Object.values(release.jobs)) expect(def['continue-on-error']).toBeUndefined()
  })
})

describe('workflow setup', () => {
  test('no workflow job runs setup-node, npm ci or electron install.js itself', () => {
    const offenders = allSteps()
      .filter(({ step }) => {
        const run = String(step.run ?? '')
        return (
          String(step.uses ?? '').startsWith('actions/setup-node') ||
          /\bnpm ci\b/.test(run) ||
          /electron\/install\.js/.test(run)
        )
      })
      .map(({ file, job }) => `${file}:${job}`)
    expect(offenders).toEqual([])
  })

  test('the Electron cache is keyed on the Electron version', () => {
    const action = loadYaml(SETUP_ACTION)
    expect(action.runs.using).toBe('composite')
    const steps = action.runs.steps
    const cache = steps.find((s) => String(s.uses ?? '').startsWith('actions/cache'))
    expect(cache).toBeDefined()
    const resolver = steps.find(
      (s) => s.id && cache.with.key.includes(`steps.${s.id}.outputs.version`),
    )
    expect(resolver, 'cache key references the version-resolving step').toBeDefined()
    expect(resolver.run).toContain("require('electron/package.json').version")
    expect(cache.with.key).toContain('runner.os')
    expect(steps.indexOf(resolver)).toBeLessThan(steps.indexOf(cache))
    for (const s of steps.filter((x) => x.run)) expect(s.shell).toBe('bash')
  })
})
