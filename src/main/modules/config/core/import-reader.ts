/**
 * Reads a Quake II installation's hand-written config the way the engine
 * would load it, and folds it into one importable result (story 005, D2).
 *
 * This is the only part of the importer that touches the filesystem - the
 * tokenizer next door (`config-parser.ts`) never sees a path. No Electron
 * either: plain `node:fs/promises` plus the shared fs helpers, so it stays
 * unit-testable against a temp fixture tree.
 *
 * ## Load order (decision 4)
 *
 * `<root>/<gameDir>/config.cfg`, then `<root>/<gameDir>/autoexec.cfg`, each
 * fully expanded before the next one starts. Later assignments win, so the
 * whole thing is one ordered stream folded left to right. Either file may be
 * absent - that is normal, not an error, and only files actually opened show
 * up in `filesRead`. `default.cfg` is deliberately not read (it lives inside
 * `pak0`; engine defaults are story 003's data table).
 *
 * Every lookup goes through `resolveRelaxed()` because Quake II folders are
 * as often `BASEQ2/CONFIG.CFG` as `baseq2/config.cfg`.
 *
 * ## `exec` (decisions 5 + 6)
 *
 * An `exec <file>` is expanded IN PLACE: the target's own cvars, binds,
 * execs and preserved lines are folded in at the point the `exec` appeared,
 * before the rest of the current file continues. Anything the target sets is
 * therefore overridden by a later line of the parent file, and overrides an
 * earlier one - the same thing the engine does.
 *
 * The target is looked up in the chosen gamedir first and in `baseq2`
 * second (the engine's search path); the second lookup is skipped when the
 * chosen gamedir already IS `baseq2`. Only regular files count - a directory
 * that happens to match the name is treated as "not found".
 *
 * Targets come from a file on disk, i.e. from outside this program, so they
 * are treated as untrusted input (CLAUDE.md). They cannot escape the
 * installation: `resolveRelaxed()` walks real directory entries one segment
 * at a time, and `..`, `.` or a drive letter never appear in a directory
 * listing, so such a segment simply fails to resolve and is reported as a
 * missing `exec` instead of reaching outside the root.
 *
 * ## Guards
 *
 * Three of them, because they catch different things:
 *
 *  - `ALIAS_LOOP_COUNT` (16, the concept's own name and value) bounds how
 *    deep expansion may nest. An entry file is depth 0, the file it execs is
 *    depth 1; an `exec` that would produce depth 17 is refused.
 *  - The active exec CHAIN (the files currently being expanded, keyed by
 *    canonical path) catches a genuine cycle - `a.cfg` -> `b.cfg` -> `a.cfg`
 *    - immediately, long before the depth budget runs out.
 *  - `MAX_EXEC_EXPANSIONS` bounds TOTAL work across the whole import. The
 *    chain guard only rules out cycles, not fan-out: a depth guard alone
 *    still allows a file that `exec`s the same (acyclic) two files at every
 *    level to blow up combinatorially (branching factor^16), because each
 *    branch is a legitimate, non-cyclic expansion on its own. This is a flat
 *    ceiling on the number of `exec` targets actually opened, independent of
 *    depth, so a pathological hand-written config degrades to "the rest is
 *    preserved unrecognized" instead of the import hanging.
 *
 * The chain is deliberately not a global "seen once" set: a file legitimately
 * exec'd twice (e.g. by `config.cfg` and again by `autoexec.cfg`, or twice in
 * a row) really is executed twice by the engine, and dropping the second run
 * would silently cost the user content - exactly the failure mode AC 4 is
 * about. Only re-entering a file that is still open above us is a cycle;
 * `MAX_EXEC_EXPANSIONS` is what keeps that choice from being exploitable.
 *
 * A refused or unresolvable `exec` never aborts the import: the line is kept
 * as an unrecognized line (so nothing is lost) and a warning records why, so
 * the caller can log it and the UI can show it.
 *
 * ## Merge semantics
 *
 *  - cvars: last assignment by name wins, across all files and depths.
 *    Names are compared exactly - Quake II's own cvar lookup is
 *    case-sensitive.
 *  - binds: folded in order. `bind` sets (overwriting), `unbind` removes,
 *    `unbindall` clears everything accumulated so far and lets the stream
 *    continue on an empty map. Key names are kept exactly as written; note
 *    that the engine compares key names case-insensitively, so a config that
 *    binds `SPACE` and `space` as if they were one key would produce two
 *    entries here. Real configs (and everything the engine writes itself)
 *    are consistent, and normalising would change the key names the profile
 *    stores, so this stays literal.
 *  - unrecognized lines: kept in overall document order, each tagged with
 *    the file it came from (the on-disk file NAME, not a path - the result
 *    travels to the renderer) and its 1-based line number in that file.
 *
 * ## Ordering caveat
 *
 * `parseConfigText()` returns four separate arrays, so the stream is
 * rebuilt by a stable sort on line number. That is exact for the normal
 * one-command-per-line config. Only when a single physical line mixes
 * commands with `;` (`set a 1; exec more.cfg`) is the intra-line order
 * unrecoverable from the parser's output; ties then fall back to a fixed
 * order - cvars, binds, `exec`, unrecognized - which is right for the
 * idiomatic "do things, then load more" form.
 *
 * ## Encoding (decision 8)
 *
 * Every file is read as latin-1, never UTF-8, so the high-ASCII bytes Quake
 * II configs use for coloured/symbol text survive as themselves and can be
 * written back byte-for-byte.
 */

