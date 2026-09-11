import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_GAME_DIR, RETAIL_PAK_SIZES } from '@shared/constants'
import type { DetectedRetailSource, StartRetailUpgradeInput } from '@shared/modules/downloads'
import {
  fail,
  ok,
  type Installation,
  type InstallationStatus,
  type Job,
  type JobProgress,
  type LaunchState,
  type Outcome,
} from '@shared/types'
import { canonicalizePath, findChild, resolveRelaxed } from '../../../lib/fs-utils'
import type { CreateJobInput } from '../../../services/jobs'
import type { AssembleInstallationResult } from '../bootstrap/assemble'
import {
  INSTALLATION_NOT_FOUND,
  INSTALLATION_RUNNING,
  LOCAL_FAILURE,
  NOT_PLAYABLE,
  RETAIL_COPY_INCOMPLETE,
  RETAIL_SOURCE_UNVERIFIED,
} from '../bootstrap/errors'
import { isPathContainedBy } from '../bootstrap/game-data-source'
import type { BootstrapLog } from '../bootstrap/ports'
import { copyRetailGameData, findDetectedRetailSource } from '../bootstrap/retail-source'

/**
 * Story 090 D2: the retail-upgrade job - "take this already-registered demo installation and
 * replace its game data with `pak0.pak`/`pak1.pak` copied out of a store installation the launcher
 * itself detected", without re-running the wizard and without re-downloading the engine (INST-D4).
 *
 * Shaped after `bootstrap/job.ts` - a `JobsService` job with a cancel callback, a `report()` that
 * goes silent once cancelled, one `failed()` exit, and `downloads.error.*` keys instead of prose
 * (CLAUDE.md). What it is *not* is a call into that job: nothing here routes through
 * `startBootstrap`, so the two-pass extras logic that re-copies the whole allowlist a second time
 * (story 088's finding F6, `job.ts` steps 7-8) is unreachable from this file. This story copies
 * with `includeVideoAndPlayers: false` always (Decisions (Sprint): "paks only"), which is the one
 * input that pass is gated on, and it calls `copyRetailGameData` directly.
 *
 * ## The order is the acceptance criterion
 *
 * 1. **Resolve the installation.** An id the library no longer holds ends the call before anything
 *    else is looked at.
 * 2. **Refuse while that installation is running** (AC7). Before the source is inspected and long
 *    before a byte is written: overwriting ~197 MB of pak files under a live Quake II process is
 *    precisely the outcome this guard exists to prevent. A refusal, not a deferred write - see
 *    `INSTALLATION_RUNNING` (`bootstrap/errors.ts`).
 * 3. **Re-verify the source** (AC6). `sourceRootPath` came from the renderer, so it is re-resolved
 *    against main's own freshly listed detected sources (`deps.retailSources`, which re-inspects
 *    each entry) and refused unless it is among them *and* still verifies as retail - the same two
 *    conditions, decided by the same `findDetectedRetailSource` predicate, that `bootstrap/job.ts`
 *    applies to its own copy source. What is copied from afterwards is main's own `rootPath` off
 *    that entry, never the string the renderer sent. Plus an overlap test against the installation
 *    being upgraded ([[089]]'s `isPathContainedBy`): copying a folder into itself is the one way
 *    this action could destroy data rather than replace it.
 *
 * Steps 1-3 all answer a failed `Outcome` from `startRetailUpgrade` itself, **before
 * `jobs.create`** - so a refusal leaves no job, no progress bar, no failure-log entry, and (AC6)
 * nothing copied.
 *
 * 4. **Copy, then rename** (AC4). See `runUpgrade` below.
 * 5. **`InstallationsService.validate(id)`** (AC5). This file never writes a status, never touches
 *    `Installation.source`, and has no way to: `RetailUpgradeInstallationsHost` exposes exactly
 *    `find` and `validate`, so "the status is re-derived, never hand-set" is checkable by reading
 *    the type rather than the whole flow.
 *
 * ## Why a staging directory rather than `<baseDir>/<name>.part`
 *
 * The decision recorded in refine is "temp-file + rename, into the inspector-resolved base dir",
 * and the reason given is the one that matters: an interrupted 184 MB copy must never leave a
 * truncated `pak0.pak` behind. That is what this file guarantees, with one difference of shape from
 * the literal `.part` wording, forced by *reusing* [[088]]'s copy routine rather than forking it:
 *
 *  - `copyRetailGameData` -> `assembleInstallation` (`bootstrap/assemble.ts`) writes each
 *    allowlisted file **directly** to `join(targetRoot, 'baseq2/pak0.pak')` with `cp` - no temp
 *    file, no rename. It is a shared code path [[074]]/[[088]]/[[089]] all depend on, and it is
 *    only safe there because every one of those runs writes into a *fresh* target folder, where a
 *    half-written file is nobody's data. Changing it was explicitly out of scope, and would be the
 *    wrong place to fix this anyway.
 *  - So this job hands it a staging directory of its own and promotes the result: the copy lands in
 *    `<baseDir>/.q2launcher-upgrade-<jobId>/baseq2/pakN.pak`, and each finished file is then
 *    `rename`d over the real one. The user's `pak0.pak` is therefore replaced by a single atomic
 *    rename of a file that is already complete on disk - a crash, a cancel or a full disk at any
 *    earlier moment leaves the installation exactly as it was, plus a staging directory that
 *    `finally` removes.
 *
 * The staging directory sits **inside the resolved base directory**, not next to it and not under
 * the installation root, for one specific reason: `rename` is only atomic within a filesystem, and
 * a `baseq2` that is a junction or symlink to another volume (perfectly legal, and something a user
 * with a small SSD does on purpose) would make any staging location outside it a cross-device move.
 * Staging inside the base directory is reached through that same junction, so source and
 * destination are on one volume by construction rather than by assumption.
 */

