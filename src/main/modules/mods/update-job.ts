import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, realpath, rename, rm, rmdir } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { ModInstallFile, ModInstallRecord } from '@shared/modules/mods'
import { isSafeGameDirName } from '@shared/mods/gamedir'
import {
  fail,
  isJobActive,
  ok,
  type Installation,
  type Job,
  type JobProgress,
  type Outcome,
} from '@shared/types'
import {
  hashFile,
  isInside,
  moveFile,
  pathKey,
  plannedDestination,
  resolveRelaxed,
} from '../../lib/fs-utils'
import { isWriteCancelled } from '../../services/write-guard'
import type { ExtractorHandle } from '../../lib/archive/extractor'
import { getExtractDir } from '../../services/package-staging'
import type { ModCatalogEntryParsed } from './catalog-schema'
import {
  collectPackageFiles,
  isSafeRelative,
  isStrictlyInside,
  PART_SUFFIX,
  placedGameLibraryName,
  resolveModVariant,
  stagePackages,
  type ModInstallDeps,
  type ModJobFailureKey,
  type ModInstallJobsHost,
  type ModInstallLog,
  type ResolvedModVariant,
} from './install-job'
import { isSafeRecordedPath, readModsState, withRecord } from './install-records'
import { planRemoval, RemovalRefusedError } from './remove'
import { planModUpdate, type ModUpdatePolicy } from './update-plan'
import { computeModUpdateStatus } from './update-status'

/**
 * Story 194 D2: update one catalog mod to its manifest's pinned version - the first record-driven
 * REPLACE inside a folder the user shares with the mod. Built from story 190's install pieces
 * (variant picker, stager, record) and story 191's removal rules (record paths only, realpath
 * containment, no link following, busy checks).
 *
 * ## The order is the acceptance
 *
 * 1. **Pre-flight, before `jobs.create`** - installation, record (by catalog id), catalog entry and
 *    its pinned version, "an update exists", the variant for this engine. A refusal leaves no job.
 * 2. **Stage every package** into `cache/downloads/extract/<jobId>-<index>`. A failure ends the job;
 *    the game dir and the record have not been looked at for writing.
 * 3. **Inside `writeGuard.runWrite`**: re-read the record, re-hash its files (the dialog's list is
 *    advisory - the policy applies to every changed file found *now*) and plan with `planModUpdate`.
 * 4. **Back up** every recorded file about to be overwritten or deleted by *moving* it into
 *    `<root>/.q2launcher-mod-backup/<jobId>/<gameDir>/...` - on the installation's own volume, and
 *    dot-prefixed so the inspector never lists it as a game dir.
 * 5. **Copy** the new files (`.q2l-part`, hash-checked, renamed into place), then write the new
 *    record **last**. Any failure before the record is saved moves the backups back, deletes what
 *    this run created, and leaves the old record.
 * 6. The slot is deleted on every exit - except when a restore could not put every file back: then
 *    it is the only copy of those files and is kept (logged), as 190's install keeps its backup.
 *
 * A file in neither record is never touched: a new-version path already occupied by an unrecorded
 * file is left as it is and stays out of the new record, the same rule as 190's "identical/kept".
 */

export const MOD_UPDATE_JOB_KIND = 'mod-update'
export const MOD_UPDATE_JOB_LABEL_KEY = 'mods.job.update'
/** Dot-prefixed: `inspector.ts` never treats it as a game directory. */
export const MOD_BACKUP_DIR_NAME = '.q2launcher-mod-backup'

const INSTALLATION_NOT_FOUND = 'installations.error.notFound'
const UNKNOWN_MOD = 'mods.error.unknownMod'
const BAD_PACKAGE = 'mods.error.badPackage'
const WRITE_FAILED = 'mods.error.writeFailed'
const BUSY = 'mods.remove.refused.busy'
const NO_RECORD = 'mods.update.refused.noRecord'
const UP_TO_DATE = 'mods.update.refused.upToDate'
const UNSAFE_PATH = 'mods.update.refused.unsafePath'
const LOCAL_FAILURE = 'mods.error.diskWrite'

