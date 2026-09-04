/**
 * The file-read layer for story 043 ("the cfg file is the source of truth"), D2: reads a profile's
 * canonical file (`canonical.ts`'s `<baseDir>/<fileName>`), hashes it and classifies it against a
 * previously cached hash - the read half of the pair `writeCanonicalProfileFile` (`canonical.ts`)
 * is the write half of. Pure read/classify: nothing here writes to disk, rebuilds a full
 * `ConfigProfile` for storage, or is wired into any IPC handler yet - that is a later deliverable's
 * job.
 *
 * Reuses, rather than reimplements, two existing pipelines:
 *  - the tokenizer (`core/config-parser.ts#parseConfigText`) that turns raw config text into
 *    cvar/bind/alias/comment lines - the same one `import-reader.ts` uses for a whole installation;
 *  - the reconstruction pass (`@shared/config/profile-restore.ts#restoreProfileParts`) that turns
 *    those lines into entries/categories/layers, tolerant of a hand-edited or metadata-stripped
 *    file (story 042's own degrade-with-warnings rule).
 *
 * What is deliberately NOT reused is `import-reader.ts#readImportableConfig` itself: it is shaped
 * around an *installation*'s gamedir search path (`config.cfg`/`autoexec.cfg` by fixed name, `exec`
 * chains resolved against `installation.rootPath`), while this module reads exactly one,
 * already-named file that lives directly under `baseDir` (`canonical.ts`'s own convention) and
 * never `exec`s anything else. The small last-assignment-wins fold below (`foldConfig`/`foldBinds`)
 * stands in for the one slice of `import-reader.ts`'s job this module still needs: turning one
 * file's already-tokenized lines into the "last definition wins, `unbind`/`unbindall` applied"
 * shape `restoreProfileParts` expects (see its own `RestoreBindLine` doc comment: "after
 * `unbind`/`unbindall` folding"). `parseConfigText` already returns each of `cvars`/`aliases`/
 * `binds` as one array in ascending document order (one push per line, in visiting order), so -
 * unlike `import-reader.ts#documentOrder`, which has to reconcile six arrays across many files and
 * `exec` depths - a single left-to-right pass per array is exact here.
 */

import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AltLayer } from '@shared/config/alt-layers'
import {
  restoreProfileParts,
  type RestoreProfilePartsInput,
  type RestoreWarning,
} from '@shared/config/profile-restore'
import type { ConfigAction, ConfigActionCategory } from '@shared/modules/config'
import {
  parseConfigText,
  type ParsedAlias,
  type ParsedBind,
  type ParsedCvar,
  type ParseConfigResult,
} from './core/config-parser'

/** Same convention as every other reader of a Quake II config in this codebase (`canonical.ts`,
 * `writer.ts`, `import-reader.ts`): the engine is byte-oriented, so a `.cfg` is read - and, here,
 * hashed - as latin1, never UTF-8. */
const FILE_ENCODING: BufferEncoding = 'latin1'

/**
 * sha-256 of `content`'s own latin1 bytes - the story's decided hash ("cache keeps `fileHash`
 * (sha-256 of the latin1 file bytes the launcher last read or wrote)"). Exported so a write path
 * (`canonical.ts#writeCanonicalProfileFile` or its caller) can hash the exact bytes it just wrote
 * with the SAME method and seed `fileHash` with the result - the property that keeps the
 * launcher's own write from ever being mistaken for an external edit on the very next read
 * (verified directly in `file-source.test.ts`).
 *
 * `Buffer.from(content, 'latin1')` round-trips exactly with `readFile(path, 'latin1')`: latin1 maps
 * every byte 0-255 to the code point of the same value and back, so this hashes the identical bytes
 * that are actually on disk, never a re-encoded approximation of them.
 */
export function hashCanonicalFileContent(content: string): string {
  return createHash('sha256').update(Buffer.from(content, FILE_ENCODING)).digest('hex')
}

// ---------------------------------------------------------------------------
// Folding: parseConfigText's per-line arrays -> last-assignment-wins maps.
// ---------------------------------------------------------------------------

/** Last item by `keyOf`, in the array's own (already ascending) document order. A `Map`'s iteration
 * order keeps a key's ORIGINAL insertion position even when a later `set()` overwrites its value,
 * which is exactly "first-seen position, latest value" - the same ordering `import-reader.ts`'s own
 * cvar/alias folds produce. */
function lastWins<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) map.set(keyOf(item), item)
  return map
}

interface LiveBind {
  key: string
  command: string
  comment: string
  line: number
}

