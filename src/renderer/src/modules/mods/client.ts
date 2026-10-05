import {
  MODS_EVENTS,
  MODS_HANDLERS,
  type ModsContract,
  type ModCatalogState,
  type ModInstallChoice,
  type ModInstallDecisionEvent,
  type ModMapPresence,
  type ModRemovalPreview,
  type ModRemoveChangedFiles,
  type ModUpdateChangedPolicy,
  type ModUpdatePreview,
  type ModsListResult,
} from '@shared/modules/mods'
import type { Outcome } from '@shared/types'
import { createModuleClient } from '../moduleClient'

const client = createModuleClient<ModsContract>('mods')

/** Typed client for the mods module. One function per handler in its contract. */
export function listMods(installationId: string): Promise<Outcome<ModsListResult>> {
  return client.call(MODS_HANDLERS.list, { installationId })
}

export function revealMod(installationId: string, gameDir: string): Promise<Outcome<null>> {
  return client.call(MODS_HANDLERS.reveal, { installationId, gameDir })
}

/** Whether a map file is on disk for a server's map: `gameDir` narrows the lookup to that mod's
 * folder (plus baseq2); without it only baseq2 is searched. */
export function getMapPresence(input: {
  installationId: string
  gameDir?: string
  map: string
}): Promise<Outcome<ModMapPresence>> {
  return client.call(MODS_HANDLERS.mapPresence, input)
}

export function getCatalog(): Promise<Outcome<ModCatalogState>> {
  return client.call(MODS_HANDLERS.catalogGet, {})
}

export function installMod(
  installationId: string,
  catalogId: string,
  version?: string,
): Promise<Outcome<{ jobId: string }>> {
  return client.call(MODS_HANDLERS.install, {
    installationId,
    catalogId,
    ...(version !== undefined ? { version } : {}),
  })
}

export function resolveInstall(jobId: string, choice: ModInstallChoice): Promise<Outcome<null>> {
  return client.call(MODS_HANDLERS.resolveInstall, { jobId, choice })
}

export function onInstallDecision(listener: (event: ModInstallDecisionEvent) => void): () => void {
  return client.on(MODS_EVENTS.installDecision, listener)
}

export function previewRemoval(
  installationId: string,
  modId: string,
): Promise<Outcome<ModRemovalPreview>> {
  return client.call(MODS_HANDLERS.removalPreview, {
    installationId,
    modId,
  })
}

export function removeMod(
  installationId: string,
  modId: string,
  changedFiles: ModRemoveChangedFiles,
): Promise<Outcome<{ jobId: string }>> {
  return client.call(MODS_HANDLERS.remove, {
    installationId,
    modId,
    changedFiles,
  })
}

export function previewUpdate(
  installationId: string,
  catalogId: string,
): Promise<Outcome<ModUpdatePreview>> {
  return client.call(MODS_HANDLERS.updatePreview, {
    installationId,
    catalogId,
  })
}

export function updateMod(
  installationId: string,
  catalogId: string,
  changedPolicy: ModUpdateChangedPolicy,
): Promise<Outcome<{ jobId: string }>> {
  return client.call(MODS_HANDLERS.update, {
    installationId,
    catalogId,
    changedPolicy,
  })
}
