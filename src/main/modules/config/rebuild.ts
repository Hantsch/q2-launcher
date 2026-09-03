/**
 * Story 043 D3: `state.json` stops being the profile's home and becomes a rebuildable cache.
 *
 * Two behaviours live here, and they are deliberately *not* the same mechanism:
 *
 * 1. **Rebuild-on-missing-record** (`rebuildMissingProfileRecords`, every start, cheap): every
 *    launcher-owned `.cfg` in the canonical directory whose sentinel id has no matching record in
 *    `state.json` gets a record rebuilt from that file's own content, **keeping the sentinel's id**
 *    (AC2). This is the exact opposite of story 042 AC4's import rule - an import of a foreign file
 *    always mints a new id - and the two therefore stay separate functions with separate
 *    `ProfilesStore` entry points (`addRebuilt` vs. `createFromImport`), because reusing the import
 *    path here would silently mint a new id and orphan every installation assignment pointing at
 *    the old one. A `.cfg` that carries no recognised `OWNERSHIP_MARKER` + id at all is never
 *    adopted: `readCanonicalOwnership` reports no owner for it, so it is not even a candidate.
 *
 * 2. **The one-time format migration** (`migrateCanonicalFiles`, AC8, gated by
 *    `configFileSourceMigratedAt`): every profile record that already exists in `state.json` gets
 *    its canonical file rewritten from the cached profile data into the current 040/042 format
 *    through the normal write path (`writeCanonicalProfileFile`, which renders internally), and its
 *    `fileHash` seeded from what was just written - so the very first `readFileState` on that file
 *    reports `unchanged` rather than a false `changedOnDisk`. The guard is only set once the whole
 *    set succeeded; a second start is a no-op for this step.
 *
 * **Order matters and is fixed**: the migration runs over the records that exist *before* the
 * rebuild adds any. A rebuilt record is reconstructed from a file, and re-rendering it back over
 * that same file would drop whatever the reconstruction could not represent (an unrecognised
 * comment the user hand-added, for instance) - so a freshly rebuilt profile must never be part of
 * the migration's write set. The rebuild itself writes **nothing**: it reads, and seeds the hash of
 * the bytes it read.
 *
 * Nothing here deletes anything, and nothing here adds backup logic: `writeCanonicalProfileFile` ->
 * `writeTargetFile` already owns the diff-skip/backup-once/atomic-write contract
 * (`docs/ARCHITECTURE.md`, "State and persistence"), and `state.json.bak` stays exactly the
 * `JsonStore` artefact it is today.
 *
 * Takes plain data and callbacks rather than `AppContext`/`StateStore`, the same style as
 * `import.ts` and `writeProfileToAssignedInstallations` (`./index.ts`), so all of it is testable
 * against a real temp directory without booting `configModule.setup()`.
 */

import { readFile, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { resolveProfileFileNames, sanitizeProfileFileBase } from '@shared/config/profile-files'
import { HAND_EDIT_SENTENCE, renderProfileFile } from '@shared/config/render'
import { stripCatalogDefaults } from '@shared/config/cvar-defaults'
import { captureBaseline } from '@shared/config/profile-baseline'
import type { ConfigProfile } from '@shared/modules/config'
import type { Logger } from '../../lib/logger'
import { readCanonicalOwnership, writeCanonicalProfileFile } from './canonical'
import { hashCanonicalFileContent, readFileState, type ParsedCanonicalProfile } from './file-source'

/** Same encoding every reader of a `.cfg` in this codebase uses - see `file-source.ts`. */
const FILE_ENCODING: BufferEncoding = 'latin1'

/**
 * Cap on a name recovered from a file header, matching the 120-character cap the *IPC* payload
 * schemas put on a profile name (`main/modules/config/schemas.ts`). The persisted schema caps
 * nothing, and the header banner itself allows up to `BANNER_TEXT_CAP` (256) characters, so a
 * hand-edited header could otherwise seed a name no path through the UI could ever have produced.
 */
const MAX_RECOVERED_NAME_LENGTH = 120

// ---------------------------------------------------------------------------
// Recovering the few fields the file carries only as decoration
// ---------------------------------------------------------------------------

/**
 * `render.ts`'s header block, as it is on disk:
 *
 * ```
 * // q2-launcher profile <id> - hand-edited changes are read back   <- the sentinel, line 1
 * // =============================================================  <- the `=` rule
 * //  <profile name> [q2l v=1]                                      <- the line this reads
 * //  Q2 Launcher - hand-edited changes to this file are read back
 * // =============================================================
 * ```
 *
 * so the name is the comment line directly after the first `=` rule. That rule is what anchors
 * this: `banner({ fill: '=' })` is used for the header block and nowhere else in a profile file, so
 * there is no other `=`-ruled line for this to latch onto.
 */
const HEADER_RULE = /^\/\/\s*={3,}\s*\r?$/

/** A trailing `[q2l ...]` tag - the header line's own `v` marker (story 042 D2). Stripped by
 * position (it is always last on the line, appended by `fitProseAndTag`) rather than searched for,
 * so a name that merely *contains* something bracket-shaped is left alone. */
const TRAILING_META_TAG = /\s*\[q2l[^\]]*\]\s*$/

