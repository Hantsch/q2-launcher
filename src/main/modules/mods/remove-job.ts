import type {
  ModInstallRecord,
  ModRemovalPreview,
  ModRemoveChangedFiles,
  ModsErrorKey,
} from '@shared/modules/mods'
import { fail, ok, type Installation, type Outcome } from '@shared/types'
import {
  JOB_INSTALLATION_BUSY,
  JOB_LOCAL_FAILURE,
  type InstallationsHost,
  type JobContext,
  type JobLocalFailureKey,
  type JobLogHost,
  type JobOutcome,
  type JobRunnerHost,
  type StartedJob,
  type ToastHost,
} from '../ports'
import { readModsState } from './install-records'
import { planRemoval, removeRecordedFiles, RemovalRefusedError } from './remove'

/**
 * Story 191 D2: remove one mod the launcher installed. Mirrors `downloads/engine/rollback-job.ts`:
 * every refusal happens before the job exists, deletion happens only inside the runner's write
 * guard, and the installation is revalidated outside it. Works from the install record alone - the
 * catalog is never consulted, so a mod that left the catalog can still be removed.
 */

export const MOD_REMOVE_JOB_KIND = 'mods-remove'
export const MOD_REMOVE_JOB_LABEL_KEY = 'mods.job.remove'
export const MOD_REMOVE_FELL_BACK_KEY = 'mods.remove.fellBackToBase'

const INSTALLATION_NOT_FOUND = 'installations.error.notFound'
const NO_RECORD = 'mods.remove.refused.noRecord'
const LOCKED = 'mods.remove.failed.locked'

/** A removal fails with a mods key, the locked-file key, or a refusal reason from the removal planner. */
type ModRemoveFailureKey =
  | ModsErrorKey
  | typeof LOCKED
  | RemovalRefusedError['reason']
  | JobLocalFailureKey

export type ModRemoveOutcome = JobOutcome<ModRemoveFailureKey>

export type StartedModRemove = StartedJob<ModRemoveFailureKey, Record<never, never>>

export interface ModRemoveDeps {
  runner: JobRunnerHost
  installations: InstallationsHost
  broadcast: ToastHost
  log?: JobLogHost
}

export interface ModRemoveRequest {
  installationId: string
  modId: string
}

interface Resolved {
  installation: Installation
  record: ModInstallRecord
}

/**
 * Any job targeting the installation makes it busy - an install (story 190) or update (story 194)
 * may replace the record this removal works from, and a second removal would race its deletes.
 */
function resolveRequest(deps: ModRemoveDeps, request: ModRemoveRequest): Outcome<Resolved> {
  const installation = deps.installations.find(request.installationId)
  if (!installation) return fail(INSTALLATION_NOT_FOUND)
  const record = readModsState(installation.moduleData).records.find(
    (r) => r.catalogId === request.modId,
  )
  if (!record) return fail(NO_RECORD)
  if (deps.runner.isInstallationBusy(installation.id)) return fail(JOB_INSTALLATION_BUSY)
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
    return fail(JOB_LOCAL_FAILURE)
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

  return deps.runner.run<ModRemoveFailureKey>(
    {
      moduleId: 'mods',
      kind: MOD_REMOVE_JOB_KIND,
      labelKey: MOD_REMOVE_JOB_LABEL_KEY,
      labelParams: { mod: record.catalogId, installation: installation.name },
      installationId: installation.id,
      exclusive: 'installation',
    },
    (ctx) => run(deps, ctx, installation, record, input.changedFiles),
  )
}

/** A failure found inside the write; thrown so the body can end the job with its key. */
class RemoveFailed extends Error {
  constructor(
    readonly key: ModRemoveFailureKey,
    reason: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(reason)
  }
}

async function run(
  deps: ModRemoveDeps,
  ctx: JobContext<ModRemoveFailureKey>,
  installation: Installation,
  record: ModInstallRecord,
  changedFiles: ModRemoveChangedFiles,
): Promise<ModRemoveOutcome> {
  ctx.report({ ratio: 0 })

  // Read inside the guard: the game this waited behind may have changed the active game dir.
  let activeGameDir = ''
  let written: 'done' | 'cancelled'
  try {
    written = await ctx.write(installation.id, async () => {
      const current = deps.installations.find(installation.id) ?? installation
      activeGameDir = current.activeGameDir ?? ''
      const result = await removeRecordedFiles(current.rootPath, record.gameDir, record, {
        changedFiles,
      })
      const stillThere = new Set([...result.failed.map((f) => f.path), ...result.kept])
      const others = readModsState(current.moduleData).records.filter(
        (r) => r.catalogId !== record.catalogId,
      )
      const partial = result.failed.length > 0
      const records = partial
        ? [...others, { ...record, files: record.files.filter((f) => stillThere.has(f.path)) }]
        : others
      const recorded = deps.installations.setModuleData(installation.id, 'mods', { records })
      if (!recorded.ok) {
        throw new RemoveFailed(
          JOB_LOCAL_FAILURE,
          `recording the removal failed: ${recorded.error.key}`,
        )
      }
      if (partial) {
        const first = result.failed[0]
        throw new RemoveFailed(LOCKED, `${first.path}: ${first.code}`, { path: first.path })
      }
    })
  } catch (error) {
    if (error instanceof RemovalRefusedError) return ctx.fail(error.reason, error.detail)
    if (error instanceof RemoveFailed) return ctx.fail(error.key, error.message, error.params)
    throw error
  }
  if (written === 'cancelled') return ctx.cancelled()

  // Files may be gone even after a partial failure: the inspector re-derives the game dirs.
  const revalidated = await ctx.revalidate(installation.id)
  if (!revalidated.ok) {
    return ctx.fail(JOB_LOCAL_FAILURE, `revalidating failed: ${revalidated.error.key}`)
  }

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

  ctx.report({ ratio: 1 })
  deps.log?.info(`removed ${record.catalogId} from ${installation.name} (job ${ctx.jobId})`)
  return { status: 'succeeded' }
}