/** Any of these running for the installation makes an update busy (and an update makes them busy). */
const BUSY_KINDS = new Set(['mod-install', 'mods-remove', MOD_UPDATE_JOB_KIND])

/** Stands in for the hash of a recorded file that is changed, unreadable or no longer a regular file. */
const CHANGED_ON_DISK = 'changed-on-disk'

const STAGE_RATIO = 0.8
const PLAN_RATIO = 0.85

export interface ModUpdateJobsHost extends Omit<ModInstallJobsHost, 'setWaiting'> {
  list(): Job[]
}

/** 190's install deps, minus the decision prompt, plus the job list for the busy check. */
export type ModUpdateDeps = Omit<ModInstallDeps, 'jobs' | 'askDecision'> & {
  jobs: ModUpdateJobsHost
}

export interface ModUpdateRequest {
  installationId: string
  catalogId: string
}

export interface StartModUpdateInput extends ModUpdateRequest {
  /** What happens to a recorded file the user changed since it was installed. */
  changedPolicy: ModUpdatePolicy
}

export interface ModUpdatePreview {
  installationName: string
  modName: string
  gameDir: string
  installedVersion: string
  targetVersion: string
  /** Recorded paths (forward slashes) whose bytes on disk are no longer what was installed. */
  changedFiles: string[]
}

/** An update fails like an install, or with one of its own refusal keys. */
type ModUpdateFailureKey = ModJobFailureKey | typeof INSTALLATION_NOT_FOUND | typeof NO_RECORD | typeof UP_TO_DATE | typeof UNSAFE_PATH

export type ModUpdateOutcome =
  | {
      status: 'succeeded'
      gameDir: string
      version: string
      files: ModInstallFile[]
      kept: string[]
    }
  | { status: 'failed'; key: ModUpdateFailureKey }
  | { status: 'cancelled' }

export interface StartedModUpdate {
  jobId: string
  /** Resolves once the job is terminal. Never rejects. */
  settled: Promise<ModUpdateOutcome>
}

type CatalogVersion = ModCatalogEntryParsed['versions'][number]

interface Resolved {
  installation: Installation
  record: ModInstallRecord
  entry: ModCatalogEntryParsed
  versionEntry: CatalogVersion
}

/** Updates in flight, keyed by installation - the job list does not see one before `jobs.create`. */
const inFlight = new Set<string>()

/** A job id as one safe path segment: no separators, dots or NULs can reach the slot path. */
function slotKey(jobId: string): string {
  const key = jobId.replace(/[^A-Za-z0-9_-]/g, '_')
  return key.length > 0 ? key : 'job'
}

// Not fs-utils' pathExists: lstat (a dangling link still exists) and rethrows anything but ENOENT/ENOTDIR.
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw error
  }
}

async function resolveUpdate(
  deps: ModUpdateDeps,
  request: ModUpdateRequest,
): Promise<Outcome<Resolved>> {
  const installation = deps.installations.find(request.installationId)
  if (!installation) return fail(INSTALLATION_NOT_FOUND)
  const record = readModsState(installation.moduleData).records.find(
    (r) => r.catalogId === request.catalogId,
  )
  if (!record) return fail(NO_RECORD)
  if (
    !isSafeGameDirName(record.gameDir) ||
    !record.files.every((f) => isSafeRecordedPath(f.path))
  ) {
    return fail(UNSAFE_PATH)
  }
  const snapshot = await deps.catalog.getCatalog()
  if (snapshot.status !== 'ok') return fail(UNKNOWN_MOD)
  const entry = snapshot.entries.find((e) => e.id === request.catalogId)
  if (!entry) return fail(UNKNOWN_MOD)
  const versionEntry = entry.versions.find((v) => v.version === entry.pinned)
  // The update replaces files inside the recorded folder; a catalog that moved the mod elsewhere is not one.
  if (!versionEntry || entry.gamedir.toLowerCase() !== record.gameDir.toLowerCase())
    return fail(UNKNOWN_MOD)
  if (!computeModUpdateStatus(record, entry).updateAvailable) return fail(UP_TO_DATE)
  return ok({ installation, record, entry, versionEntry })
}

