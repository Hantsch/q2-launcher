/**
 * The three import handlers' logic (story 005, D3): scan an installation for
 * gamedirs with an importable config, preview what they contain, and commit
 * the result into a new profile.
 *
 * Kept as plain exported functions rather than inline in `configModule.setup()`
 * so they are testable against a real temp fixture tree without booting the
 * whole `MainModule`/`AppContext` machinery - same style as
 * `writeProfileToAssignedInstallations` in `./index.ts`. Each function takes
 * an `installations` lookup (not the concrete `InstallationsService`) as its
 * only main-process dependency, which is what lets a test fake "installation
 * not found" without a filesystem at all.
 *
 * Path trust (CLAUDE.md, decision 2): every function is addressed by
 * `{ installationId, gameDir }`, never by a path. The installation's own
 * `rootPath` is the only path that ever reaches `readImportableConfig()`, and
 * `gameDir` is checked against the installation's own recorded gamedirs
 * before it is used for anything - see `gameDirBelongsToInstallation()`.
 */

import { randomUUID } from 'node:crypto'
import { BASE_GAME_DIR } from '@shared/constants'
import { buildImportedActions } from '@shared/config/alias-import'
import type { AltLayer } from '@shared/config/alt-layers'
import {
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigProfile,
  type ImportCommitInput,
  type ImportGamedirCandidate,
  type ImportPreviewInput,
  type ImportPreviewResult,
  type ImportScanInput,
  type ImportScanResult,
  type UnrecognizedConfigLine,
} from '@shared/modules/config'
import { fail, ok, type Outcome } from '@shared/types'
import type { Installation } from '@shared/types'
import { isFile, resolveRelaxed } from '../../lib/fs-utils'
import type { Logger } from '../../lib/logger'
import { readImportableConfig } from './core/import-reader'

/** The subset of `InstallationsService` these handlers need. */
export interface ImportInstallations {
  find: (id: string) => Installation | undefined
}

/**
 * What `import.commit` calls to actually create the profile
 * (`ProfilesStore.createFromImport`). Story 041 (D6) adds `actions`/
 * `categories`/`layers` - `buildImportedActions`'s own result, alongside the
 * cvars/binds/unrecognized story 005 already produced, never replacing them.
 */
export type CreateProfileFromImport = (input: {
  name: string
  cvars: Record<string, string>
  binds: Record<string, string>
  unrecognized: UnrecognizedConfigLine[]
  actions: ConfigAction[]
  categories: ConfigActionCategory[]
  layers: AltLayer[]
}) => ConfigProfile[]

/**
 * `installation.gameDirs` plus `baseq2`, deduplicated, `baseq2` always first -
 * so a naive "pick candidates[0]" default (D4) always lands on the normal
 * case (decision 12), even though `gameDirs` is not documented to ever
 * contain `baseq2` itself.
 */
function candidateGameDirNames(installation: Installation): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const gameDir of [BASE_GAME_DIR, ...installation.gameDirs]) {
    if (seen.has(gameDir)) continue
    seen.add(gameDir)
    result.push(gameDir)
  }
  return result
}

/** True when `gameDir` is really one of `installation`'s own gamedirs. */
export function gameDirBelongsToInstallation(installation: Installation, gameDir: string): boolean {
  return gameDir === BASE_GAME_DIR || installation.gameDirs.includes(gameDir)
}

/** Case-insensitive existence check for `<rootPath>/<gameDir>/<fileName>`. */
async function hasFile(rootPath: string, gameDir: string, fileName: string): Promise<boolean> {
  const resolved = await resolveRelaxed(rootPath, `${gameDir}/${fileName}`)
  return resolved !== null && (await isFile(resolved))
}

/**
 * `import.scan`: every gamedir of `installation` that actually has a
 * `config.cfg` or an `autoexec.cfg` (decision 12) - a gamedir with neither is
 * left out entirely rather than listed as an empty candidate.
 */
export async function scanImportCandidates(
  installations: ImportInstallations,
  input: ImportScanInput,
): Promise<Outcome<ImportScanResult>> {
  const installation = installations.find(input.installationId)
  if (!installation) return fail('config.error.installationNotFound')

  const candidates: ImportGamedirCandidate[] = []
  for (const gameDir of candidateGameDirNames(installation)) {
    const hasConfigCfg = await hasFile(installation.rootPath, gameDir, 'config.cfg')
    const hasAutoexecCfg = await hasFile(installation.rootPath, gameDir, 'autoexec.cfg')
    if (hasConfigCfg || hasAutoexecCfg) {
      candidates.push({ gameDir, hasConfigCfg, hasAutoexecCfg })
    }
  }

  return ok({ candidates })
}

function logImportWarnings(
  log: Logger,
  installationId: string,
  warnings: { file: string; line: number; reason: string; target: string }[],
): void {
  for (const warning of warnings) {
    log.warn(
      `import: ${warning.reason} for exec target "${warning.target}" ` +
        `(${warning.file}:${warning.line}, installation ${installationId})`,
    )
  }
}

function logDuplicateBinds(
  log: Logger,
  installationId: string,
  duplicateBinds: { key: string; file: string; line: number }[],
): void {
  for (const duplicate of duplicateBinds) {
    log.warn(
      `import: key "${duplicate.key}" bound more than once ` +
        `(${duplicate.file}:${duplicate.line}, installation ${installationId})`,
    )
  }
}

