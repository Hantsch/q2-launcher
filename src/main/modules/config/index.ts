import { join } from 'node:path'
import {
  CONFIG_HANDLERS,
  type CleanupApplyResult,
  type CleanupRestoreResult,
  type CleanupScanResult,
  type ConfigProfile,
  type DiscardProfileResult,
  type ImportPreviewResult,
  type PickedConfigFile,
  type PreviewProfileResult,
  type WriteState,
} from '@shared/modules/config'
import { reconcileAssignments } from './assignments'
import { resolveProfileFileNames } from '@shared/config/profile/profile-files'
import { fail, ok, type Outcome } from '@shared/types'
import type { AppContext } from '../../context'
import { isFile } from '../../lib/fs-utils'
import { userDataDir } from '../../lib/paths'
import type { MainModule } from '../types'
import {
  applyCleanupIfNotRunning,
  restoreCleanupIfNotRunning,
  scanRedundantCopies,
} from './cleanup'
import { commitImportFiles, pickImportFiles, previewImportFiles } from './import'
import { PickedFilesRegistry } from './picked-files'
import { ProfilesStore } from './profiles'
import { runConfigStartup } from './startup'
import {
  assignProfileInputSchema,
  cleanupApplyInputSchema,
  cleanupRestoreInputSchema,
  cleanupScanInputSchema,
  commitProfileCvarsInputSchema,
  createConfigProfileInputSchema,
  discardProfileInputSchema,
  importFilesCommitInputSchema,
  importFilesPreviewInputSchema,
  importPickFilesInputSchema,
  listInputSchema,
  openFileInputSchema,
  previewProfileInputSchema,
  rawFilesInputSchema,
  refreshFromFilesInputSchema,
  removeConfigProfileInputSchema,
  renameConfigProfileInputSchema,
  saveProfileInputSchema,
  saveRawTextInputSchema,
  setDefaultProfileInputSchema,
  setPlayedModsInputSchema,
  setProfileActionsInputSchema,
  setProfileBindsInputSchema,
  setProfileCvarsInputSchema,
  setProfileLayersInputSchema,
  setSectionHeaderStyleInputSchema,
  setSwitchBindInputSchema,
  setWriteCatalogDefaultsInputSchema,
  setWriteUnbindallInputSchema,
  switchBindsInputSchema,
  syncStateInputSchema,
  tidyUpApplyInputSchema,
  unassignProfileInputSchema,
  writeProfileInputSchema,
  writeStateInputSchema,
} from './schemas'
import { previewProfileFiles, validatePlayedMods } from './write-plan'
import { BASE_GAME_DIR, ownedProfileIdFromContent, readExisting } from './writer'
import { configState } from './persisted'
import { createProfileWrites, profileWritesFileIo } from './profile-writes'

/**
 * Story 066 D5: which folder the config-file picker opens in - the selected installation's
 * `baseq2`, or the last registered installation's when nothing is selected, so the common "just
 * read my baseq2" case costs two clicks (story decision "file import replaces the installation/
 * gamedir import").
 *
 * Returns `{}` - no `defaultPath` at all, letting the OS pick its own default - when the launcher
 * has no installation registered: the flow must not need one (AC9). This is a *starting folder*
 * for the dialog and never a path that gets read; only what the user actually selects reaches the
 * picked-files registry, so a stale or vanished folder here can at worst make the dialog open
 * somewhere unhelpful.
 */
function importPickerStartFolder(app: AppContext): { defaultPath?: string } {
  const list = app.installations.list()
  if (list.length === 0) return {}

  const activeId = app.state.settings().activeInstallationId
  const selected =
    (activeId ? list.find((installation) => installation.id === activeId) : undefined) ??
    list[list.length - 1]

  return selected ? { defaultPath: join(selected.rootPath, BASE_GAME_DIR) } : {}
}

/**
 * The config module - CRUD over centrally-owned config profiles, plus their
 * assignment links to installations.
 *
 * Mirrors `library`'s shape (see `../library/index.ts`): a `MainModule` whose
 * `setup` registers handlers on the shell's `module:invoke` channel and does
 * nothing else. Profile logic itself lives in `ProfilesStore`; this file only
 * wires payload validation to it and shapes the return values.
 *
 * No `emit` here - the renderer reloads from each mutation's returned list,
 * there is no broadcast event for this module in step 1.
 */
