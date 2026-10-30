// What `npm run verify:release` runs, and which blocking CI step each local step stands in for.
// Pure: no spawning, no filesystem - scripts/verify-release.mjs does the I/O and hands in the parsed
// workflows, so the plan, its gates and its coverage of the real workflows are unit-testable.

/** release.yml's packaged launch smoke target, relative to the checkout it was packaged in. */
export const PACKAGED_APP = 'release/smoke/win-unpacked/Q2 Launcher.exe'

/** A `windows-verify` step that runs exactly one flow with no further arguments. */
const FLOW_RUN = /^npm run ui:flow -- ([a-z0-9-]+)$/

/** The flows `ui-flows.yml` › `windows-verify` runs, in its order. */
export function windowsVerifyFlows(uiFlowsDoc) {
  return (uiFlowsDoc.jobs?.['windows-verify']?.steps ?? []).flatMap((step) => {
    const match = FLOW_RUN.exec(String(step.run ?? '').trim())
    return match ? [match[1]] : []
  })
}

/**
 * The host steps, in order: `[{ label, gate, kind, args?, env? }]`. `kind` is what the script
 * executes: `npm` / `node` with `args`, or the two release.mjs calls it handles itself. A failing
 * `gate` skips everything after it; every other failure is reported and the run goes on.
 * `ctx.uiFlows` is the parsed `ui-flows.yml` of the tree under test, so a flow added to
 * `windows-verify` runs here without touching this file.
 */
export function hostSteps({ uiFlows, packagedApp = PACKAGED_APP }) {
  const npm = (label, args, extra = {}) => ({ label, gate: false, kind: 'npm', args, ...extra })
  return [
    npm('npm ci', ['ci'], { gate: true }),
    // format, typecheck, lint and unit tests - first, because it is the cheapest way to go red.
    npm('npm run check', ['run', 'check'], { gate: true }),
    npm('npm audit --audit-level=high', ['audit', '--audit-level=high']),
    { label: 'node scripts/release.mjs --print-plan', gate: false, kind: 'release-plan' },
    // After check: unit tests resolve `electron` to a stub; ui:verify, the flows and packaging
    // need the real binary.
    {
      label: 'node node_modules/electron/install.js',
      gate: false,
      kind: 'node',
      args: ['node_modules/electron/install.js'],
    },
    npm('npm run fetch:7za', ['run', 'fetch:7za']),
    npm('npm run build:dev', ['run', 'build:dev']),
    npm('npm run ui:verify', ['run', 'ui:verify']),
    ...windowsVerifyFlows(uiFlows).map((flow) =>
      npm(`npm run ui:flow -- ${flow}`, ['run', 'ui:flow', '--', flow]),
    ),
    npm('npm run package:dir:smoke', ['run', 'package:dir:smoke'], {
      env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    }),
    npm('npm run ui:flow -- about-release-notes --app=<packaged app>', [
      'run',
      'ui:flow',
      '--',
      'about-release-notes',
      `--app=${packagedApp}`,
    ]),
    {
      label: 'node scripts/release.mjs --dry-run --version <planned>',
      gate: false,
      kind: 'release-dry-run',
    },
  ]
}

const LINUX_REASON =
  'The Linux build is advisory on GitHub (continue-on-error) and runs locally under npm run verify:linux.'
const GUARD_REASON =
  'Compares the checked-out commit with the one the ci job saw; verify:release checks the snapshot it runs.'

/**
 * Every blocking CI `run`, mapped to the host step that stands in for it or to the reason there is
 * none. Each regex is anchored to one command shape so that a new step matches nothing; a
 * multi-line script is matched by its first line, its defining command and its last line. A `step`
 * may refer to a capture group (`$1`), resolved per run by `localStep`.
 */
