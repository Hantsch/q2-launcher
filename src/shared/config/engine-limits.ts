/**
 * Engine buffer/alias limits — the canonical, citation-bearing constants
 * module the story's plan calls "engine-limits.ts".
 *
 * Ported from the external q2-config-manager project (`src/core/engines.ts`)
 * — its `COMMON` block only. Upstream's `EngineProfile`/`ENGINES`/
 * `compressedLength`/`evaluateSize` are a different, out-of-scope budget
 * concept and are not ported here.
 *
 * This is a separate, independent module from `alt-layers.ts`'s own
 * `MAX_LINE_BYTES`/`MAX_ALIAS_NAME` constants (which stay as they are, used
 * internally by story 006/007 code) — nothing here imports from or modifies
 * `alt-layers.ts`. The values are the same numbers by design (same engine
 * fact), just cited here as the canonical reference. A later deliverable
 * (alias rendering) may choose which of the two modules to import from.
 */

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