/** `Job.kind` for this job - the discriminator the Downloads tab and the diagnostics registry key on. */
export const RETAIL_UPGRADE_JOB_KIND = 'retail-upgrade'

/** i18n key for the job's label; `{{name}}` is the installation being upgraded. */
export const RETAIL_UPGRADE_JOB_LABEL_KEY = 'downloads.job.retailUpgrade'

/**
 * The only two files this job ever writes into the installation (AC4, and Decisions (Sprint):
 * "Upgrade scope: paks only"). `pak2.pak` is deliberately absent even though
 * `copyRetailGameData`'s allowlist offers it: leaving the demo state needs pak0+pak1, and this
 * story does not backfill anything else. Anything the copy staged beyond these two names is
 * discarded with the staging directory rather than promoted, so the allowlist this job is judged
 * by is *this* constant, not the copier's.
 */
export const UPGRADE_PAK_NAMES = ['pak0.pak', 'pak1.pak'] as const

/** Name prefix of the per-job staging directory - see the module comment for why it lives inside
 * the base directory. Dot-prefixed so it reads as scratch space in the one window it exists in. */
const STAGING_DIR_PREFIX = '.q2launcher-upgrade-'

/** The job's progress coordinate once the copy is done and only the renames are left. */
const COPY_DONE_RATIO = 0.95

/** What became of one upgrade. A one-shot value, never a second status source next to the job. */
export type RetailUpgradeOutcome =
  | { status: 'succeeded'; installationStatus: InstallationStatus }
  | { status: 'failed'; key: string }
  | { status: 'cancelled' }

export interface StartedRetailUpgrade {
  /** The `Job.id` - what `jobs:cancel` takes, and what the UI renders. */
  jobId: string
  /** Resolves once the job has reached a terminal state. Never rejects. */
  settled: Promise<RetailUpgradeOutcome>
}

/** The `JobsService` surface this job uses. `JobsService` satisfies it structurally. */
export interface RetailUpgradeJobsHost {
  create(input: CreateJobInput): Job
  progress(id: string, progress: JobProgress): void
  finish(
    id: string,
    outcome: { status: 'succeeded' | 'failed' | 'cancelled'; error?: Job['error'] },
  ): void
}

/**
 * The `InstallationsService` surface this job uses. Two methods, and deliberately neither `update`
 * nor `setIcon` nor anything else that could write a status or a flag: AC5 is "re-derived from the
 * inspector, never hand-set", and this type is what makes that a property of the code rather than
 * of the control flow below.
 */
export interface RetailUpgradeInstallationsHost {
  find(id: string): Installation | undefined
  validate(id: string): Promise<Outcome<Installation>>
}

/**
 * The `LaunchService` surface AC7's guard reads - `getState()` only. Not `isRunning()`, which
 * answers "is *any* installation running": this job must refuse only when the running game is the
 * one whose files it is about to overwrite, exactly the `installationId` + `phase` pair
 * `ActionBar.tsx` already gates its own launch button on.
 */
export interface RetailUpgradeLaunchHost {
  getState(): LaunchState
}

