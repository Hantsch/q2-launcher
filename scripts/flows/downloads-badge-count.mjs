// Story 032 D4 acceptance flow: the Downloads nav button's active-job badge
// (D1-D3, already implemented — this deliverable only proves it end to end
// through the real app). Mirrors `import-from-files.mjs`'s shape (real
// testids, `step()`/`shot()` reporting, thrown `Error`s for assertion
// failures so `flow.mjs` reports "flow '<name>' failed at step '<step>': …").
//
// D-fixture (story doc's own decision): jobs are seeded through the dev-only
// `dev:simulateJob` channel (`{ scenario }`, `src/shared/ipc.ts`), which
// always creates a `moduleId: 'downloads'` job (`src/main/ipc/dev.ts`) — this
// makes the story's acceptance independent of the real download pipeline
// (071) landing first. `scenario: 'stall'` is used rather than `'success'`:
// `'stall'` holds the job at ~40% forever until cancelled, while `'success'`
// runs a 200ms-tick timer to completion on its own — a real risk of the job
// finishing (and the badge count dropping) mid-flow. `dev:simulateJob`'s own
// response carries no job id (`res: Outcome<null>`), so jobs are looked up
// afterwards through `jobs:list` (`src/shared/ipc.ts`) and cancelled by id
// through `jobs:cancel`.
//
// Selectors — read TitleBar.tsx/NavJobBadge.tsx before changing these:
//   nav-downloads-badge   TitleBar.tsx, the Downloads UtilityButton's badge (NavJobBadge.tsx),
//                          only rendered while `useActiveJobCount('downloads')` is > 0

const TIMEOUT_MS = 8_000

/** Seeds one `moduleId: 'downloads'` job via the dev-only `dev:simulateJob` channel, held at
 * ~40% forever (never finishes on its own) until cancelled. */
async function simulateJob(page) {
  const outcome = await page.evaluate(() =>
    window.q2.invoke('dev:simulateJob', { scenario: 'stall' }),
  )
  if (!outcome?.ok) {
    throw new Error(`dev:simulateJob failed: ${JSON.stringify(outcome)}`)
  }
}

/** Reads the full job list and returns the ids of every `downloads`-module job still active
 * (queued/running/paused) — mirrors `countActiveJobs` (`src/shared/types/jobs.ts`). */
async function activeDownloadsJobIds(page) {
  const jobs = await page.evaluate(() => window.q2.invoke('jobs:list'))
  return jobs
    .filter((job) => job.moduleId === 'downloads')
    .filter((job) => job.status === 'queued' || job.status === 'running' || job.status === 'paused')
    .map((job) => job.id)
}

async function cancelJob(page, id) {
  const outcome = await page.evaluate((jobId) => window.q2.invoke('jobs:cancel', jobId), id)
  if (!outcome?.ok) {
    throw new Error(`jobs:cancel(${id}) failed: ${JSON.stringify(outcome)}`)
  }
}

function downloadsBadge(page) {
  return page.getByTestId('nav-downloads-badge')
}

export default async function downloadsBadgeCount({ page, shot, step }) {
  step('seed two active downloads jobs via dev:simulateJob')
  await simulateJob(page)
  await simulateJob(page)

  const jobIds = await activeDownloadsJobIds(page)
  if (jobIds.length !== 2) {
    throw new Error(`expected 2 active downloads jobs after seeding, found ${jobIds.length}`)
  }

  step('two active downloads badge the Downloads button with 2 (AC1)')
  const badge = downloadsBadge(page)
  await badge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const badgeText = (await badge.innerText()).trim()
  if (badgeText !== '2') {
    throw new Error(`expected nav-downloads-badge text to be "2", got "${badgeText}"`)
  }
  await shot('two-active-jobs-badge')

  step('cancelling every job removes the badge (AC2)')
  for (const id of jobIds) {
    await cancelJob(page, id)
  }
  await badge.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  await shot('no-active-jobs-no-badge')
}
