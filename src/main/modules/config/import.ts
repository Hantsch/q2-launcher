/**
 * The three import handlers' logic (story 005 D3, re-addressed by story 066 D5): open the config
 * file picker, preview what the picked files contain, and commit the result into a new profile.
 *
 * Kept as plain exported functions rather than inline in `configModule.setup()`
 * so they are testable against a real temp fixture tree without booting the
 * whole `MainModule`/`AppContext` machinery - same style as
 * `writeProfileToAssignedInstallations` in `./index.ts`.
 *
 * **Path trust** (CLAUDE.md; story 005 decision 2, story 066 decision "picker ownership"). Story
 * 066 D5 replaced the old `{ installationId, gameDir }` addressing - which confined every read to a
 * registered installation's own folder - with file-picker addressing. What confines the reads now:
 *
 * - The renderer sends `fileIds` and nothing else. There is no path field on any of these inputs,
 *   so there is no renderer-supplied path to validate, sanitise or accidentally trust.
 * - An id only ever means something because `pickImportFiles` put it in the session registry
 *   (`picked-files.ts`) together with a path a real OS picker returned. An id the renderer invented
 *   resolves to nothing, and the whole request is refused before any file is opened.
 * - Which folders the *config files themselves* can reach is the reader's guarantee, unchanged:
 *   `readImportableFiles` confines an `exec` to the containing file's own folder (AC8).
 *
 * Neither `previewImportFiles` nor `commitImportFiles` has an installations dependency at all any
 * more, which is what makes "import from files needs no installation" (AC9) true by construction
 * rather than by a test.
 */

import { randomUUID } from 'node:crypto'
import { BASE_GAME_DIR } from '@shared/constants'
import type { AltLayer } from '@shared/config/alt-layers'
import {
  foreignBannerCommentText,
  restoreProfileParts,
  type RestoreCommentLine,
  type RestoreProfilePartsInput,
} from '@shared/config/profile-restore'
import {
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigCvarSection,
  type ConfigProfile,
  type ImportFilesCommitInput,
  type ImportFilesPreviewInput,
  type ImportMetadataWarning,
  type ImportPreviewResult,
  type PickedConfigFile,
  type UnrecognizedConfigLine,
} from '@shared/modules/config'
import { fail, ok, type Outcome } from '@shared/types'
import type { Installation } from '@shared/types'
import type { Logger } from '../../lib/logger'
import { readImportableFiles, type ImportResult } from './core/import-reader'
import {
  UnknownPickedFileError,
  type PickedFileRegistrar,
  type PickedFileResolver,
} from './picked-files'

/**
 * The subset of `DialogService` (`main/services/dialog.ts`) `pickImportFiles` needs - the concrete
 * service is not taken, so a test drives the flow with a fake picker instead of an OS dialog.
 */
export interface ConfigFilePicker {
  pickConfigFiles: (options: { defaultPath?: string }) => Promise<string[]>
}

/**
 * What `import.commitFiles` calls to actually create the profile
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
  /**
   * Story 059 D5: `restoreProfileParts`'s own `cvarSections`, passed through unchanged - the
   * Settings-tab counterpart of `categories` above. Always an array (possibly empty, never
   * `undefined`): a foreign config with no cvar-group banners at all files every cvar unplaced,
   * which is exactly what an empty list means (see `profile-restore.ts`'s "Cvar sections" doc
   * comment - the reserved `Other` bucket is the *absence* of a section, not a section of its own).
   */
  cvarSections: ConfigCvarSection[]
}) => ConfigProfile[]

/**
 * True when `gameDir` is really one of `installation`'s own gamedirs.
 *
 * No import path uses this any more (story 066 D5 removed the gamedir-addressed handlers together
 * with their guards); it stays here because `cleanup.ts` deliberately reuses story 005's rule for
 * its own path-trust check (story 010 decision 10, `entryIsTrusted`) and that is its only caller.
 */
export function gameDirBelongsToInstallation(installation: Installation, gameDir: string): boolean {
  return gameDir === BASE_GAME_DIR || installation.gameDirs.includes(gameDir)
}