export const configModule: MainModule = {
  id: 'config',

  async setup({ handle, app, log }) {
    const profiles = new ProfilesStore(app.state)
    const writes = createProfileWrites({
      profiles,
      installations: app.installations,
      launchState: () => app.launch.getState(),
      config: configState(app.state),
      canonicalBaseDir: userDataDir,
      ...profileWritesFileIo,
      log,
    })

    // One-off sweep: drop assignments to installations that vanished while the
    // launcher was closed, so a stale reference never reaches the renderer.
    profiles.reconcile(app.installations.list().map((installation) => installation.id))

    // Every handler below re-filters against the *live* installation set on
    // read, so an installation removed mid-session (no restart, no reconcile
    // sweep in between) never shows up in what the renderer sees - without
    // writing that removal to disk here, since this module deliberately does
    // not hook into `InstallationsService.remove()`.
    const withLiveAssignments = (list: ConfigProfile[]): ConfigProfile[] =>
      reconcileAssignments(
        list,
        app.installations.list().map((installation) => installation.id),
      )

    /**
     * Story 043 D4: the tail every *content* mutation now ends in, in place of `syncAndPersist`.
     *
     * This is the inversion of story 022 decision 8 ("every mutation writes immediately"), decided
     * with the user in story 043: the file is the source of truth, so the launcher may not keep
     * stamping it on every keystroke. The mutation itself is already persisted in `state.json` by
     * the setter that ran just before this (a crash must not lose an edit); all that is left is to
     * record that the canonical `.cfg` does not carry it yet. No file is touched here, and
     * `CONFIG_HANDLERS.save` is the only thing that writes profile content from now on.
     */
    const markUnsaved = (profileId: string): ConfigProfile[] =>
      withLiveAssignments(profiles.setDirty(profileId, true))

    handle(CONFIG_HANDLERS.list, listInputSchema, () => ok(withLiveAssignments(profiles.list())))

    handle(CONFIG_HANDLERS.create, createConfigProfileInputSchema, (input) =>
      writes.syncAppended(withLiveAssignments(profiles.create(input))),
    )

    /**
     * Story 043 D4: a rename changes what the file is *called* as well as what it says, so it is
     * still a content mutation as far as the file goes - and it stops touching disk like the rest.
     * Until the user saves, the canonical file keeps its old name (its sentinel still identifies the
     * profile, which is how `save` and the sync engine find it again); the rename of the file, and
     * the cascade for any sibling this displaces, happen inside that save.
     */
    handle(CONFIG_HANDLERS.rename, renameConfigProfileInputSchema, (input) => {
      // A rename cannot remove the profile, so it is always in the new list.
      profiles.rename(input)
      return ok(markUnsaved(input.id))
    })

    handle(CONFIG_HANDLERS.remove, removeConfigProfileInputSchema, async (input) => {
      const list = withLiveAssignments(profiles.remove(input))
      await writes.cleanupRemoved(input.id)
      return ok(list)
    })

    handle(CONFIG_HANDLERS.setCvars, setProfileCvarsInputSchema, (input) => {
      profiles.setCvars(input)
      return ok(markUnsaved(input.profileId))
    })

    // Story 175 D1; its contract is documented on `profile-writes.ts#commitCvars`.
    handle(CONFIG_HANDLERS.commitCvars, commitProfileCvarsInputSchema, (input) =>
      writes.commitCvars(input),
    )

    handle(CONFIG_HANDLERS.setBinds, setProfileBindsInputSchema, (input) => {
      profiles.setBinds(input)
      return ok(markUnsaved(input.profileId))
    })

    handle(CONFIG_HANDLERS.setLayers, setProfileLayersInputSchema, (input) => {
      profiles.setLayers(input)
      return ok(markUnsaved(input.profileId))
    })

    handle(CONFIG_HANDLERS.setActions, setProfileActionsInputSchema, (input) => {
      profiles.setActions(input)
      return ok(markUnsaved(input.profileId))
    })

    // Story 040 D4: a dedicated setter for one boolean, not routed through the whole-field
    // replace setters above - same "genuinely new handler" shape as `setPlayedMods`/
    // `setSwitchBind` further down, but this one is write-affecting (it changes what
    // `renderProfileFile` emits), so it is a content mutation exactly like
    // `setCvars`/`setBinds`/`setLayers`/`setActions` and takes the same `markUnsaved` tail (story
    // 043 D4) rather than the plain state write those two use.
    handle(CONFIG_HANDLERS.setWriteUnbindall, setWriteUnbindallInputSchema, (input) => {
      profiles.setWriteUnbindall(input)
      return ok(markUnsaved(input.profileId))
    })

    // Story 059 D9: mirrors `setWriteUnbindall` right above exactly - a dedicated setter for one
    // boolean, write-affecting (it changes whether `buildCvarSections` writes unplaced catalogue
    // cvars into the reserved `Defaults` section, D1/D2), so it takes the same `markUnsaved` tail.
    handle(CONFIG_HANDLERS.setWriteCatalogDefaults, setWriteCatalogDefaultsInputSchema, (input) => {
      profiles.setWriteCatalogDefaults(input)
      return ok(markUnsaved(input.profileId))
    })

    // Story 042 D7: mirrors `setWriteUnbindall` right above exactly - a dedicated setter for one
    // field, write-affecting (it changes which decoration `renderProfileFile` draws around every
    // section banner), so it takes the same `markUnsaved` tail. Story 043 D4's acceptance list does
    // not name this handler, but its being write-affecting is the whole reason it went through
    // `syncAndPersist` before; leaving it as the one content setter that still stamps the file
    // immediately would be an inconsistency the plan clearly did not intend.
    handle(CONFIG_HANDLERS.setSectionHeaderStyle, setSectionHeaderStyleInputSchema, (input) => {
      profiles.setSectionHeaderStyle(input)
      return ok(markUnsaved(input.profileId))
    })

    /**
     * Story 049 D3: discard - restores a profile's pending edits to its last-saved/loaded baseline,
     * without touching any file. Deliberately does NOT go through `markUnsaved`/`syncAndPersist`:
     * discard writes nothing to disk (the story's explicit requirement - "It never writes to the
     * file"), so it needs neither the dirty-marking tail every content setter above ends in (the
     * profile comes back out of `discard` already clean) nor a sync run.
     *
     * `profiles.discard` throws only for an unknown profile id, same as every other setter; the
     * "no baseline to discard from" case is a typed result, not an error, and is reported as such
     * rather than mapped onto `fail(...)`.
     */
    handle(CONFIG_HANDLERS.discard, discardProfileInputSchema, (input) => {
      const outcome = profiles.discard(input.profileId)
      if (outcome.outcome === 'noBaseline')
        return ok<DiscardProfileResult>({ status: 'noBaseline' })
      return ok<DiscardProfileResult>({
        status: 'discarded',
        profiles: withLiveAssignments(outcome.profiles),
      })
    })

    handle(CONFIG_HANDLERS.assign, assignProfileInputSchema, (input) => writes.assign(input))
    handle(CONFIG_HANDLERS.unassign, unassignProfileInputSchema, (input) => writes.unassign(input))
    handle(CONFIG_HANDLERS.setDefault, setDefaultProfileInputSchema, (input) =>
      writes.setDefault(input),
    )
    handle(CONFIG_HANDLERS.write, writeProfileInputSchema, (input) => writes.write(input))

    // The explicit save; its read-before-write contract is documented on `profile-writes.ts#save`.
    handle(CONFIG_HANDLERS.save, saveProfileInputSchema, (input) => writes.save(input))

    // Raw text save; its contract is documented on `profile-writes.ts#saveRawText`.
    handle(CONFIG_HANDLERS.saveRawText, saveRawTextInputSchema, (input) =>
      writes.saveRawText(input),
    )

    // Refresh from files; its contract is documented on `profile-writes.ts#refreshFromFiles`.
    handle(CONFIG_HANDLERS.refreshFromFiles, refreshFromFilesInputSchema, (input) =>
      writes.refreshFromFiles(input),
    )

    handle(
      CONFIG_HANDLERS.preview,
      previewProfileInputSchema,
      async (input): Promise<Outcome<PreviewProfileResult>> => {
        const profile = profiles.find(input.profileId)
        if (!profile) return fail('config.error.profileNotFound')
        const installation = app.installations.find(input.installationId)
        if (!installation) return fail('config.error.installationNotFound')

        const files = previewProfileFiles(
          profile,
          profiles.list(),
          installation,
          configState(app.state).switchBinds.get()[installation.id],
        )
        return ok({
          files: await Promise.all(
            files.map(async (file) => ({ ...file, onDisk: await isFile(file.path) })),
          ),
        })
      },
    )

    // Story 079 D4: a running game defers nothing, so no installation is ever pending a write any
    // more - this channel's shared contract (`WriteState`, a later deliverable's concern) is kept
    // alive by always answering "nothing pending" rather than by persisting a map that can never
    // gain an entry.
    handle(CONFIG_HANDLERS.writeState, writeStateInputSchema, () => ok<WriteState>({}))

    // Story 022 D7 / 023 D1: read-only reports; their contracts are on `profile-writes.ts`.
    handle(CONFIG_HANDLERS.syncState, syncStateInputSchema, (input) => writes.syncState(input))
    handle(CONFIG_HANDLERS.rawFiles, rawFilesInputSchema, (input) => writes.rawFiles(input))

    /**
     * Story 023 D2: hand one of this profile's files to the OS - the default
     * application for `.cfg` (`mode: 'open'`) or the file manager with the file
     * selected (`mode: 'reveal'`). Mirrors `app:revealPath`
     * (`src/main/ipc/app.ts`), minus its directory branch: the target here is
     * always a file.
     *
     * This is the module's one privileged path, so the order below is the whole
     * point of it (AC 8):
     *
     * 1. The payload carries ids only - no path field exists to be trusted. The
     *    path is resolved here, from main's own profile list and installation
     *    registry, exactly the way `collectRawFiles`/`syncState` resolve it, so
     *    the renderer cannot aim this at a file of its choosing even if it
     *    wanted to.
     * 2. A non-null `installationId` must be an installation that exists AND is
     *    one this profile is actually assigned to - an id that merely exists is
     *    refused, since a copy of this profile's file is only ever expected
     *    where it is assigned.
     * 3. The file must exist and its first line must be this profile's exact
     *    sentinel. A file that exists at the resolved path but is NOT this
     *    profile's own (a hand-written file, or another profile's canonical file
     *    at a not-yet-reconciled name - the case `canonical.ts` reconciles at
     *    write time) is reported as `fileNotFound`, never opened or revealed:
     *    the same exact-sentinel rule `canonical.ts` uses before it renames or
     *    deletes anything, applied here before handing a path to the OS.
     *
     * Only then is the OS touched at all.
     */
    handle(CONFIG_HANDLERS.openFile, openFileInputSchema, async (input): Promise<Outcome<null>> => {
      const { profileId, installationId, mode } = input

      const allProfiles = profiles.list()
      const profile = allProfiles.find((p) => p.id === profileId)
      if (!profile) return fail('config.error.profileNotFound')
      // `profile` came out of `allProfiles`, so this lookup cannot miss.
      const fileName = resolveProfileFileNames(allProfiles).get(profile.id)!

      let path: string
      if (installationId === null) {
        path = join(userDataDir(), fileName)
      } else {
        const installation = app.installations.find(installationId)
        const isAssigned = profile.assignments.some((a) => a.installationId === installationId)
        // Both misses collapse into one key on purpose: from the caller's side
        // "no such installation" and "that installation is not a target of this
        // profile" are the same answer - not a valid target for this profile.
        if (!installation || !isAssigned) return fail('config.error.installationNotFound')
        path = join(installation.rootPath, BASE_GAME_DIR, fileName)
      }

      // Defence in depth, not a live check: `resolveProfileFileNames` only ever
      // produces `<base>.cfg`. It is here so that a future change to the name
      // resolver can never quietly turn this handler into one that hands the OS
      // something other than a config file.
      if (!path.toLowerCase().endsWith('.cfg')) return fail('config.error.fileNotFound')

      // `readExisting` is the write pipeline's own ENOENT-only-swallowed read,
      // so "missing" means the same thing here as it does to `rawFiles`. A read
      // that fails for any OTHER reason propagates and the registry turns it
      // into a failed outcome - which is the right direction: no OS call
      // happens on a file we could not verify.
      const content = await readExisting(path)
      if (content === null) return fail('config.error.fileNotFound')
      if (ownedProfileIdFromContent(content) !== profile.id) {
        return fail('config.error.fileNotFound')
      }

      if (mode === 'open') {
        const error = await app.os.openPath(path)
        return error ? fail('config.error.openFailed', { message: error }) : ok(null)
      }
      // No error signal to surface - `showItemInFolder` returns void, same as
      // `app:revealPath`'s own reveal branch.
      await app.os.showItemInFolder(path)
      return ok(null)
    })

    handle(CONFIG_HANDLERS.setPlayedMods, setPlayedModsInputSchema, (input): Outcome<string[]> => {
      const installation = app.installations.find(input.installationId)
      if (!installation) return fail('config.error.installationNotFound')

      const validated = validatePlayedMods(installation.gameDirs, input.playedMods)
      configState(app.state).playedMods.update((live) => ({
        ...live,
        [installation.id]: validated,
      }))
      return ok(validated)
    })

    // Story 007: which key (if any) cycles an installation's assigned
    // profiles in-session. Per-installation, not part of a profile (decision
    // 1) - see `SetSwitchBindInput`'s doc comment.
    handle(CONFIG_HANDLERS.switchBinds, switchBindsInputSchema, () =>
      ok(configState(app.state).switchBinds.get()),
    )

    handle(CONFIG_HANDLERS.setSwitchBind, setSwitchBindInputSchema, (input) =>
      writes.setSwitchBind(input),
    )

    // Story 005 / 066 D5: read-only import of hand-written config FILES into a new profile.
    // `import.ts` holds the fs-touching logic so it stays testable without booting this module;
    // these handlers only validate the payload shape, supply the picker's starting folder and
    // (for commit) reconcile live assignments the same way every other profile-list-returning
    // handler does.
    //
    // `pickedFiles` is the session's id -> absolute path map (`picked-files.ts`). Created here, per
    // `setup()` call, rather than as module-level state: one app run, one registry, never persisted
    // (story 066: "no source paths are persisted"). It is the only thing the three handlers share,
    // and the only thing that can turn a renderer-supplied id into a path.
    const pickedFiles = new PickedFilesRegistry()

    handle(
      CONFIG_HANDLERS.importPickFiles,
      importPickFilesInputSchema,
      (): Promise<Outcome<PickedConfigFile[]>> =>
        pickImportFiles(app.dialog, pickedFiles, log, importPickerStartFolder(app)),
    )

    handle(
      CONFIG_HANDLERS.importPreviewFiles,
      importFilesPreviewInputSchema,
      (input): Promise<Outcome<ImportPreviewResult>> => previewImportFiles(pickedFiles, log, input),
    )

    handle(
      CONFIG_HANDLERS.importCommitFiles,
      importFilesCommitInputSchema,
      async (input): Promise<Outcome<ConfigProfile[]>> => {
        const result = await commitImportFiles(pickedFiles, log, input, (seed) =>
          profiles.createFromImport(seed),
        )
        // Nothing was created, so there is nothing to sync.
        if (!result.ok) return result
        return writes.syncAppended(withLiveAssignments(result.value))
      },
    )

    // Story 010: find and remove mod-folder `.cfg` copies that duplicate a
    // same-named `baseq2` file. `cleanup.ts` holds the fs-touching logic
    // (D1/D2, already tested against a real temp tree there); these handlers
    // only validate the payload, resolve the real installation and - for
    // `apply`/`restore` only, never for the read-only `scan` (decision 12) -
    // refuse a currently-running installation the same way `write` does.
    handle(
      CONFIG_HANDLERS.cleanupScan,
      cleanupScanInputSchema,
      async (input): Promise<Outcome<CleanupScanResult>> => {
        const installation = app.installations.find(input.installationId)
        if (!installation) return fail('config.error.installationNotFound')

        const findings = await scanRedundantCopies(installation)
        return ok({ findings })
      },
    )

    handle(
      CONFIG_HANDLERS.cleanupApply,
      cleanupApplyInputSchema,
      async (input): Promise<Outcome<CleanupApplyResult>> => {
        const installation = app.installations.find(input.installationId)
        if (!installation) return fail('config.error.installationNotFound')

        return applyCleanupIfNotRunning(installation, input.entries, app.launch.getState())
      },
    )

    handle(
      CONFIG_HANDLERS.cleanupRestore,
      cleanupRestoreInputSchema,
      async (input): Promise<Outcome<CleanupRestoreResult>> => {
        const installation = app.installations.find(input.installationId)
        if (!installation) return fail('config.error.installationNotFound')

        return restoreCleanupIfNotRunning(installation, input.entries, app.launch.getState())
      },
    )

    // Story 025 D3; its contract is documented on `profile-writes.ts#tidyUpApply`.
    handle(CONFIG_HANDLERS.tidyUpApply, tidyUpApplyInputSchema, (input) =>
      writes.tidyUpApply(input),
    )

    // Awaited on purpose: boot blocks here so the first `list` call already sees profiles rebuilt
    // from disk, while handler registration above is not delayed by this disk I/O.
    await runConfigStartup({
      profiles,
      config: configState(app.state),
      canonicalBaseDir: userDataDir,
      syncAndPersist: writes.syncAndPersist,
      log,
    })

    log.debug('config module ready')
  },
}