import { readFile } from 'node:fs/promises'
import { BASE_GAME_DIR } from '@shared/constants'
import { canonicalizePath, fileName, isFile, resolveRelaxed } from '../../../lib/fs-utils'
import { parseConfigText } from './config-parser'
import type {
  ParseConfigResult,
  ParsedBind,
  ParsedCvar,
  ParsedExec,
  PreservedLine,
} from './config-parser'

/** A line the importer did not understand, kept verbatim (AC 4). */
export interface ImportedUnrecognizedLine {
  /** On-disk file name the line came from, e.g. `config.cfg`. */
  file: string
  /** 1-based line number within that file. */
  line: number
  text: string
}

export type ImportWarningReason =
  /** Not found in the gamedir nor in `baseq2`, or not readable. */
  | 'exec-missing'
  /** The target is already being expanded further up the chain. */
  | 'exec-cyclic'
  /** Expanding it would exceed `ALIAS_LOOP_COUNT`. */
  | 'exec-too-deep'
  /** The import as a whole already opened `MAX_EXEC_EXPANSIONS` files. */
  | 'exec-budget-exceeded'

export interface ImportWarning {
  /** On-disk file name the `exec` line was in. */
  file: string
  line: number
  reason: ImportWarningReason
  /** The `exec` target exactly as written in the config. */
  target: string
}

export interface ImportResult {
  /** cvar name -> value, last assignment in the stream wins. */
  cvars: Record<string, string>
  /** key name -> bound command, after `unbind`/`unbindall` were applied. */
  binds: Record<string, string>
  /** Everything not understood, in overall document order. */
  unrecognized: ImportedUnrecognizedLine[]
  /**
   * File names actually opened, in the order they were opened. This is a read
   * log rather than a set: a file exec'd twice was read twice and appears
   * twice.
   */
  filesRead: string[]
  /** Why an `exec` was not expanded. Empty on a clean import. */
  warnings: ImportWarning[]
}

/**
 * Maximum `exec` nesting depth. Named after the concept's `ALIAS_LOOP_COUNT`
 * (decision 6) so the guard is recognisable from the spec.
 */
export const ALIAS_LOOP_COUNT = 16

/**
 * Maximum number of `exec` targets a single import may open in total, across
 * every depth and branch combined. The depth guard alone bounds how deep one
 * chain can go, not how many chains there are - a config that `exec`s two
 * distinct (acyclic) files at every level is legitimate by the chain guard's
 * own rules yet opens up to 2^16 files. 512 comfortably covers any real
 * hand-written config (which realistically execs a handful of files) while
 * keeping a crafted worst case bounded to a fraction of a second of work.
 */
