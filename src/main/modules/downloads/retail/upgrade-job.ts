import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_GAME_DIR, RETAIL_PAK_SIZES } from '@shared/constants'
import type {
  DetectedRetailSource,
  DownloadsErrorKey,
  StartRetailUpgradeInput,
} from '@shared/modules/downloads'
import { fail, ok, type Installation, type InstallationStatus, type Outcome } from '@shared/types'
import { canonicalizePath, findChild, resolveRelaxed } from '../../../lib/fs-utils'
import type { JobContext, JobOutcome, JobRunnerHost, StartedJob } from '../../ports'
import type { AssembleInstallationResult } from '../bootstrap/assemble'
import {
  INSTALLATION_NOT_FOUND,
  LOCAL_FAILURE,
  NOT_PLAYABLE,
  RETAIL_COPY_INCOMPLETE,
  RETAIL_SOURCE_UNVERIFIED,
} from '../bootstrap/errors'
import { isPathContainedBy } from '../bootstrap/game-data-source'
import type { BootstrapLog } from '../bootstrap/ports'
import { copyRetailGameData, findDetectedRetailSource } from '../bootstrap/retail-source'

/**
 * Story 090: the retail-upgrade job - "take this already-registered demo installation and
 * replace its game data with `pak0.pak`/`pak1.pak` copied out of a store installation the launcher
 * itself detected", without re-running the wizard and without re-downloading the engine.
 *
 * A body on the shared `JobRunner`, which owns admission (one job per installation), cancellation,
 * the write guard and the closing revalidation; failures are `downloads.error.*` keys instead of
 * prose (CLAUDE.md). What it is *not* is a call into that job: nothing here routes through
 * `startBootstrap`, so the two-pass extras logic that re-copies the whole allowlist a second time
 * (story 088, `job.ts` steps 7-8) is unreachable from this file. This story copies
 * with `includeVideoAndPlayers: false` always (Decisions (Sprint): "paks only"), which is the one
 * input that pass is gated on, and it calls `copyRetailGameData` directly.
 *
 * ## The order is the acceptance criterion
 *
 * 1. **Resolve the installation.** An id the library no longer holds ends the call before anything
 *    else is looked at.
 * 2. **Re-verify the source**. `sourceRootPath` came from the renderer, so it is re-resolved
 *    against main's own freshly listed detected sources (`deps.retailSources`, which re-inspects
 *    each entry) and refused unless it is among them *and* still verifies as retail - the same two
 *    conditions, decided by the same `findDetectedRetailSource` predicate, that `bootstrap/job.ts`
 *    applies to its own copy source. What is copied from afterwards is main's own `rootPath` off
 *    that entry, never the string the renderer sent. Plus an overlap test against the installation
 *    being upgraded ([[089]]'s `isPathContainedBy`): copying a folder into itself is the one way
 *    this action could destroy data rather than replace it.
 *
 * Steps 1-2 both answer a failed `Outcome` from `startRetailUpgrade` itself, **before
 * `jobs.create`** - so a refusal leaves no job, no progress bar, no failure-log entry, and
 * nothing copied.
 *
 * 3. **Copy, then rename**, behind the write guard. See `runUpgrade` below.
 * 4. **`InstallationsService.validate(id)`**. This file never writes a status, never touches
 *    `Installation.source`, and has no way to: `RetailUpgradeInstallationsHost` exposes exactly
 *    `find` and `validate`, so "the status is re-derived, never hand-set" is checkable by reading
 *    the type rather than the whole flow.
 *
 * ## The write waits, it does not refuse
 *
 * While that installation's own game runs the job is still created; only its copy+promote block
 * runs inside `ctx.write(...)`, which defers it until the game exits. Everything before that block -
 * resolving the installation, re-listing and re-verifying the source, resolving the base directory -
 * only reads, and reading is never gated. A cancel while the write is deferred and a cancel
 * mid-copy leave through the same `finally`.
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
 * The only two files this job ever writes into the installation (
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

interface UpgradeSuccess {
  installationStatus: InstallationStatus
}

/** What became of one upgrade. A one-shot value, never a second status source next to the job. */
export type RetailUpgradeOutcome = JobOutcome<DownloadsErrorKey, UpgradeSuccess>

