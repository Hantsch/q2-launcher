import yaml from 'js-yaml'

/**
 * release.yml's `build-linux` job as a standalone workflow text: the job exactly as release.yml
 * has it, except that the `plan` job outputs it reads (version, sha) are replaced by literals, and
 * its checkout's `ref` is dropped: act only copies the local tree in for a checkout without one,
 * and the snapshot already is the tree that lands on main. act's copy carries no .git, so a stand-in
 * repo whose HEAD names `sha` stands in for the one checkout leaves (no tags: `--promote-changelog`
 * lists them; no objects: the same-commit guard compares names only). Any other `needs.` reference
 * throws, because act runs the job without the plan job.
 */
export function buildLinuxWorkflowText(releaseYml, version, sha) {
  const release = yaml.load(releaseYml)
  const { needs: _plan, ...job } = release.jobs['build-linux']
  const checkout = job.steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'))
  delete job.steps[checkout].with?.ref
  job.steps.splice(checkout + 1, 0, {
    run: `git init --quiet && echo ${sha} > .git/HEAD`,
  })
  const text = yaml
    .dump({
      name: 'verify-release build-linux',
      on: { workflow_dispatch: null },
      jobs: { 'build-linux': job },
    })
    .replaceAll('${{ needs.plan.outputs.version }}', version)
    .replaceAll('${{ needs.plan.outputs.sha }}', sha)
  if (text.includes('needs.')) {
    throw new Error('build-linux uses a job output besides the version and sha')
  }
  return text
}
