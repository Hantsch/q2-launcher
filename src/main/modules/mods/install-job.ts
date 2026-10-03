import { copyFile, lstat, mkdir, rename, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { DownloadsErrorKey, PackageSource } from '@shared/modules/downloads'
import type { ModInstallFile, ModInstallRecord, ModsErrorKey } from '@shared/modules/mods'
import { isSafeGameDirName } from '@shared/mods/gamedir'
import { fail, ok, type Installation, type Job, type Outcome } from '@shared/types'
import {
  findChild,
  hashFile,
  isDirectory,
  isInside,
  listFilesRecursive,
  pathKey,
  plannedDestination,
  resolveRelaxed,
} from '../../lib/fs-utils'
import { isSafeEarlyToken } from '../../services/launch-plan'
import type { ExtractorHandle } from '../../lib/archive/extractor'
import { isSafeDownloadFileName } from '../../lib/net/download-cache-paths'
import { getExtractDir } from '../../services/package-staging'
import type {
  InstallationsHost,
  JobContext,
  JobLocalFailureKey,
  JobLogHost,
  JobOutcome,
  JobRunnerHost,
  StartedJob,
} from '../ports'
import type { StagePackageInput, StagePackageResult } from '../../services/package-staging'
import type { CatalogSnapshot } from './catalog-service'
import { isSafeContentsFrom, type ModCatalogEntryParsed } from './catalog-schema'
import { resolveEngineTarget, selectVariant } from './engine-target'
import { recordedGameDirs, withRecord } from './install-records'

/**
 * Story 190: install one catalog mod into one installation's game directory - the first job
 * that writes into a folder the user may already own. Shaped after `downloads/engine/update-job.ts`
 * (narrow hosts, one `AbortController`, `report` silent after cancel, one failing exit).
 *
 * ## The order is the acceptance
 *
 * 1. **Pre-flight, before `jobs.create`** - installation, catalog entry + version, game dir name,
 *    "already installed", variant. A refusal leaves no job and nothing on disk.
 * 2. **Stage every package** into `cache/downloads/extract/<jobId>-<index>`. The first failure
 *    ends the job; the installation has not been looked at for writing yet.
 * 3. **Plan** the gamedir-relative file list from each package's `contents[]`, hash every staged
 *    file, and refuse anything that would land outside the game directory.
 * 4. **Decide** - an existing folder without a record is the user's: always ask (naming the folder,
 *    listing the files that differ, possibly none). Identical files are skipped either way.
 * 5. **Write, inside `writeGuard.runWrite`** - each overwritten file is first *copied* into a backup
 *    dir, the new bytes go to `<dest>.q2l-part` and are renamed into place, so the user's file is
 *    never missing at any instant. Then the record, listing **only the files this run wrote** -
 *    never a kept or identical one, because story 191's Remove deletes exactly what is recorded.
 *    Any failure restores the backups, removes what this run created, and writes no record.
 * 6. **Revalidate** outside the guard, so the inspector re-derives `gameDirs` for the action bar.
 *
 * ## What makes the folder a game directory (story 193 depends on it)
 *
 * The inspector (`services/inspector.ts`, `isGameDir`) lists a folder as a game dir only when it is
 * a known one or its *top level* holds a `.pak`/`.pkz`/`.pk3`, `game.dll`/`gamex86.dll`/
 * `gamex86_64.dll`, or any `.so`. A content-only mod shipping `pak0.pak` (the catalog's shape)
 * satisfies that with no help. Two cases would not, and are handled or flagged here:
 *  - a suffixed library (`gamex86-opentdm-r388~add8f3c.dll`) is neither the name the inspector
 *    accepts nor the one `+set game` loads, so it is placed under its plain name
 *    (`placedGameLibraryName`);
 *  - a content-only package whose files are all nested (`maps/x.bsp`, no top-level pak) would not
 *    be listed. No catalog entry has that shape, and inventing a placeholder file in the user's
 *    folder is worse than the gap, so the job only logs a warning when revalidation does not list
 *    the folder.
 */

export const MOD_INSTALL_JOB_KIND = 'mod-install'
export const MOD_INSTALL_JOB_LABEL_KEY = 'mods.job.install'
export const MOD_INSTALL_WAITING_KEY = 'mods.job.waitingForDecision'

const INSTALLATION_NOT_FOUND = 'installations.error.notFound'
const UNKNOWN_MOD = 'mods.error.unknownMod'
const ALREADY_INSTALLED = 'mods.error.alreadyInstalled'
const BAD_PACKAGE = 'mods.error.badPackage'
const WRITE_FAILED = 'mods.error.writeFailed'

/** Suffix of a file being written; only renamed onto its real name once fully copied and hashed. */
export const PART_SUFFIX = '.q2l-part'

/** Share of the bar the downloads take; planning + writing is the rest. */
const STAGE_RATIO = 0.8
const PLAN_RATIO = 0.85

export type ModInstallDecision = 'overwrite' | 'keep' | 'cancel'

export interface ModInstallDecisionRequest {
  /** The existing folder's own name, as it is spelled on disk. */
  folder: string
  /** Gamedir-relative paths (forward slashes) of existing files whose bytes differ. May be empty. */
  conflicts: string[]
}

/** A mod job fails with its own key, the key the package staging step reported, or the shared one. */
export type ModJobFailureKey = ModsErrorKey | DownloadsErrorKey | JobLocalFailureKey

interface ModInstallSuccess {
  gameDir: string
  files: ModInstallFile[]
}

export type ModInstallOutcome = JobOutcome<ModJobFailureKey, ModInstallSuccess>

export type StartedModInstall = StartedJob<ModJobFailureKey, ModInstallSuccess>

export interface StartModInstallInput {
  installationId: string
  catalogId: string
  /** Defaults to the entry's pinned version. */
  version?: string
}

/** The one lifecycle step the runner has no verb for: parking the job on the user's answer. */
export interface ModInstallWaitingHost {
  setWaiting(id: string, reason: NonNullable<Job['waitingReason']>): void
}

/** `CatalogService` satisfies this structurally. */
export interface ModInstallCatalogHost {
  getCatalog(): Promise<CatalogSnapshot>
}

type EnginePackageLike = Parameters<typeof resolveEngineTarget>[1][number]

export interface ModInstallDeps {
  runner: JobRunnerHost
  jobs: ModInstallWaitingHost
  installations: InstallationsHost
  catalog: ModInstallCatalogHost
  enginePackages: () => Promise<readonly EnginePackageLike[]> | readonly EnginePackageLike[]
  /** The `stagePackage` step. */
  stage: (input: StagePackageInput) => Promise<StagePackageResult>
  resolveExtractor: () => { path: string; exists: boolean }
  readArch: Parameters<typeof resolveEngineTarget>[2]
  askDecision: (jobId: string, request: ModInstallDecisionRequest) => Promise<ModInstallDecision>
  /** `app.getPath('userData')`; staging and backup dirs live under its downloads cache. */
  userDataPath: string
  log?: JobLogHost
}

type CatalogVersion = ModCatalogEntryParsed['versions'][number]
type CatalogPackage = CatalogVersion['contentOnly']['packages'][number]

const GAME_LIBRARY_SUFFIXED = /^(game[a-z0-9_]*?)-[^/\\]*\.(dll|so)$/i

/**
 * A game library shipped with a build suffix (`gamex86-opentdm-r388~add8f3c.dll`) is placed under
 * its plain name (`gamex86.dll`), the one `+set game <dir>` loads. Only directly in the gamedir
 * root; every other path is returned unchanged.
 */
export function placedGameLibraryName(relativePath: string): string {
  if (relativePath.includes('/') || relativePath.includes('\\')) return relativePath
  const match = GAME_LIBRARY_SUFFIXED.exec(relativePath)
  return match ? `${match[1]}.${match[2]}` : relativePath
}

/** The catalog package as the download pipeline's own minimal input, or undefined if unusable. */
export function toSource(pkg: CatalogPackage): PackageSource | undefined {
  let fileName: string
  try {
    fileName = decodeURIComponent(new URL(pkg.url).pathname.split('/').pop() ?? '')
  } catch {
    return undefined
  }
  if (!isSafeDownloadFileName(fileName)) return undefined
  return {
    fileName,
    url: pkg.url,
    mirrors: pkg.mirrors,
    sizeBytes: pkg.sizeBytes,
    sha256: pkg.sha256,
  }
}

/** Strictly inside `parent` (never equal). `isPathContainedBy` is symmetric, so it is not enough here. */
export function isStrictlyInside(child: string, parent: string): boolean {
  return isInside(parent, child) && pathKey(child) !== pathKey(parent)
}

export function isSafeRelative(rel: string): boolean {
  if (rel.length === 0 || isAbsolute(rel)) return false
  return rel
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

/** Regular files under `dir`, relative with forward slashes; `null` on a link or special file. */
async function collectFiles(dir: string): Promise<{ rel: string; abs: string }[] | null> {
  const entries = await listFilesRecursive(dir)
  if (entries.some((entry) => !entry.isFile)) return null
  return entries.map(({ rel, abs }) => ({ rel, abs }))
}

interface PlannedFile {
  /** Gamedir-relative, as the package (after the library rename) spells it. */
  rel: string
  /** Staged source. */
  abs: string
  sha256: string
  sizeBytes: number
  /** The existing file at that path (its own spelling), if any. */
  existing: string | null
  kind: 'new' | 'identical' | 'conflict'
}

/** Pre-flight: everything that can be refused without a job. */
async function preflight(
  deps: ModInstallDeps,
  input: StartModInstallInput,
): Promise<
  Outcome<{
    installation: Installation
    entry: ModCatalogEntryParsed
    version: string
    packages: CatalogPackage[]
    sources: PackageSource[]
    contentOnly: boolean
    variantId: string
    arch: ModInstallRecord['arch']
    platform: ModInstallRecord['platform']
  }>
> {
  const installation = deps.installations.find(input.installationId)
  if (!installation) return fail(INSTALLATION_NOT_FOUND)

  const snapshot = await deps.catalog.getCatalog()
  if (snapshot.status !== 'ok') return fail(UNKNOWN_MOD)
  const entry = snapshot.entries.find((e) => e.id === input.catalogId)
  if (!entry) return fail(UNKNOWN_MOD)
  const version = input.version ?? entry.pinned
  const versionEntry = entry.versions.find((v) => v.version === version)
  if (!versionEntry) return fail(UNKNOWN_MOD)
  // The same two rules `launch-plan.ts` and the catalog parser apply: a name `+set game` can carry.
  if (!isSafeGameDirName(entry.gamedir) || !isSafeEarlyToken(entry.gamedir))
    return fail(UNKNOWN_MOD)

  if (recordedGameDirs(installation.moduleData).has(entry.gamedir.toLowerCase())) {
    return fail(ALREADY_INSTALLED)
  }

  const variant = await resolveModVariant(deps, installation, versionEntry)
  if (!variant.ok) return variant
  return ok({ installation, entry, version, ...variant.value })
}

export interface ResolvedModVariant {
  packages: CatalogPackage[]
  sources: PackageSource[]
  contentOnly: boolean
  variantId: string
  arch: ModInstallRecord['arch']
  platform: ModInstallRecord['platform']
}

/** The package set for this installation's engine (platform + architecture), as the record names it. */
export async function resolveModVariant(
  deps: Pick<ModInstallDeps, 'enginePackages' | 'readArch'>,
  installation: Installation,
  versionEntry: CatalogVersion,
): Promise<Outcome<ResolvedModVariant>> {
  const target = await resolveEngineTarget(installation, await deps.enginePackages(), deps.readArch)
  const selection = selectVariant(versionEntry, target)
  if ('refused' in selection) return fail(selection.refused)

  const packages = selection.variant.packages
  const sources: PackageSource[] = []
  for (const pkg of packages) {
    const source = toSource(pkg)
    if (!source) return fail(BAD_PACKAGE)
    sources.push(source)
  }

  const variant = selection.variant
  const isLibrary = 'platform' in variant
  return ok({
    packages,
    sources,
    contentOnly: selection.contentOnly,
    variantId: isLibrary ? `${variant.platform}-${variant.arch}` : 'content-only',
    // A content-only package set carries no arch of its own; the engine's is recorded. An engine
    // whose arch could not be read is recorded as unknown, never guessed.
    arch: isLibrary
      ? variant.arch
      : target.arch === 'x86_64'
        ? 'x64'
        : target.arch === 'x86'
          ? 'x86'
          : 'unknown',
    platform: isLibrary ? variant.platform : target.platform,
  })
}

export type StagePackagesResult =
  | { ok: true; extractDirs: string[] }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; key: ModJobFailureKey; reason: string }

/** Stages every package in order; the first failure (or a cancel) ends it. Touches no installation. */
export async function stagePackages(args: {
  deps: Pick<ModInstallDeps, 'stage' | 'resolveExtractor' | 'userDataPath'>
  jobId: string
  sources: readonly PackageSource[]
  signal: AbortSignal
  onExtractor: (handle: ExtractorHandle) => void
  /** `ratio` of the whole download, 0..1. */
  onProgress: (bytesDone: number, bytesTotal: number) => void
}): Promise<StagePackagesResult> {
  const { deps, jobId, sources, signal } = args
  const bytesTotal = sources.reduce((sum, s) => sum + s.sizeBytes, 0)
  const extractDirs: string[] = []
  let bytesBefore = 0
  for (const [index, source] of sources.entries()) {
    if (signal.aborted) return { ok: false, cancelled: true }
    const staged = await deps.stage({
      source,
      jobId,
      index,
      userDataPath: deps.userDataPath,
      signal,
      resolveExtractor: deps.resolveExtractor,
      onExtractor: args.onExtractor,
      onProgress: (received) =>
        args.onProgress(bytesBefore + Math.min(received, source.sizeBytes), bytesTotal),
    })
    if (!staged.ok) {
      if (staged.cancelled || signal.aborted) return { ok: false, cancelled: true }
      return {
        ok: false,
        cancelled: false,
        key: staged.key,
        reason: `staging package ${index} (${source.fileName}) failed`,
      }
    }
    extractDirs.push(staged.extractDir)
    bytesBefore += source.sizeBytes
  }
  if (signal.aborted) return { ok: false, cancelled: true }
  return { ok: true, extractDirs }
}

/** Staged trees -> package-relative files per each package's `contents[]`; refuses links and escapes. */
export async function collectPackageFiles(
  packages: readonly CatalogPackage[],
  extractDirs: readonly string[],
): Promise<{ ok: true; files: { rel: string; abs: string }[] } | { ok: false; reason: string }> {
  const staged: { rel: string; abs: string }[] = []
  for (const [index, pkg] of packages.entries()) {
    const tree = extractDirs[index]!
    for (const content of pkg.contents) {
      if (!isSafeContentsFrom(content.from))
        return { ok: false, reason: `unsafe from ${content.from}` }
      const source = content.from === '.' ? tree : join(tree, content.from)
      if (pathKey(source) !== pathKey(tree) && !isStrictlyInside(source, tree)) {
        return { ok: false, reason: `${content.from} leaves the staged tree` }
      }
      let info
      try {
        info = await lstat(source)
      } catch {
        return { ok: false, reason: `${pkg.id} holds no ${content.from}` }
      }
      if (info.isFile()) {
        staged.push({ rel: basename(source), abs: source })
      } else if (info.isDirectory()) {
        const files = await collectFiles(source)
        if (files === null) return { ok: false, reason: `${pkg.id} holds a link or special file` }
        staged.push(...files)
      } else {
        return { ok: false, reason: `${pkg.id}'s ${content.from} is a link or special file` }
      }
    }
  }
  return { ok: true, files: staged }
}

export async function startModInstall(
  deps: ModInstallDeps,
  input: StartModInstallInput,
): Promise<Outcome<StartedModInstall>> {
  const checked = await preflight(deps, input)
  if (!checked.ok) {
    deps.log?.warn(`refusing to install ${input.catalogId}: ${checked.error.key}`)
    return checked
  }
  const plan = checked.value

  // The runner's admission check and `jobs.create` share one synchronous turn, so a concurrent
  // second install (or any other job on the installation) is refused there.
  return deps.runner.run<ModJobFailureKey, ModInstallSuccess>(
    {
      moduleId: 'mods',
      kind: MOD_INSTALL_JOB_KIND,
      labelKey: MOD_INSTALL_JOB_LABEL_KEY,
      labelParams: { name: plan.entry.name },
      installationId: plan.installation.id,
      exclusive: 'installation',
    },
    (ctx) => runInstall(deps, ctx, plan),
  )
}

/** A failure found inside the write; thrown so the body can end the job with its key. */
class InstallFailed extends Error {}

async function runInstall(
  deps: ModInstallDeps,
  ctx: JobContext<ModJobFailureKey, ModInstallSuccess>,
  plan: Extract<Awaited<ReturnType<typeof preflight>>, { ok: true }>['value'],
): Promise<ModInstallOutcome> {
  const { installation, entry, packages, sources } = plan
  const { jobId, signal } = ctx
  const log = deps.log
  const root = installation.rootPath

  const stagingDirs = sources.map((_, index) =>
    getExtractDir(deps.userDataPath, `${jobId}-${index}`),
  )
  const backupRoot = getExtractDir(deps.userDataPath, `${jobId}-backup`)
  /** Set when a restore could not put every backed-up file back: the backup is then the only copy. */
  let keepBackup = false
  const bytesTotal = sources.reduce((sum, s) => sum + s.sizeBytes, 0)

  try {
    ctx.report({ ratio: 0, bytesDone: 0, bytesTotal })

    // Stage every package before anything in the installation is touched.
    const stagedPackages = await stagePackages({
      deps,
      jobId,
      sources,
      signal,
      onExtractor: ctx.setExtractor,
      onProgress: (done) =>
        ctx.report({
          ratio: (done / Math.max(1, bytesTotal)) * STAGE_RATIO,
          bytesDone: done,
          bytesTotal,
        }),
    })
    if (!stagedPackages.ok) {
      if (stagedPackages.cancelled) return ctx.cancelled()
      return ctx.fail(stagedPackages.key, stagedPackages.reason)
    }
    ctx.report({ ratio: STAGE_RATIO, bytesDone: bytesTotal, bytesTotal })

    // Plan: staged trees -> gamedir-relative paths.
    const collected = await collectPackageFiles(packages, stagedPackages.extractDirs)
    if (!collected.ok) return ctx.fail(BAD_PACKAGE, collected.reason)
    const staged = collected.files

    const existingFolder = await findChild(root, entry.gamedir)
    if (existingFolder !== null && !(await isDirectory(existingFolder))) {
      return ctx.fail(WRITE_FAILED, `${existingFolder} exists and is not a folder`)
    }
    const gameDirPath = existingFolder ?? join(root, entry.gamedir)
    const folder = basename(gameDirPath)

    const planned: PlannedFile[] = []
    const seen = new Set<string>()
    for (const file of staged) {
      const rel = placedGameLibraryName(file.rel)
      const key = rel.toLowerCase()
      if (!isSafeRelative(rel) || seen.has(key))
        return ctx.fail(BAD_PACKAGE, `bad or duplicate ${rel}`)
      seen.add(key)
      if (!isStrictlyInside(join(gameDirPath, rel), gameDirPath)) {
        return ctx.fail(BAD_PACKAGE, `${rel} leaves the game directory`)
      }
      const hashed = await hashFile(file.abs)
      const existing = existingFolder ? await resolveRelaxed(gameDirPath, rel) : null
      let kind: PlannedFile['kind'] = 'new'
      if (existing !== null) {
        const current = (await isDirectory(existing)) ? null : await hashFile(existing)
        kind = current !== null && current.sha256 === hashed.sha256 ? 'identical' : 'conflict'
      }
      planned.push({ rel, abs: file.abs, ...hashed, existing, kind })
    }
    if (signal.aborted) return ctx.cancelled()
    ctx.report({ ratio: PLAN_RATIO, bytesDone: bytesTotal, bytesTotal })

    // A folder that exists without a record is the user's: always ask, naming it.
    let decision: ModInstallDecision = 'overwrite'
    if (existingFolder !== null) {
      const conflicts = planned
        .filter((p) => p.kind === 'conflict')
        .map((p) => relative(gameDirPath, p.existing!).split(sep).join('/'))
      deps.jobs.setWaiting(jobId, { key: MOD_INSTALL_WAITING_KEY, params: { folder } })
      const answer = await raceAbort(signal, () => deps.askDecision(jobId, { folder, conflicts }))
      if (answer === 'aborted' || answer === 'cancel' || signal.aborted) return ctx.cancelled()
      decision = answer
    }

    // Kept and identical files are never written and therefore never recorded.
    const toWrite = planned.filter(
      (p) => p.kind === 'new' || (p.kind === 'conflict' && decision === 'overwrite'),
    )

    let written: ModInstallFile[] = []
    let result: 'done' | 'cancelled'
    try {
      result = await ctx.write(installation.id, async () => {
        const wrote = await writeFiles({
          deps,
          installationId: installation.id,
          gameDirPath,
          toWrite,
          backupRoot,
          signal,
          record: (files) => ({
            catalogId: entry.id,
            gameDir: folder,
            version: plan.version,
            variantId: plan.variantId,
            engineKind: installation.engineKind,
            arch: plan.arch,
            platform: plan.platform,
            contentOnly: plan.contentOnly,
            ...(installation.engineKind === 'r1q2' &&
            files.some((f) => f.path.toLowerCase().endsWith('.pkz'))
              ? { pkzUnsupported: true }
              : {}),
            installedAt: Date.now(),
            files,
          }),
          onRestoreIncomplete: () => {
            keepBackup = true
          },
          log,
        })
        if (wrote.ok) written = wrote.files
        else if (!wrote.cancelled) throw new InstallFailed(wrote.reason)
      })
    } catch (error) {
      if (error instanceof InstallFailed) return ctx.fail(WRITE_FAILED, error.message)
      throw error
    }
    if (result === 'cancelled') return ctx.cancelled()

    const revalidated = await ctx.revalidate(installation.id)
    if (!revalidated.ok) {
      log?.warn(`revalidating ${installation.id} after installing ${entry.id} failed`)
    } else if (!revalidated.value.gameDirs.some((d) => d.toLowerCase() === folder.toLowerCase())) {
      log?.warn(`${folder} is installed but the inspector does not list it as a game directory`)
    }

    ctx.report({ ratio: 1, bytesDone: bytesTotal, bytesTotal, filesRemaining: 0 })
    log?.info(`installed ${entry.id} ${plan.version} into ${gameDirPath} (${written.length} files)`)
    return { status: 'succeeded', gameDir: folder, files: written }
  } finally {
    for (const dir of keepBackup ? stagingDirs : [...stagingDirs, backupRoot]) {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
        (error: unknown) => log?.warn(`could not remove ${dir}: ${String(error)}`),
      )
    }
  }
}