/** Synchronous, so the check and `inFlight.add`/`jobs.create` after it cannot interleave with another start. */
function isBusy(deps: ModUpdateDeps, installationId: string): boolean {
  return (
    inFlight.has(installationId) ||
    deps.jobs
      .list()
      .some(
        (j) =>
          j.moduleId === 'mods' &&
          BUSY_KINDS.has(j.kind) &&
          j.installationId === installationId &&
          isJobActive(j),
      )
  )
}

/**
 * The disk state of every recorded file, in `planModUpdate`'s terms: absent = gone from disk, the
 * record's own hash = unchanged, {@link CHANGED_ON_DISK} = changed (or unreadable, or not a regular
 * file any more). 191's `planRemoval` does the hashing and refuses an unsafe record or a linked or
 * escaping game dir with {@link RemovalRefusedError} - one rule set for "what did the user change".
 */
async function recordedDiskHashes(
  root: string,
  record: ModInstallRecord,
): Promise<Map<string, string>> {
  const plan = await planRemoval(root, record.gameDir, record)
  const missing = new Set(plan.missing)
  const changed = new Set(plan.changed)
  const hashes = new Map<string, string>()
  for (const file of record.files) {
    if (missing.has(file.path)) continue
    hashes.set(file.path, changed.has(file.path) ? CHANGED_ON_DISK : file.sha256)
  }
  return hashes
}

/** What D3's confirmation dialog shows; the same validation as the start, and never writes. */
export async function previewModUpdate(
  deps: ModUpdateDeps,
  request: ModUpdateRequest,
): Promise<Outcome<ModUpdatePreview>> {
  const resolved = await resolveUpdate(deps, request)
  if (!resolved.ok) return resolved
  const { installation, record, entry, versionEntry } = resolved.value
  if (isBusy(deps, installation.id)) return fail(BUSY)
  try {
    const hashes = await recordedDiskHashes(installation.rootPath, record)
    return ok({
      installationName: installation.name,
      modName: entry.name,
      gameDir: record.gameDir,
      installedVersion: record.version,
      targetVersion: versionEntry.version,
      changedFiles: planModUpdate(record, [], hashes, 'overwrite').changed,
    })
  } catch (error) {
    if (error instanceof RemovalRefusedError) {
      deps.log?.warn(`refusing to preview the update of ${record.catalogId}: ${error.detail}`)
      return fail(UNSAFE_PATH)
    }
    deps.log?.warn(`previewing the update of ${record.catalogId} threw: ${String(error)}`)
    return fail(LOCAL_FAILURE)
  }
}

