import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_GAME_DIR } from '@shared/constants'
import {
  fail,
  isStoreManaged,
  ok,
  type AddExistingInstallationInput,
  type CreateInstallationInput,
  type EngineKind,
  type Installation,
  type InstallationIcon,
  type InstallationLastFailure,
  type LauncherSettings,
  type Outcome,
  type RemoveInstallationInput,
  type UpdateInstallationInput,
  type ValidationResult,
} from '@shared/types'
import { canonicalizePath, isDirectory, pathKey } from '../lib/fs-utils'
import { scopedLogger } from '../lib/logger'
import {
  readEngineState,
  writeEngineState,
  type InstallationEngineState,
} from '../modules/downloads/engine/installation-state'
import { deleteInstallationFolder } from './installation-removal'
import { inspectInstallation, suggestName } from './inspector'
import type { StateStore } from './state'

const log = scopedLogger('installations')

export interface InstallationsDeps {
  state: StateStore
  /** Called after every change, with the new list. */
  onChange: (installations: Installation[]) => void
  /**
   * Called whenever this service changes settings as a side effect - selecting
   * the first installation, or picking a replacement after a removal.
   *
   * Without this the renderer would keep a stale `activeInstallationId` until
   * something else happened to refresh the settings, and the shell would show
   * "no installation selected" while three sat in the rail.
   */
  onSettingsChange: (settings: LauncherSettings) => void
  /**
   * Called after an installation has been removed, so anything keyed by its id can be torn down
   * with it - story 067's `userData/installation-icons/<id>.png`. Optional, because this service
   * stays usable (and testable) without any such owner wired in.
   *
   * Deliberately a hook rather than a direct call: this service knows nothing about `userData` or
   * Electron, and a second remove path (a future module removing an installation) then cannot
   * forget the teardown.
   */
  onRemoved?: (id: string) => Promise<void>
  /**
   * Story 094 D2: true while `installationId`'s own game process is starting or running - the
   * refusal `remove({ deleteFromDisk: true })` uses instead of story 091's `runWrite` wait, since a
   * destructive one-shot delete is refused outright rather than deferred (see the story's Decisions
   * section). Optional and a callback, not a direct `InstallationWriteGuard` dependency, for the
   * same reason `onRemoved` is a callback above: this service is deliberately launch-agnostic and
   * constructed before `LaunchService`/the write guard exist, and stays testable without booting
   * Electron or a `LaunchService`.
   */
  isRunning?: (id: string) => boolean
  /**
   * The launcher's own data directory (`app.getPath('userData')`) and the user's home directory
   * (`os.homedir()`), forwarded to `deleteInstallationFolder` unchanged. Plain strings rather than
   * callbacks, unlike `isRunning` above: neither changes during a run, so there is nothing to
   * late-bind. Injected rather than read from `../lib/paths`/`node:os` directly, so this service
   * never imports `electron` and stays testable against a plain temp directory - the same rule
   * `installation-removal.ts` follows for the same two values.
   *
   * Optional so every existing fixture that never exercises `deleteFromDisk` (this service's other
   * tests, the download/repair job tests) does not have to pass values it will never use; `remove()`
   * only ever reads them on the `deleteFromDisk` path, and `context.ts` always supplies real ones.
   */
  userDataDir?: string
  homeDir?: string
}

/**
 * The launcher's library of Quake II installations: add, validate, order, launch
 * target selection, removal.
 *
 * Identity is the generated `id`, never the path - a user may move a folder and
 * relocate the installation without losing its settings, playtime or (later)
 * mod and asset state.
 */
export class InstallationsService {
  private readonly state: StateStore
  private readonly onChange: (installations: Installation[]) => void
  private readonly onSettingsChange: (settings: LauncherSettings) => void
  private readonly onRemoved: ((id: string) => Promise<void>) | undefined
  private readonly isRunning: ((id: string) => boolean) | undefined
  private readonly userDataDir: string
  private readonly homeDir: string