/** [[088]]'s copy routine, as this job reaches it. Injected so a test can drive the job without
 * moving 197 MB; production passes nothing and gets `copyRetailGameData` itself. */
export type RetailGameDataCopy = (input: {
  sourceRoot: string
  targetRoot: string
  includeVideoAndPlayers: boolean
}) => Promise<AssembleInstallationResult>

export interface RetailUpgradeDeps {
  jobs: RetailUpgradeJobsHost
  installations: RetailUpgradeInstallationsHost
  launch: RetailUpgradeLaunchHost
  /**
   * Main's own, freshly computed list of detected retail sources - `detectedRetailSourcesFor(app)`
   * (`retail/sources.ts`) in production, the same resolution the wizard's picker and the bootstrap
   * job both use, so a source offered by one can never disagree with what another admits.
   *
   * Required, not optional, for the same reason `BootstrapDeps.retailSources` is: a run may only
   * ever copy from a source main itself listed *at that moment*, so "the job has no way to check"
   * has to be a compile error at the wiring rather than a run that quietly trusts the renderer.
   */
  retailSources: () => Promise<DetectedRetailSource[]>
  /**
   * [[088]]'s `copyRetailGameData` unless a test substitutes one. Optional where `retailSources`
   * above is required, and the difference is the same one `BootstrapDeps.inspectGameDataSource`
   * draws: the default below *is* the production implementation, so there is no wiring in which
   * this goes unchecked - production therefore does not pass it at all.
   */
  copyGameData?: RetailGameDataCopy
  log?: BootstrapLog
}

/**
 * Starts the upgrade and answers as soon as the job exists (or as soon as a pre-flight check has
 * refused it) - it never waits for ~197 MB to be copied, mirroring `startBootstrap`. The job itself
 * is the progress and status surface from then on, and awaiting `settled` is optional.
 */
export async function startRetailUpgrade(
  deps: RetailUpgradeDeps,
  input: StartRetailUpgradeInput,
): Promise<Outcome<StartedRetailUpgrade>> {
  const log = deps.log

  // 1. The installation. Everything below acts on *this* record's `rootPath` - the canonicalised
  // one the library stores - and never on a path the renderer supplied.
  const installation = deps.installations.find(input.installationId)
  if (!installation) return fail(INSTALLATION_NOT_FOUND)

  // 2. AC7. First, because the two steps after it read the disk and the one after those writes to
  // it; a game that is starting or running owns these files until it exits.
  const launchState = deps.launch.getState()
  if (
    launchState.installationId === installation.id &&
    (launchState.phase === 'starting' || launchState.phase === 'running')
  ) {
    log?.warn(
      `refusing to upgrade ${installation.name}: its game is ${launchState.phase} (job not started)`,
    )
    return fail(INSTALLATION_RUNNING, { name: installation.name })
  }

  // 3. AC6, and CLAUDE.md's "paths from the renderer are never trusted".
  const verified = await verifyUpgradeSource(deps, input.sourceRootPath, installation.rootPath)
  if (!verified.ok) {
    log?.warn(
      `refusing to upgrade ${installation.name}: ${verified.error.key} (${JSON.stringify(verified.error.params ?? {})})`,
    )
    return verified
  }
  const source = verified.value

  // From here on there is work to cancel, so from here on there is a job.
  let cancelled = false
  const job = deps.jobs.create({
    moduleId: 'downloads',
    kind: RETAIL_UPGRADE_JOB_KIND,
    labelKey: RETAIL_UPGRADE_JOB_LABEL_KEY,
    labelParams: { name: installation.name },
    installationId: installation.id,
    cancellable: true,
    onCancel: () => {
      cancelled = true
    },
  })

  const settled = (async (): Promise<RetailUpgradeOutcome> => {
    try {
      return await runUpgrade({
        deps,
        job,
        installation,
        source,
        isCancelled: () => cancelled,
      })
    } catch (error) {
      // Nothing in `runUpgrade` is expected to throw; if something does, the job must still end -
      // an unfinished job would sit in the Downloads tab forever.
      log?.warn(`the upgrade of ${installation.name} threw: ${String(error)}`)
      deps.jobs.finish(job.id, { status: 'failed', error: { key: LOCAL_FAILURE } })
      return { status: 'failed', key: LOCAL_FAILURE }
    }
  })()

  return ok({ jobId: job.id, settled })
}