/** Starts the update and answers as soon as the job exists. */
export async function startModUpdate(
  deps: ModUpdateDeps,
  input: StartModUpdateInput,
): Promise<Outcome<StartedModUpdate>> {
  const resolved = await resolveUpdate(deps, input)
  if (!resolved.ok) {
    deps.log?.warn(`refusing to update ${input.catalogId}: ${resolved.error.key}`)
    return resolved
  }
  const { installation, entry, versionEntry } = resolved.value
  // 190's picker: platform + engine arch; may move the install between full and content-only.
  const variant = await resolveModVariant(deps, installation, versionEntry)
  if (!variant.ok) {
    deps.log?.warn(`refusing to update ${input.catalogId}: ${variant.error.key}`)
    return variant
  }

  // From here to `jobs.create` nothing awaits: the busy check and the reservation are one step.
  if (isBusy(deps, installation.id)) return fail(BUSY)
  inFlight.add(installation.id)

  const cancellation = new AbortController()
  let extractor: ExtractorHandle | undefined
  let job: Job
  try {
    job = deps.jobs.create({
      moduleId: 'mods',
      kind: MOD_UPDATE_JOB_KIND,
      labelKey: MOD_UPDATE_JOB_LABEL_KEY,
      labelParams: { name: entry.name, version: versionEntry.version },
      installationId: installation.id,
      cancellable: true,
      onCancel: () => {
        cancellation.abort()
        extractor?.kill()
      },
    })
  } catch (error) {
    inFlight.delete(installation.id)
    throw error
  }

  const settled = (async (): Promise<ModUpdateOutcome> => {
    try {
      return await runUpdate(
        deps,
        job.id,
        resolved.value,
        variant.value,
        input.changedPolicy,
        cancellation.signal,
        (h) => {
          extractor = h
        },
      )
    } catch (error) {
      deps.log?.warn(`updating ${entry.id} threw: ${String(error)}`)
      deps.jobs.finish(job.id, { status: 'failed', error: { key: LOCAL_FAILURE } })
      return { status: 'failed', key: LOCAL_FAILURE }
    } finally {
      inFlight.delete(installation.id)
    }
  })()
  return ok({ jobId: job.id, settled })
}

interface NewFile {
  /** Gamedir-relative; spelled like the old record's path when it names the same file. */
  path: string
  abs: string
  sha256: string
  sizeBytes: number
}

async function runUpdate(
  deps: ModUpdateDeps,
  jobId: string,
  ctx: Resolved,
  variant: ResolvedModVariant,
  policy: ModUpdatePolicy,
  signal: AbortSignal,
  setExtractor: (handle: ExtractorHandle) => void,
): Promise<ModUpdateOutcome> {
  const { installation, entry } = ctx
  const log = deps.log
  const report = (progress: JobProgress): void => {
    if (!signal.aborted) deps.jobs.progress(jobId, progress)
  }
  const failed = (key: ModUpdateFailureKey, reason: string): ModUpdateOutcome => {
    log?.warn(`updating ${entry.id} in ${installation.name} failed with ${key}: ${reason}`)
    deps.jobs.finish(jobId, { status: 'failed', error: { key } })
    return { status: 'failed', key }
  }
  const cancelledOutcome = (): ModUpdateOutcome => {
    log?.info(`updating ${entry.id} was cancelled (job ${jobId})`)
    return { status: 'cancelled' }
  }

  const stagingDirs = variant.sources.map((_, index) =>
    getExtractDir(deps.userDataPath, `${jobId}-${index}`),
  )
  const slotParent = join(installation.rootPath, MOD_BACKUP_DIR_NAME)
  const slot = join(slotParent, slotKey(jobId))
  let keepSlot = false
  const bytesTotal = variant.sources.reduce((sum, s) => sum + s.sizeBytes, 0)

  try {
    report({ ratio: 0, bytesDone: 0, bytesTotal })

    // Download, verify, extract - before anything in the installation is touched.
    const staged = await stagePackages({
      deps,
      jobId,
      sources: variant.sources,
      signal,
      onExtractor: setExtractor,
      onProgress: (done) =>
        report({
          ratio: (done / Math.max(1, bytesTotal)) * STAGE_RATIO,
          bytesDone: done,
          bytesTotal,
        }),
    })
    if (!staged.ok) return staged.cancelled ? cancelledOutcome() : failed(staged.key, staged.reason)
    report({ ratio: STAGE_RATIO, bytesDone: bytesTotal, bytesTotal })

    const collected = await collectPackageFiles(variant.packages, staged.extractDirs)
    if (!collected.ok) return failed(BAD_PACKAGE, collected.reason)
    const newFiles: { rel: string; abs: string; sha256: string; sizeBytes: number }[] = []
    const seen = new Set<string>()
    for (const file of collected.files) {
      const rel = placedGameLibraryName(file.rel)
      const key = rel.toLowerCase()
      if (!isSafeRelative(rel) || !isSafeRecordedPath(rel) || seen.has(key)) {
        return failed(BAD_PACKAGE, `bad or duplicate ${rel}`)
      }
      seen.add(key)
      newFiles.push({ rel, abs: file.abs, ...(await hashFile(file.abs)) })
    }
    if (signal.aborted) return cancelledOutcome()
    report({ ratio: PLAN_RATIO, bytesDone: bytesTotal, bytesTotal })

    const writePhase: ModUpdateOutcome[] = []
    try {
      await deps.writeGuard.runWrite(installation.id, jobId, signal, async () => {
        writePhase.push(
          await applyUpdate({
            deps,
            ctx,
            variant,
            newFiles,
            policy,
            slot,
            signal,
            failed,
            cancelled: cancelledOutcome,
            onRestoreIncomplete: () => {
              keepSlot = true
            },
            log,
          }),
        )
      })
    } catch (error) {
      if (isWriteCancelled(error) || signal.aborted) return cancelledOutcome()
      throw error
    }
    const outcome = writePhase[0]
    if (!outcome || outcome.status !== 'succeeded') return outcome ?? cancelledOutcome()

    const revalidated = await deps.installations.validate(installation.id)
    if (!revalidated.ok)
      log?.warn(`revalidating ${installation.id} after updating ${entry.id} failed`)

    report({ ratio: 1, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })
    deps.jobs.finish(jobId, { status: 'succeeded' })
    log?.info(
      `updated ${entry.id} to ${outcome.version} in ${installation.name} (${outcome.files.length} files)`,
    )
    return outcome
  } finally {
    for (const dir of stagingDirs) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
        (error: unknown) => log?.warn(`could not remove ${dir}: ${String(error)}`),
      )
    }
    if (keepSlot) {
      log?.warn(`keeping ${slot}: it holds the only copy of files a rollback could not put back`)
    } else {
      // The slot is the launcher's own folder; only its parent is removed non-recursively.
      await rm(slot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
        (error: unknown) => log?.warn(`could not remove ${slot}: ${String(error)}`),
      )
      await rmdir(slotParent).catch(() => {})
    }
  }
}

