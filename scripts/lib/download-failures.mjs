// Story 075 D7: the two static `downloadFailures` entries the UI-verification fixture seeds
// (mirrors `src/shared/modules/downloads.ts`'s `DownloadFailure`/`DownloadDiagnostics`), so
// `scripts/flows/downloads-tab.mjs` can prove AC3-AC6 and AC8 offline without a live
// `dev:simulateJob` round trip.
//
// Split out of `fixture.mjs` for one reason: `fixture.mjs` transitively imports `harness.mjs`
// (and with it playwright), which a unit test cannot reasonably pull in. This module imports
// nothing but the redaction mirror, so `src/main/modules/downloads/diagnostics.test.ts` can
// assert the seeded entry is byte-for-byte what the real `redactHome` produces from the raw
// inputs below - AC4's guarantee is then proven by the code under test, not by a hand-typed
// `<home>` placeholder.
//
// Everything here is deterministic: fixed ids, fixed ISO timestamps, a fixed fake home directory.
import { redactHome } from './redact-home.mjs'

/** Exported so the flow asserts against the exact same literal ids rather than a copy. */
export const DOWNLOAD_FAILURE_WITH_DIAGNOSTICS_ID = 'fixture-failure-diagnostics'
export const DOWNLOAD_FAILURE_WITHOUT_DIAGNOSTICS_ID = 'fixture-failure-plain'

/**
 * The realistic, *un-redacted* home directory the seeded diagnostics are built from - the shape
 * `os.homedir()` returns on the machines this launcher targets, complete with an account name.
 * Fixed rather than taken from the running machine so `npm run ui:seed` stays byte-idempotent.
 */
export const FIXTURE_HOME_DIR = 'C:\\Users\\q2fixtureaccount'

/** The account-name segment of `FIXTURE_HOME_DIR`. Nothing the launcher renders, copies or
 * persists may contain this string - that is exactly what AC4 promises about a real one. */
export const FIXTURE_ACCOUNT_NAME = 'q2fixtureaccount'

/** The raw install path the failed bootstrap run targeted, before redaction. */
export const FIXTURE_RAW_TARGET_PATH = `${FIXTURE_HOME_DIR}\\AppData\\Roaming\\Q2 Launcher\\installs\\Q2PRO Demo`

/** The raw log lines the job wrote, before redaction - two of them carry the home directory the
 * same way the real `BootstrapLog` lines that motivated this story did. */
const FIXTURE_RAW_LOG_TAIL = [
  '[12:00:00] bootstrap: fetching q2pro-engine from https://example.invalid/q2pro/q2pro-engine-1.0.zip',
  '[12:00:12] bootstrap: verified q2pro-engine (sha256 match)',
  `[12:00:13] bootstrap: extracted q2pro-engine into ${FIXTURE_RAW_TARGET_PATH}`,
  '[12:00:14] bootstrap: fetching demo-gamedata - primary source failed, retrying mirror',
  '[12:00:40] bootstrap: verified demo-gamedata (sha256 match)',
  '[12:00:41] bootstrap: extraction produced no usable game data for demo-gamedata',
  '[12:00:42] bootstrap: fetching point-release from https://example.invalid/gamedata/point-release.zip',
  '[12:01:05] bootstrap: verified point-release (sha256 match)',
  '[12:01:06] bootstrap: extracted point-release',
  `[12:01:07] bootstrap: inspecting ${FIXTURE_RAW_TARGET_PATH}: status invalid, missing base-paks`,
]

/**
 * The entry that carries a full `DownloadDiagnostics` record: three packages (mirrors a Q2PRO
 * bootstrap - engine, demo data, point release), the demo package extracting nothing (the exact
 * 2026-09-08 real-world failure the story's Requirement describes), and a target plus log tail
 * whose home-directory paths are run through redaction here, at seed time - the same place
 * production redacts them (at capture, in main), never hand-written as `<home>`.
 */
export function downloadFailureWithDiagnostics() {
  const targetPath = redactHome(FIXTURE_RAW_TARGET_PATH, FIXTURE_HOME_DIR)
  return {
    id: DOWNLOAD_FAILURE_WITH_DIAGNOSTICS_ID,
    jobId: 'fixture-bootstrap-job-diagnostics',
    // Mirrors src/main/modules/downloads/bootstrap/job.ts's `BOOTSTRAP_JOB_LABEL_KEY`.
    labelKey: 'downloads.job.bootstrap',
    labelParams: { name: 'Q2PRO Demo' },
    error: { key: 'downloads.error.installationNotPlayable' },
    createdAt: Date.parse('2026-09-08T12:01:07.000Z'),
    diagnostics: {
      jobId: 'fixture-bootstrap-job-diagnostics',
      kind: 'bootstrap',
      startedAt: '2026-09-08T11:58:00.000Z',
      finishedAt: '2026-09-08T12:01:07.000Z',
      errorKey: 'downloads.error.installationNotPlayable',
      packages: [
        {
          id: 'q2pro-engine',
          url: 'https://example.invalid/q2pro/q2pro-engine-1.0.zip',
          sizeBytes: 5_242_880,
          verified: true,
          extracted: true,
        },
        {
          id: 'demo-gamedata',
          // Served from a mirror, not the primary url - proves the diagnostics name the URL a
          // package was *actually* fetched from (AC1).
          url: 'https://mirror.example.invalid/gamedata/demo-mirror.zip',
          sizeBytes: 62_914_560,
          verified: true,
          extracted: false,
        },
        {
          id: 'point-release',
          url: 'https://example.invalid/gamedata/point-release.zip',
          sizeBytes: 15_728_640,
          verified: true,
          extracted: true,
        },
      ],
      target: {
        targetPath,
        verdict: 'invalid',
        missingChecks: [{ id: 'base-paks', messageKey: 'validation.pak0Missing' }],
      },
      logTail: FIXTURE_RAW_LOG_TAIL.map((line) => redactHome(line, FIXTURE_HOME_DIR)),
    },
  }
}

/**
 * AC6's compatibility path: an entry written before story 075 - no `diagnostics` field at all,
 * not an empty one. Must still render, and offer no copy action (and no disabled stub).
 */
export function downloadFailureWithoutDiagnostics() {
  return {
    id: DOWNLOAD_FAILURE_WITHOUT_DIAGNOSTICS_ID,
    jobId: 'fixture-download-job-plain',
    // Mirrors src/main/modules/downloads.ts's non-bootstrap job label key.
    labelKey: 'downloads.job.download',
    labelParams: { name: 'Q2PRO Engine' },
    error: { key: 'downloads.error.network' },
    createdAt: Date.parse('2026-09-01T09:00:00.000Z'),
  }
}

export function populatedDownloadFailures() {
  return [downloadFailureWithDiagnostics(), downloadFailureWithoutDiagnostics()]
}
