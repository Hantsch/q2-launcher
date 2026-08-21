import {
  CONFIG_HANDLERS,
  type AssignProfileInput,
  type CleanupApplyInput,
  type CleanupApplyResult,
  type CleanupRestoreInput,
  type CleanupRestoreResult,
  type CleanupScanInput,
  type CleanupScanResult,
  type ConfigProfile,
  type CreateConfigProfileInput,
  type ImportCommitInput,
  type ImportPreviewInput,
  type ImportPreviewResult,
  type ImportScanInput,
  type ImportScanResult,
  type OpenProfileFileInput,
  type PreviewProfileInput,
  type PreviewProfileResult,
  type ProfileSyncState,
  type RawFilesInput,
  type RawFilesResult,
  type RemoveConfigProfileInput,
  type RenameConfigProfileInput,
  type SetDefaultProfileInput,
  type SetPlayedModsInput,
  type SetProfileActionsInput,
  type SetProfileBindsInput,
  type SetProfileCvarsInput,
  type SetProfileLayersInput,
  type SetSwitchBindInput,
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
export function updateProfileCvars(
  input: SetProfileCvarsInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.setCvars, input)
}

/** Replaces a profile's binds map and returns the full, updated profile list. */
export function updateProfileBinds(
  input: SetProfileBindsInput,
): Promise<Outcome<ConfigProfile[]>> {
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
 * `assign`/`unassign`/`setDefault` each return, as the transport-level
 * `Outcome`'s own value, an inner `Outcome<ConfigProfile[]>` built by the main
 * process handler - so a raw `callModule` call here yields
 * `Outcome<Outcome<ConfigProfile[]>>`. These three functions flatten that one
 * level so every other file only ever sees a flat `Outcome<ConfigProfile[]>`,
 * same as `create`/`rename`/`remove` above.
 */
export async function assignConfigProfile(
  input: AssignProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  const result = await callModule<Outcome<ConfigProfile[]>>('config', CONFIG_HANDLERS.assign, input)
  return result.ok ? result.value : result
}

/** Unassigns a profile from an installation and returns the full, updated profile list. */
export async function unassignConfigProfile(
  input: UnassignProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  const result = await callModule<Outcome<ConfigProfile[]>>('config', CONFIG_HANDLERS.unassign, input)
  return result.ok ? result.value : result
}

/** Marks a profile as an installation's default and returns the full, updated profile list. */
export async function setDefaultConfigProfile(
  input: SetDefaultProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  const result = await callModule<Outcome<ConfigProfile[]>>(
    'config',
    CONFIG_HANDLERS.setDefault,
    input,
  )
  return result.ok ? result.value : result
}

/** Writes a profile's content to every installation it is assigned to. */
export function writeConfigProfile(
  input: WriteProfileInput,
): Promise<Outcome<WriteTargetResult[]>> {
  return callModule<WriteTargetResult[]>('config', CONFIG_HANDLERS.write, input)
}

/**
 * Previews the exact files a write would put on an installation's disk, without writing them.
 *
 * Same double-unwrap gotcha as `getRawFiles`/`getProfileSyncState`/`openProfileFile` above: the
 * `preview` main-process handler returns an `Outcome<PreviewProfileResult>` itself, and
 * `MainModuleRegistry.invoke` (`src/main/modules/registry.ts`) wraps every handler's return in its
 * own `Outcome` unconditionally - so the raw `callModule` response here is
 * `Outcome<Outcome<PreviewProfileResult>>`, flattened the same way.
 */
export async function previewConfigProfile(
  input: PreviewProfileInput,
): Promise<Outcome<PreviewProfileResult>> {
  const result = await callModule<Outcome<PreviewProfileResult>>(
    'config',
    CONFIG_HANDLERS.preview,
    input,
  )
  return result.ok ? result.value : result
}

/** Installations currently waiting for a retry, keyed by installation id. */
export function getWriteState(): Promise<Outcome<WriteState>> {
  return callModule<WriteState>('config', CONFIG_HANDLERS.writeState)
}

/**
 * Read-only: the profile's canonical file plus one entry per assigned installation, with live
 * status. Never writes.
 *
 * `syncState`'s main-process handler returns an `Outcome<ProfileSyncState>` itself, and
 * `MainModuleRegistry.invoke` (`src/main/modules/registry.ts`) wraps every handler's return value
 * in its own `Outcome` unconditionally - so the raw `callModule` response here is
 * `Outcome<Outcome<ProfileSyncState>>`. Same flattening as `assignConfigProfile`/`unassignConfigProfile`/
 * `setDefaultConfigProfile` above, needed for the same reason.
 */
export async function getProfileSyncState(
  input: SyncProfileStateInput,
): Promise<Outcome<ProfileSyncState>> {
  const result = await callModule<Outcome<ProfileSyncState>>(
    'config',
    CONFIG_HANDLERS.syncState,
    input,
  )
  return result.ok ? result.value : result
}

/**
 * Read-only: the profile's own canonical file plus one entry per assigned installation (story 023
 * D1). Never writes.
 *
 * Same double-unwrap gotcha as `getProfileSyncState` above: the `rawFiles` main-process handler
 * returns an `Outcome<RawFilesResult>` itself, and `MainModuleRegistry.invoke` wraps every
 * handler's return value in its own `Outcome` unconditionally - so the raw `callModule` response
 * here is `Outcome<Outcome<RawFilesResult>>`, flattened the same way.
 */
export async function getRawFiles(input: RawFilesInput): Promise<Outcome<RawFilesResult>> {
  const result = await callModule<Outcome<RawFilesResult>>('config', CONFIG_HANDLERS.rawFiles, input)
  return result.ok ? result.value : result
}

/**
 * Opens one of the profile's own files in the OS default application for `.cfg`
 * (`mode: 'open'`), or reveals it in the file manager (`mode: 'reveal'`). Story 023 D2.
 *
 * Addressed by ids, never by a path: `installationId: null` is the profile's own canonical file,
 * a non-null value is that installation's copy. Main resolves the real path itself and refuses
 * anything that is not this profile's own `.cfg` (AC 8), so there is deliberately nothing
 * path-shaped to pass here.
 *
 * Same double-unwrap as `getRawFiles`/`getProfileSyncState` above, for the same reason: the
 * handler's own return value is already an `Outcome<null>`, and `MainModuleRegistry.invoke`
 * (`src/main/modules/registry.ts`) wraps every handler return in a second `Outcome`
 * unconditionally.
 */
export async function openProfileFile(input: OpenProfileFileInput): Promise<Outcome<null>> {
  const result = await callModule<Outcome<null>>('config', CONFIG_HANDLERS.openFile, input)
  return result.ok ? result.value : result
}

/**
 * Sets which mods an installation is considered to have been played with.
 *
 * Same double-unwrap gotcha as `getRawFiles`/`getProfileSyncState`/`openProfileFile` above: the
 * `setPlayedMods` main-process handler returns an `Outcome<string[]>` itself, and
 * `MainModuleRegistry.invoke` (`src/main/modules/registry.ts`) wraps every handler's return in its
 * own `Outcome` unconditionally - so the raw `callModule` response here is
 * `Outcome<Outcome<string[]>>`, flattened the same way.
 */
export async function setPlayedMods(input: SetPlayedModsInput): Promise<Outcome<string[]>> {
  const result = await callModule<Outcome<string[]>>('config', CONFIG_HANDLERS.setPlayedMods, input)
  return result.ok ? result.value : result
}

/** installationId -> the key bound to cycle its assigned profiles in-session, if configured. */
export function getSwitchBinds(): Promise<Outcome<Record<string, string>>> {
  return callModule<Record<string, string>>('config', CONFIG_HANDLERS.switchBinds)
}

/** Sets or clears (key: null) the in-session profile-switch key for one installation. */
export function setSwitchBind(
  input: SetSwitchBindInput,
): Promise<Outcome<Record<string, string>>> {
  return callModule<Record<string, string>>('config', CONFIG_HANDLERS.setSwitchBind, input)
}

/**
 * Import (story 005): `importScan`/`importPreview`/`importCommit` each return,
 * as the transport-level `Outcome`'s own value, an inner `Outcome<T>` built by
 * the main process handler - same flattening as `assign`/`unassign`/
 * `setDefault` above, needed so callers only ever see a flat `Outcome<T>`.
 */

/** Gamedirs of an installation that have an importable `config.cfg`/`autoexec.cfg`. */
export async function scanImportCandidates(
  input: ImportScanInput,
): Promise<Outcome<ImportScanResult>> {
  const result = await callModule<Outcome<ImportScanResult>>(
    'config',
    CONFIG_HANDLERS.importScan,
    input,
  )
  return result.ok ? result.value : result
}

/** Previews what an import of one gamedir would produce, without writing anything. */
export async function previewImportCandidates(
  input: ImportPreviewInput,
): Promise<Outcome<ImportPreviewResult>> {
  const result = await callModule<Outcome<ImportPreviewResult>>(
    'config',
    CONFIG_HANDLERS.importPreview,
    input,
  )
  return result.ok ? result.value : result
}

/** Re-parses the chosen gamedir and creates a new profile from it, returning the full, updated profile list. */
export async function commitImportProfile(
  input: ImportCommitInput,
): Promise<Outcome<ConfigProfile[]>> {
  const result = await callModule<Outcome<ConfigProfile[]>>(
    'config',
    CONFIG_HANDLERS.importCommit,
    input,
  )
  return result.ok ? result.value : result
}

/**
 * Cleanup (story 010): `cleanupScan`/`cleanupApply`/`cleanupRestore` each
 * return, as the transport-level `Outcome`'s own value, an inner `Outcome<T>`
 * built by the main process handler - same flattening as the import wrappers
 * above.
 */

/** Mod-folder `.cfg` files on an installation that duplicate a same-named `baseq2` file. Always safe to call, even while the installation is running. */
export async function scanCleanupFindings(
  input: CleanupScanInput,
): Promise<Outcome<CleanupScanResult>> {
  const result = await callModule<Outcome<CleanupScanResult>>(
    'config',
    CONFIG_HANDLERS.cleanupScan,
    input,
  )
  return result.ok ? result.value : result
}

/** Backs up and removes the given redundant copies. Fails with `config.error.installationRunning` while the installation is running. */
export async function applyCleanup(
  input: CleanupApplyInput,
): Promise<Outcome<CleanupApplyResult>> {
  const result = await callModule<Outcome<CleanupApplyResult>>(
    'config',
    CONFIG_HANDLERS.cleanupApply,
    input,
  )
  return result.ok ? result.value : result
}

/** Restores the given entries from their backup. Fails with `config.error.installationRunning` while the installation is running. */
export async function restoreCleanup(
  input: CleanupRestoreInput,
): Promise<Outcome<CleanupRestoreResult>> {
  const result = await callModule<Outcome<CleanupRestoreResult>>(
    'config',
    CONFIG_HANDLERS.cleanupRestore,
    input,
  )
  return result.ok ? result.value : result
}

/**
 * Tidy-up (story 025 D3/D5): applies one atomic batch of `TidyUpOp`s
 * (`@shared/config/tidy-up`) to a profile and returns the committed profile
 * plus which ops applied vs. were rejected as stale. Same double-unwrap
 * gotcha as `scanCleanupFindings`/`applyCleanup` above.
 */
export async function applyTidyUp(input: TidyUpApplyInput): Promise<Outcome<TidyUpApplyResult>> {
  const result = await callModule<Outcome<TidyUpApplyResult>>(
    'config',
    CONFIG_HANDLERS.tidyUpApply,
    input,
  )
  return result.ok ? result.value : result
}