export const MAX_EXEC_EXPANSIONS = 512

/** The entry files of a gamedir, in engine load order (decision 4). */
export const ENTRY_FILE_NAMES = ['config.cfg', 'autoexec.cfg'] as const

interface ReaderContext {
  installationRoot: string
  gameDir: string
  /** Canonical paths of the files currently being expanded (the exec chain). */
  chain: Set<string>
  /** Total files opened so far (entry files + every expanded `exec`), capped at `MAX_EXEC_EXPANSIONS`. */
  filesOpened: number
  cvars: Map<string, string>
  binds: Map<string, string>
  unrecognized: ImportedUnrecognizedLine[]
  filesRead: string[]
  warnings: ImportWarning[]
}

type StreamItem =
  | { kind: 'cvar'; item: ParsedCvar }
  | { kind: 'bind'; item: ParsedBind }
  | { kind: 'exec'; item: ParsedExec }
  | { kind: 'preserved'; item: PreservedLine }

/**
 * Rebuilds one document-ordered stream out of the parser's four arrays.
 * Each array is already in ascending line order, and `Array#sort` is stable,
 * so equal line numbers keep the concatenation order (cvar, bind, exec,
 * preserved) - see the ordering caveat at the top of the file.
 */
function documentOrder(parsed: ParseConfigResult): StreamItem[] {
  const items: StreamItem[] = [
    ...parsed.cvars.map((item): StreamItem => ({ kind: 'cvar', item })),
    ...parsed.binds.map((item): StreamItem => ({ kind: 'bind', item })),
    ...parsed.execs.map((item): StreamItem => ({ kind: 'exec', item })),
    ...parsed.preserved.map((item): StreamItem => ({ kind: 'preserved', item })),
  ]
  return items.sort((a, b) => a.item.line - b.item.line)
}

function applyBind(ctx: ReaderContext, bind: ParsedBind): void {
  switch (bind.kind) {
    case 'bind':
      ctx.binds.set(bind.key, bind.command)
      return
    case 'unbind':
      ctx.binds.delete(bind.key)
      return
    case 'unbindall':
      ctx.binds.clear()
      return
  }
}

/**
 * The text kept for an `exec` that could not be expanded. The parser hands
 * over the parsed target only, not the raw line, so this is a normalised
 * reconstruction rather than the original bytes - re-quoted when the target
 * contains whitespace so the line stays valid config.
 */
function reconstructExecLine(target: string): string {
  return /\s/.test(target) ? `exec "${target}"` : `exec ${target}`
}

/** Resolves `<gameDir>/<relative>` case-insensitively; must be a real file. */
async function resolveFileIn(
  installationRoot: string,
  dir: string,
  relative: string,
): Promise<string | null> {
  const resolved = await resolveRelaxed(installationRoot, `${dir}/${relative}`)
  if (!resolved) return null
  return (await isFile(resolved)) ? resolved : null
}

/** Chosen gamedir first, `baseq2` second - the engine's search path. */
async function resolveExecTarget(ctx: ReaderContext, target: string): Promise<string | null> {
  const inGameDir = await resolveFileIn(ctx.installationRoot, ctx.gameDir, target)
  if (inGameDir) return inGameDir
  if (ctx.gameDir.toLowerCase() === BASE_GAME_DIR) return null
  return await resolveFileIn(ctx.installationRoot, BASE_GAME_DIR, target)
}

function refuseExec(
  ctx: ReaderContext,
  exec: ParsedExec,
  file: string,
  reason: ImportWarningReason,
): void {
  ctx.warnings.push({ file, line: exec.line, reason, target: exec.target })
  ctx.unrecognized.push({ file, line: exec.line, text: reconstructExecLine(exec.target) })
}