/**
 * The same two conditions `bootstrap/job.ts`'s `verifyCopySource` applies - the path is one main
 * itself just listed, **and** that entry's fresh `inspection.verified` is true - decided by the
 * same `findDetectedRetailSource` predicate, plus one this story needs and a fresh bootstrap does
 * not: the source may not be, contain, or sit inside the installation being upgraded. A verified
 * retail installation that the user had also registered in the library would otherwise be copied
 * onto itself through a staging directory carved out of its own `baseq2`.
 *
 * The failure carries `params: { reason }` as data for the log and D3's dialog - the source's own
 * `RetailSourceUnverifiedReasonKey` where there is one, never prose.
 */
async function verifyUpgradeSource(
  deps: { retailSources: () => Promise<DetectedRetailSource[]> },
  sourceRootPath: string,
  installationRootPath: string,
): Promise<Outcome<DetectedRetailSource>> {
  const detected = await deps.retailSources()
  const match = await findDetectedRetailSource(detected, sourceRootPath)
  if (!match) return fail(RETAIL_SOURCE_UNVERIFIED, { reason: 'notDetected' })
  if (!match.inspection.verified) {
    return fail(RETAIL_SOURCE_UNVERIFIED, {
      reason: match.inspection.unverifiedReason ?? 'unverified',
    })
  }

  // Canonicalised on both sides, so a junction or a trailing separator cannot spell its way past
  // the test - the same pairing `findDetectedRetailSource` itself uses.
  const sourceRoot = await canonicalizePath(match.rootPath)
  const targetRoot = await canonicalizePath(installationRootPath)
  if (isPathContainedBy(sourceRoot, targetRoot)) {
    return fail(RETAIL_SOURCE_UNVERIFIED, { reason: 'targetOverlap' })
  }

  return ok(match)
}

/**
 * Steps 4-5: copy into a staging directory, promote exactly `pak0.pak`/`pak1.pak` by rename, then
 * let the inspector have the last word. Split out of `startRetailUpgrade` so the pre-flight
 * refusals above and the job's own body read as two separate things, which is what they are: the
 * first three steps can still answer the caller, everything here can only answer the `Job`.
 */