/**
 * The keys actually bound after every `bind`/`unbind`/`unbindall` in `items` is applied, in order -
 * `import-reader.ts#applyBind`'s own rule, minus its duplicate-bind reporting: a re-`bind` of a key
 * loses nothing but a *binding*, which the surviving line still states in full, unlike a re-defined
 * `alias`, whose earlier body is gone for good (hence `FoldedConfig.discardedAliases`).
 * `parseConfigText` already
 * interleaves all three kinds into one `binds` array in document order (they are pushed together as
 * each line is visited), so a single left-to-right pass is exact - there is no second array to
 * reconcile against the way a multi-file import has to.
 */
function foldBinds(items: readonly ParsedBind[]): Map<string, LiveBind> {
  const live = new Map<string, LiveBind>()
  for (const item of items) {
    switch (item.kind) {
      case 'bind':
        live.set(item.key, {
          key: item.key,
          command: item.command,
          comment: item.comment,
          line: item.line,
        })
        break
      case 'unbind':
        live.delete(item.key)
        break
      case 'unbindall':
        live.clear()
        break
    }
  }
  return live
}

interface FoldedConfig {
  cvars: Map<string, ParsedCvar>
  aliases: Map<string, ParsedAlias>
  binds: Map<string, LiveBind>
  /**
   * The `alias` definitions this fold threw away - every line whose name a later line in the same
   * file re-defines, in file order. `[]` for every healthy file.
   *
   * Collected rather than dropped because this is the exact point at which a whole entry can
   * disappear from a profile (story-050 review, finding 4, second round). Two entries whose display
   * names derive to one alias name (`alias-render.ts#derivedAliasName` has no id suffix by story
   * 039's own decision - the name is the user's contract with whatever binding calls it, so it is
   * reported as a duplicate, never silently renamed) render two `alias fire` lines; the engine keeps
   * only the last of the two and so does this fold, and everything downstream - `restoreProfileParts`
   * included - then sees a file that looks like it only ever had one such entry. Warning about it
   * anywhere further down is impossible for want of the evidence, which is why it happens here.
   *
   * Not filtered to entry aliases: a duplicated layer helper or chunk alias is a lost body just the
   * same, and a `.cfg` the launcher itself wrote never repeats a name unless something is genuinely
   * ambiguous about it.
   */
  discardedAliases: ParsedAlias[]
}

function foldConfig(parsed: ParseConfigResult): FoldedConfig {
  const aliases = lastWins(parsed.aliases, (alias) => alias.name)
  return {
    cvars: lastWins(parsed.cvars, (cvar) => cvar.name),
    aliases,
    binds: foldBinds(parsed.binds),
    // Exactly the lines the winning map does not point at - an identity comparison against the
    // fold's own result rather than a second name-counting pass, so the two can never disagree
    // about which definition survived.
    discardedAliases: parsed.aliases.filter((alias) => aliases.get(alias.name) !== alias),
  }
}

/**
 * One `entry-alias-duplicate` warning per definition `foldConfig` discarded, at that definition's
 * own line - the line whose commands are gone - with the colliding alias name as the `subject`.
 *
 * Positioned on the *discarded* line rather than on the surviving one (the convention
 * `import-reader.ts#DuplicateAlias` uses for its own duplicate report) because this warning is read
 * as "this line's content did not survive the read", and every other `RestoreWarning` likewise
 * points at the line it is about.
 */
function discardedAliasWarnings(
  file: string,
  discarded: readonly ParsedAlias[],
): RestoreWarning[] {
  return discarded.map((alias) => ({
    reason: 'entry-alias-duplicate' as const,
    file,
    line: alias.line,
    subject: alias.name,
  }))
}

/** `foldConfig`'s maps, shaped into `restoreProfileParts`'s input - every line tagged with `file`
 * (there is only one, the canonical file itself, unlike a multi-file installation import) since
 * `RestoreSourcePosition` requires it for section attribution. No `layerAliases`: that field only
 * matters on the untagged/foreign-config delegation path, where it stands for the user's own
 * "attempt as layer" answers - there are none yet at this pure read/classify stage. */
function toRestoreInput(
  file: string,
  parsed: ParseConfigResult,
  folded: FoldedConfig,
  newId: () => string,
): RestoreProfilePartsInput {
  return {
    aliases: [...folded.aliases.values()].map((alias) => ({
      name: alias.name,
      body: alias.body,
      file,
      line: alias.line,
      comment: alias.comment,
      codeWidth: alias.codeWidth,
    })),
    binds: [...folded.binds.values()].map((bind) => ({
      key: bind.key,
      command: bind.command,
      file,
      line: bind.line,
      comment: bind.comment,
    })),
    cvars: [...folded.cvars.values()].map((cvar) => ({
      name: cvar.name,
      value: cvar.value,
      file,
      line: cvar.line,
      comment: cvar.comment,
    })),
    comments: parsed.comments.map((comment) => ({ text: comment.text, file, line: comment.line })),
    newId,
  }
}

// ---------------------------------------------------------------------------
// The result shape
// ---------------------------------------------------------------------------