/**
 * Story 066 D5: the reader's own warnings, logged without an installation to attribute them to -
 * `file` is the bare file name the reader recorded (never an absolute path, see `processFile`), so
 * this stays a log line about config content rather than about the user's folder layout.
 */
function logImportWarnings(
  log: Logger,
  warnings: { file: string; line: number; reason: string; target: string }[],
): void {
  for (const warning of warnings) {
    log.warn(
      `import: ${warning.reason} for exec target "${warning.target}" ` +
        `(${warning.file}:${warning.line})`,
    )
  }
}

function logDuplicateBinds(
  log: Logger,
  duplicateBinds: { key: string; file: string; line: number }[],
): void {
  for (const duplicate of duplicateBinds) {
    log.warn(
      `import: key "${duplicate.key}" bound more than once ` +
        `(${duplicate.file}:${duplicate.line})`,
    )
  }
}

/**
 * Shapes one `readImportableConfig()` result into `restoreProfileParts`'s input (story 042 D5).
 *
 * `binds`/`cvars` keep their pre-existing `Record<string, string>` shape on `ImportResult` (every
 * other caller already destructures them as plain value maps), so their `file`/`line` travel in
 * the parallel `bindLines`/`cvarLines` maps this deliverable added to the reader; a name with no
 * recorded position (should not happen for anything actually in `binds`/`cvars`) falls back to an
 * empty file/line 0 rather than throwing, so a reader bug degrades to a mis-attributed category
 * instead of a crashed import.
 */
/**
 * `result.comments` plus every `result.unrecognized` line `foreignBannerCommentText` recognises as a
 * foreign author's own marker-less section banner (story 059 D5 - `dm.cfg`'s own
 * `<<--- .: General Settings :. --->>`/`##### 1st row #####` conventions, which
 * `config-parser.ts` classifies as `unrecognized` rather than as a comment, since neither ever
 * carries a `//` marker at all). Merged back into overall document order (`result.filesRead`'s own
 * file order, then line number within a file) so `scanComments`' "last header above this line"
 * search - which assumes its input arrives in that order - still works once the two are combined.
 *
 * Purely additive and read-only: `result.unrecognized`/`result.preserved` themselves are never
 * touched, so a line promoted here is *also* still reported as unrecognized to the import dialog -
 * exactly as any other untagged banner already is (a cvar group's plain label is never removed from
 * `preserved` either). See `foreignBannerCommentText`'s own doc comment for why this can never
 * become a second, competing section-boundary mechanism: it only decides what counts as candidate
 * *input* for `scanComments`, never what a section actually is.
 */
function mergeForeignBannerComments(result: ImportResult): RestoreCommentLine[] {
  const fileOrder = new Map(result.filesRead.map((file, index) => [file, index]))
  const orderKey = (position: { file: string; line: number }): number =>
    (fileOrder.get(position.file) ?? 0) * 1_000_000 + position.line

  const bannerComments: RestoreCommentLine[] = []
  for (const line of result.unrecognized) {
    const text = foreignBannerCommentText(line.text)
    if (text !== null) bannerComments.push({ file: line.file, line: line.line, text })
  }

  return [...result.comments, ...bannerComments].sort((a, b) => orderKey(a) - orderKey(b))
}

export function toRestoreInput(
  result: ImportResult,
  layerAliases: readonly string[] | undefined,
  newId: () => string,
): RestoreProfilePartsInput {
  return {
    aliases: result.aliases.map(({ name, body, file, line, comment, codeWidth }) => ({
      name,
      body,
      file,
      line,
      comment,
      codeWidth,
    })),
    binds: Object.entries(result.binds).map(([key, command]) => {
      const position = result.bindLines[key]
      return {
        key,
        command,
        file: position?.file ?? '',
        line: position?.line ?? 0,
        comment: result.bindComments[key] ?? '',
      }
    }),
    cvars: Object.entries(result.cvars).map(([name, value]) => {
      const position = result.cvarLines[name]
      // Story 059 review Fix 3: `firstFile`/`firstLine` carry the name's FIRST occurrence
      // (`result.cvarFirstLines`) separately from `file`/`line`'s last-assignment-wins position -
      // `restoreProfileParts`'s `readCvarSections` uses the former for section attribution, the
      // rest of the pipeline keeps using the latter unchanged.
      const firstPosition = result.cvarFirstLines[name]
      return {
        name,
        value,
        file: position?.file ?? '',
        line: position?.line ?? 0,
        comment: result.cvarComments[name] ?? '',
        ...(firstPosition ? { firstFile: firstPosition.file, firstLine: firstPosition.line } : {}),
      }
    }),
    comments: mergeForeignBannerComments(result),
    layerAliases,
    newId,
  }
}

