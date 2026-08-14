import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_GAME_DIR } from '@shared/constants'
import {
  fail,
  ok,
  type AddExistingInstallationInput,
  type CreateInstallationInput,
  type Installation,
  type LauncherSettings,
  type Outcome,
  type RemoveInstallationInput,
  type UpdateInstallationInput,
  type ValidationResult,
} from '@shared/types'
import { canonicalizePath, isDirectory, pathKey } from '../lib/fs-utils'
import { scopedLogger } from '../lib/logger'
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

  constructor(deps: InstallationsDeps) {
    this.state = deps.state
    this.onChange = deps.onChange
    this.onSettingsChange = deps.onSettingsChange
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

  async remove(input: RemoveInstallationInput): Promise<Outcome<null>> {
    if (input.deleteFromDisk) {
      // Deliberate: nothing in step 1 may delete a user's game files.
      return fail('installations.error.deleteFromDiskUnsupported')
    }

    const current = this.find(input.id)
    if (!current) return fail('installations.error.notFound')

    const remaining = this.state.installations().filter((i) => i.id !== input.id)
    this.commit(remaining)

    if (this.state.settings().activeInstallationId === input.id) {
      const fallback = [...remaining].sort((a, b) => a.sortOrder - b.sortOrder)[0]
      this.onSettingsChange(
        this.state.patchSettings({ activeInstallationId: fallback?.id ?? null }),
      )
    }

    log.info(`removed installation ${current.name} (kept files on disk)`)
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

    // A user-chosen engine kind is never overwritten by detection.
    if (installation.engineKind !== 'custom') next.engineKind = result.engineKind

    // Adopt a working executable if the stored one is gone.
    if (!installation.executablePath && result.executables[0]) {
      next.executablePath = result.executables[0]
    }

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