/**
 * Everything `restoreProfileParts` plus this module's own cvar/bind fold recovered from the file -
 * the "profile parts" a later deliverable (the rebuild step) assembles into a full `ConfigProfile`
 * by combining this with the identity fields (`id`, `name`, `createdAt`, `assignments`, ...) that
 * live only in the persisted profile and that this module has no business inventing.
 */
export interface ParsedCanonicalProfile {
  cvars: Record<string, string>
  binds: Record<string, string>
  actions: ConfigAction[]
  categories: ConfigActionCategory[]
  layers: AltLayer[]
  /** Every discrepancy reading this file back turned up - a malformed tag, a hand-deleted version
   * marker, a tag that disagreed with the config line it sat on (all `restoreProfileParts`'), plus
   * the `entry-alias-duplicate` reports from this module's own `alias` fold, which happens before
   * that pass and is the only place those are still visible (`FoldedConfig.discardedAliases`).
   * Never fatal to the parse itself (see `readFileState`'s doc comment). */
  warnings: RestoreWarning[]
  sourceProfileId: string | null
  metadataVersion: number | null
}

function parseCanonicalProfile(file: string, content: string): ParsedCanonicalProfile {
  const parsed = parseConfigText(content)
  const folded = foldConfig(parsed)
  const restored = restoreProfileParts(toRestoreInput(file, parsed, folded, randomUUID))

  return {
    cvars: Object.fromEntries([...folded.cvars.values()].map((cvar) => [cvar.name, cvar.value])),
    binds: Object.fromEntries([...folded.binds.values()].map((bind) => [bind.key, bind.command])),
    actions: restored.actions,
    categories: restored.categories,
    layers: restored.layers,
    // The fold's own reports first: they are about lines `restoreProfileParts` was never handed,
    // and they name content that is missing from everything below them in this result.
    warnings: [...discardedAliasWarnings(file, folded.discardedAliases), ...restored.warnings],
    sourceProfileId: restored.sourceProfileId,
    metadataVersion: restored.metadataVersion,
  }
}

// ---------------------------------------------------------------------------
// "Is this text at all?" - the one thing the parser cannot answer for itself.
// ---------------------------------------------------------------------------

/**
 * Whether `code` is a byte a `.cfg` cannot legitimately contain: any C0 control except tab, LF and
 * CR (the only three an editor writes into a text file) and except `0x1a`, the historical DOS
 * end-of-file marker some very old tools still append.
 *
 * A byte in this set is not a config line this parser should try to make sense of - it is the
 * signature of a file that was truncated by an interrupted write, of one filled with binary
 * garbage, or of one that is simply not a text file at all. Story 043 D10 found why this check has
 * to exist here rather than being left to the parser: `parseConfigText`/`restoreProfileParts`
 * degrade rather than throw (story 042's rule, and the right rule for *text*), so a NUL-truncated
 * or binary file came back as an ordinary `changedOnDisk` carrying an almost-empty profile - which
 * `refreshFromFiles` then adopted, replacing the last good cache with nothing. That is exactly what
 * AC4 ("a file that is unparseable, or that fails to parse into a valid profile, does not take the
 * profile down") exists to prevent, and it is also what makes the `unparseable` branch below a real
 * outcome rather than the unreachable defensive boundary D2 documented it as.
 *
 * Deliberately narrow: anything that *is* text stays on the degrade-with-warnings path. A file with
 * a hand-deleted metadata comment, a hand-reordered section, an unterminated quote or hand-typed
 * nonsense is still text, is still parsed, and is still `changedOnDisk` - all pinned in
 * `file-source.test.ts` and `file-source-pipeline.test.ts`.
 *
 * Written as an explicit code test rather than a character-class regex so the control bytes it is
 * about never have to appear literally in this source file. `content` is read as latin1, so
 * `charCodeAt` IS the byte on disk.
 */
const TAB = 9
const LINE_FEED = 10
const CARRIAGE_RETURN = 13
const DOS_END_OF_FILE = 26

function isCorruptByte(code: number): boolean {
  if (code >= 0x20) return false
  return code !== TAB && code !== LINE_FEED && code !== CARRIAGE_RETURN && code !== DOS_END_OF_FILE
}

/**
 * The `{ file, line, message }` diagnostic for `content` when it carries a byte no text config
 * can, or `null` when it is text.
 *
 * The line number is real - counted from the actual offending byte's position, not the `line: 1`
 * placeholder the previously-unreachable branch below had to use - because "the file and line" is
 * what AC4 promises the user and what D7 renders.
 */