/**
 * Steps 3-5, and the only code here that writes into the installation. Every exit before the new
 * record is saved has restored the game dir: files this run wrote removed, backups moved back,
 * folders this run created removed when empty (`rmdir`, never recursive in the user's tree).
 */
async function applyUpdate(args: {
  deps: ModUpdateDeps
  ctx: Resolved
  variant: ResolvedModVariant
  newFiles: { rel: string; abs: string; sha256: string; sizeBytes: number }[]
  policy: ModUpdatePolicy
  slot: string
  signal: AbortSignal
  failed: (key: ModUpdateFailureKey, reason: string) => ModUpdateOutcome
  cancelled: () => ModUpdateOutcome
  onRestoreIncomplete: () => void
  log: ModInstallLog | undefined
}): Promise<ModUpdateOutcome> {
  const { deps, ctx, variant, policy, slot, signal, failed, log } = args
  const installationId = ctx.installation.id

  // Re-read inside the guard: whatever waited before this may have changed or removed the record.
  const current = deps.installations.find(installationId)
  if (!current) return failed(INSTALLATION_NOT_FOUND, `${installationId} disappeared`)
  const record = readModsState(current.moduleData).records.find((r) => r.catalogId === ctx.entry.id)
  if (!record || record.gameDir.toLowerCase() !== ctx.record.gameDir.toLowerCase()) {
    return failed(NO_RECORD, `the record of ${ctx.entry.id} changed while the update waited`)
  }
  if (record.version === ctx.versionEntry.version)
    return failed(UP_TO_DATE, `${record.version} is already installed`)
  if (
    !isSafeGameDirName(record.gameDir) ||
    !record.files.every((f) => isSafeRecordedPath(f.path))
  ) {
    return failed(UNSAFE_PATH, `record of ${record.gameDir} holds an unsafe path`)
  }

  let diskHashes: Map<string, string>
  try {
    diskHashes = await recordedDiskHashes(current.rootPath, record)
  } catch (error) {
    if (error instanceof RemovalRefusedError) return failed(UNSAFE_PATH, error.detail)
    throw error
  }

  // A new path naming a recorded file in another case is that file, under the record's spelling -
  // otherwise "obsolete" would delete what was just written on a case-insensitive file system.
  const oldSpelling = new Map(record.files.map((f) => [f.path.toLowerCase(), f.path]))
  const incoming: NewFile[] = args.newFiles.map((f) => ({
    path: oldSpelling.get(f.rel.toLowerCase()) ?? f.rel,
    abs: f.abs,
    sha256: f.sha256,
    sizeBytes: f.sizeBytes,
  }))
  const byPath = new Map(incoming.map((f) => [f.path, f]))
  const plan = planModUpdate(record, incoming, diskHashes, policy)

  const createdDirs: string[] = []
  const mkdirTracked = async (dir: string): Promise<void> => {
    const first = await mkdir(dir, { recursive: true })
    if (first === undefined) return
    for (let d = dir; d.length >= first.length; d = dirname(d)) {
      createdDirs.push(d)
      if (pathKey(d) === pathKey(first)) break
    }
  }
  const backups: { dest: string; backup: string }[] = []
  const written: string[] = []
  const parts = new Set<string>()

  const restore = async (): Promise<void> => {
    let unrestored = 0
    for (const part of parts) await rm(part, { force: true }).catch(() => {})
    for (const dest of [...written].reverse()) {
      await rm(dest, { force: true, maxRetries: 3, retryDelay: 50 }).catch((error: unknown) =>
        log?.warn(`removing ${dest} failed: ${String(error)}`),
      )
    }
    for (const { dest, backup } of [...backups].reverse()) {
      try {
        await moveFile(backup, dest)
      } catch (error) {
        unrestored += 1
        log?.warn(`restoring ${dest} from ${backup} failed: ${String(error)}`)
      }
    }
    for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) {
      await rmdir(dir).catch(() => {})
    }
    if (unrestored > 0) args.onRestoreIncomplete()
  }

  try {
    await mkdirTracked(join(current.rootPath, record.gameDir))
    const realGameDir = await realpath(join(current.rootPath, record.gameDir))
    const recordedKeys = new Set(record.files.map((f) => f.path.toLowerCase()))
    /** Where a recorded path lives; its real parent is re-checked against the real game dir. */
    const recordedTarget = async (path: string): Promise<string> => {
      const target = join(realGameDir, ...path.split('/'))
      if (!isInside(realGameDir, await realpath(dirname(target))))
        throw new Error(`${path} leaves ${realGameDir}`)
      return target
    }

    // A new-version path already taken by a file in no record is the user's: never touched, never recorded.
    const toWrite: NewFile[] = []
    const userOwned: string[] = []
    for (const path of [...plan.write].sort()) {
      if (
        !recordedKeys.has(path.toLowerCase()) &&
        (await resolveRelaxed(realGameDir, path)) !== null
      ) {
        userOwned.push(path)
        continue
      }
      toWrite.push(byPath.get(path)!)
    }
    if (userOwned.length > 0)
      log?.info(`leaving unrecorded ${userOwned.join(', ')} in ${record.gameDir} alone`)

    // 4. Every recorded file about to be replaced or deleted moves into the slot first.
    const writeKeys = new Set(toWrite.map((f) => f.path))
    const toMove = record.files
      .map((f) => f.path)
      .filter(
        (path) =>
          diskHashes.has(path) && (writeKeys.has(path) || plan.deleteObsolete.includes(path)),
      )
    for (const path of toMove) {
      if (signal.aborted) {
        await restore()
        return args.cancelled()
      }
      const target = await recordedTarget(path)
      const info = await lstat(target)
      // A link or folder at a recorded path is not the launcher's file; it is never moved.
      if (!info.isFile()) throw new Error(`${target} is no longer a regular file`)
      const backup = join(slot, record.gameDir, ...path.split('/'))
      await mkdir(dirname(backup), { recursive: true })
      await moveFile(target, backup)
      backups.push({ dest: target, backup })
    }

    // 5. The new files, each written beside its destination and renamed into place once verified.
    const files: ModInstallFile[] = []
    for (const file of toWrite) {
      if (signal.aborted) {
        await restore()
        return args.cancelled()
      }
      const dest = await plannedDestination(realGameDir, file.path)
      if (!isStrictlyInside(dest, realGameDir)) throw new Error(`${dest} leaves ${realGameDir}`)
      await mkdirTracked(dirname(dest))
      if (!isInside(realGameDir, await realpath(dirname(dest))))
        throw new Error(`${dest} resolves outside ${realGameDir}`)
      // Planning saw the folder a moment ago: anything at `dest` now was not planned and is not ours.
      if (await exists(dest)) throw new Error(`${dest} appeared during the update`)
      const part = `${dest}${PART_SUFFIX}`
      try {
        await copyFile(file.abs, part, constants.COPYFILE_EXCL)
      } catch (error) {
        // EEXIST: a file of that name that is not this run's - it must not be cleaned up as ours.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') parts.add(part)
        throw error
      }
      parts.add(part)
      const hashed = await hashFile(part)
      if (hashed.sha256 !== file.sha256) throw new Error(`${part} does not match its staged bytes`)
      await rename(part, dest)
      parts.delete(part)
      written.push(dest)
      files.push({ path: relative(realGameDir, dest).split(sep).join('/'), ...hashed })
    }

    // The record goes last: until it is saved, the old one still describes what is restored.
    const fresh = deps.installations.find(installationId)
    if (!fresh) throw new Error(`${installationId} disappeared`)
    const next: ModInstallRecord = {
      catalogId: record.catalogId,
      gameDir: record.gameDir,
      version: ctx.versionEntry.version,
      variantId: variant.variantId,
      engineKind: fresh.engineKind,
      arch: variant.arch,
      platform: variant.platform,
      contentOnly: variant.contentOnly,
      ...(fresh.engineKind === 'r1q2' && files.some((f) => f.path.toLowerCase().endsWith('.pkz'))
        ? { pkzUnsupported: true }
        : {}),
      installedAt: Date.now(),
      files,
    }
    const saved = deps.installations.setModuleData(
      installationId,
      'mods',
      withRecord(fresh.moduleData, next)['mods'],
    )
    if (!saved.ok) throw new Error(`recording the update failed: ${saved.error.key}`)

    // Folders the deleted obsolete files leave empty go; non-recursive, and never the game dir itself.
    const obsoleteDirs = new Map<string, string>()
    for (const path of plan.deleteObsolete) {
      const segments = path.split('/').slice(0, -1)
      for (let depth = segments.length; depth > 0; depth--) {
        const dir = join(realGameDir, ...segments.slice(0, depth))
        obsoleteDirs.set(pathKey(dir), dir)
      }
    }
    for (const dir of [...obsoleteDirs.values()].sort((a, b) => b.length - a.length)) {
      try {
        const info = await lstat(dir)
        if (!info.isSymbolicLink() && info.isDirectory()) await rmdir(dir)
      } catch {
        // Not empty, gone or locked: the folder stays.
      }
    }

    return {
      status: 'succeeded',
      gameDir: record.gameDir,
      version: next.version,
      files,
      kept: plan.keptUntouched,
    }
  } catch (error) {
    await restore()
    return failed(WRITE_FAILED, String(error))
  }
}
