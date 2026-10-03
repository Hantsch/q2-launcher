import {
  CONFIG_HANDLERS,
  type AssignProfileInput,
  type CleanupApplyInput,
  type CleanupApplyResult,
  type CleanupRestoreInput,
  type CleanupRestoreResult,
  type CleanupScanInput,
  type CleanupScanResult,
  type CommitProfileCvarsInput,
  type ConfigProfile,
  type CreateConfigProfileInput,
  type DiscardProfileInput,
  type DiscardProfileResult,
  type ImportFilesCommitInput,
  type ImportFilesPreviewInput,
  type ImportPreviewResult,
  type OpenProfileFileInput,
  type PickedConfigFile,
  type PreviewProfileInput,
  type PreviewProfileResult,
  type ProfileSyncState,
  type RawFilesInput,
  type RawFilesResult,
  type RefreshFromFilesInput,
  type RefreshFromFilesResult,
  type RemoveConfigProfileInput,
  type RenameConfigProfileInput,
  type SaveProfileInput,
  type SaveProfileResult,
  type SaveRawTextInput,
  type SaveRawTextResult,
  type SetDefaultProfileInput,
  type SetPlayedModsInput,
  type SetProfileActionsInput,
  type SetProfileBindsInput,
  type SetProfileCvarsInput,
  type SetProfileLayersInput,
  type SetSectionHeaderStyleInput,
  type SetSwitchBindInput,
  type SetWriteCatalogDefaultsInput,
  type SetWriteUnbindallInput,
  type SyncProfileStateInput,
  type TidyUpApplyInput,
  type TidyUpApplyResult,
  type UnassignProfileInput,
  type WriteProfileInput,
  type WriteState,
  type WriteTargetResult,
} from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the config module. One function per handler in its contract. */
export function listConfigProfiles(): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.list)
}

/** Creates a profile and returns the full, updated profile list. */
export function createConfigProfile(
  input: CreateConfigProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.create, input)
}

/** Renames a profile and returns the full, updated profile list. */
export function renameConfigProfile(
  input: RenameConfigProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.rename, input)
}

/** Removes a profile and returns the full, updated profile list. */
export function removeConfigProfile(
  input: RemoveConfigProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.remove, input)
}

/** Replaces a profile's cvars map and returns the full, updated profile list. */
export function updateProfileCvars(input: SetProfileCvarsInput): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setCvars, input)
}

/**
 * Sets only the given cvars on a profile without a read-modify-write of the whole map; the main
 * handler refuses (typed error keys) when the profile's file changed on disk or holds unsaved edits.
 */
export function commitProfileCvars(
  input: CommitProfileCvarsInput,
): Promise<Outcome<ConfigProfile>> {
  return callModule<ConfigProfile>('config', CONFIG_HANDLERS.commitCvars, input)
}

/** Replaces a profile's binds map and returns the full, updated profile list. */
export function updateProfileBinds(input: SetProfileBindsInput): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setBinds, input)
}

/** Replaces a profile's layers array and returns the full, updated profile list. */
export function updateProfileLayers(
  input: SetProfileLayersInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setLayers, input)
}

/** Replaces a profile's categories+actions wholesale and returns the full, updated profile list. */
export function updateProfileActions(
  input: SetProfileActionsInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setActions, input)
}

/**
 * Sets whether a profile's rendered file opens with `unbindall` (story 040) and returns the
 * full, updated profile list. Same direct (non-double-wrapped) shape as `updateProfileCvars`/
 * `updateProfileBinds`/`updateProfileLayers`/`updateProfileActions` above - the main handler
 * returns `ConfigProfile[]` itself, not a second `Outcome`.
 */
export function updateProfileWriteUnbindall(
  input: SetWriteUnbindallInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setWriteUnbindall, input)
}

/**
 * Sets whether a profile's writer still emits unplaced catalogue cvars into the reserved
 * `Defaults` section (story 059) and returns the full, updated profile list. Mirrors
 * `updateProfileWriteUnbindall` right above exactly.
 */
export function updateProfileWriteCatalogDefaults(
  input: SetWriteCatalogDefaultsInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setWriteCatalogDefaults, input)
}

