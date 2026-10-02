import {
  REPLAYS_EVENTS,
  REPLAYS_HANDLERS,
  type DemoFileActionResult,
  type DemoRow,
  type DiscoveredDemo,
  type ExtraFoldersResult,
  type ReplaysDemoPlayResult,
  type ReplaysModWarning,
  type ReplaysStageRect,
  type ReplaysExtraFolder,
  type ReplaysOverview,
  type ReplaysPlaybackPosition,
  type ReplaysPlaybackDisplay,
  type ReplaysPlaybackState,
  type ReplaysScanProgress,
  type ReplaysScanStartResult,
  type SidecarSaveResult,
  type SidecarState,
} from '@shared/modules/replays'
import type { NameTemplatesView } from '@shared/replays/name-templates'
import type { SidecarFields } from '@shared/replays/sidecar'
import type { DemoListSort } from '@shared/replays/list-sort'
import type { DemoListFilter } from '@shared/replays/list-filter'
import type { TimelineAction } from '@shared/replays/timeline'
import type { Outcome } from '@shared/types'
import { callModule, onModuleEvent } from '../moduleClient'

/** Typed client for the replays module's handlers (story 135 D3). One function per handler in its
 * contract - mirrors `modules/servers/client.ts`. */
export function getReplaysOverview(): Promise<Outcome<ReplaysOverview>> {
  return callModule<ReplaysOverview>('replays', REPLAYS_HANDLERS.overviewRead)
}

/** The `nameTemplates.*` handlers answer their own `Outcome<NameTemplatesView>` (a refusal for an
 * invalid template, an unknown id, ...); the registry passes it through, so one envelope arrives. */
export function listNameTemplates(): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesList)
}

export function addNameTemplate(template: string): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesAdd, {
    template,
  })
}

export function updateNameTemplate(
  id: string,
  template: string,
): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesUpdate, {
    id,
    template,
  })
}

export function removeNameTemplate(id: string): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesRemove, {
    id,
  })
}

export function reorderNameTemplates(ids: string[]): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesReorder, {
    ids,
  })
}

export function resetNameTemplate(id: string): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesReset, {
    id,
  })
}