/** How far into the file the header block can possibly reach - the sentinel, the rule, the name,
 * the sentence, the closing rule, plus slack for a hand-inserted line or two. Bounded so this never
 * walks a 30 KB file looking for a rule that is not there. */
const HEADER_SCAN_LINES = 8

/**
 * The profile display name the file's header block carries, or `null` when the header does not look
 * like one this writer produced (a pre-040 file, or one whose header was hand-removed).
 *
 * Reading the name off the file rather than off the file *name* is deliberate: the file name is the
 * *sanitized* base (`sanitizeProfileFileBase` maps every space and every non-`[A-Za-z0-9_.-]`
 * character to `-`), so `"My Config"` would come back as `"My-Config"`. The header carries the name
 * as the user typed it, modulo `sanitizeComment`/`neutralizeProse`, and - now that the file is the
 * source of truth - a user who renames the profile *in the header* means it.
 */
export function recoverProfileName(content: string): string | null {
  const lines = content.split('\n', HEADER_SCAN_LINES)
  const ruleIndex = lines.findIndex((line) => HEADER_RULE.test(line))
  if (ruleIndex === -1) return null

  const nameLine = lines[ruleIndex + 1]
  if (nameLine === undefined || !nameLine.startsWith('//')) return null

  const name = nameLine.slice(2).replace(TRAILING_META_TAG, '').trim()
  // The hand-edit sentence is the header's *second* content line; seeing it here means the name
  // line is gone, and adopting the sentence as a profile name would be worse than falling back.
  if (name.length === 0 || name === HAND_EDIT_SENTENCE) return null
  return name.slice(0, MAX_RECOVERED_NAME_LENGTH).trim() || null
}

/**
 * A bare `unbindall` command line (story 040 D4's opening line), never one inside a comment
 * (`// unbindall` starts with `/`) or an alias body (`alias x "unbindall"` starts with `alias`).
 * `\r` is tolerated so a CRLF file reads the same as an LF one.
 */
const UNBINDALL_LINE = /^[ \t]*unbindall[ \t]*(\/\/.*)?\r?$/m

/**
 * Whether the file opens with `unbindall`, i.e. what `profile.writeUnbindall` has to be for the next
 * render of this profile to reproduce the file it was rebuilt from.
 *
 * Read from the file rather than defaulted, because the persisted default is `true`
 * (`main/lib/schemas.ts`) and defaulting would silently flip the setting *on* for a user who turned
 * it off - the next save would then add a line to their file that they had deliberately removed.
 */
export function detectWriteUnbindall(content: string): boolean {
  return UNBINDALL_LINE.test(content)
}

/**
 * `sectionHeaderStyle` inferred from the file's own section banners, or `undefined` when the file
 * carries none this recognises (a profile with no sections at all - no cvars, no binds, no aliases -
 * has no banner to read a style off, and `undefined` then reads back as the `'dashes'` default).
 *
 * Each of the three styles is recognised by the *fixed anchor* `banner()` writes for it and by
 * nothing else, in most-specific-first order - never by a loose "contains dashes" test:
 *
 * - `brackets`: `// ----- [ <title> ] -----`
 * - `dashes`:   `// --- <title> ---...`
 * - `plain`:    `// <title>` with no decoration at all, so the only safe signal is one of the three
 *   reserved section-title prefixes this writer puts in front of *every* category section
 *   (`profile-restore.ts` relies on the same three for the same reason).
 *
 * Best-effort by nature: a hand-typed comment shaped exactly like one of these anchors can mislead
 * it. The cost of a wrong answer is the decoration the *next* save writes, never a lost bind or
 * cvar, which is why an inference is acceptable here at all.
 */
