import type { ModCatalogEntry, ModInstallRecord } from '@shared/modules/mods'

/**
 * The update-check half of a mod's status - pure comparison, no I/O. Mirrors
 * `computeEngineUpdateStatus` (`downloads/engine/update-status.ts`).
 *
 * - An update exists only for a catalog install (a record with a catalog id) whose catalog entry has a
 *   pinned version that differs from the recorded one. *Any* difference counts, so a pin that moved
 *   back to a lower version (a rollback) is an update too.
 * - A record with no installed version counts as "differs".
 * - No record, or a record without a catalog id (a manual game dir), never has an update.
 */
export interface ModUpdateStatus {
  updateAvailable: boolean
  installedVersion?: string
  pinnedVersion?: string
}

type StatusRecord = Partial<Pick<ModInstallRecord, 'catalogId' | 'version'>>

export function computeModUpdateStatus(
  record: StatusRecord | undefined,
  entry: Pick<ModCatalogEntry, 'pinned'> | undefined,
): ModUpdateStatus {
  const installedVersion = record?.version || undefined
  const pinnedVersion = entry?.pinned || undefined
  const isCatalogInstall = !!record && !!record.catalogId
  const updateAvailable =
    isCatalogInstall &&
    pinnedVersion !== undefined &&
    (installedVersion === undefined || installedVersion !== pinnedVersion)
  return {
    updateAvailable,
    ...(installedVersion !== undefined ? { installedVersion } : {}),
    ...(pinnedVersion !== undefined ? { pinnedVersion } : {}),
  }
}