export type StartedRetailUpgrade = StartedJob<DownloadsErrorKey, UpgradeSuccess>

/**
 * The `InstallationsService` surface this job uses. Two methods, and deliberately neither `update`
 * nor `setIcon` nor anything else that could write a status or a flag: the rule is "re-derived from the
 * inspector, never hand-set", and this type is what makes that a property of the code rather than
 * of the control flow below.
 */
export interface RetailUpgradeInstallationsHost {
  find(id: string): Installation | undefined
  validate(id: string): Promise<Outcome<Installation>>
}

/** [[088]]'s copy routine, as this job reaches it. Injected so a test can drive the job without
 * moving 197 MB; production passes nothing and gets `copyRetailGameData` itself. */
export type RetailGameDataCopy = (input: {
  sourceRoot: string
  targetRoot: string
  includeVideoAndPlayers: boolean
}) => Promise<AssembleInstallationResult>

export interface RetailUpgradeDeps {
  runner: JobRunnerHost
  installations: RetailUpgradeInstallationsHost
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

  // 2. CLAUDE.md's "paths from the renderer are never trusted".
  const verified = await verifyUpgradeSource(deps, input.sourceRootPath, installation.rootPath)
  if (!verified.ok) {
    log?.warn(
      `refusing to upgrade ${installation.name}: ${verified.error.key} (${JSON.stringify(verified.error.params ?? {})})`,
    )
    return verified
  }
  const source = verified.value

  // From here on there is work to cancel, so from here on there is a job.
  return deps.runner.run<DownloadsErrorKey, UpgradeSuccess>(
    {
      moduleId: 'downloads',
      kind: RETAIL_UPGRADE_JOB_KIND,
      labelKey: RETAIL_UPGRADE_JOB_LABEL_KEY,
      labelParams: { name: installation.name },
      installationId: installation.id,
      exclusive: 'installation',
    },
    (ctx) => runUpgrade(ctx, { deps, installation, source }),
  )
}

/**
 * The same two conditions `bootstrap/job.ts`'s `verifyCopySource` applies - the path is one main
 * itself just listed, **and** that entry's fresh `inspection.verified` is true - decided by the
 * same `findDetectedRetailSource` predicate, plus one this story needs and a fresh bootstrap does
 * not: the source may not be, contain, or sit inside the installation being upgraded. A verified
 * retail installation that the user had also registered in the library would otherwise be copied
 * onto itself through a staging directory carved out of its own `baseq2`.
 *
 * The failure carries `params: { reason }` as data for the log and the dialog - the source's own
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

/** A write-phase step that failed; thrown inside the write so the body can end the job with its reason. */
class UpgradeRefused extends Error {
  constructor(
    readonly key: DownloadsErrorKey,
    reason: string,
  ) {
    super(reason)
  }
}

/**
 * Steps 3-4: copy into a staging directory, promote exactly `pak0.pak`/`pak1.pak` by rename, then
 * let the inspector have the last word. Split out of `startRetailUpgrade` so the pre-flight
 * refusals above and the job's own body read as two separate things, which is what they are: the
 * first two steps can still answer the caller, everything here can only answer the `Job`.
 */
