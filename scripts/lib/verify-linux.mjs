// Pure decisions behind `npm run verify:linux` - no spawn, no fs.

const APPIMAGE = { workflow: 'release.yml', job: 'build-linux' }

const isDispatchOnly = (doc) => {
  const on = doc?.on
  if (on === 'workflow_dispatch') return true
  if (Array.isArray(on)) return on.length === 1 && on[0] === 'workflow_dispatch'
  return on !== null && typeof on === 'object' && Object.keys(on).join() === 'workflow_dispatch'
}

const runsOnUbuntu = (def) => [def['runs-on']].flat().some((label) => /ubuntu/.test(String(label)))

/**
 * Every Linux check: each ubuntu job of a workflow that only runs on dispatch, plus release.yml's
 * `build-linux` (the AppImage build). release.yml's other jobs never run here.
 * @param {{ file: string, doc: object }[]} workflows
 * @returns {{ workflow: string, job: string }[]}
 */
export function linuxRuns(workflows) {
  const runs = []
  for (const { file, doc } of workflows) {
    if (file === APPIMAGE.workflow) {
      if (doc.jobs?.[APPIMAGE.job]) runs.push({ ...APPIMAGE })
      continue
    }
    if (!isDispatchOnly(doc)) continue
    for (const [job, def] of Object.entries(doc.jobs ?? {})) {
      if (runsOnUbuntu(def)) runs.push({ workflow: file, job })
    }
  }
  return runs
}

export const isAppImageRun = (run) => run.workflow === APPIMAGE.workflow && run.job === APPIMAGE.job

/** The text that stops verify:linux before anything runs, or `null` when act and Docker are there. */
export function preflight({ act, docker }) {
  if (act === null || act === undefined) {
    return 'verify:linux - act not found: install it (Windows: `winget install nektos.act`) or set ACT=<path>.'
  }
  if (!docker) return 'verify:linux - Docker is not running: start Docker Desktop.'
  return null
}

/**
 * Linux checks are advisory: a failed or skipped one is a warning, never a failing exit code.
 * @param {{ workflow: string, job: string, status: 'passed' | 'failed' | 'skipped', reason?: string }[]} results
 */
export function verdict(results) {
  const bad = results.filter((result) => result.status !== 'passed')
  if (bad.length === 0) return { lines: ['verify:linux: GREEN'], exitCode: 0 }
  return {
    lines: [
      'verify:linux: YELLOW',
      ...bad.map(
        ({ workflow, job, status, reason }) =>
          `warning: ${workflow} ${job}: ${reason ?? `${status}`}`,
      ),
    ],
    exitCode: 0,
  }
}
