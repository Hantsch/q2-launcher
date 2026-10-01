import type { ModInstallRecord, ModRemovalPreview, ModRemoveChangedFiles } from '@shared/modules/mods'
import {
  fail,
  isJobActive,
  ok,
  type Installation,
  type Job,
  type JobProgress,
  type Outcome,
} from '@shared/types'
import type { CreateJobInput } from '../../services/jobs'
import { isWriteCancelled } from '../../services/write-guard'
import { readModsState } from './install-records'
import { planRemoval, removeRecordedFiles, RemovalRefusedError } from './remove'

/**
 * Story 191 D2: remove one mod the launcher installed. Mirrors `downloads/engine/rollback-job.ts`:
 * every refusal happens before `jobs.create`, deletion happens only inside `writeGuard.runWrite`,
 * and the installation is revalidated outside it. Works from the install record alone - the
 * catalog is never consulted, so a mod that left the catalog can still be removed.
 */

export const MOD_REMOVE_JOB_KIND = 'mods-remove'
export const MOD_REMOVE_JOB_LABEL_KEY = 'mods.job.remove'
export const MOD_REMOVE_FELL_BACK_KEY = 'mods.remove.fellBackToBase'

const INSTALLATION_NOT_FOUND = 'installations.error.notFound'
const NO_RECORD = 'mods.remove.refused.noRecord'
const BUSY = 'mods.remove.refused.busy'
const LOCKED = 'mods.remove.failed.locked'
const LOCAL_FAILURE = 'downloads.error.diskWrite'

/**
 * An install (story 190) or update (story 194) running for the installation makes it busy: the
 * removal works from the record it read at the start, which either of them may replace.
 */
const BUSY_KINDS = new Set(['mod-install', 'mod-update'])

export type ModRemoveOutcome =
  | { status: 'succeeded' }
  | { status: 'failed'; key: string }
  | { status: 'cancelled' }

export interface StartedModRemove {
  jobId: string
  /** Resolves once the job is terminal. Never rejects. */
  settled: Promise<ModRemoveOutcome>
}

export interface ModRemoveJobsHost {
  create(input: CreateJobInput): Job
  progress(id: string, progress: JobProgress): void
  finish(
    id: string,
    outcome: { status: 'succeeded' | 'failed' | 'cancelled'; error?: Job['error'] },
  ): void
  list(): Job[]
}

export interface ModRemoveInstallationsHost {
  find(id: string): Installation | undefined
  validate(id: string): Promise<Outcome<Installation>>
  setModuleData(id: string, moduleId: string, value: unknown): Outcome<Installation>
}

export interface ModRemoveWriteGuardHost {
  runWrite(
    installationId: string,
    jobId: string,
    signal: AbortSignal,
    fn: () => Promise<void>,
  ): Promise<void>
}

export interface ModRemoveDeps {
  jobs: ModRemoveJobsHost
  installations: ModRemoveInstallationsHost
  /** Required: a wiring without it would delete files of a running game. */
  writeGuard: ModRemoveWriteGuardHost
  broadcast: {
    toast(level: 'info', messageKey: string, params?: Record<string, string | number>): void
  }
  log?: { info(message: string): void; warn(message: string): void }
}

export interface ModRemoveRequest {
  installationId: string
  modId: string
}

/** Removals in flight, keyed `installationId|modId` - the job list alone cannot tell two mods apart. */
const inFlight = new Set<string>()
const flightKey = (installationId: string, modId: string): string => `${installationId}|${modId}`

interface Resolved {
  installation: Installation
  record: ModInstallRecord
}

function resolveRequest(deps: ModRemoveDeps, request: ModRemoveRequest): Outcome<Resolved> {
  const installation = deps.installations.find(request.installationId)
  if (!installation) return fail(INSTALLATION_NOT_FOUND)
  const record = readModsState(installation.moduleData).records.find(
    (r) => r.catalogId === request.modId,
  )
  if (!record) return fail(NO_RECORD)
  const installing = deps.jobs
    .list()
    .some(
      (j) =>
        j.moduleId === 'mods' &&
        BUSY_KINDS.has(j.kind) &&
        j.installationId === installation.id &&
        isJobActive(j),
    )
  if (installing || inFlight.has(flightKey(installation.id, record.catalogId))) return fail(BUSY)
  return ok({ installation, record })
}

/** What removing would touch; the same validation as the start, and never deletes. */
export async function previewModRemoval(
  deps: ModRemoveDeps,
  request: ModRemoveRequest,
): Promise<Outcome<ModRemovalPreview>> {
  const resolved = resolveRequest(deps, request)
  if (!resolved.ok) return resolved
  const { installation, record } = resolved.value
  try {
    const plan = await planRemoval(installation.rootPath, record.gameDir, record)
    return ok({
      installationName: installation.name,
      modName: record.catalogId,
      gameDir: record.gameDir,
      changedFiles: plan.changed,
    })
  } catch (error) {
    if (error instanceof RemovalRefusedError) {
      deps.log?.warn(`refusing to preview the removal of ${record.catalogId}: ${error.detail}`)
      return fail(error.reason)
    }
    deps.log?.warn(`previewing the removal of ${record.catalogId} threw: ${String(error)}`)
    return fail(LOCAL_FAILURE)
  }
}