/** Story 041 (D2/D6): mirrors `logDuplicateBinds` for alias redefinitions. */
function logDuplicateAliases(
  log: Logger,
  installationId: string,
  duplicateAliases: { name: string; file: string; line: number }[],
): void {
  for (const duplicate of duplicateAliases) {
    log.warn(
      `import: alias "${duplicate.name}" defined more than once ` +
        `(${duplicate.file}:${duplicate.line}, installation ${installationId})`,
    )
  }
}

/**
 * `import.preview`: the installation + gamedir validation happens before any
 * filesystem access (the acceptance line this is tested against directly),
 * then `readImportableConfig()` is shaped into counts + preserved lines.
 * Nothing is written - `readImportableConfig()` is read-only by construction
 * (decision 14).
 *
 * Story 041 (D6): also runs the alias definitions through `buildImportedActions`
 * with an empty `layerAliases` - the user has not answered anything yet, so
 * this is purely for `aliasCount`/`messageCount`/`ambiguousRebindAliases`,
 * never for the `actions`/`categories`/`layers` it would otherwise produce
 * (those are `commitImport`'s job, with the real answers). `newId` still has
 * to be a real factory even though preview discards its output, hence
 * `randomUUID` here too.
 */
export async function previewImport(
  installations: ImportInstallations,
  log: Logger,
  input: ImportPreviewInput,
): Promise<Outcome<ImportPreviewResult>> {
  const installation = installations.find(input.installationId)
  if (!installation) return fail('config.error.installationNotFound')
  if (!gameDirBelongsToInstallation(installation, input.gameDir)) {
    return fail('config.error.gameDirNotFound')
  }

  const result = await readImportableConfig(installation.rootPath, input.gameDir)
  logImportWarnings(log, installation.id, result.warnings)
  logDuplicateBinds(log, installation.id, result.duplicateBinds)
  logDuplicateAliases(log, installation.id, result.duplicateAliases)

  const imported = buildImportedActions({
    aliases: result.aliases,
    binds: result.binds,
    layerAliases: [],
    newId: randomUUID,
  })

  return ok({
    cvarCount: Object.keys(result.cvars).length,
    bindCount: Object.keys(result.binds).length,
    aliasCount: result.aliases.length,
    messageCount: imported.actions.filter((action) => action.kind === 'message').length,
    preserved: result.unrecognized,
    filesRead: result.filesRead,
    duplicateBinds: result.duplicateBinds,
    duplicateAliases: result.duplicateAliases,
    ambiguousRebindAliases: imported.ambiguous,
  })
}

/**
 * `import.commit`: same validation as `previewImport` (never trust a path
 * from the renderer - decision 2), then re-reads and re-parses from disk
 * (decision 3) rather than trusting anything the renderer previously saw
 * from `preview`, and hands the result to `createProfile` (in practice
 * `ProfilesStore.createFromImport`, injected by the caller so this stays
 * testable without a `StateStore`).
 *
 * Returns the raw created-profile list; live-assignment reconciliation
 * (`withLiveAssignments` in `./index.ts`) is the caller's job, not this
 * function's, so this file never needs the whole `MainModule` to be tested.
 *
 * Story 041 (D6): `input.layerAliases` is never trusted at face value
 * (CLAUDE.md - a renderer-supplied value is never trusted). `buildImportedActions`
 * itself does not reject an unknown name; it simply produces no layer for it
 * (`asLayer.has(name)` never matches anything when nothing in this import
 * actually has that name with a rebinding body). So this function checks every
 * name in `input.layerAliases` against `imported.ambiguous` - the same
 * ambiguous list `previewImport` reported for *this* import - and fails the
 * whole commit rather than silently dropping or accepting an invalid one. The
 * check runs after the one `buildImportedActions` call (its `ambiguous` output
 * does not depend on `layerAliases` - see the alias-import file doc comment -
 * so nothing here needs a second, throwaway call to compute it), and before
 * `imported.actions`/`categories`/`layers` are ever handed to `createProfile`.
 */
export async function commitImport(
  installations: ImportInstallations,
  log: Logger,
  input: ImportCommitInput,
  createProfile: CreateProfileFromImport,
): Promise<Outcome<ConfigProfile[]>> {
  const installation = installations.find(input.installationId)
  if (!installation) return fail('config.error.installationNotFound')
  if (!gameDirBelongsToInstallation(installation, input.gameDir)) {
    return fail('config.error.gameDirNotFound')
  }

  const result = await readImportableConfig(installation.rootPath, input.gameDir)
  logImportWarnings(log, installation.id, result.warnings)
  logDuplicateBinds(log, installation.id, result.duplicateBinds)
  logDuplicateAliases(log, installation.id, result.duplicateAliases)

  const layerAliases = input.layerAliases ?? []
  const imported = buildImportedActions({
    aliases: result.aliases,
    binds: result.binds,
    layerAliases,
    newId: randomUUID,
  })

  const ambiguousNames = new Set(
    imported.ambiguous.map((alias) => alias.name.trim().toLowerCase()),
  )
  const unknownLayerAliases = layerAliases.filter(
    (name) => !ambiguousNames.has(name.trim().toLowerCase()),
  )
  if (unknownLayerAliases.length > 0) {
    log.warn(
      `import.commit: rejected layerAliases not ambiguous in this import ` +
        `(installation ${installation.id}): ${unknownLayerAliases.join(', ')}`,
    )
    return fail('config.error.invalidLayerAlias')
  }

  const profiles = createProfile({
    name: input.name,
    cvars: result.cvars,
    binds: result.binds,
    unrecognized: result.unrecognized,
    actions: imported.actions,
    categories: imported.categories,
    layers: imported.layers,
  })

  return ok(profiles)
}
