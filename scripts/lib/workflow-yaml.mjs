// Loading the GitHub workflow files, shared by the workflow tests and verify:release (which reads a
// workflow from its snapshot checkout, so every loader takes the repo root it reads from).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { REPO_ROOT } from './paths.mjs'

const WORKFLOWS_SUBDIR = join('.github', 'workflows')

export function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf-8'))
}

/** One `.github/workflows/<file>` under `root`, parsed. */
export function loadWorkflow(file, root = REPO_ROOT) {
  return loadYaml(join(root, WORKFLOWS_SUBDIR, file))
}

/** Every `.github/workflows/*.yml` under `root`, parsed: `[{ file, doc }]`. */
export function loadWorkflows(root = REPO_ROOT) {
  return readdirSync(join(root, WORKFLOWS_SUBDIR))
    .filter((f) => f.endsWith('.yml'))
    .sort()
    .map((file) => ({ file, doc: loadWorkflow(file, root) }))
}

/** Every step of every job: `[{ file, job, step }]`. */
export function allSteps(workflows = loadWorkflows()) {
  return workflows.flatMap(({ file, doc }) =>
    Object.entries(doc.jobs ?? {}).flatMap(([job, def]) =>
      (def.steps ?? []).map((step) => ({ file, job, step })),
    ),
  )
}
