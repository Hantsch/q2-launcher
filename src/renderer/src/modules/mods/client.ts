import {
  MODS_EVENTS,
  MODS_HANDLERS,
  type ModCatalogState,
  type ModInstallChoice,
  type ModInstallDecisionEvent,
  type ModRemovalPreview,
  type ModRemoveChangedFiles,
  type ModsListResult,
} from '@shared/modules/mods'
import type { Outcome } from '@shared/types'
import { callModule, onModuleEvent } from '../moduleClient'

/**
 * Typed client for the mods module. One function per handler in its contract.
 *
 * The module handlers return their own `Outcome`, which `module:invoke` wraps in another one -
 * flattened here so callers see a single `Outcome<T>`.
 */
async function call<T>(type: string, payload: unknown): Promise<Outcome<T>> {
  const outer = await callModule<Outcome<T>>('mods', type, payload)
  return outer.ok ? outer.value : outer
}

export function listMods(installationId: string): Promise<Outcome<ModsListResult>> {
  return call<ModsListResult>(MODS_HANDLERS.list, { installationId })
}

export function revealMod(installationId: string, gameDir: string): Promise<Outcome<null>> {
  return call<null>(MODS_HANDLERS.reveal, { installationId, gameDir })
}

export function getCatalog(): Promise<Outcome<ModCatalogState>> {
  return call<ModCatalogState>(MODS_HANDLERS.catalogGet, {})
}

export function installMod(
  installationId: string,
  catalogId: string,
  version?: string,
): Promise<Outcome<{ jobId: string }>> {
  return call<{ jobId: string }>(MODS_HANDLERS.install, {
    installationId,
    catalogId,
    ...(version !== undefined ? { version } : {}),
  })
}

export function resolveInstall(jobId: string, choice: ModInstallChoice): Promise<Outcome<null>> {
  return call<null>(MODS_HANDLERS.resolveInstall, { jobId, choice })
}

export function onInstallDecision(listener: (event: ModInstallDecisionEvent) => void): () => void {
  return onModuleEvent<ModInstallDecisionEvent>('mods', MODS_EVENTS.installDecision, listener)
}

export function previewRemoval(
  installationId: string,
  modId: string,
): Promise<Outcome<ModRemovalPreview>> {
  return call<ModRemovalPreview>(MODS_HANDLERS.removalPreview, { installationId, modId })
}

export function removeMod(
  installationId: string,
  modId: string,
  changedFiles: ModRemoveChangedFiles,
): Promise<Outcome<{ jobId: string }>> {
  return call<{ jobId: string }>(MODS_HANDLERS.remove, { installationId, modId, changedFiles })
}