/**
 * `ImportPreviewResult.preserved` minus whatever `restoreProfileParts` reported as *understood*
 * (story 042, D6 fix) - the header's version marker, a well-formed section banner, a well-formed
 * entry anchor. `preserved` is supposed to mean "we don't understand this, so we kept it verbatim";
 * a recognised `[q2l ...]` line in a launcher-written file is the opposite of that, and showing it
 * anyway is misleading noise the import dialog's "preserved" list should not carry.
 *
 * `consumed` is always empty on the untagged/foreign-config delegation path (nothing there was
 * recognised as a tag at all), so this is a no-op for that path by construction - AC8's fixture
 * count is unaffected without needing a separate `ownWrittenFile` branch here.
 */
function preservedLinesFor<T extends { file: string; line: number }>(
  unrecognized: readonly T[],
  consumed: readonly { file: string; line: number }[],
): T[] {
  if (consumed.length === 0) return [...unrecognized]
  const consumedKeys = new Set(consumed.map((position) => `${position.file}:${position.line}`))
  return unrecognized.filter((line) => !consumedKeys.has(`${line.file}:${line.line}`))
}

/**
 * `RestoreWarning.reason` -> the i18n key it crosses the module boundary as (story 042 D5) -
 * `config.import.warning.<reasonCode>`, consistent enough for D6 to wire to real `en.json` entries
 * later without a second naming pass here.
 */
function toMetadataWarnings(
  warnings: readonly { reason: string; file: string; line: number; subject?: string }[],
): ImportMetadataWarning[] {
  return warnings.map((warning) => ({
    key: `config.import.warning.${warning.reason}`,
    file: warning.file,
    line: warning.line,
    ...(warning.subject !== undefined ? { subject: warning.subject } : {}),
  }))
}

/** Story 041 (D2/D6): mirrors `logDuplicateBinds` for alias redefinitions. */
function logDuplicateAliases(
  log: Logger,
  duplicateAliases: { name: string; file: string; line: number }[],
): void {
  for (const duplicate of duplicateAliases) {
    log.warn(
      `import: alias "${duplicate.name}" defined more than once ` +
        `(${duplicate.file}:${duplicate.line})`,
    )
  }
}

/**
 * Story 066 D5: `fileIds` -> absolute paths, or a refusal - the one gate every read in this file is
 * behind.
 *
 * Runs before any filesystem access and rejects the WHOLE request if a single id is unknown
 * (`PickedFilesRegistry.resolve`), so an invented id cannot ride along with real ones and get the
 * rest of them imported. The failure is deliberately indistinguishable for a stale id and an
 * invented one, and the log line deliberately does not echo the id: that value is renderer-supplied
 * text of unbounded length (the payload schema only requires a non-empty string), which has no
 * business in the log file.
 */
function resolvePickedPaths(
  picked: PickedFileResolver,
  log: Logger,
  fileIds: readonly string[],
): Outcome<string[]> {
  try {
    return ok(picked.resolve(fileIds))
  } catch (error) {
    if (error instanceof UnknownPickedFileError) {
      log.warn(
        `import: refused a request carrying ${fileIds.length} file id(s) - one of them was never ` +
          `handed out by this session's file picker`,
      )
      return fail('config.error.pickedFileNotFound')
    }
    throw error
  }
}

/**
 * `import.pickFiles`: opens the real picker and registers what came back (story 066 D5).
 *
 * The only writer of the session registry, and the only place an absolute path enters this flow at
 * all. A cancelled dialog yields `[]` from `DialogService.pickConfigFiles` and therefore an empty,
 * successful result here - "the user picked nothing" is not an error, and it must not clear the
 * files the dialog is already showing (which is why nothing is reset on this path).
 *
 * `defaultPath` is a convenience the caller computes (the selected or last installation's `baseq2`,
 * see `./index.ts`); it is a *starting folder* for the OS dialog, never a path that gets read - the
 * user's actual selection is the only thing that ends up in the registry.
 */
