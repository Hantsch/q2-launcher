// What `npm run verify:release` leaves behind and what `--status` makes of it. Pure: no
// filesystem, no spawning - scripts/verify-release.mjs reads and writes the file and asks git.

/**
 * The record of one run. `verifiedTree` is the tree of the verified subject (HEAD plus uncommitted
 * changes) BEFORE origin/main is merged in: committing exactly those changes yields a HEAD with
 * that same tree, so it reads as verified, while the merge tree would never equal any HEAD. (story 277)
 */
export function buildRecord({
  headSha,
  verifiedTree,
  includedUncommitted,
  base,
  baseSha,
  failed,
  finishedAt,
}) {
  return {
    headSha,
    verifiedTree,
    includedUncommitted,
    base,
    baseSha,
    result: failed.length === 0 ? 'green' : 'red',
    failed,
    finishedAt,
  }
}

/**
 * Whether the record still vouches for the current checkout: `{ exitCode, lines }`, 0 only for a
 * green record of HEAD's tree on an unchanged base. The commit sha is not compared - committing
 * the verified changes changes it and not the tree.
 */
export function statusVerdict(record, { headTree, headSha, baseSha, fetchFailed }) {
  const reasons = []
  if (record.result !== 'green') {
    const failed = record.failed?.length ? `: ${record.failed.join(', ')}` : ''
    reasons.push(`the last run was ${record.result}${failed}`)
  }
  if (headTree !== record.verifiedTree) {
    reasons.push(
      `HEAD ${String(headSha).slice(0, 7)} has tree ${String(headTree).slice(0, 7)}, not the verified tree ${String(record.verifiedTree).slice(0, 7)}`,
    )
  }
  if (fetchFailed) {
    reasons.push(`git fetch failed, so ${record.base} is unknown`)
  } else if (baseSha !== record.baseSha) {
    reasons.push(
      `${record.base} moved from ${String(record.baseSha).slice(0, 7)} to ${String(baseSha).slice(0, 7)}`,
    )
  }
  const lines = [
    `verified sha: ${record.headSha}${record.includedUncommitted ? ' + uncommitted changes' : ''}`,
    `base: ${record.base} ${record.baseSha}`,
    `result: ${record.result} (${record.finishedAt})`,
  ]
  if (reasons.length === 0) return { exitCode: 0, lines: [...lines, 'verified: yes'] }
  return { exitCode: 1, lines: [...lines, ...reasons.map((reason) => `NOT verified: ${reason}`)] }
}