async function runUpgrade(
  ctx: JobContext<DownloadsErrorKey, UpgradeSuccess>,
  args: { deps: RetailUpgradeDeps; installation: Installation; source: DetectedRetailSource },
): Promise<RetailUpgradeOutcome> {
  const { deps, installation, source } = args
  const log = deps.log
  const jobId = ctx.jobId

  /** `jobs.cancel()` has already finished the job as cancelled; nothing more to report. */
  const cancelled = (): RetailUpgradeOutcome => {
    log?.info(`the upgrade of ${installation.name} was cancelled (job ${jobId})`)
    return ctx.cancelled()
  }

  const bytesTotal = UPGRADE_PAK_NAMES.reduce((total, name) => total + RETAIL_PAK_SIZES[name], 0)
  ctx.report({ ratio: null, bytesDone: 0, bytesTotal, filesRemaining: UPGRADE_PAK_NAMES.length })

  /**
   * The base directory, resolved case-insensitively exactly the way `inspector.ts` resolves it
   * (`rootListing.byLowerName.get(BASE_GAME_DIR)`, which is what `findChild`/`resolveRelaxed` do) -
   * never a hardcoded `join(root, 'baseq2')`. A traditional `BASEQ2` install would otherwise have
   * the upgrade land in a second, newly created `baseq2` the inspector never looks at, leaving the
   * user with the demo data still in place and 197 MB of retail data nobody reads.
   */
  const baseDir = await resolveRelaxed(installation.rootPath, BASE_GAME_DIR)
  if (baseDir === null) {
    return ctx.fail(
      LOCAL_FAILURE,
      `${installation.rootPath} has no ${BASE_GAME_DIR} directory to upgrade`,
    )
  }

  const stagingRoot = join(baseDir, `${STAGING_DIR_PREFIX}${jobId}`)

  /**
   * Everything this job writes into the installation's own folder, and nothing else - which is
   * exactly the extent of the write guard. The staging directory is part of it rather than an
   * ungated "download into the cache": it is carved out of the installation's `baseq2` (see the
   * module comment on why it has to be), so creating it is already a write into the folder a running
   * game owns. A failure is thrown as `UpgradeRefused`; a cancel returns early and `ctx.write`
   * reports it.
   */
  const copyAndPromote = async (): Promise<void> => {
    // 3a. [[088]]'s copy routine, into this job's own staging directory. `includeVideoAndPlayers`
    // is false, always (paks only), which is also what keeps this run clear of the extras pass that
    // re-copies a whole plan - that pass lives in `bootstrap/job.ts` and is gated on this flag.
    const copy = deps.copyGameData ?? copyRetailGameData
    let copied: AssembleInstallationResult
    try {
      copied = await copy({
        sourceRoot: source.rootPath,
        targetRoot: stagingRoot,
        includeVideoAndPlayers: false,
      })
    } catch (error) {
      throw new UpgradeRefused(
        LOCAL_FAILURE,
        `copying from ${source.rootPath} failed: ${String(error)}`,
      )
    }

    if (ctx.signal.aborted) return

    // The source verified as retail moments ago and could still have been moved, unplugged or
    // emptied since - the same window `RETAIL_COPY_INCOMPLETE` was minted for.
    if (copied.missingRequired.length > 0) {
      throw new UpgradeRefused(
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
      throw new UpgradeRefused(
        RETAIL_COPY_INCOMPLETE,
        `the copy produced no ${missing.map((entry) => entry.name).join(', ')}`,
      )
    }

    ctx.report({ ratio: COPY_DONE_RATIO, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })

    // 3b. The point of no return, and the last place a cancel is honoured: once the first rename
    // has landed, the second one has to follow, or the installation is left with a retail
    // `pak0.pak` and a demo-era `pak1.pak` - a state no later run would notice as half-done.
    if (ctx.signal.aborted) return

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
        throw new UpgradeRefused(
          LOCAL_FAILURE,
          `renaming ${entry.from} onto ${target} failed: ${String(error)}`,
        )
      }
    }
  }

  try {
    if (ctx.signal.aborted) return cancelled()

    let written: 'done' | 'cancelled'
    try {
      written = await ctx.write(installation.id, copyAndPromote)
    } catch (error) {
      if (error instanceof UpgradeRefused) return ctx.fail(error.key, error.message)
      throw error
    }
    if (written === 'cancelled') return cancelled()

    // 4. The status is whatever `inspectInstallation` now makes of the folder. This file never
    // writes one, and `RetailUpgradeInstallationsHost` gives it no way to.
    const revalidated = await ctx.revalidate(installation.id)
    if (!revalidated.ok) {
      return ctx.fail(
        LOCAL_FAILURE,
        `revalidating ${installation.id} failed: ${revalidated.error.key}`,
      )
    }

    if (revalidated.value.status === 'invalid' || revalidated.value.status === 'missing') {
      // The paks are in place and the inspector still says this is not a usable installation.
      // Succeeding here would tell the user the upgrade worked while the library shows a broken
      // entry; the files stay either way - they are the retail data, and putting the demo back is
      // not something this job has kept a copy for.
      return ctx.fail(
        NOT_PLAYABLE,
        `${installation.rootPath} is ${revalidated.value.status} after the upgrade`,
      )
    }

    ctx.report({ ratio: 1, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })
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