export async function pickImportFiles(
  picker: ConfigFilePicker,
  registry: PickedFileRegistrar,
  log: Logger,
  options: { defaultPath?: string } = {},
): Promise<Outcome<PickedConfigFile[]>> {
  const paths = await picker.pickConfigFiles(options)
  if (paths.length === 0) {
    log.info('import: file picker cancelled or nothing selected')
    return ok([])
  }

  const files = registry.register(paths)
  log.info(`import: registered ${files.length} picked config file(s)`)
  return ok(files)
}

/**
 * `import.previewFiles`: id resolution happens before any filesystem access (the acceptance line
 * this is tested against directly), then `readImportableFiles()` is shaped into counts + preserved
 * lines. Nothing is written - the reader is read-only by construction (story 005 decision 14), and
 * `ProfilesStore` is not even reachable from here: `createProfile` is a parameter of
 * `commitImportFiles` alone (AC10).
 *
 * Story 041 (D6): also runs the folded config through `restoreProfileParts`
 * (story 042 D4/D5) with an empty `layerAliases` - the user has not answered
 * anything yet, so this is purely for `aliasCount`/`messageCount`/
 * `ambiguousRebindAliases`/`ownWrittenFile`/`metadataVersion`/
 * `sourceProfileId`/`metadataWarnings`, never for the `actions`/`categories`/
 * `layers` it would otherwise produce (those are `commitImportFiles`'s job, with
 * the real answers). `newId` still has to be a real factory even though
 * preview discards its output, hence `randomUUID` here too.
 *
 * Story 042 D5: for a foreign config `restoreProfileParts` delegates wholesale
 * to story 041's `buildImportedActions` (same input, same `newId`), so this
 * call is a strict superset of what `previewImportFiles` computed before this
 * deliverable - nothing about the pre-042 preview behaviour changes for a file
 * with no `[q2l ...]` metadata.
 */
export async function previewImportFiles(
  picked: PickedFileResolver,
  log: Logger,
  input: ImportFilesPreviewInput,
): Promise<Outcome<ImportPreviewResult>> {
  const paths = resolvePickedPaths(picked, log, input.fileIds)
  if (!paths.ok) return paths

  const result = await readImportableFiles(paths.value)
  logImportWarnings(log, result.warnings)
  logDuplicateBinds(log, result.duplicateBinds)
  logDuplicateAliases(log, result.duplicateAliases)

  const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))

  return ok({
    cvarCount: Object.keys(result.cvars).length,
    bindCount: Object.keys(result.binds).length,
    aliasCount: result.aliases.length,
    messageCount: restored.actions.filter((action) => action.kind === 'message').length,
    preserved: preservedLinesFor(result.unrecognized, restored.consumedCommentLines),
    filesRead: result.filesRead,
    duplicateBinds: result.duplicateBinds,
    duplicateAliases: result.duplicateAliases,
    ambiguousRebindAliases: restored.ambiguous,
    ownWrittenFile: restored.sourceProfileId !== null,
    metadataVersion: restored.metadataVersion,
    sourceProfileId: restored.sourceProfileId,
    metadataWarnings: toMetadataWarnings(restored.warnings),
    cvarSections: restored.cvarSections,
  })
}