/** Resolves with the answer, or `'aborted'` as soon as the job is cancelled while it is pending. */
function raceAbort(
  signal: AbortSignal,
  ask: () => Promise<ModInstallDecision>,
): Promise<ModInstallDecision | 'aborted'> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve('aborted')
    const onAbort = (): void => resolve('aborted')
    signal.addEventListener('abort', onAbort, { once: true })
    ask().then(
      (answer) => {
        signal.removeEventListener('abort', onAbort)
        resolve(answer)
      },
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve('cancel')
      },
    )
  })
}

type WriteResult =
  { ok: true; files: ModInstallFile[] } | { ok: false; cancelled: boolean; reason: string }

/**
 * The only code that writes into the installation. Every exit that is not a success has restored
 * the folder: backed-up files copied back over their path, files and folders this run created
 * removed (folders only when empty - `rmdir`, never a recursive delete in the user's tree).
 */
async function writeFiles(args: {
  deps: ModInstallDeps
  installationId: string
  gameDirPath: string
  toWrite: PlannedFile[]
  backupRoot: string
  signal: AbortSignal
  record: (files: ModInstallFile[]) => ModInstallRecord
  onRestoreIncomplete: () => void
  log: JobLogHost | undefined
}): Promise<WriteResult> {
  const { deps, installationId, gameDirPath, toWrite, backupRoot, signal, log } = args
  const createdDirs: string[] = []
  const createdFiles: string[] = []
  const backups: { dest: string; backup: string }[] = []
  const parts = new Set<string>()
  const files: ModInstallFile[] = []

  const mkdirTracked = async (dir: string): Promise<void> => {
    const first = await mkdir(dir, { recursive: true })
    if (first === undefined) return
    for (let d = dir; d.length >= first.length; d = dirname(d)) {
      createdDirs.push(d)
      if (pathKey(d) === pathKey(first)) break
    }
  }

  const restore = async (): Promise<void> => {
    let unrestored = 0
    for (const part of parts) await rm(part, { force: true }).catch(() => {})
    for (const { dest, backup } of backups) {
      try {
        await copyFile(backup, dest)
      } catch (error) {
        unrestored += 1
        log?.warn(`restoring ${dest} from ${backup} failed: ${String(error)}`)
      }
    }
    for (const dest of createdFiles) {
      await rm(dest, { force: true, maxRetries: 3, retryDelay: 50 }).catch((error: unknown) =>
        log?.warn(`removing ${dest} failed: ${String(error)}`),
      )
    }
    for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) {
      await rmdir(dir).catch(() => {})
    }
    if (unrestored > 0) args.onRestoreIncomplete()
  }

  try {
    await mkdirTracked(gameDirPath)
    for (const [index, file] of toWrite.entries()) {
      if (signal.aborted) {
        await restore()
        return { ok: false, cancelled: true, reason: 'cancelled' }
      }
      const dest = file.existing ?? (await plannedDestination(gameDirPath, file.rel))
      if (!isStrictlyInside(dest, gameDirPath)) throw new Error(`${dest} leaves ${gameDirPath}`)
      await mkdirTracked(dirname(dest))
      // Planning saw the folder some time ago: whatever sits at `dest` right now is the user's
      // and is backed up (so a rollback puts it back), whether or not it was planned as one.
      let present = file.existing !== null
      if (!present) {
        try {
          const info = await lstat(dest)
          if (!info.isFile()) throw new Error(`${dest} appeared and is not a regular file`)
          present = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (present) {
        const backup = join(backupRoot, String(index))
        await mkdir(backupRoot, { recursive: true })
        await copyFile(dest, backup)
        backups.push({ dest, backup })
      }
      const part = `${dest}${PART_SUFFIX}`
      parts.add(part)
      await copyFile(file.abs, part)
      const written = await hashFile(part)
      if (written.sha256 !== file.sha256) throw new Error(`${part} does not match its staged bytes`)
      await rename(part, dest)
      parts.delete(part)
      if (!present) createdFiles.push(dest)
      files.push({
        path: relative(gameDirPath, dest).split(sep).join('/'),
        sizeBytes: written.sizeBytes,
        sha256: written.sha256,
      })
    }

    const current = deps.installations.find(installationId)
    if (!current) throw new Error(`${installationId} disappeared`)
    const next = withRecord(current.moduleData, args.record(files))
    const saved = deps.installations.setModuleData(installationId, 'mods', next['mods'])
    if (!saved.ok) throw new Error(`recording the install failed: ${saved.error.key}`)
    return { ok: true, files }
  } catch (error) {
    await restore()
    return { ok: false, cancelled: false, reason: String(error) }
  }
}
