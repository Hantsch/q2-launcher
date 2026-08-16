/**
 * Engine buffer/alias limits — the canonical, citation-bearing constants
 * module the story's plan calls "engine-limits.ts".
 *
 * Ported from the external q2-config-manager project (`src/core/engines.ts`)
 * — originally just its `COMMON` block; story 009 D1 extends this file with
 * upstream's per-engine `EngineLimits`/`ENGINES`/`compressedLength`/
 * `evaluateSize`, generalized from upstream's three-way `EngineId` to this
 * launcher's ten-way `EngineKind` the same way `cvar-facts.ts` did for the
 * cvar catalog: a `Partial<Record<EngineKind, EngineLimits>>` populated only
 * for `r1q2`/`q2pro`/`vanilla`, with `limitsFor()` returning `undefined` for
 * every other engine rather than falling back to r1q2's numbers.
 *
 * This is a separate, independent module from `alt-layers.ts`'s own
 * `MAX_LINE_BYTES`/`MAX_ALIAS_NAME` constants (which stay as they are, used
 * internally by story 006/007 code) — nothing here imports from or modifies
 * `alt-layers.ts`. The values are the same numbers by design (same engine
 * fact), just cited here as the canonical reference. A later deliverable
 * (alias rendering) may choose which of the two modules to import from.
 */

import type { EngineKind } from '../types/engine'

/**
 * Per-line buffer in Cbuf_Execute. 1024 on all three engines:
 * vanilla and r1q2 use `char line[1024]`, q2pro uses
 * `char line[MAX_STRING_CHARS]` with MAX_STRING_CHARS 1024
 * (inc/shared/shared.h:63). Q2PRO discards an over-long line with
 * "Line exceeded 1024 chars, discarded." rather than truncating it
 * (src/common/cmd.c:165-190).
 */
export const CBUF_LINE_BYTES = 1024

/** MAX_ALIAS_NAME in cmd.c (all engines this app targets). */
export const MAX_ALIAS_NAME = 32

/** ALIAS_LOOP_COUNT in cmd.c - how deep alias expansion may nest per frame. */
export const ALIAS_LOOP_COUNT = 16

/**
 * Per-engine hard limits the Quake 2 command interpreter imposes, ported
 * verbatim from upstream `src/core/engines.ts`'s `EngineLimits` interface.
 *
 * Every number was read out of engine source, not guessed. The citations
 * matter because the whole "can my config be this big?" question depends on
 * them, and the answer differs by almost an order of magnitude between
 * engines — and, in Q2PRO's case, is not even measured on the same bytes.
 */
export interface EngineLimits {
  /**
   * Maximum byte length of a single file loaded via `exec`.
   *
   * vanilla (qcommon/cmd.c): `byte cmd_text_buf[8192]`, and Cbuf_AddText does
   *   `if (cmd_text.cursize + l >= cmd_text.maxsize) { Com_Printf("Cbuf_AddText: overflow\n"); return; }`
   *   -- note the early return: on overflow the *entire* file is dropped, it
   *   is not partially applied. A 9 KB config simply does nothing on vanilla.
   *
   * r1q2 (qcommon/cmd.c:33,485-488): `#define COMMAND_BUFFER_SIZE 0x10000`
   *   (65536) and Cmd_Exec_f clamps explicitly:
   *   `if (len > COMMAND_BUFFER_SIZE - 2) { Com_Printf("WARNING: %s exceeds maximum config file length\n"); len = COMMAND_BUFFER_SIZE - 2; }`
   *   -- so r1q2 truncates at 65534 bytes and tells you on the console.
   *
   * q2pro (inc/common/cmd.h:25, src/common/cmd.c:1633-1652):
   *   `#define CMD_BUFFER_SIZE (1 << 16)` and the check is
   *   `len = COM_Compress(f); if (len >= CMD_BUFFER_SIZE) { ret = Q_ERR(EFBIG); goto finish; }`
   *   -- two things follow. The file is *rejected whole*, never truncated,
   *   and the length compared is the one after COM_Compress has stripped
   *   comments and collapsed whitespace. See `sizeCountsAfterCompression`.
   */
  execBufferBytes: number
  /** True when going over `execBufferBytes` discards the whole file rather than truncating. */
  overflowDiscardsWholeFile: boolean
  /**
   * True when the engine measures the file *after* stripping comments and
   * collapsing whitespace, so a heavily commented config costs far less than
   * its byte count suggests. Only Q2PRO does this (COM_Compress in
   * src/shared/shared.c:536, called from src/common/cmd.c:1633).
   */
  sizeCountsAfterCompression: boolean
  /**
   * Per-line buffer in Cbuf_Execute. 1024 on all three engines: vanilla and
   * r1q2 use `char line[1024]`, q2pro uses `char line[MAX_STRING_CHARS]` with
   * MAX_STRING_CHARS 1024 (inc/shared/shared.h:63). Q2PRO discards an
   * over-long line with "Line exceeded 1024 chars, discarded." rather than
   * truncating it (src/common/cmd.c:165-190). Same fact as `CBUF_LINE_BYTES`
   * above, cited again here so `EngineLimits` is self-contained.
   */
  maxLineBytes: number
  /** MAX_ALIAS_NAME in cmd.c. Same fact as `MAX_ALIAS_NAME` above. */
  maxAliasNameLength: number
  /** ALIAS_LOOP_COUNT in cmd.c - how deep alias expansion may nest per frame. Same fact as `ALIAS_LOOP_COUNT` above. */
  aliasLoopCount: number
  /** Filename the engine itself writes settings to on shutdown. */
  writtenConfigName: string
}