/**
 * `import.commitFiles`: same id resolution as `previewImportFiles` (never trust a path from the
 * renderer - story 005 decision 2), then reads and parses **from disk again** (decision 3, story
 * 066's own restatement of it) rather than trusting anything the renderer previously saw from
 * `previewFiles`, and hands the result to `createProfile` (in practice
 * `ProfilesStore.createFromImport`, injected by the caller so this stays
 * testable without a `StateStore`).
 *
 * The re-read is the whole point of the flow's shape, so it is worth being precise about what makes
 * it one: nothing from the preview reaches this function. The preview's `ImportPreviewResult` is
 * not an input here (`ImportFilesCommitInput` carries only `fileIds`/`name`/`layerAliases`), and no
 * parsed result is cached anywhere between the two calls - the only thing the two share is the
 * registry's id -> path map. So whatever the file says at commit time is what gets stored, even if
 * the user edited it after previewing, and there is no cached preview a replayed request could
 * resurrect.
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
 * ambiguous list `previewImportFiles` reported for *this* import - and fails the
 * whole commit rather than silently dropping or accepting an invalid one. The
 * check runs after the one `restoreProfileParts` call (its `ambiguous` output
 * does not depend on `layerAliases` - see the alias-import file doc comment -
 * so nothing here needs a second, throwaway call to compute it), and before
 * `restored.actions`/`categories`/`layers` are ever handed to `createProfile`.
 *
 * Story 042 D5: `restoreProfileParts` replaces the direct `buildImportedActions`
 * call - a foreign config still delegates to it wholesale (AC8), while a
 * launcher-written file (`restored.sourceProfileId !== null`, the same
 * ownership check `previewImportFiles` reports as `ownWrittenFile` - the header
 * tag's `id` field, or the legacy sentinel, read either way through
 * `scanComments` in `@shared/config/profile-restore`)
 * reconstructs entries/categories/layers from its `[q2l ...]` metadata
 * instead. `restoreProfileParts` always reports an empty `ambiguous` list on
 * that path (D4: "there is nothing to guess"), so the `layerAliases` review
 * step below is skipped outright for an own-written file rather than
 * rejecting a stray answer the (skip-aware) dialog should never have sent.
 * `restored.actions`/`categories`/`layers` are what `createProfile` stores
 * either way - never the pre-restore `buildImportedActions` result directly.
 *
 * The profile `id` `createProfile` (`ProfilesStore.createFromImport`) mints is
 * always fresh (AC4) - `restored.sourceProfileId` is reported by `preview`
 * only so the dialog can say which profile this looks like a restore of, and
 * is never read here at all, so importing the same file twice yields two
 * profiles with two different ids by construction.
 */
export async function commitImportFiles(
  picked: PickedFileResolver,
  log: Logger,
  input: ImportFilesCommitInput,
  createProfile: CreateProfileFromImport,
): Promise<Outcome<ConfigProfile[]>> {
  const paths = resolvePickedPaths(picked, log, input.fileIds)
  if (!paths.ok) return paths

  const result = await readImportableFiles(paths.value)
  logImportWarnings(log, result.warnings)
  logDuplicateBinds(log, result.duplicateBinds)
  logDuplicateAliases(log, result.duplicateAliases)

  const layerAliases = input.layerAliases ?? []
  const restored = restoreProfileParts(toRestoreInput(result, layerAliases, randomUUID))
  const ownWrittenFile = restored.sourceProfileId !== null

  if (!ownWrittenFile) {
    const ambiguousNames = new Set(
      restored.ambiguous.map((alias) => alias.name.trim().toLowerCase()),
    )
    const unknownLayerAliases = layerAliases.filter(
      (name) => !ambiguousNames.has(name.trim().toLowerCase()),
    )
    if (unknownLayerAliases.length > 0) {
      log.warn(
        `import.commitFiles: rejected layerAliases not ambiguous in this import: ` +
          `${unknownLayerAliases.join(', ')}`,
      )
      return fail('config.error.invalidLayerAlias')
    }
  }

  const profiles = createProfile({
    name: input.name,
    cvars: result.cvars,
    binds: result.binds,
    // Story-042-review finding 5 (fix-cycle-5 continuation): `previewImportFiles` already filters
    // `restored.consumedCommentLines` out of what it calls "preserved" - the header block's
    // decoration, the sentinel, a well-formed section banner - because those are understood,
    // launcher-owned lines, not foreign leftovers. `commitImportFiles` handed `result.unrecognized`
    // to `createProfile` *unfiltered*, so the profile that got created carried every one of those
    // understood lines as `unrecognized` anyway; the Care tab (which reads a profile's own
    // `unrecognized` list) then asked the user to tidy up the launcher's own metadata on every
    // restored profile. Same filter, same reasoning, applied where the data actually gets stored.
    unrecognized: preservedLinesFor(result.unrecognized, restored.consumedCommentLines),
    actions: restored.actions,
    categories: restored.categories,
    layers: restored.layers,
    cvarSections: restored.cvarSections,
  })

  return ok(profiles)
}