/**
 * Sets a profile's rendered section-banner decoration (story 042) and returns the full,
 * updated profile list. Mirrors `updateProfileWriteUnbindall` right above exactly. No UI control
 * calls this yet - that is story 042's job (`RawFileTab.tsx`), a separate deliverable.
 */
export function updateProfileSectionHeaderStyle(
  input: SetSectionHeaderStyleInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setSectionHeaderStyle, input)
}

/**
 * Story 049: restores a profile to its last-saved/loaded baseline, writing no file. Same direct
 * (non-double-wrapped) shape as `updateProfileWriteUnbindall`/`updateProfileSectionHeaderStyle`
 * above - the main handler returns a `DiscardProfileResult` itself, not a second `Outcome` - the
 * `status` field on the resolved value then discriminates `'discarded'` (carries the full, updated
 * profile list) from `'noBaseline'` (nothing to discard from; nothing was mutated).
 */
export function discardConfigProfile(
  input: DiscardProfileInput,
): Promise<Outcome<DiscardProfileResult>> {
  return callModule<DiscardProfileResult>('config', CONFIG_HANDLERS.discard, input)
}

export function assignConfigProfile(input: AssignProfileInput): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.assign, input)
}

/** Unassigns a profile from an installation and returns the full, updated profile list. */
export function unassignConfigProfile(
  input: UnassignProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.unassign, input)
}

/** Marks a profile as an installation's default and returns the full, updated profile list. */
export function setDefaultConfigProfile(
  input: SetDefaultProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setDefault, input)
}

/** Writes a profile's content to every installation it is assigned to. */
export function writeConfigProfile(
  input: WriteProfileInput,
): Promise<Outcome<WriteTargetResult[]>> {
  return callModule<WriteTargetResult[]>('config', CONFIG_HANDLERS.write, input)
}

/**
 * Story 043: explicit save - re-reads the canonical file, checks it still looks the way the
 * launcher last saw it, and only then writes the profile's unsaved edits to disk and re-syncs
 * installations.

 */
export function saveConfigProfile(input: SaveProfileInput): Promise<Outcome<SaveProfileResult>> {
  return callModule<SaveProfileResult>('config', CONFIG_HANDLERS.save, input)
}

/**
 * Story 057: saves the Raw file tab's edited text - writes exactly `input.text` to the profile's
 * canonical file under the same conflict guard `saveConfigProfile` above uses, then reads it back
 * into the profile.

 */
export function saveConfigProfileRawText(
  input: SaveRawTextInput,
): Promise<Outcome<SaveRawTextResult>> {
  return callModule<SaveRawTextResult>('config', CONFIG_HANDLERS.saveRawText, input)
}

/**
 * Story 043: the renderer's client wrapper for `refreshFromFiles` - re-reads the given
 * profile's canonical file and reports whether it changed, was adopted, conflicts with unsaved
 * edits, or came back unparseable/unreadable/missing. `useFileSourceRefresh` is the only
 * caller today and always passes a `profileId` (the story's own "Decided during refine": the
 * renderer scopes re-reads to the selected profile, never the whole list).

 */
export function refreshProfilesFromFiles(
  input: RefreshFromFilesInput,
): Promise<Outcome<RefreshFromFilesResult>> {
  return callModule<RefreshFromFilesResult>('config', CONFIG_HANDLERS.refreshFromFiles, input)
}

/**
 * Previews the exact files a write would put on an installation's disk, without writing them.

 */
export function previewConfigProfile(
  input: PreviewProfileInput,
): Promise<Outcome<PreviewProfileResult>> {
  return callModule<PreviewProfileResult>('config', CONFIG_HANDLERS.preview, input)
}

/** Installations currently waiting for a retry, keyed by installation id. */
export function getWriteState(): Promise<Outcome<WriteState>> {
  return callModule<WriteState>('config', CONFIG_HANDLERS.writeState)
}

/**
 * Read-only: the profile's canonical file plus one entry per assigned installation, with live
 * status. Never writes.

 */
export function getProfileSyncState(
  input: SyncProfileStateInput,
): Promise<Outcome<ProfileSyncState>> {
  return callModule<ProfileSyncState>('config', CONFIG_HANDLERS.syncState, input)
}

/**
 * Read-only: the profile's own canonical file plus one entry per assigned installation (story 023
 * Never writes.

 */
export function getRawFiles(input: RawFilesInput): Promise<Outcome<RawFilesResult>> {
  return callModule<RawFilesResult>('config', CONFIG_HANDLERS.rawFiles, input)
}

