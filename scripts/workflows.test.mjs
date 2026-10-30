import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, test } from 'vitest'
import { tierFlows } from './lib/flow-select.mjs'
import { loadFlowTree } from './lib/flow-tree.mjs'

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

/** True once at least two released `## x.y.z` headings are newer than `baseline`; `## Unreleased` never counts. */
export function packagedSmokeMustBlock(changelogText, baseline = '0.8.0') {
  const num = (v) => v.split('.').map(Number)
  const newer = (a, b) => {
    const [x, y] = [num(a), num(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
    return false
  }
  const released = [...changelogText.matchAll(/^## \[?(\d+\.\d+\.\d+)\]?/gm)].map((m) => m[1])
  return released.filter((v) => newer(v, baseline)).length >= 2
}

const LINUX = join(WORKFLOWS_DIR, 'linux.yml')

describe('linux workflow', () => {
  test('the Linux UI flows run six shards on manual dispatch only', () => {
    const doc = loadYaml(LINUX)
    // js-yaml (YAML 1.2 core) keeps `on` a string key.
    expect(Object.keys(doc.on)).toEqual(['workflow_dispatch'])
    expect(Object.keys(doc.jobs).sort()).toEqual(['flows', 'journey', 'unit'])
    const job = doc.jobs.flows
    expect(job['runs-on']).toBe('ubuntu-latest')
    expect(job.strategy['fail-fast']).toBe(false)
    expect(job.strategy.matrix.shard).toEqual([1, 2, 3, 4, 5, 6])
    const runs = job.steps.map((s) => String(s.run ?? ''))
    expect(
      runs.some(
        (r) => /\bnpm run ui:flows\b/.test(r) && r.includes('--shard=${{ matrix.shard }}/'),
      ),
    ).toBe(true)
    expect(runs).toContain('npm run fetch:7za')
    expect(runs).toContain('npm run build:dev')
    const flows = job.steps.find((s) => /ui:flows/.test(String(s.run ?? '')))
    expect(flows.env.ELECTRON_DISABLE_SANDBOX).toBe('1')
    expect(flows['timeout-minutes']).toBe(20)
    const upload = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'))
    expect(upload.if).toBe("${{ always() && contains(steps.*.outcome, 'failure') }}")
    expect(upload.with.path).toContain('.ui-verify/screenshots/**')
  })
})

const UI_FLOWS = join(WORKFLOWS_DIR, 'ui-flows.yml')

describe('ui-flows workflow', () => {
  test('ui-flows triggers on PRs into main and on dispatch only, one run per ref', () => {
    const doc = loadYaml(UI_FLOWS)
    expect(Object.keys(doc.on).sort()).toEqual(['pull_request', 'workflow_dispatch'])
    expect(doc.on.pull_request.branches).toEqual(['main'])
    expect(doc.concurrency.group).toContain('github.ref')
  })

  test('windows-verify blocks on the core-journey flows on windows-latest', () => {
    const job = loadYaml(UI_FLOWS).jobs['windows-verify']
    expect(job['runs-on']).toBe('windows-latest')
    expect(job['timeout-minutes']).toBe(30)
    expect(job['continue-on-error']).toBeUndefined()
    for (const step of job.steps) expect(step['continue-on-error']).toBeUndefined()
    const runs = job.steps.filter((s) => s.run).map((s) => s.run)
    const flows = [
      'linux-user-journey',
      'bootstrap-wizard',
      'servers-join',
      'replays-play-q2pro',
      'mods-install',
      'steam-handoff',
      'about-release-notes',
      'open-keycap-dialog',
    ]
    expect(runs).toEqual([
      'npm run fetch:7za',
      'npm run build:dev',
      'npm run ui:verify',
      ...flows.map((f) => `npm run ui:flow -- ${f}`),
    ])
    const run = runs.filter((r) => r.startsWith('npm run ui:flow -- ')).map((r) => r.slice(19))
    expect(run.length).toBeGreaterThanOrEqual(4)
    expect(run.length).toBeLessThanOrEqual(8)
    expect(run).toContain('linux-user-journey')
    const tree = loadFlowTree()
    const smoke = tierFlows(
      tree.tiers,
      'smoke',
      tree.flows.map((f) => f.name),
    )
    for (const f of run) expect(smoke, f).toContain(f)
    const upload = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'))
    expect(upload.if).toBe('always()')
    for (const p of ['.ui-verify/screenshots/**', '.ui-verify/a11y.json', '.ui-verify/a11y.md'])
      expect(upload.with.path).toContain(p)
  })
})

describe('7za fetch ordering', () => {
  test('every job that runs launch-with-scope fetches 7za first', () => {
    // `\b` after `ui:flow` does not match `ui:flows`, so the two patterns stay distinct.
    const runsScope = (run) =>
      /\bui:flows\b/.test(run) || /\bui:flow\b.*\blaunch-with-scope\b/.test(run)
    let checked = 0
    for (const { file, doc } of loadWorkflows()) {
      for (const [name, def] of Object.entries(doc.jobs ?? {})) {
        const runs = (def.steps ?? []).map((s) => String(s.run ?? ''))
        runs.forEach((run, i) => {
          if (!runsScope(run)) return
          checked++
          expect(runs.indexOf('npm run fetch:7za'), `${file} › ${name}`).toBeGreaterThanOrEqual(0)
          expect(runs.indexOf('npm run fetch:7za'), `${file} › ${name}`).toBeLessThan(i)
        })
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('Linux jobs never gate and never end red', () => {
  // Strict under act so the local rehearsal still reports a failed Linux step.
  const ADVISORY = "${{ github.actor != 'nektos/act' }}"
  // An `if:` without a status function implies `success()`, which a continue-on-error failure
  // leaves true; the `contains` is what skips the rest of the job.
  const SKIP_AFTER_FAILURE = "${{ !contains(steps.*.outcome, 'failure') }}"
  // release.yml still triggers on push, so the exception goes when it is dispatch-only (story 278)
  const PUSH_PR_EXCEPTED = ['release.yml']

  /** Every runner a job resolves to, with a `matrix.os` runs-on expanded to its values. */
  const runnersOf = (def) =>
    /matrix\.os/.test(String(def['runs-on']))
      ? (def.strategy?.matrix?.os ?? []).map(String)
      : [String(def['runs-on'])]
  const isLinux = (def) => runnersOf(def).some((r) => r.includes('ubuntu'))
  const onPushOrPr = (doc) => {
    const on = doc.on
    const events = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {})
    return events.includes('push') || events.includes('pull_request')
  }

  const linuxJobs = () =>
    loadWorkflows()
      .filter(({ doc }) => !onPushOrPr(doc))
      .flatMap(({ file, doc }) =>
        Object.entries(doc.jobs)
          .filter(([, def]) => isLinux(def))
          .map(([job, def]) => ({ file, job, def })),
      )

  test('no push or pull-request workflow runs a Linux job', () => {
    const offenders = loadWorkflows()
      .filter(({ file, doc }) => onPushOrPr(doc) && !PUSH_PR_EXCEPTED.includes(file))
      .flatMap(({ file, doc }) =>
        Object.entries(doc.jobs)
          .filter(([, def]) => !runnersOf(def).every((r) => r.includes('windows')))
          .map(([job]) => `${file}:${job}`),
      )
    expect(offenders).toEqual([])
  })

  test('a manual Linux job cannot end red', () => {
    const jobs = linuxJobs()
    expect(jobs.map(({ file, job }) => `${file}:${job}`).sort()).toEqual([
      'linux-update.yml:update',
      'linux-verify.yml:verify',
      'linux.yml:flows',
      'linux.yml:journey',
      'linux.yml:unit',
    ])
    for (const { file, job, def } of jobs) {
      const at = `${file} › ${job}`
      expect(def['continue-on-error'], at).toBeUndefined()
      expect(def['timeout-minutes'], at).toBeUndefined()
      const steps = def.steps
      const last = steps.at(-1)
      steps.forEach((step, i) => {
        const where = `${at} › step ${step.id ?? i}`
        expect(step.id, where).toMatch(/^[\w-]+$/)
        if (step === last) return
        expect(step['continue-on-error'], where).toBe(ADVISORY)
        if (i === 0) expect(step.if, where).toBeUndefined()
        // An evidence upload runs after a failure on purpose; everything else skips.
        else if (String(step.uses ?? '').startsWith('actions/upload-artifact'))
          expect(String(step.if), where).toMatch(/^(\$\{\{ )?always\(\)/)
        else expect(step.if, where).toBe(SKIP_AFTER_FAILURE)
      })
      expect(new Set(steps.map((s) => s.id)).size, at).toBe(steps.length)
      expect(last.run, at).toBe('node scripts/linux-advisory.mjs')
      expect(last.if, at).toBe('always()')
      expect(last['continue-on-error'], at).toBe(true)
      expect(last.env.STEPS, at).toBe('${{ toJSON(steps) }}')
      expect(last.env.CHECK.startsWith(`${file}/${job}`), at).toBe(true)
    }
  })

  test('the ci test job runs audit, format check, typecheck, lint and tests on windows-latest', () => {
    const job = loadYaml(join(WORKFLOWS_DIR, 'ci.yml')).jobs.test
    expect(job['runs-on']).toBe('windows-latest')
    expect(job.strategy).toBeUndefined()
    const steps = job.steps.filter((s) => s.run)
    for (const s of steps) {
      expect(s.if, s.name).toBeUndefined()
      expect(s['continue-on-error'], s.name).toBeUndefined()
    }
    expect(steps.map((s) => s.run)).toEqual([
      'npm audit --audit-level=high',
      'npm run format:check',
      'npm run typecheck',
      'npm run lint',
      'npm test',
    ])
  })

  test('Windows jobs and the release pipeline stay blocking', () => {
    const { doc: ui } = loadWorkflows().find((w) => w.file === 'ui-flows.yml')
    expect(ui.jobs['windows-verify']['continue-on-error']).toBeUndefined()
    const { doc: release } = loadWorkflows().find((w) => w.file === 'release.yml')
    for (const def of Object.values(release.jobs)) expect(def['continue-on-error']).toBeUndefined()
    // Only the Linux artifact download and the packaged smoke may fail without failing the job.
    const exempt = ['Download the Linux artifacts', 'Packaged launch smoke']
    for (const name of ['plan', 'release'])
      for (const step of release.jobs[name].steps)
        if (!exempt.includes(step.name))
          expect(step['continue-on-error'], step.name).toBeUndefined()
  })
})

describe('perf lane', () => {
  test('the perf lane runs only on manual dispatch and no push or pull-request workflow runs it', () => {
    const workflows = loadWorkflows()
    const perf = workflows.find((w) => w.file === 'perf.yml').doc
    expect(Object.keys(perf.on)).toEqual(['workflow_dispatch'])
    const runs = Object.values(perf.jobs).flatMap((j) => j.steps.map((s) => String(s.run ?? '')))
    expect(runs).toContain('npm run test:perf')

    const offenders = workflows
      .filter(({ doc }) => 'push' in doc.on || 'pull_request' in doc.on)
      .flatMap(({ file }) =>
        allSteps(workflows.filter((w) => w.file === file))
          .filter(({ step }) => /test:perf|vitest\.perf\.config/.test(String(step.run ?? '')))
          .map(({ job }) => `${file}:${job}`),
      )
    expect(offenders).toEqual([])
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

describe('release workflow', () => {
  const release = () => loadYaml(join(WORKFLOWS_DIR, 'release.yml'))

  test('the release plan requires a green ci run before any build job', () => {
    const { jobs } = release()
    const steps = jobs.plan.steps
    const guard = steps.findIndex((s) => s.id === 'ci-guard')
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(steps[guard].run).toContain('scripts/release-ci-guard.mjs')
    expect(guard).toBeLessThan(steps.findIndex((s) => s.id === 'plan'))
    for (const job of ['build-linux', 'release']) expect([jobs[job].needs].flat()).toContain('plan')
  })

  test('later release jobs refuse a commit the guard did not see', () => {
    const doc = release()
    for (const job of ['build-linux', 'release']) {
      const steps = doc.jobs[job].steps
      const after =
        steps[steps.findIndex((s) => String(s.uses ?? '').startsWith('actions/checkout')) + 1]
      expect(JSON.stringify(after), job).toContain('needs.plan.outputs.sha')
    }
    expect(doc.permissions.actions).toBe('read')
  })

  test('build-linux cannot end red and the release runs after it fails', () => {
    const { jobs } = release()
    const def = jobs['build-linux']
    expect(def['continue-on-error']).toBeUndefined()
    expect(def['timeout-minutes']).toBeUndefined()
    const last = def.steps.at(-1)
    def.steps.forEach((step, i) => {
      expect(step.id, `step ${i}`).toMatch(/^[\w-]+$/)
      if (step === last) return
      expect(step['continue-on-error'], step.id).toBe("${{ github.actor != 'nektos/act' }}")
      if (i === 0) expect(step.if, step.id).toBeUndefined()
      else expect(step.if, step.id).toBe("${{ !contains(steps.*.outcome, 'failure') }}")
    })
    expect(last.run).toBe('node scripts/linux-advisory.mjs')
    expect(last.if).toBe('always()')
    expect(last['continue-on-error']).toBe(true)
    expect(last.env.STEPS).toBe('${{ toJSON(steps) }}')
    expect(last.env.CHECK).toBe('release.yml/build-linux')
    const upload = def.steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'))
    expect(upload.with['if-no-files-found']).toBe('warn')

    expect(jobs.release.if).toContain('!cancelled()')
    expect(jobs.release.if).toContain('needs.plan.result')
    expect([jobs.release.needs].flat()).toContain('build-linux')
    const download = jobs.release.steps.find((s) =>
      String(s.uses ?? '').startsWith('actions/download-artifact'),
    )
    expect(download['continue-on-error']).toBe(true)
  })

  test('the release job still runs unit tests and typecheck on windows', () => {
    const runs = release().jobs.release.steps.map((s) => String(s.run ?? ''))
    expect(runs).toContain('npm test')
    expect(runs).toContain('npm run typecheck')
  })
})

describe('release packaged launch smoke', () => {
  const steps = () => loadYaml(join(WORKFLOWS_DIR, 'release.yml')).jobs.release.steps
  const smokeStep = () =>
    steps().find((s) => /\bui:flow\b/.test(String(s.run ?? '')) && /--app=/.test(s.run))

  test('the release job launches the unpacked app before it publishes', () => {
    const all = steps()
    const smoke = all.findIndex(
      (s) => /\bui:flow\b/.test(String(s.run ?? '')) && /--app=/.test(s.run),
    )
    const publish = all.findIndex((s) => String(s.run ?? '').includes('scripts/release.mjs'))
    expect(smoke).toBeGreaterThanOrEqual(0)
    expect(smoke).toBeLessThan(publish)
    const runs = all.slice(0, smoke).map((s) => String(s.run ?? ''))
    expect(runs.some((r) => /\bpackage:dir\b/.test(r))).toBe(true)
    expect(runs.some((r) => /\bpackage:win\b/.test(r))).toBe(false)
  })

  test('the packaged smoke turns blocking after two releases past 0.8.0', () => {
    const h = (...v) => ['## Unreleased', ...v.map((x) => `## ${x} - 2026-11-01`)].join('\n\n')
    expect(packagedSmokeMustBlock(h())).toBe(false)
    expect(packagedSmokeMustBlock(h('0.8.0'))).toBe(false)
    expect(packagedSmokeMustBlock(h('0.8.1', '0.8.0'))).toBe(false)
    expect(packagedSmokeMustBlock(h('0.10.0', '0.8.1', '0.8.0'))).toBe(true)
    expect(packagedSmokeMustBlock('## [0.9.0]\n## [0.8.1]')).toBe(true)
  })

  test("the packaged smoke step's continue-on-error matches the released count", () => {
    const must = packagedSmokeMustBlock(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf-8'))
    const flag = smokeStep()['continue-on-error']
    if (must) expect(flag).toBeUndefined()
    else expect(flag).toBe(true)
  })
})