const COMMON = {
  maxLineBytes: CBUF_LINE_BYTES,
  maxAliasNameLength: MAX_ALIAS_NAME,
  aliasLoopCount: ALIAS_LOOP_COUNT,
} as const

/** The three engines this app has source-cited hard limits for. */
const ENGINE_KINDS_WITH_LIMITS: readonly EngineKind[] = ['r1q2', 'q2pro', 'vanilla']

/** `true` only for the engines `ENGINE_LIMITS` carries data for; `false` for every other `EngineKind`. */
export function hasEngineLimits(kind: EngineKind): boolean {
  return ENGINE_KINDS_WITH_LIMITS.includes(kind)
}

/**
 * Populated only for `r1q2`/`q2pro`/`vanilla` — the same `hasEngineFacts`
 * gating precedent as `cvar-facts.ts`. Every other `EngineKind` (including
 * the other detected-but-unsupported source ports like `yquake2`) is
 * deliberately absent so `limitsFor()` returns `undefined` rather than
 * falling back to r1q2's numbers.
 */
const ENGINE_LIMITS: Partial<Record<EngineKind, EngineLimits>> = {
  r1q2: {
    ...COMMON,
    execBufferBytes: 65534, // COMMAND_BUFFER_SIZE (0x10000) - 2
    overflowDiscardsWholeFile: false,
    sizeCountsAfterCompression: false,
    writtenConfigName: 'q2config.cfg',
  },
  q2pro: {
    ...COMMON,
    execBufferBytes: 65535, // len >= CMD_BUFFER_SIZE (1 << 16) is rejected whole (EFBIG)
    overflowDiscardsWholeFile: true,
    sizeCountsAfterCompression: true,
    writtenConfigName: 'q2config.cfg',
  },
  vanilla: {
    ...COMMON,
    execBufferBytes: 8190, // cmd_text_buf[8192], minus room for the trailing newline pair
    overflowDiscardsWholeFile: true,
    sizeCountsAfterCompression: false,
    writtenConfigName: 'config.cfg',
  },
}

/**
 * Hard limits for `engine`, or `undefined` when this app has no source-cited
 * facts for it. Never falls back to r1q2's numbers — a caller that forgets to
 * check for `undefined` gets a type error, not a wrong answer.
 */
export function limitsFor(engine: EngineKind): EngineLimits | undefined {
  return ENGINE_LIMITS[engine]
}

/**
 * Length of `text` after Q2PRO's COM_Compress would have run over it.
 *
 * Ported from src/shared/shared.c:536 rather than approximated, because this
 * number decides whether Q2PRO accepts a config at all. COM_Compress removes
 * `//` and slash-star comments, collapses each run of whitespace into a
 * single space (or a single newline if the run contained one), drops
 * backslash-newline line continuations, and copies quoted strings through
 * untouched.
 */