/**
 * Opens one of the profile's own files in the OS default application for `.cfg`
 * (`mode: 'open'`), or reveals it in the file manager (`mode: 'reveal'`). Story 023.
 *
 * Addressed by ids, never by a path: `installationId: null` is the profile's own canonical file,
 * a non-null value is that installation's copy. Main resolves the real path itself and refuses
 * anything that is not this profile's own `.cfg`, so there is deliberately nothing
 * path-shaped to pass here.

 */
export function openProfileFile(input: OpenProfileFileInput): Promise<Outcome<null>> {
  return callModule<null>('config', CONFIG_HANDLERS.openFile, input)
}

/**
 * Sets which mods an installation is considered to have been played with.

 */
export function setPlayedMods(input: SetPlayedModsInput): Promise<Outcome<string[]>> {
  return callModule<string[]>('config', CONFIG_HANDLERS.setPlayedMods, input)
}

/** installationId -> the key bound to cycle its assigned profiles in-session, if configured. */
export function getSwitchBinds(): Promise<Outcome<Record<string, string>>> {
  return callModule<Record<string, string>>('config', CONFIG_HANDLERS.switchBinds)
}

/** Sets or clears (key: null) the in-session profile-switch key for one installation. */
export function setSwitchBind(input: SetSwitchBindInput): Promise<Outcome<Record<string, string>>> {
  return callModule<Record<string, string>>('config', CONFIG_HANDLERS.setSwitchBind, input)
}

/**
 * None of the three takes or returns a path: `pickImportFiles` opens the real OS picker and hands
 * back opaque `PickedConfigFile` handles (id + display-only `fileName`/`dirName`), and the other
 * two are addressed entirely by the ids this function returned - see `PickedConfigFile`'s own doc
 * comment (`@shared/modules/config`) for why there is no path field to carry here at all.
 */

/** Opens the native multi-select config-file picker and registers what came back. */
export function pickImportFiles(): Promise<Outcome<PickedConfigFile[]>> {
  return callModule<PickedConfigFile[]>('config', CONFIG_HANDLERS.importPickFiles)
}

/** Previews what importing the given, ordered picked files would produce, without writing anything. */
export function previewImportFiles(
  input: ImportFilesPreviewInput,
): Promise<Outcome<ImportPreviewResult>> {
  return callModule<ImportPreviewResult>('config', CONFIG_HANDLERS.importPreviewFiles, input)
}

/**
 * Re-reads the given, ordered picked files from disk and creates a new profile from them,
 * returning the full, updated profile list. `input.layerAliases` (story 041) carries the names
 * `ImportProfileDialog`'s review step flipped to "attempt as layer".
 */
export function commitImportFiles(
  input: ImportFilesCommitInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.importCommitFiles, input)
}

/** Mod-folder `.cfg` files on an installation that duplicate a same-named `baseq2` file. Always safe to call, even while the installation is running. */
export function scanCleanupFindings(input: CleanupScanInput): Promise<Outcome<CleanupScanResult>> {
  return callModule<CleanupScanResult>('config', CONFIG_HANDLERS.cleanupScan, input)
}

/** Backs up and removes the given redundant copies. Fails with `config.error.installationRunning` while the installation is running. */
export function applyCleanup(input: CleanupApplyInput): Promise<Outcome<CleanupApplyResult>> {
  return callModule<CleanupApplyResult>('config', CONFIG_HANDLERS.cleanupApply, input)
}

/** Restores the given entries from their backup. Fails with `config.error.installationRunning` while the installation is running. */
export function restoreCleanup(input: CleanupRestoreInput): Promise<Outcome<CleanupRestoreResult>> {
  return callModule<CleanupRestoreResult>('config', CONFIG_HANDLERS.cleanupRestore, input)
}

/**
 * Tidy-up (story 025): applies one atomic batch of `TidyUpOp`s
 * (`@shared/config/profile/tidy-up`) to a profile and returns the committed profile
 * plus which ops applied vs. were rejected as stale.
 */
export function applyTidyUp(input: TidyUpApplyInput): Promise<Outcome<TidyUpApplyResult>> {
  return callModule<TidyUpApplyResult>('config', CONFIG_HANDLERS.tidyUpApply, input)
}
