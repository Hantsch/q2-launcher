import {
  REPLAYS_EVENTS,
  REPLAYS_HANDLERS,
  type DiscoveredDemo,
  type ExtraFoldersResult,
  type ReplaysExtraFolder,
  type ReplaysOverview,
  type ReplaysScanProgress,
  type ReplaysScanStartResult,
} from '@shared/modules/replays'
import type { NameTemplatesView } from '@shared/replays/name-templates'
import type { Outcome } from '@shared/types'
import { callModule, onModuleEvent } from '../moduleClient'

/** Typed client for the replays module's handlers (story 135 D3). One function per handler in its
 * contract - mirrors `modules/servers/client.ts`. */
export function getReplaysOverview(): Promise<Outcome<ReplaysOverview>> {
  return callModule<ReplaysOverview>('replays', REPLAYS_HANDLERS.overviewRead)
}

/**
 * Story 140 D3: the `nameTemplates.*` handlers' renderer-side transport. Every one of them is a
 * main handler that itself returns `Outcome<NameTemplatesView>` (its own refusal for an invalid
 * template, an unknown id, ...) - and the module registry (`MainModuleRegistry.invoke`) always
 * wraps a handler's return value in its own transport-level `ok(...)`, the same way it wraps
 * `servers.sources.*`'s `MasterSourcesResult`. So what actually crosses IPC is a **nested**
 * `Outcome<Outcome<NameTemplatesView>>`: the outer layer is transport (an unknown handler, a bad
 * payload, a thrown exception), the inner layer is this module's own domain refusal. Fixed post-140:
 * the original single-layer typing here let a real refusal's `entries` reach `SortableZone` as
 * `undefined` (a nested `{ ok, value }` has no `entries` of its own), crashing the whole Settings
 * view - `NameTemplatesList.tsx` unwraps both layers now, the same way
 * `ServersSettingsSection.tsx`'s `mutate()` does for `MasterSourcesResult`.
 */
export function listNameTemplates(): Promise<Outcome<Outcome<NameTemplatesView>>> {
  return callModule<Outcome<NameTemplatesView>>('replays', REPLAYS_HANDLERS.nameTemplatesList)
}

export function addNameTemplate(template: string): Promise<Outcome<Outcome<NameTemplatesView>>> {
  return callModule<Outcome<NameTemplatesView>>('replays', REPLAYS_HANDLERS.nameTemplatesAdd, {
    template,
  })
}

export function updateNameTemplate(
  id: string,
  template: string,
): Promise<Outcome<Outcome<NameTemplatesView>>> {
  return callModule<Outcome<NameTemplatesView>>('replays', REPLAYS_HANDLERS.nameTemplatesUpdate, {
    id,
    template,
  })
}

export function removeNameTemplate(id: string): Promise<Outcome<Outcome<NameTemplatesView>>> {
  return callModule<Outcome<NameTemplatesView>>('replays', REPLAYS_HANDLERS.nameTemplatesRemove, {
    id,
  })
}

export function reorderNameTemplates(ids: string[]): Promise<Outcome<Outcome<NameTemplatesView>>> {
  return callModule<Outcome<NameTemplatesView>>('replays', REPLAYS_HANDLERS.nameTemplatesReorder, {
    ids,
  })
}

export function resetNameTemplate(id: string): Promise<Outcome<Outcome<NameTemplatesView>>> {
  return callModule<Outcome<NameTemplatesView>>('replays', REPLAYS_HANDLERS.nameTemplatesReset, {
    id,
  })
}

export function restoreNameTemplates(): Promise<Outcome<Outcome<NameTemplatesView>>> {
  return callModule<Outcome<NameTemplatesView>>('replays', REPLAYS_HANDLERS.nameTemplatesRestore)
}

/** Story 141 D4: every discovered demo across every known installation - the `ReplaysView`'s list. */
export function listDemos(): Promise<Outcome<DiscoveredDemo[]>> {
  return callModule<DiscoveredDemo[]>('replays', REPLAYS_HANDLERS.demosList)
}

/**
 * Story 142 D4: the `extraFolders.*` handlers' renderer-side transport, mirroring
 * `servers/client.ts`'s `listMasterSources`/`addMasterSource`/`removeMasterSource` exactly -
 * `listExtraFolders` always succeeds and answers the list directly, `add`/`remove` resolve to an
 * `ExtraFoldersResult` (its own ok/refusal union) at the domain level, nested under `Outcome`'s own
 * transport-level ok/error.
 */
export function listExtraFolders(): Promise<Outcome<ReplaysExtraFolder[]>> {
  return callModule<ReplaysExtraFolder[]>('replays', REPLAYS_HANDLERS.extraFoldersList)
}

export function addExtraFolder(path: string): Promise<Outcome<ExtraFoldersResult>> {
  return callModule<ExtraFoldersResult>('replays', REPLAYS_HANDLERS.extraFoldersAdd, { path })
}

export function removeExtraFolder(id: string): Promise<Outcome<ExtraFoldersResult>> {
  return callModule<ExtraFoldersResult>('replays', REPLAYS_HANDLERS.extraFoldersRemove, { id })
}

/**
 * Story 144 D4: the index scan's renderer-side transport, mirroring `servers/client.ts`'s
 * `startScan`/`readScan`/`onScanChanged` triad. `scanStart` kicks off a background scan
 * (single-flight - `started: false` means one was already running); `indexRead` is a one-shot
 * catch-up read of the current index (cached rows before this process's first scan finishes, the
 * last successful scan's rows after); `onScanProgress` subscribes to the scan's own push.
 */
export function scanStart(): Promise<Outcome<ReplaysScanStartResult>> {
  return callModule<ReplaysScanStartResult>('replays', REPLAYS_HANDLERS.scanStart)
}

export function indexRead(): Promise<Outcome<DiscoveredDemo[]>> {
  return callModule<DiscoveredDemo[]>('replays', REPLAYS_HANDLERS.indexRead)
}

export function onScanProgress(listener: (payload: ReplaysScanProgress) => void): () => void {
  return onModuleEvent<ReplaysScanProgress>('replays', REPLAYS_EVENTS.scanProgress, listener)
}