export function restoreNameTemplates(): Promise<Outcome<NameTemplatesView>> {
  return callModule<NameTemplatesView>('replays', REPLAYS_HANDLERS.nameTemplatesRestore)
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
 * Story 156 D2: the `demos.reveal`/`demos.copyPath` handlers' renderer-side transport - a demo id
 * in, a `DemoFileActionResult` out (never a path either way, per CLAUDE.md's "paths from the
 * renderer are never trusted"), mirroring `addExtraFolder`/`removeExtraFolder` above exactly.
 */
export function revealDemo(demoId: string): Promise<Outcome<DemoFileActionResult>> {
  return callModule<DemoFileActionResult>('replays', REPLAYS_HANDLERS.demosReveal, { demoId })
}

/** `demo.play` - plays one demo in the active Q2PRO installation; refusals arrive as the handler's
 * own `fail` keys. */
export function playDemo(payload: {
  demoId: string
  installationId: string
  acknowledgeModMissing?: boolean
  stage?: ReplaysStageRect
}): Promise<Outcome<ReplaysDemoPlayResult>> {
  return callModule<ReplaysDemoPlayResult>('replays', REPLAYS_HANDLERS.demoPlay, payload)
}

/** Story 170 D5: re-places the running demo's window after the stage picture's box changed. */
export function sendStageRect(rect: ReplaysStageRect | null): Promise<Outcome<void>> {
  return callModule<void>('replays', REPLAYS_HANDLERS.playbackStage, { rect })
}

/** Steers the running demo; the typed no-session error arrives as a `fail`. */
export function playbackTimeline(action: TimelineAction): Promise<Outcome<void>> {
  return callModule<void>('replays', REPLAYS_HANDLERS.playbackTimeline, action)
}

/** Enters or leaves cinema mode. */
export function playbackCinema(enter: boolean): Promise<Outcome<void>> {
  return callModule<void>('replays', REPLAYS_HANDLERS.playbackCinema, { enter })
}

/** Story 187 D6: the current display state, read once when a session begins. */
export function playbackDisplayRead(): Promise<Outcome<ReplaysPlaybackDisplay>> {
  return callModule<ReplaysPlaybackDisplay>('replays', REPLAYS_HANDLERS.playbackDisplayRead, {})
}

/** Story 164 D4 events, mirroring `onScanProgress`. */
export function onPlaybackPosition(
  listener: (payload: ReplaysPlaybackPosition) => void,
): () => void {
  return onModuleEvent<ReplaysPlaybackPosition>(
    'replays',
    REPLAYS_EVENTS.playbackPosition,
    listener,
  )
}

export function onPlaybackState(listener: (payload: ReplaysPlaybackState) => void): () => void {
  return onModuleEvent<ReplaysPlaybackState>('replays', REPLAYS_EVENTS.playbackState, listener)
}

export function onPlaybackDisplay(listener: (payload: ReplaysPlaybackDisplay) => void): () => void {
  return onModuleEvent<ReplaysPlaybackDisplay>('replays', REPLAYS_EVENTS.playbackDisplay, listener)
}

export function copyDemoPath(demoId: string): Promise<Outcome<DemoFileActionResult>> {
  return callModule<DemoFileActionResult>('replays', REPLAYS_HANDLERS.demosCopyPath, { demoId })
}

/** The `demos.rename` handler: a demo id and the user's typed stem in, the freshly discovered demo out. */
export function renameDemo(id: string, name: string): Promise<Outcome<{ demo: DiscoveredDemo }>> {
  return callModule<{ demo: DiscoveredDemo }>('replays', REPLAYS_HANDLERS.demoRename, { id, name })
}

/** Sends one console line to the running demo's engine; a refusal is `replays.console.error.*`. */
export function consoleSend(line: string): Promise<Outcome<void>> {
  return callModule<void>('replays', REPLAYS_HANDLERS.playbackConsoleSend, { line })
}

/** Ends the running demo (quit, then terminate - main owns the timeout); no running launch is
 * `replays.playback.error.noSession`. */
export function playbackStop(): Promise<Outcome<void>> {
  return callModule<void>('replays', REPLAYS_HANDLERS.playbackStop, undefined)
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

export function indexRead(): Promise<Outcome<DemoRow[]>> {
  return callModule<DemoRow[]>('replays', REPLAYS_HANDLERS.indexRead)
}

export function onScanProgress(listener: (payload: ReplaysScanProgress) => void): () => void {
  return onModuleEvent<ReplaysScanProgress>('replays', REPLAYS_EVENTS.scanProgress, listener)
}

/**
 * Story 152 D3: the persisted list-sort's renderer-side transport, mirroring `servers/client.ts`'s
 * `getListSort`/`setListSort` exactly. `getListSort` resolves to the current `DemoListSort | null`
 * (`null` meaning the default favourites-first order); `setListSort` persists a new one (or clears
 * it back to the default with `null`) and resolves to what was actually persisted.
 */
export function getListSort(): Promise<Outcome<DemoListSort | null>> {
  return callModule<DemoListSort | null>('replays', REPLAYS_HANDLERS.listGetSort)
}

export function setListSort(sort: DemoListSort | null): Promise<Outcome<DemoListSort | null>> {
  return callModule<DemoListSort | null>('replays', REPLAYS_HANDLERS.listSetSort, { sort })
}

/**
 * Story 153 D5: the persisted list-filter's renderer-side transport, mirroring `getListSort`/
 * `setListSort` right above exactly. `getListFilter` resolves to the current `DemoListFilter`
 * (`EMPTY_DEMO_LIST_FILTER` when nothing stored); `setListFilter` persists a full-replacement
 * filter and resolves to what was actually persisted.
 */
/**
 * Story 155 D1: the sidecar's renderer-side transport for a single demo, mirroring `indexRead`'s
 * `callModule` pattern exactly. `sidecarRead` resolves to the current on-disk state (`'none'`/
 * `'ok'`/`'error'` with itemized `issues`) plus whatever fields it could parse - this is the only
 * place the detail panel can see specific sidecar issues, since `DemoRow.sidecar.state` (from
 * `index.read`) drops them. `sidecarWrite` is unused by this read-only deliverable but added
 * alongside it so the pair mirrors the shared contract 1:1.
 */
export function sidecarRead(
  demoId: string,
): Promise<Outcome<{ state: SidecarState; values: Partial<SidecarFields> }>> {
  return callModule<{ state: SidecarState; values: Partial<SidecarFields> }>(
    'replays',
    REPLAYS_HANDLERS.sidecarRead,
    { demoId },
  )
}

export function sidecarWrite(
  demoId: string,
  fields: Partial<SidecarFields>,
  confirmReplace?: string,
): Promise<Outcome<SidecarSaveResult>> {
  return callModule<SidecarSaveResult>('replays', REPLAYS_HANDLERS.sidecarWrite, {
    demoId,
    fields,
    confirmReplace,
  })
}

export function getListFilter(): Promise<Outcome<DemoListFilter>> {
  return callModule<DemoListFilter>('replays', REPLAYS_HANDLERS.listGetFilter)
}

export function setListFilter(filter: DemoListFilter): Promise<Outcome<DemoListFilter>> {
  return callModule<DemoListFilter>('replays', REPLAYS_HANDLERS.listSetFilter, { filter })
}

export function readModWarning(): Promise<Outcome<ReplaysModWarning>> {
  return callModule<ReplaysModWarning>('replays', REPLAYS_HANDLERS.modWarningRead)
}

export function setModWarningEnabled(enabled: boolean): Promise<Outcome<ReplaysModWarning>> {
  return callModule<ReplaysModWarning>('replays', REPLAYS_HANDLERS.modWarningSetEnabled, {
    enabled,
  })
}

export function trustModWarningMod(gameDir: string): Promise<Outcome<ReplaysModWarning>> {
  return callModule<ReplaysModWarning>('replays', REPLAYS_HANDLERS.modWarningTrustMod, { gameDir })
}

export function resetModWarningTrusted(): Promise<Outcome<ReplaysModWarning>> {
  return callModule<ReplaysModWarning>('replays', REPLAYS_HANDLERS.modWarningResetTrusted)
}