const BRACKETS_BANNER = /^\/\/ ----- \[ /m
const DASHES_BANNER = /^\/\/ --- /m
const PLAIN_BANNER = /^\/\/ (?:Aliases|Binds|Entries): /m

export function detectSectionHeaderStyle(
  content: string,
): ConfigProfile['sectionHeaderStyle'] | undefined {
  if (BRACKETS_BANNER.test(content)) return 'brackets'
  if (DASHES_BANNER.test(content)) return 'dashes'
  if (PLAIN_BANNER.test(content)) return 'plain'
  return undefined
}

/**
 * `createdAt`/`updatedAt` for a rebuilt record, taken from the file's own timestamps rather than
 * from the clock.
 *
 * `createdAt` is not cosmetic: `resolveProfileFileNames` orders name claims by it, so a rebuilt
 * profile stamped "now" would sort behind every other profile and could be pushed off the very file
 * name it was just rebuilt from (onto `<base>-2.cfg`) the next time anything writes. The file's
 * birth time is the closest honest answer available; `mtime` is the fallback where the platform does
 * not report one, and is clamped so `createdAt` can never end up after `updatedAt`.
 */
function timestampsFor(stats: Stats | null, now: number): { createdAt: string; updatedAt: string } {
  const usable = (value: number | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

  const modified = usable(stats?.mtimeMs) ?? now
  const born = usable(stats?.birthtimeMs)
  const created = born === null ? modified : Math.min(born, modified)

  return {
    createdAt: new Date(created).toISOString(),
    updatedAt: new Date(modified).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Building the record
// ---------------------------------------------------------------------------

export interface RebuiltProfileInput {
  /** The id the file's own ownership sentinel carries - never a fresh one. */
  id: string
  /** The file this was rebuilt from, `<baseDir>`-relative. */
  fileName: string
  /** Raw latin1 file content, for the header/format recovery above. `null` when it could not be
   * re-read, in which case every recovered field falls back to its documented default. */
  content: string | null
  /** What `readFileState` parsed out of that same file. */
  parsed: ParsedCanonicalProfile
  /** sha-256 of the bytes `readFileState` read, so the first refresh reports `unchanged`. */
  fileHash: string
  stats: Stats | null
  now: number
}

/**
 * One rebuilt `ConfigProfile`, shaped exactly like `ProfilesStore.createFromImport`'s record (same
 * fields, same "no assignments" starting point) so a rebuilt profile is indistinguishable from an
 * ordinary one downstream - only the id and the timestamps come from a different place.
 *
 * What is knowingly **not** recovered, because the file has nowhere to carry it, and what AC2 means
 * by "its assignments/played-mods absence is the only loss":
 *
 * - `assignments` - a profile's link to installations is launcher bookkeeping, never file content.
 *   Played mods live in `configPlayedMods`, keyed by installation, and are likewise not touched.
 * - `unrecognized` - the preserved-verbatim lines an *import* records. They are still physically in
 *   the file (nothing deleted them), and the file is now the source of truth, so an empty list here
 *   costs a Care tidy-up suggestion, not data.
 *
 * Story 048 D3: `cvars` goes through `stripCatalogDefaults` for the same reason
 * `profiles.ts#adoptFromFile` does - see that method's own doc comment. A rebuild reads a file the
 * launcher itself wrote (nothing without a recognised `OWNERSHIP_MARKER` + id is ever a candidate,
 * see `rebuildMissingProfileRecords`), and since D2 such a file states every catalogue cvar
 * explicitly; adopting all ~30 verbatim would record "the user chose this" for every default the
 * writer merely restated. A cvar the catalogue does not know is kept exactly as the file had it, so
 * nothing the file carries beyond the catalogue is lost. The foreign-import path
 * (`ProfilesStore.createFromImport`) is untouched by this.
 */
export function buildRebuiltProfile(input: RebuiltProfileInput): ConfigProfile {
  const { content, parsed } = input
  const name =
    (content === null ? null : recoverProfileName(content)) ??
    fallbackProfileName(input.fileName, input.id)
  const style = content === null ? undefined : detectSectionHeaderStyle(content)

  return {
    id: input.id,
    name,
    ...timestampsFor(input.stats, input.now),
    // Returns a fresh map, so this is the copy `{ ...parsed.cvars }` used to make.
    cvars: stripCatalogDefaults(parsed.cvars),
    binds: { ...parsed.binds },
    assignments: [],
    unrecognized: [],
    actions: parsed.actions,
    categories: parsed.categories,
    layers: parsed.layers,
    // `content === null` cannot be reached through `rebuildMissingProfileRecords` (the file was
    // just read successfully by `readFileState`), so the `true` here is the persisted default
    // rather than a guess that overrides a detected `false`.
    writeUnbindall: content === null ? true : detectWriteUnbindall(content),
    ...(style === undefined ? {} : { sectionHeaderStyle: style }),
    fileHash: input.fileHash,
    fileSeenAt: input.now,
    // Story 049 D1 seeds the `baseline` that belongs next to this hash one step later, in
    // `ProfilesStore.addRebuilt` - see `ProfilesStore.seedBaseline` for why it has to be taken after
    // the adoption pass, which this pure builder does not (and must not) run.
    dirty: false,
    // The bytes on disk are exactly the bytes `fileHash` was taken over, which is what
    // `unchanged` means (see `ProfileFileState`) - not a claim that re-rendering this record
    // would reproduce the file byte-for-byte.
    fileState: 'unchanged',
  }
}

/**
 * Name for a rebuilt profile whose file header carries none: the file's own base name, which *is*
 * the sanitized profile name (`sanitizeProfileFileBase`), so it is the closest thing left on disk.
 * An empty base falls back to that function's own `profile-<id8>` convention rather than to a new
 * one, so a nameless rebuild reads the same way a nameless profile's file already does.
 */
function fallbackProfileName(fileName: string, id: string): string {
  const base = fileName.replace(/\.cfg$/i, '').trim()
  return base.length > 0 ? base.slice(0, MAX_RECOVERED_NAME_LENGTH) : sanitizeProfileFileBase('', id)
}

// ---------------------------------------------------------------------------
// The two startup steps
// ---------------------------------------------------------------------------

export interface FileSourceStartupDeps {
  /** The canonical directory - `userDataDir()` in production. */
  baseDir: string
  /** `ProfilesStore.list` - every record `state.json` currently holds. */
  listProfiles: () => ConfigProfile[]
  /** `ProfilesStore.replaceProfile` - the commit path for a record that already exists. */
  replaceProfile: (profile: ConfigProfile) => void
  /** `ProfilesStore.addRebuilt` - the commit path for a record being restored from its file. */
  addProfile: (profile: ConfigProfile) => void
  /** `StateStore.configFileSourceMigratedAt` - AC8's one-time guard. */
  migratedAt: () => string | null
  /** `StateStore.setConfigFileSourceMigratedAt` - write-once by contract. */
  setMigratedAt: (at: string) => void
  log: Logger
  /** Injectable clock (epoch ms), so a test can pin `fileSeenAt` and the guard value. */
  now?: () => number
}

export interface FileSourceStartupReport {
  /** `skipped` when the guard was already set, `completed` when every record's file was rewritten,
   * `incomplete` when at least one failed (the guard is then deliberately left unset so the next
   * start retries - rewriting an already-correct file is a diff-skipped no-op). */
  migration: 'skipped' | 'completed' | 'incomplete'
  migratedProfileIds: string[]
  failedProfileIds: string[]
  /** Ids rebuilt from a file that `state.json` had no record for. */
  rebuiltProfileIds: string[]
  /** Launcher-owned files that were candidates for a rebuild but could not be used (unreadable,
   * unparseable). Reported, never deleted, never adopted as a broken profile. */
  ignoredFileNames: string[]
}

/**
 * AC8's one-time migration: bring every *existing* profile's canonical file up to the current
 * 040/042 format from the cached profile data, and seed that profile's `fileHash` from what was
 * written.
 *
 * The write goes through `writeCanonicalProfileFile` - the same function every normal save uses, so
 * the rename-reconciliation, the diff-skip, the backup-once rule and the foreign/live-owner refusal
 * all apply here unchanged and this function adds no file handling of its own. `liveProfileIds` is
 * passed so that refusal is armed: a profile whose target name is currently occupied by *another
 * live profile's* file raises rather than overwriting it, which is recorded as a failure and retried
 * on the next start (by which time the other profile has moved to its own resolved name).
 *
 * `fileHash` is the hash of `renderProfileFile(profile)` rather than of a re-read of the file:
 * `renderProfileFile` is deterministic by contract and `writeCanonicalProfileFile` writes exactly
 * its output in latin1, and `hashCanonicalFileContent` hashes latin1 bytes - the equality of the two
 * is pinned directly in `file-source.test.ts`. Re-reading would add a failure mode (a read error
 * *after* a successful write) with nothing to gain.
 */
async function migrateCanonicalFiles(
  deps: FileSourceStartupDeps,
  now: number,
): Promise<Pick<FileSourceStartupReport, 'migration' | 'migratedProfileIds' | 'failedProfileIds'>> {
  const profiles = deps.listProfiles()
  const fileNames = resolveProfileFileNames(profiles)
  const liveProfileIds = new Set(profiles.map((profile) => profile.id))

  const migratedProfileIds: string[] = []
  const failedProfileIds: string[] = []

  for (const profile of profiles) {
    // `profile` came out of the same list `fileNames` was resolved from, so this cannot miss.
    const fileName = fileNames.get(profile.id)!
    try {
      // Sequential, never `Promise.all`: two overlapping writes into the same directory can race
      // over each other's rename target - the same reasoning `sync.ts`'s write loops give.
      await writeCanonicalProfileFile(deps.baseDir, profile, fileName, liveProfileIds)
      const migrated: ConfigProfile = {
        ...profile,
        fileHash: hashCanonicalFileContent(renderProfileFile(profile)),
        fileSeenAt: now,
        dirty: false,
        fileState: 'unchanged',
      }
      // Story 049 D1: the file now holds this record's render, so this record IS the baseline
      // "unsaved" is measured against from here on - seeded wherever `fileHash` is. Captured from
      // `migrated` rather than routed through `ProfilesStore.seedBaseline`, because the commit path
      // this step uses (`replaceProfile`) is shared with `tidyUp.apply`, which is an *edit* and must
      // not reseed anything. Nothing is adopted in between either: `profile` came out of the store
      // and has already been through `adoptProfileBinds`, and this step changes no content field.
      deps.replaceProfile({ ...migrated, baseline: captureBaseline(migrated) })
      migratedProfileIds.push(profile.id)
    } catch (error) {
      deps.log.error(
        `config file-source migration: failed to bring ${fileName} up to format for profile ` +
          `${profile.id}; leaving the migration guard unset so the next start retries`,
        error,
      )
      failedProfileIds.push(profile.id)
    }
  }

  return {
    migration: failedProfileIds.length === 0 ? 'completed' : 'incomplete',
    migratedProfileIds,
    failedProfileIds,
  }
}

/**
 * AC2's rebuild: a record for every launcher-owned canonical file `state.json` has no record for,
 * **keeping the id the file's sentinel carries**.
 *
 * Ownership is `readCanonicalOwnership`'s answer and nothing else, which is what keeps a foreign
 * file out: a `.cfg` whose first line is not `OWNERSHIP_MARKER` followed by an id - a hand-written
 * config, or another tool's file with its own marker - has no owner in that map and is therefore
 * never a candidate here. That map is keyed by profile id, so two files claiming the same id yield
 * at most one rebuild, and a record that already exists is skipped before anything is read, so this
 * can never produce a duplicate id (`ProfilesStore.addRebuilt` refuses one independently).
 *
 * A file that reads but does not parse into a profile at all is reported and left alone: adopting a
 * half-recovered profile would be worse than showing nothing, and deleting the file is never on the
 * table.
 *
 * "Corrupt record" needs no separate detection here. `parseConfigProfile`
 * (`main/lib/schemas.ts`) already drops an unparseable profile row on its own during load, so a
 * corrupt record *is* a missing record by the time this runs - which is exactly the case this
 * handles.
 */
async function rebuildMissingProfileRecords(
  deps: FileSourceStartupDeps,
  now: number,
): Promise<Pick<FileSourceStartupReport, 'rebuiltProfileIds' | 'ignoredFileNames'>> {
  const owners = await readCanonicalOwnership(deps.baseDir)
  const known = new Set(deps.listProfiles().map((profile) => profile.id))

  const rebuiltProfileIds: string[] = []
  const ignoredFileNames: string[] = []

  for (const [profileId, fileName] of owners) {
    if (known.has(profileId)) continue

    // No cached hash by definition (there is no record), so this always classifies as
    // `changedOnDisk`; `unchanged` is accepted too rather than relying on that.
    const read = await readFileState(deps.baseDir, fileName, undefined)
    if (read.state !== 'changedOnDisk' && read.state !== 'unchanged') {
      deps.log.warn(
        `config rebuild: ${fileName} claims profile ${profileId} but could not be used ` +
          `(${read.state}); the profile is not rebuilt and the file is left untouched`,
      )
      ignoredFileNames.push(fileName)
      continue
    }

    // Story-050 review, finding 3 (third round): the same `entry-alias-duplicate` reports that
    // become `RefreshedProfileResult.droppedAliases` on the reload path (its own warning toast)
    // reach this startup path too, and the rebuilt record cannot carry them - there is no renderer
    // yet, and `ConfigProfile` has no field for a read warning. So they go to the log, which is
    // the only channel a startup step has: without this the rebuilt profile is simply missing an
    // entry, with nothing anywhere saying so. Only the duplicate-alias reason is logged, not every
    // warning - a metadata-stripped file legitimately produces a `tag-missing` per line, and
    // drowning this one out is how it stayed invisible in the first place.
    const droppedAliases = read.profile.warnings.flatMap((warning) =>
      warning.reason === 'entry-alias-duplicate' && warning.subject ? [warning.subject] : [],
    )
    if (droppedAliases.length > 0) {
      deps.log.warn(
        `config rebuild: ${fileName} defines ${droppedAliases.length} alias name(s) more than ` +
          `once (${droppedAliases.join(', ')}); only the last definition of each survives, so ` +
          `profile ${profileId} is rebuilt without the earlier one(s)`,
      )
    }

    const path = join(deps.baseDir, fileName)
    // A second, best-effort read: the D2 seam (`readFileState`) hands back parsed profile *parts*,
    // not the raw text the header/format recovery above needs, and widening that seam for this one
    // caller is not worth it. A failure here degrades to the documented per-field fallbacks rather
    // than costing the rebuild.
    const content = await readFile(path, FILE_ENCODING).catch(() => null)
    const stats = await stat(path).catch(() => null)

    const profile = buildRebuiltProfile({
      id: profileId,
      fileName,
      content,
      parsed: read.profile,
      fileHash: read.hash,
      stats,
      now,
    })

    try {
      deps.addProfile(profile)
      rebuiltProfileIds.push(profileId)
      deps.log.info(
        `config rebuild: restored profile ${profileId} ("${profile.name}") from ${fileName} - ` +
          `installation assignments and played mods are not recoverable from a file`,
      )
    } catch (error) {
      deps.log.error(`config rebuild: failed to store rebuilt profile ${profileId}`, error)
      ignoredFileNames.push(fileName)
    }
  }

  return { rebuiltProfileIds, ignoredFileNames }
}

/**
 * The config module's startup hook for story 043: AC8's one-time migration first, then the rebuild
 * (see this file's own doc comment for why that order is fixed and not an implementation detail).
 *
 * Never throws for a per-profile or per-file problem - each is logged and reported - so a single bad
 * file cannot stop the module from starting. A failure of the directory scan itself does propagate;
 * the caller in `index.ts` treats that as "leave everything alone this session".
 */
export async function runFileSourceStartup(
  deps: FileSourceStartupDeps,
): Promise<FileSourceStartupReport> {
  const now = deps.now?.() ?? Date.now()

  const alreadyMigrated = deps.migratedAt() !== null
  const migration = alreadyMigrated
    ? {
        migration: 'skipped' as const,
        migratedProfileIds: [] as string[],
        failedProfileIds: [] as string[],
      }
    : await migrateCanonicalFiles(deps, now)

  if (migration.migration === 'completed') deps.setMigratedAt(new Date(now).toISOString())

  const rebuild = await rebuildMissingProfileRecords(deps, now)

  return { ...migration, ...rebuild }
}