async function expandExec(
  ctx: ReaderContext,
  exec: ParsedExec,
  file: string,
  depth: number,
): Promise<void> {
  if (depth + 1 > ALIAS_LOOP_COUNT) {
    refuseExec(ctx, exec, file, 'exec-too-deep')
    return
  }

  // Flat ceiling on total work (see `MAX_EXEC_EXPANSIONS`'s doc comment):
  // checked before doing any more filesystem work, not just before recursing,
  // so a budget-exhausted import stops touching disk as soon as possible.
  if (ctx.filesOpened >= MAX_EXEC_EXPANSIONS) {
    refuseExec(ctx, exec, file, 'exec-budget-exceeded')
    return
  }

  const resolved = await resolveExecTarget(ctx, exec.target)
  if (!resolved) {
    refuseExec(ctx, exec, file, 'exec-missing')
    return
  }

  // Canonical (symlinks and `..` resolved) so the cycle check is about files,
  // not about how they happen to be spelled.
  const canonical = await canonicalizePath(resolved)
  if (ctx.chain.has(canonical)) {
    refuseExec(ctx, exec, file, 'exec-cyclic')
    return
  }

  const read = await processFile(ctx, resolved, canonical, depth + 1)
  // Resolved but unreadable (permissions, a file that vanished between the
  // lookup and the read): as good as absent from the import's point of view.
  if (!read) refuseExec(ctx, exec, file, 'exec-missing')
}

/**
 * Reads one file as latin-1, folds its contents into `ctx` in document order
 * and expands any `exec` it contains. Returns false when the file could not
 * be read; the caller decides whether that is worth a warning.
 */
async function processFile(
  ctx: ReaderContext,
  absolutePath: string,
  canonicalPath: string,
  depth: number,
): Promise<boolean> {
  let text: string
  try {
    text = await readFile(absolutePath, 'latin1')
  } catch {
    return false
  }

  const file = fileName(absolutePath)
  ctx.filesRead.push(file)
  ctx.filesOpened++

  const stream = documentOrder(parseConfigText(text))

  ctx.chain.add(canonicalPath)
  try {
    for (const entry of stream) {
      switch (entry.kind) {
        case 'cvar':
          ctx.cvars.set(entry.item.name, entry.item.value)
          break
        case 'bind':
          applyBind(ctx, entry.item)
          break
        case 'exec':
          await expandExec(ctx, entry.item, file, depth)
          break
        case 'preserved':
          ctx.unrecognized.push({ file, line: entry.item.line, text: entry.item.text })
          break
      }
    }
  } finally {
    ctx.chain.delete(canonicalPath)
  }

  return true
}

/**
 * Reads the importable config of `<installationRoot>/<gameDir>`.
 *
 * `gameDir` is a plain folder name (`baseq2`, `xatrix`, ...); checking that it
 * really belongs to the installation happens at the IPC boundary (D3), which
 * is also where the installation root comes from - never from the renderer
 * (decision 2). Read-only: nothing is written (decision 14).
 *
 * Never throws for missing/cyclic/too-deep content; a gamedir without any
 * config file simply yields an empty result.
 */
export async function readImportableConfig(
  installationRoot: string,
  gameDir: string,
): Promise<ImportResult> {
  const ctx: ReaderContext = {
    installationRoot,
    gameDir,
    chain: new Set<string>(),
    filesOpened: 0,
    cvars: new Map<string, string>(),
    binds: new Map<string, string>(),
    unrecognized: [],
    filesRead: [],
    warnings: [],
  }

  for (const entryFile of ENTRY_FILE_NAMES) {
    const resolved = await resolveFileIn(installationRoot, gameDir, entryFile)
    if (!resolved) continue
    await processFile(ctx, resolved, await canonicalizePath(resolved), 0)
  }

  return {
    // `fromEntries` defines own properties, so a config containing a cvar or
    // key literally called `__proto__` cannot poison the returned objects.
    cvars: Object.fromEntries(ctx.cvars),
    binds: Object.fromEntries(ctx.binds),
    unrecognized: ctx.unrecognized,
    filesRead: ctx.filesRead,
    warnings: ctx.warnings,
  }
}