export function compressedLength(text: string): number {
  const at = (index: number): number => (index < text.length ? text.charCodeAt(index) : 0)
  const SPACE = 0x20
  const NEWLINE = 0x0a
  const RETURN = 0x0d
  const SLASH = 0x2f
  const STAR = 0x2a
  const QUOTE = 0x22
  const BACKSLASH = 0x5c

  let count = 0
  // The character COM_Compress owes the output for the whitespace it skipped.
  let pending = 0
  let i = 0

  while (at(i) !== 0) {
    // Skip whitespace, remembering whether the run contained a line feed.
    if (at(i) <= SPACE) {
      if (pending === 0) pending = SPACE
      do {
        const c = at(i)
        i++
        if (c === NEWLINE) pending = NEWLINE
        if (c === 0) return count
      } while (at(i) <= SPACE)
    }

    if (at(i) === SLASH && at(i + 1) === SLASH) {
      pending = SPACE
      i += 2
      while (at(i) !== 0 && at(i) !== NEWLINE) i++
      continue
    }

    if (at(i) === SLASH && at(i + 1) === STAR) {
      pending = SPACE
      i += 2
      while (at(i) !== 0) {
        if (at(i) === STAR && at(i + 1) === SLASH) {
          i += 2
          break
        }
        if (at(i) === NEWLINE) pending = NEWLINE
        i++
      }
      continue
    }

    if (pending !== 0) {
      count++
      pending = 0
    }

    // Quoted strings are copied verbatim, comment markers inside them included.
    if (at(i) === QUOTE) {
      i++
      count++
      for (;;) {
        const c = at(i)
        i++
        if (c === 0) return count
        count++
        if (c === QUOTE) break
      }
      continue
    }

    // Line continuations disappear entirely.
    if (at(i) === BACKSLASH && at(i + 1) === NEWLINE) {
      i += 2
      continue
    }
    if (at(i) === BACKSLASH && at(i + 1) === RETURN && at(i + 2) === NEWLINE) {
      i += 3
      continue
    }

    // A regular word.
    do {
      count++
      i++
    } while (at(i) > SPACE)
  }

  return count
}

/** What `engine` would measure when deciding whether `content` fits, or `undefined` when out of scope. */
export function effectiveSize(content: string, engine: EngineKind): number | undefined {
  const limits = limitsFor(engine)
  if (!limits) return undefined
  return limits.sizeCountsAfterCompression ? compressedLength(content) : content.length
}

/**
 * Budget report for a config file against one engine's `execBufferBytes`.
 *
 * `overflowDiscardsWholeFile` and `sizeCountsAfterCompression` are carried
 * through from `EngineLimits` so a caller (D3's structural checks) can word
 * the finding correctly without looking the engine up a second time: q2pro
 * rejects the whole file (EFBIG) measured on compressed bytes, r1q2 truncates
 * measured on raw bytes, vanilla discards the whole file measured on raw
 * bytes.
 */
export interface SizeBudget {
  /** Raw file size in bytes, i.e. what the file system shows. */
  bytes: number
  /** What the engine actually compares against its limit. */
  effectiveBytes: number
  limit: number
  engine: EngineKind
  ratio: number
  level: 'ok' | 'warn' | 'over'
  /** True when the engine strips comments before measuring, so the two differ. */
  sizeCountsAfterCompression: boolean
  /** True when going over `limit` discards the whole file rather than truncating. */
  overflowDiscardsWholeFile: boolean
}

/**
 * `content` is optional so a caller that only has a byte count still gets a
 * usable answer; without it, an engine that measures compressed size is
 * evaluated on the raw count, which errs towards warning too early. Returns
 * `undefined` for an engine `limitsFor` has no facts for — never r1q2's
 * budget as a fallback.
 *
 * Arithmetic (ratio = effectiveBytes / limit, warn above 0.8, over above 1.0)
 * matches upstream's `evaluateSize` exactly; a later deliverable's tests pin
 * this down.
 */
export function evaluateSize(
  bytes: number,
  engine: EngineKind,
  content?: string,
): SizeBudget | undefined {
  const limits = limitsFor(engine)
  if (!limits) return undefined

  const limit = limits.execBufferBytes
  const countsCompressed = limits.sizeCountsAfterCompression
  const effectiveBytes = countsCompressed && content !== undefined ? compressedLength(content) : bytes
  const ratio = effectiveBytes / limit

  return {
    bytes,
    effectiveBytes,
    limit,
    engine,
    ratio,
    sizeCountsAfterCompression: countsCompressed,
    overflowDiscardsWholeFile: limits.overflowDiscardsWholeFile,
    level: effectiveBytes > limit ? 'over' : ratio > 0.8 ? 'warn' : 'ok',
  }
}