function corruptContentDiagnostic(
  fileName: string,
  content: string,
): { file: string; line: number; message: string } | null {
  let index = -1
  for (let at = 0; at < content.length; at += 1) {
    if (isCorruptByte(content.charCodeAt(at))) {
      index = at
      break
    }
  }
  if (index === -1) return null

  // 1-based, counting the newlines before the offending byte - the same convention
  // `parseConfigText` uses for its own line numbers.
  const line = content.slice(0, index).split('\n').length
  const code = content.charCodeAt(index).toString(16).padStart(2, '0')
  const column = index - (content.lastIndexOf('\n', index - 1) + 1) + 1
  return {
    file: fileName,
    line,
    // The file and the line are carried as their own fields (the UI's own headline says both), so
    // the message adds only what they cannot: which byte, and how far into the line it sits.
    message:
      `byte 0x${code} at column ${column} is not something a config file can contain - ` +
      `the file looks truncated or binary rather than edited`,
  }
}

/**
 * One of the five outcomes `readFileState` classifies a read into.
 *
 * `unchanged`/`changedOnDisk` both carry the freshly parsed profile (see `ParsedCanonicalProfile`'s
 * doc comment) plus the hash the caller should cache for the next read - even on `unchanged`, so a
 * caller that always stores whatever this function last returned never has to special-case "the
 * hash did not change, keep the old value".
 *
 * `content` is the file's raw latin1 text, exactly the bytes `hash` was taken over (story 043 D4).
 * Carried rather than left for the caller to re-read: the whole-file conflict the story decided on
 * ("UI-edit vs. disk-edit conflicts are shown as whole-file old-vs-new") needs the disk side as
 * *text*, and a second `readFile` after this one could return different bytes than the ones this
 * classification was made from - which is precisely the race a hash comparison exists to close.
 */
export type FileReadResult =
  | { state: 'unchanged'; hash: string; content: string; profile: ParsedCanonicalProfile }
  | { state: 'changedOnDisk'; hash: string; content: string; profile: ParsedCanonicalProfile }
  | { state: 'missing' }
  | { state: 'unparseable'; file: string; line: number; message: string }
  | { state: 'readError'; error: unknown }

/**
 * Reads `<baseDir>/<fileName>` (`canonical.ts`'s own path convention) and classifies it against
 * `cachedHash` - the persisted `fileHash` from a previous read or write, or `undefined`/`null` when
 * there is no baseline yet (a brand-new profile, or one that predates this field). A missing
 * baseline is treated exactly like a mismatched one: `changedOnDisk`, never `unchanged`.
 *
 * Only `ENOENT` means `missing`; every other read failure (permissions, an I/O fault, a directory
 * sitting where a file should be) is `readError` rather than being folded into `missing` - the same
 * "unreadable is not the same as absent" rule `writer.ts#readExisting`/`canonical.ts` already apply,
 * because a caller that treated the two the same could go on to "recreate" a file it actually just
 * failed to read, destroying whatever the permissions problem was hiding.
 *
 * `unparseable` has exactly two sources, and story 043 D10's adversarial pass is why the first one
 * exists at all:
 *
 * 1. **The content is not text** (`corruptContentDiagnostic` above) - a NUL-truncated or binary
 *    file. Checked before parsing, because parsing itself (`parseConfigText` +
 *    `restoreProfileParts`) is designed to never throw: a malformed or hand-stripped `[q2l ...]`
 *    tag degrades to a warning (story 042's own rule; see both functions' doc comments), and so
 *    does binary garbage - it "parses" into an almost-empty profile, which a caller then adopts
 *    over the last good cache. That silent loss is what AC4 forbids, and this branch is what makes
 *    the promise real. It carries the offending byte's actual line, not a placeholder.
 * 2. **A thrown error from the parse itself** - a defensive boundary for a genuine bug in this
 *    module's own fold, not a path either function is documented to take. There is no positioned
 *    -error protocol to draw a real position from in that case, so `line: 1` is a placeholder
 *    value there, not a claim about where the problem is.
 *
 * A file with a hand-deleted metadata comment, a hand-reordered file, an unterminated quote or CRLF
 * line endings is text in all cases and therefore still comes back as `changedOnDisk`, degraded
 * with warnings - never as `unparseable`.
 */
export async function readFileState(
  baseDir: string,
  fileName: string,
  cachedHash: string | null | undefined,
): Promise<FileReadResult> {
  const path = join(baseDir, fileName)

  let content: string
  try {
    content = await readFile(path, FILE_ENCODING)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'readError', error }
  }

  const corrupt = corruptContentDiagnostic(fileName, content)
  if (corrupt !== null) return { state: 'unparseable', ...corrupt }

  const hash = hashCanonicalFileContent(content)

  let profile: ParsedCanonicalProfile
  try {
    profile = parseCanonicalProfile(fileName, content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { state: 'unparseable', file: fileName, line: 1, message }
  }

  return hash === cachedHash
    ? { state: 'unchanged', hash, content, profile }
    : { state: 'changedOnDisk', hash, content, profile }
}