/** Starts the removal and answers as soon as the job exists. */
export function startModRemove(
  deps: ModRemoveDeps,
  input: ModRemoveRequest & { changedFiles: ModRemoveChangedFiles },
): Outcome<StartedModRemove> {
  const resolved = resolveRequest(deps, input)
  if (!resolved.ok) return resolved
  const { installation, record } = resolved.value
  const key = flightKey(installation.id, record.catalogId)

  const cancellation = new AbortController()
  inFlight.add(key)
  let job: Job
  try {
    job = deps.jobs.create({
      moduleId: 'mods',
      kind: MOD_REMOVE_JOB_KIND,
      labelKey: MOD_REMOVE_JOB_LABEL_KEY,
      labelParams: { mod: record.catalogId, installation: installation.name },
      installationId: installation.id,
      cancellable: true,
      onCancel: () => cancellation.abort(),
    })
  } catch (error) {
    inFlight.delete(key)
    throw error
  }

  const settled = (async (): Promise<ModRemoveOutcome> => {
    try {
      return await run(deps, job, installation, record, input.changedFiles, cancellation.signal)
    } catch (error) {
      deps.log?.warn(`removing ${record.catalogId} threw: ${String(error)}`)
      deps.jobs.finish(job.id, { status: 'failed', error: { key: LOCAL_FAILURE } })
      return { status: 'failed', key: LOCAL_FAILURE }
    } finally {
      inFlight.delete(key)
    }
  })()
  return ok({ jobId: job.id, settled })
}

async function run(
  deps: ModRemoveDeps,
  job: Job,
  installation: Installation,
  record: ModInstallRecord,
  changedFiles: ModRemoveChangedFiles,
  signal: AbortSignal,
): Promise<ModRemoveOutcome> {
  const jobId = job.id
  const failed = (
    errorKey: string,
    reason: string,
    params?: Record<string, string | number>,
  ): ModRemoveOutcome => {
    deps.log?.warn(`removing ${record.catalogId} failed with ${errorKey}: ${reason}`)
    deps.jobs.finish(jobId, {
      status: 'failed',
      error: { key: errorKey, ...(params ? { params } : {}) },
    })
    return { status: 'failed', key: errorKey }
  }

  if (!signal.aborted) deps.jobs.progress(jobId, { ratio: 0 })

  // Read inside the guard: the game this waited behind may have changed the active game dir.
  let activeGameDir = ''
  const phase: ModRemoveOutcome[] = []
  try {
    await deps.writeGuard.runWrite(installation.id, jobId, signal, async () => {
      const current = deps.installations.find(installation.id) ?? installation
      activeGameDir = current.activeGameDir ?? ''
      let result
      try {
        result = await removeRecordedFiles(current.rootPath, record.gameDir, record, {
          changedFiles,
        })
      } catch (error) {
        if (error instanceof RemovalRefusedError) {
          phase.push(failed(error.reason, error.detail))
          return
        }
        throw error
      }
      const stillThere = new Set([...result.failed.map((f) => f.path), ...result.kept])
      const others = readModsState(current.moduleData).records.filter(
        (r) => r.catalogId !== record.catalogId,
      )
      const partial = result.failed.length > 0
      const records = partial
        ? [...others, { ...record, files: record.files.filter((f) => stillThere.has(f.path)) }]
        : others
      const written = deps.installations.setModuleData(installation.id, 'mods', { records })
      if (!written.ok) {
        phase.push(failed(LOCAL_FAILURE, `recording the removal failed: ${written.error.key}`))
        return
      }
      if (partial) {
        const first = result.failed[0]
        phase.push(failed(LOCKED, `${first.path}: ${first.code}`, { path: first.path }))
      }
    })
  } catch (error) {
    if (isWriteCancelled(error) || signal.aborted) return { status: 'cancelled' }
    throw error
  }

  // Files may be gone even after a partial failure: the inspector re-derives the game dirs.
  const revalidated = await deps.installations.validate(installation.id)
  if (phase.length > 0) return phase[0]
  if (!revalidated.ok) return failed(LOCAL_FAILURE, `revalidating failed: ${revalidated.error.key}`)

  if (
    activeGameDir !== '' &&
    activeGameDir.toLowerCase() === record.gameDir.toLowerCase() &&
    (revalidated.value.activeGameDir ?? '') === ''
  ) {
    deps.broadcast.toast('info', MOD_REMOVE_FELL_BACK_KEY, {
      installation: installation.name,
      gameDir: record.gameDir,
    })
  }

  deps.jobs.progress(jobId, { ratio: 1 })
  deps.jobs.finish(jobId, { status: 'succeeded' })
  deps.log?.info(`removed ${record.catalogId} from ${installation.name} (job ${jobId})`)
  return { status: 'succeeded' }
}