export const COVERAGE = [
  { match: /^npm audit --audit-level=high$/, step: 'npm audit --audit-level=high' },
  { match: /^npm run format:check$/, step: 'npm run check' },
  { match: /^npm run typecheck$/, step: 'npm run check' },
  { match: /^npm run lint$/, step: 'npm run check' },
  { match: /^npm test$/, step: 'npm run check' },
  { match: /^npm run fetch:7za$/, step: 'npm run fetch:7za' },
  { match: /^npm run build:dev$/, step: 'npm run build:dev' },
  { match: /^npm run ui:verify$/, step: 'npm run ui:verify' },
  { match: FLOW_RUN, step: 'npm run ui:flow -- $1' },
  { match: /^npm run package:dir:smoke$/, step: 'npm run package:dir:smoke' },
  {
    match:
      /^npm run ui:flow -- about-release-notes --app="\$\{\{ steps\.smoke-app\.outputs\.path \}\}"$/,
    step: 'npm run ui:flow -- about-release-notes --app=<packaged app>',
  },
  {
    match:
      /^set -euo pipefail\n(?:.*\n)*node scripts\/release\.mjs --print-plan \$ARGS > release-plan\.json\n(?:.*\n)*echo "version=\$VERSION" >> "\$GITHUB_OUTPUT"$/,
    step: 'node scripts/release.mjs --print-plan',
  },
  {
    match: /^echo "sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"$/,
    local: false,
    reason: 'Hands the checked commit to the plan job; a local run has only the one snapshot.',
  },
  {
    match:
      /^HEAD_SHA="\$\(git rev-parse HEAD\)"\nif \[ -n "\$CI_SHA" \] && \[ "\$CI_SHA" != "\$HEAD_SHA" \]; then\n(?:.*\n)*echo "sha=\$HEAD_SHA" >> "\$GITHUB_OUTPUT"$/,
    local: false,
    reason: GUARD_REASON,
  },
  {
    match:
      /^HEAD_SHA="\$\(git rev-parse HEAD\)"\nif \[ "\$HEAD_SHA" != "\$GUARDED_SHA" \]; then\n(?:.*\n)*fi$/,
    local: false,
    reason: GUARD_REASON,
  },
  {
    match:
      /^set -euo pipefail\nAPP_PATH="release\/smoke\/win-unpacked\/Q2 Launcher\.exe"\n(?:.*\n)*echo "path=\$APP_PATH" >> "\$GITHUB_OUTPUT"$/,
    local: false,
    reason:
      'Only resolves the packaged app path for a later step; the local smoke is given it directly.',
  },
  { match: /^npm pkg set version="\$PLANNED_VERSION"$/, local: false, reason: LINUX_REASON },
  {
    match: /^node scripts\/release\.mjs --promote-changelog --version "\$PLANNED_VERSION"$/,
    local: false,
    reason: LINUX_REASON,
  },
  { match: /^npm run package:linux$/, local: false, reason: LINUX_REASON },
  {
    match:
      /^git config user\.name "github-actions\[bot\]"\ngit config user\.email "41898282\+github-actions\[bot\]@users\.noreply\.github\.com"$/,
    local: false,
    reason: 'Sets the bot identity for the release commit, which a local run never makes.',
  },
  {
    match: /^ARGS="--version \$RELEASE_VERSION"\n(?:.*\n)*node scripts\/release\.mjs \$ARGS$/,
    local: false,
    reason:
      'Commits, tags and publishes; verify:release rehearses the same code with release.mjs --dry-run.',
  },
  {
    match: /^git fetch origin dev\n(?:.*\n)*fi$/,
    local: false,
    reason: 'Pushes dev after a published release; there is nothing to push after a local run.',
  },
]

/** The entry covering `run`, or `undefined`. */
export function coveringEntry(run, coverage = COVERAGE) {
  return coverage.find((entry) => entry.match.test(run))
}

/** The host step label `entry` maps `run` to (`$1` resolved). */
export function localStep(entry, run) {
  return run.replace(entry.match, entry.step)
}

const REUSABLE_WORKFLOW = /^\.\/\.github\/workflows\/([^/]+\.ya?ml)$/

function triggers(doc) {
  const on = doc.on
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on
  return Object.keys(on ?? {})
}

/**
 * Every `run` that can fail a PR check or the release: `[{ file, job, name, run }]`. That is every
 * job of a workflow with a `pull_request` trigger and every job of release.yml, minus jobs and steps
 * whose `continue-on-error` is literally `true` (an expression may still evaluate to false). A job
 * calling a local reusable workflow contributes that workflow's jobs; a job calling one that is not
 * in `workflows` is returned as a `uses: ...` run, which no entry covers.
 */
export function blockingRuns(workflows) {
  const byFile = new Map(workflows.map(({ file, doc }) => [file, doc]))
  const jobRuns = (file, doc, callers) =>
    Object.entries(doc.jobs ?? {}).flatMap(([job, def]) => {
      if (def['continue-on-error'] === true) return []
      if (def.uses !== undefined) {
        const called = REUSABLE_WORKFLOW.exec(String(def.uses))?.[1]
        if (called && byFile.has(called) && !callers.includes(called)) {
          return jobRuns(called, byFile.get(called), [...callers, called])
        }
        return [{ file, job, name: job, run: `uses: ${def.uses}` }]
      }
      return (def.steps ?? [])
        .filter((step) => step['continue-on-error'] !== true && step.run !== undefined)
        .map((step) => ({ file, job, name: step.name ?? null, run: String(step.run).trim() }))
    })
  return workflows
    .filter(({ file, doc }) => file === 'release.yml' || triggers(doc).includes('pull_request'))
    .flatMap(({ file, doc }) => jobRuns(file, doc, [file]))
}

/** The runs no coverage entry matches. */
export function uncovered(runs, coverage = COVERAGE) {
  return runs.filter(({ run }) => coveringEntry(run, coverage) === undefined)
}

/**
 * Runs `steps` in order through `execute(step)` (`true` = passed) and returns
 * `[{ label, status, seconds? }]`. After a failed `gate` every remaining step is `skipped`; any other
 * failure is recorded and the next step still runs, so one run reports every red step.
 */
export function runPhase(name, steps, execute, { log = console.log, now = Date.now } = {}) {
  const results = []
  let gateFailed = false
  for (const step of steps) {
    const label = `${name}: ${step.label}`
    if (gateFailed) {
      results.push({ label, status: 'skipped' })
      continue
    }
    log(`\n=== verify:release - ${label} ===`)
    const startedAt = now()
    const ok = execute(step) === true
    const seconds = Math.round((now() - startedAt) / 1000)
    results.push({ label, status: ok ? 'passed' : 'FAILED', seconds })
    if (!ok && step.gate) gateFailed = true
  }
  return results
}