  constructor(deps: InstallationsDeps) {
    this.state = deps.state
    this.onChange = deps.onChange
    this.onSettingsChange = deps.onSettingsChange
    this.onRemoved = deps.onRemoved
    this.isRunning = deps.isRunning
    this.userDataDir = deps.userDataDir ?? ''
    this.homeDir = deps.homeDir ?? ''
  }

  list(): Installation[] {
    return [...this.state.installations()].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  find(id: string): Installation | undefined {
    return this.state.installations().find((installation) => installation.id === id)
  }

  /** Used by the detection scan to mark candidates the user already has. */
  isRegistered(key: string): boolean {
    return this.state.installations().some((installation) => pathKey(installation.rootPath) === key)
  }

  /**
   * Finds the installation registered at `rootPath`, using the exact same comparison
   * `addExisting()`/`create()` use to detect a duplicate: canonicalize, then compare
   * `pathKey`s (case-insensitive where `pathKey` already is). Returns `undefined` when nothing
   * matches - a plain lookup, not an error.
   */
  async findByRootPath(rootPath: string): Promise<Installation | undefined> {
    const key = pathKey(await canonicalizePath(rootPath))
    return this.state.installations().find((installation) => pathKey(installation.rootPath) === key)
  }

  // -------------------------------------------------------------------------
  // Adding
  // -------------------------------------------------------------------------

  async addExisting(input: AddExistingInstallationInput): Promise<Outcome<Installation>> {
    const rootPath = await canonicalizePath(input.rootPath)
    const key = pathKey(rootPath)

    const existing = this.state.installations().find((i) => pathKey(i.rootPath) === key)
    if (existing) {
      return fail('installations.error.duplicate', { name: existing.name })
    }

    const result = await inspectInstallation(rootPath, {
      ...(input.executablePath ? { executablePath: input.executablePath } : {}),
    })

    if (result.status === 'missing') {
      return fail('installations.error.rootMissing', { path: rootPath })
    }
    if (!looksLikeQuake2(result)) {
      return fail('installations.error.notQuake2', { path: rootPath })
    }

    const now = new Date().toISOString()
    const installation: Installation = {
      id: randomUUID(),
      name: input.name?.trim() || suggestName(rootPath),
      rootPath,
      engineKind: result.engineKind,
      launchArgs: [],
      activeGameDir: '',
      source: input.source ?? 'manual',
      status: result.status,
      checks: result.checks,
      gameDirs: result.gameDirs,
      favorite: false,
      sortOrder: this.nextSortOrder(),
      createdAt: now,
      updatedAt: now,
      lastValidatedAt: result.checkedAt,
      totalPlaytimeSeconds: 0,
      ...(input.executablePath || result.executables[0]
        ? { executablePath: input.executablePath ?? result.executables[0] }
        : {}),
      ...(result.detectedVersion ? { detectedVersion: result.detectedVersion } : {}),
      // Story 103 D2: absent on Windows, where no header is read - so the key only ever appears on
      // a record whose executable was actually identified by its first bytes.
      ...(result.executableKind ? { executableKind: result.executableKind } : {}),
      // AC1 fix: a fresh inspection of a folder the user already has is a positive identification -
      // record it once, so a later missing executable (which drops `engineKind` to `'unknown'`, see
      // `Installation.recordedEngineKind`'s doc comment) does not also erase this memory.
      ...(result.engineKind !== 'unknown' ? { recordedEngineKind: result.engineKind } : {}),
    }

    this.commit([...this.state.installations(), installation])
    this.activateIfFirst(installation.id)
    log.info(`added installation ${installation.name} (${installation.engineKind}) at ${rootPath}`)
    return ok(installation)
  }

  /** Bulk import from a detection scan. Duplicates are skipped, not reported as errors. */
  async importMany(rootPaths: string[]): Promise<Outcome<Installation[]>> {
    const imported: Installation[] = []
    for (const rootPath of rootPaths) {
      const result = await this.addExisting({ rootPath, source: 'manual' })
      if (result.ok) imported.push(result.value)
    }
    if (imported.length === 0) {
      return fail('installations.error.nothingImported')
    }
    return ok(imported)
  }

  /**
   * Prepares a folder for an installation the launcher will later populate.
   *
   * Step 1 creates the directory skeleton and registers it; the resulting
   * installation reports "game files missing" with a fix action that the
   * download module will implement. The user is never left on a dead end - they
   * see a real entry in their library with a clear next step.
   */
  async create(input: CreateInstallationInput): Promise<Outcome<Installation>> {
    const rootPath = await canonicalizePath(input.rootPath)
    const key = pathKey(rootPath)

    if (this.state.installations().some((i) => pathKey(i.rootPath) === key)) {
      return fail('installations.error.duplicate', { name: input.name })
    }

    if (await isDirectory(rootPath)) {
      const existing = await inspectInstallation(rootPath)
      if (looksLikeQuake2(existing)) {
        return fail('installations.error.alreadyContainsGame', { path: rootPath })
      }
    }

    try {
      await mkdir(join(rootPath, BASE_GAME_DIR), { recursive: true })
    } catch (error) {
      log.error(`could not create ${rootPath}`, error)
      return fail('installations.error.createFailed', { path: rootPath })
    }

    const canonicalRoot = await canonicalizePath(rootPath)
    const result = await inspectInstallation(canonicalRoot)
    const now = new Date().toISOString()

    const installation: Installation = {
      id: randomUUID(),
      name: input.name.trim(),
      rootPath: canonicalRoot,
      engineKind: input.engineKind,
      launchArgs: [],
      activeGameDir: '',
      source: 'created',
      status: result.status,
      checks: result.checks,
      gameDirs: result.gameDirs,
      favorite: false,
      sortOrder: this.nextSortOrder(),
      createdAt: now,
      updatedAt: now,
      lastValidatedAt: result.checkedAt,
      totalPlaytimeSeconds: 0,
      // AC1 fix: `input.engineKind` is the caller's own choice (the bootstrap wizard's engine pick),
      // authoritative the moment the installation is created - see `Installation.recordedEngineKind`.
      ...(input.engineKind !== 'unknown' ? { recordedEngineKind: input.engineKind } : {}),
    }

    this.commit([...this.state.installations(), installation])
    this.activateIfFirst(installation.id)
    log.info(`created installation ${installation.name} at ${canonicalRoot}`)
    return ok(installation)
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  async update(input: UpdateInstallationInput): Promise<Outcome<Installation>> {
    const current = this.find(input.id)
    if (!current) return fail('installations.error.notFound')

    let next: Installation = { ...current, updatedAt: new Date().toISOString() }

    if (input.name !== undefined) next.name = input.name.trim() || current.name
    if (input.launchArgs !== undefined) next.launchArgs = input.launchArgs
    if (input.favorite !== undefined) next.favorite = input.favorite
    if (input.activeGameDir !== undefined) next.activeGameDir = input.activeGameDir
    if (input.executablePath !== undefined) next.executablePath = input.executablePath
    // Story 103 D6: the runner choice `resolveRunner` (src/main/services/runners.ts) reads. Does
    // not trigger revalidation below - it changes nothing `applyInspection` checks.
    if (input.runner !== undefined) next.runner = input.runner

    if (input.writeDirPath !== undefined) {
      if (input.writeDirPath === null) delete next.writeDirPath
      else next.writeDirPath = await canonicalizePath(input.writeDirPath)
    }

    // Relocating: the new folder must not already belong to another entry.
    if (input.rootPath !== undefined) {
      const rootPath = await canonicalizePath(input.rootPath)
      const key = pathKey(rootPath)
      const clash = this.state
        .installations()
        .find((other) => other.id !== current.id && pathKey(other.rootPath) === key)
      if (clash) return fail('installations.error.duplicate', { name: clash.name })

      next.rootPath = rootPath
      // The old executable path points into the old folder; drop it and let the
      // inspection below pick a fresh one.
      if (current.executablePath && input.executablePath === undefined) {
        delete next.executablePath
      }
    }

    // Anything that can change the verdict triggers a fresh inspection.
    const revalidate =
      input.executablePath !== undefined ||
      input.writeDirPath !== undefined ||
      input.rootPath !== undefined
    if (revalidate) {
      next = await this.applyInspection(next)
    }

    this.commit(this.state.installations().map((i) => (i.id === next.id ? next : i)))
    return ok(next)
  }

  /**
   * Story 067: the icon is not part of `UpdateInstallationInput` - it has its own IPC channels and
   * its own service - but it is part of the same record, so it goes through the same `commit` path
   * as `update()` above rather than a second way of writing an installation.
   *
   * `null` removes the field entirely, which is what "no icon" means to the renderer (the tile
   * falls back to the engine/initials code); an absent key is also what a record written before
   * this story looks like.
   */
  setIcon(id: string, icon: InstallationIcon | null): Outcome<Installation> {
    const current = this.find(id)
    if (!current) return fail('installations.error.notFound')

    const next: Installation = { ...current, updatedAt: new Date().toISOString() }
    if (icon === null) delete next.icon
    else next.icon = icon

    this.commit(this.state.installations().map((i) => (i.id === next.id ? next : i)))
    return ok(next)
  }

  /**
   * Story 077 D1: records (or clears) the installation's last bootstrap failure - same shape as
   * `setIcon()` right above, its own field, its own `commit()` write.
   *
   * `null` removes the field entirely, the same "absent means none" convention `setIcon` uses for
   * `icon`. The field is also cleared automatically the next time `applyInspection()` sees a
   * playable verdict (see that method below) - this method is for the bootstrap job to set it (and
   * for tests/future callers to clear it explicitly), not the only place it can be cleared.
   */
  setLastFailure(id: string, failure: InstallationLastFailure | null): Outcome<Installation> {
    const current = this.find(id)
    if (!current) return fail('installations.error.notFound')

    const next: Installation = { ...current, updatedAt: new Date().toISOString() }
    if (failure === null) delete next.lastFailure
    else next.lastFailure = failure

    this.commit(this.state.installations().map((i) => (i.id === next.id ? next : i)))
    return ok(next)
  }

  /**
   * Story 092 D2: records (or extends) the installation's recorded engine state - same shape as
   * `setIcon()`/`setLastFailure()` above, its own field (`moduleData['downloads']`), its own
   * `commit()` write. `readEngineState`/`writeEngineState` (`modules/downloads/engine/
   * installation-state.ts`) do the defensive parsing/merging; this method only wires that into the
   * installation record.
   *
   * `detectedVersion` (a field already defined on `Installation`, but never written before this
   * story) is mirrored from the patched state's `version` in the same write, per the Decisions
   * (Sprint): "mirrored into `Installation.detectedVersion` for display". Written only when the
   * merged state actually has a `version`, and removed otherwise (e.g. a patch that never set one,
   * on an installation that never had one either) - never left stale.
   */
  setEngineState(id: string, patch: Partial<InstallationEngineState>): Outcome<Installation> {
    const current = this.find(id)
    if (!current) return fail('installations.error.notFound')

    const moduleData = writeEngineState(current.moduleData, patch)
    const merged = readEngineState(moduleData)

    const next: Installation = { ...current, moduleData, updatedAt: new Date().toISOString() }
    if (merged.version) next.detectedVersion = merged.version
    else delete next.detectedVersion

    this.commit(this.state.installations().map((i) => (i.id === next.id ? next : i)))
    return ok(next)
  }

  /**
   * Story 093 finding fix (AC1): records the engine a completed `reinstall-engine` repair just put
   * back - same shape as `setIcon()`/`setLastFailure()` above, its own field, its own `commit()`
   * write. Keeps `Installation.recordedEngineKind` accurate for a *future* repair, the same reason
   * it is set at creation time in `create()`/`addExisting()` above.
   */
  setRecordedEngineKind(id: string, engine: EngineKind): Outcome<Installation> {
    const current = this.find(id)
    if (!current) return fail('installations.error.notFound')

    const next: Installation = { ...current, recordedEngineKind: engine, updatedAt: new Date().toISOString() }
    this.commit(this.state.installations().map((i) => (i.id === next.id ? next : i)))
    return ok(next)
  }

  reorder(orderedIds: string[]): Installation[] {
    const byId = new Map(this.state.installations().map((i) => [i.id, i]))
    const ordered: Installation[] = []

    for (const id of orderedIds) {
      const installation = byId.get(id)
      if (installation) {
        ordered.push(installation)
        byId.delete(id)
      }
    }
    // Anything the caller did not mention keeps its relative order, at the end.
    for (const leftover of [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder)) {
      ordered.push(leftover)
    }

    const renumbered = ordered.map((installation, index) => ({
      ...installation,
      sortOrder: index,
    }))
    this.commit(renumbered)
    return this.list()
  }

  /**
   * Story 094 D2: `deleteFromDisk` deletes the installation's folder before dropping its library
   * entry - files first, entry second - so a refused or failed delete leaves the entry, the active
   * installation and the icon exactly as they were, rather than an entry with no files behind it.
   * The `false`/absent path is untouched: entry-only removal, exactly as before this story.
   */
  async remove(input: RemoveInstallationInput): Promise<Outcome<null>> {
    const current = this.find(input.id)
    if (!current) return fail('installations.error.notFound')

    if (input.deleteFromDisk) {
      // A store owns these files; the store, not the launcher, is how you uninstall them.
      if (isStoreManaged(current.source)) {
        return fail('installations.error.deleteFromDiskStoreManaged')
      }
      // Refused rather than deferred (unlike story 091's `runWrite`): a destructive one-shot
      // delete is not something to queue up behind the game exiting.
      if (this.isRunning?.(input.id)) {
        return fail('installations.error.deleteFromDiskRunning')
      }
      // Review fix: `userDataDir`/`homeDir` are the safety fence's own anchors (AC3) - a caller
      // that forgot to wire them would otherwise fall back to `''`, which `canonicalizePath`
      // resolves to `process.cwd()` and silently turns the fence into a wrong-but-plausible guard
      // instead of a loud failure. Checked here, not in the constructor, so every other test
      // fixture that never exercises `deleteFromDisk` still does not have to supply them.
      if (!this.userDataDir || !this.homeDir) {
        return fail('installations.error.deleteFromDiskMisconfigured')
      }

      const deleted = await deleteInstallationFolder({
        rootPath: current.rootPath,
        userDataDir: this.userDataDir,
        homeDir: this.homeDir,
        otherInstallationRoots: this.state
          .installations()
          .filter((i) => i.id !== input.id)
          .map((i) => i.rootPath),
      })
      if (!deleted.ok) return deleted
    }

    const remaining = this.state.installations().filter((i) => i.id !== input.id)
    this.commit(remaining)

    if (this.state.settings().activeInstallationId === input.id) {
      const fallback = [...remaining].sort((a, b) => a.sortOrder - b.sortOrder)[0]
      this.onSettingsChange(
        this.state.patchSettings({ activeInstallationId: fallback?.id ?? null }),
      )
    }

    // Launcher-owned data keyed by this id goes with it (story 067: the stored icon file).
    await this.onRemoved?.(input.id)

    log.info(
      input.deleteFromDisk
        ? `removed installation ${current.name} and deleted its files`
        : `removed installation ${current.name} (kept files on disk)`,
    )
    return ok(null)
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  async validate(id: string): Promise<Outcome<Installation>> {
    const current = this.find(id)
    if (!current) return fail('installations.error.notFound')

    const next = await this.applyInspection(current)
    this.commit(this.state.installations().map((i) => (i.id === id ? next : i)))
    return ok(next)
  }

  /**
   * Re-checks every installation. Runs once at startup so a folder that vanished
   * while the launcher was closed shows up as `missing` instead of silently
   * failing on the next launch.
   */
  async validateAll(): Promise<Installation[]> {
    const validated: Installation[] = []
    for (const installation of this.state.installations()) {
      validated.push(await this.applyInspection(installation))
    }
    this.commit(validated)
    return this.list()
  }

  /** Records a finished play session. */
  recordPlaySession(id: string, seconds: number): void {
    const current = this.find(id)
    if (!current) return
    const next: Installation = {
      ...current,
      lastPlayedAt: new Date().toISOString(),
      totalPlaytimeSeconds: current.totalPlaytimeSeconds + Math.max(0, Math.round(seconds)),
    }
    this.commit(this.state.installations().map((i) => (i.id === id ? next : i)))
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async applyInspection(installation: Installation): Promise<Installation> {
    const result = await inspectInstallation(installation.rootPath, {
      ...(installation.executablePath ? { executablePath: installation.executablePath } : {}),
      ...(installation.writeDirPath ? { writeDirPath: installation.writeDirPath } : {}),
    })

    const next: Installation = {
      ...installation,
      status: result.status,
      checks: result.checks,
      gameDirs: result.gameDirs,
      lastValidatedAt: result.checkedAt,
      updatedAt: new Date().toISOString(),
    }

    // Story 077 D1: a playable verdict retires any stale failure record - same "playable" predicate
    // `bootstrap/job.ts`'s `markPlayableIfReady` uses. An `invalid`/`missing` verdict leaves
    // `lastFailure` exactly as it was; this is the only place other than `setLastFailure(id, null)`
    // that clears it.
    if (result.status !== 'invalid' && result.status !== 'missing') {
      delete next.lastFailure
    }

    // A user-chosen engine kind is never overwritten by detection.
    // Story 077 (review fix, AC1/AC8): an empty/unrecognizable folder inspects as `unknown` - for a
    // *failed* installation (the folder this story's cleanup just emptied - Decisions (Sprint), Q1)
    // that must not clobber the wizard's engine choice, or a restart would show "Unknown engine"
    // next to a name and path it otherwise preserved exactly. Deliberately scoped to
    // `installation.lastFailure`, the one field only a bootstrap failure ever sets: an *ordinary*
    // installation (no `lastFailure` - AC8's "an installation without the new field") keeps today's
    // unconditional overwrite, engineKind included, so this story changes nothing about how an
    // untouched installation's engine badge behaves when its folder empties out for any other
    // reason. A too-broad version of this guard (no `lastFailure` scoping) was caught in review:
    // it silently changed the engine badge on installations that carry no `lastFailure` at all.
    const preserveKnownEngine =
      result.engineKind === 'unknown' &&
      installation.engineKind !== 'unknown' &&
      installation.lastFailure !== undefined
    if (installation.engineKind !== 'custom' && !preserveKnownEngine) {
      next.engineKind = result.engineKind
    }

    // Adopt a working executable if the stored one is gone.
    if (!installation.executablePath && result.executables[0]) {
      next.executablePath = result.executables[0]
    }

    // Story 103 D2: record what the chosen executable turned out to be. Written only when the
    // inspection actually read a header (never on Windows - AC8: a revalidation there must leave
    // the record exactly as it found it), so a kind read on another platform is kept rather than
    // erased by a Windows run over the same state file.
    if (result.executableKind) next.executableKind = result.executableKind

    // The selected game dir may have been deleted behind our back.
    if (next.activeGameDir && !result.gameDirs.includes(next.activeGameDir)) {
      next.activeGameDir = ''
    }

    return next
  }

  private nextSortOrder(): number {
    const orders = this.state.installations().map((i) => i.sortOrder)
    return orders.length === 0 ? 0 : Math.max(...orders) + 1
  }

  private activateIfFirst(id: string): void {
    if (this.state.settings().activeInstallationId === null) {
      this.onSettingsChange(this.state.patchSettings({ activeInstallationId: id }))
    }
  }

  private commit(installations: Installation[]): void {
    this.state.setInstallations(installations)
    this.onChange(this.list())
  }
}

/** Same rule the detection scan uses, so both agree on what counts as a game folder. */
function looksLikeQuake2(result: ValidationResult): boolean {
  if (result.status === 'missing') return false
  const missingBaseDir = result.checks.some(
    (check) => check.id === 'base-game-dir' && check.severity === 'error',
  )
  return !missingBaseDir || result.engineKind !== 'unknown'
}