async function runUpgrade(args: {
  deps: RetailUpgradeDeps
  job: Job
  installation: Installation
  source: DetectedRetailSource
  isCancelled: () => boolean
}): Promise<RetailUpgradeOutcome> {
  const { deps, job, installation, source, isCancelled } = args
  const log = deps.log
  const jobId = job.id

  /** Every progress report in this file. Silent once cancelled, because `JobsService.progress()`
   * unconditionally sets `status: 'running'` and would otherwise resurrect a cancelled job. */
  const report = (progress: JobProgress): void => {
    if (isCancelled()) return
    deps.jobs.progress(jobId, progress)
  }

  /** The one failing exit: log the (prose) reason, end the job with the i18n key. */
  const failed = (key: string, reason: string): RetailUpgradeOutcome => {
    log?.warn(`the upgrade of ${installation.name} failed with ${key}: ${reason}`)
    deps.jobs.finish(jobId, { status: 'failed', error: { key } })
    return { status: 'failed', key }
  }

  /** `jobs.cancel()` has already finished the job as cancelled; nothing more to report. */
  const cancelledOutcome = (): RetailUpgradeOutcome => {
    log?.info(`the upgrade of ${installation.name} was cancelled (job ${jobId})`)
    return { status: 'cancelled' }
  }

  const bytesTotal = UPGRADE_PAK_NAMES.reduce((total, name) => total + RETAIL_PAK_SIZES[name], 0)
  report({ ratio: null, bytesDone: 0, bytesTotal, filesRemaining: UPGRADE_PAK_NAMES.length })

  /**
   * The base directory, resolved case-insensitively exactly the way `inspector.ts` resolves it
   * (`rootListing.byLowerName.get(BASE_GAME_DIR)`, which is what `findChild`/`resolveRelaxed` do) -
   * never a hardcoded `join(root, 'baseq2')`. A traditional `BASEQ2` install would otherwise have
   * the upgrade land in a second, newly created `baseq2` the inspector never looks at, leaving the
   * user with the demo data still in place and 197 MB of retail data nobody reads.
   */
  const baseDir = await resolveRelaxed(installation.rootPath, BASE_GAME_DIR)
  if (baseDir === null) {
    return failed(
      LOCAL_FAILURE,
      `${installation.rootPath} has no ${BASE_GAME_DIR} directory to upgrade`,
    )
  }

  const stagingRoot = join(baseDir, `${STAGING_DIR_PREFIX}${jobId}`)

  try {
    if (isCancelled()) return cancelledOutcome()

    // 4a. [[088]]'s copy routine, into this job's own staging directory. `includeVideoAndPlayers`
    // is false, always (Decisions (Sprint): "paks only"), which is also what keeps this run clear
    // of the extras pass that re-copies a whole plan (story 088's finding F6) - that pass lives in
    // `bootstrap/job.ts` and is gated on this flag; nothing here calls into it either way.
    const copy = deps.copyGameData ?? copyRetailGameData
    let copied: AssembleInstallationResult
    try {
      copied = await copy({
        sourceRoot: source.rootPath,
        targetRoot: stagingRoot,
        includeVideoAndPlayers: false,
      })
    } catch (error) {
      return failed(LOCAL_FAILURE, `copying from ${source.rootPath} failed: ${String(error)}`)
    }

    if (isCancelled()) return cancelledOutcome()

    // The source verified as retail moments ago and could still have been moved, unplugged or
    // emptied since - the same window `RETAIL_COPY_INCOMPLETE` was minted for in [[088]].
    if (copied.missingRequired.length > 0) {
      return failed(
        RETAIL_COPY_INCOMPLETE,
        `${source.rootPath} no longer provided ${copied.missingRequired.map((entry) => entry.from.join('|')).join(', ')}`,
      )
    }

    const staged = UPGRADE_PAK_NAMES.map((name) => ({
      name,
      from: join(stagingRoot, BASE_GAME_DIR, name),
      relative: `${BASE_GAME_DIR}/${name}`,
    }))
    const missing = staged.filter((entry) => !copied.copiedFiles.includes(entry.relative))
    if (missing.length > 0) {
      return failed(
        RETAIL_COPY_INCOMPLETE,
        `the copy produced no ${missing.map((entry) => entry.name).join(', ')}`,
      )
    }

    report({ ratio: COPY_DONE_RATIO, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })

    // 4b. The point of no return, and the last place a cancel is honoured: once the first rename
    // has landed, the second one has to follow, or the installation is left with a retail
    // `pak0.pak` and a demo-era `pak1.pak` - a state no later run would notice as half-done.
    if (isCancelled()) return cancelledOutcome()

    for (const entry of staged) {
      // Promote onto the file that is actually there, by its real spelling: a `PAK0.PAK` next to a
      // freshly written `pak0.pak` is two files on a case-sensitive filesystem, and which of them
      // the engine (or the inspector's `byLowerName` map) then picks is not something this job
      // should be deciding. Falls back to the canonical lowercase name when there is nothing to
      // overwrite - a demo installation legitimately has no `pak1.pak` at all.
      const existing = await findChild(baseDir, entry.name)
      const target = existing ?? join(baseDir, entry.name)
      try {
        await rename(entry.from, target)
      } catch (error) {
        return failed(
          LOCAL_FAILURE,
          `renaming ${entry.from} onto ${target} failed: ${String(error)}`,
        )
      }
    }

    // 5. AC5: the status is whatever `inspectInstallation` now makes of the folder. This file never
    // writes one, and `RetailUpgradeInstallationsHost` gives it no way to.
    const revalidated = await deps.installations.validate(installation.id)
    if (!revalidated.ok) {
      return failed(
        LOCAL_FAILURE,
        `revalidating ${installation.id} failed: ${revalidated.error.key}`,
      )
    }

    if (revalidated.value.status === 'invalid' || revalidated.value.status === 'missing') {
      // The paks are in place and the inspector still says this is not a usable installation.
      // Succeeding here would tell the user the upgrade worked while the library shows a broken
      // entry; the files stay either way - they are the retail data, and putting the demo back is
      // not something this job has kept a copy for.
      return failed(
        NOT_PLAYABLE,
        `${installation.rootPath} is ${revalidated.value.status} after the upgrade`,
      )
    }

    report({ ratio: 1, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })
    deps.jobs.finish(jobId, { status: 'succeeded' })
    log?.info(
      `upgraded ${installation.name} with retail data from ${source.rootPath} (job ${jobId})`,
    )
    return { status: 'succeeded', installationStatus: revalidated.value.status }
  } finally {
    // Best-effort, and on every exit: a staging directory left behind would sit inside `baseq2`
    // holding up to 197 MB, and (unlike the promoted paks) it is of no use to anyone.
    try {
      await rm(stagingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error) {
      log?.warn(`could not remove the staging directory ${stagingRoot}: ${String(error)}`)
    }
  }
}
