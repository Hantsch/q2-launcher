// Pure decision step of the release ci guard; the CLI shell fetches the runs. (story 266)
import { isReleaseCommitMessage } from './plan.mjs'

/**
 * @param {{ headSha: string, headMessage: string, parentSha: string }} input
 * @returns {string} the SHA whose ci run is judged: a release commit carries `[skip ci]`, so its
 *   parent is the commit that was actually tested.
 */
export function resolveGuardTarget({ headSha, headMessage, parentSha }) {
  return isReleaseCommitMessage(headMessage) ? parentSha : headSha
}

/**
 * @param {{ dryRun: boolean, override: boolean, targetSha: string,
 *   runs: Array<{ head_sha: string, status: string, conclusion: string | null }> }} input
 * @returns {{ pass: boolean, pending?: boolean, reason: string }} `pending` means the run is still
 *   going: the caller polls again instead of refusing.
 */
export function decideCiGuard({ dryRun, override, targetSha, runs }) {
  if (dryRun) return { pass: true, reason: 'dry run, guard not applied' }
  if (override) return { pass: true, reason: `ci guard skipped by override for ${targetSha}` }
  const matching = runs.filter((run) => run.head_sha === targetSha)
  if (matching.some((run) => run.status === 'completed' && run.conclusion === 'success')) {
    return { pass: true, reason: `ci run for ${targetSha} succeeded` }
  }
  if (matching.some((run) => run.status !== 'completed')) {
    return {
      pass: false,
      pending: true,
      reason: `ci run for ${targetSha} is not finished yet`,
    }
  }
  return { pass: false, reason: `no successful ci run for ${targetSha}` }
}
